import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { Textarea } from "@/components/panelui/textarea";
import { saveStudyOcrPages, studyId, StudyTextConflict, writeStudyOcrDraft } from "@/lib/db/study";
import { recognizeStudyPdfPages, renderStudyOcrPreview, type StudyOcrBatchEvent } from "@/lib/study/ocr-client";
import { maxOcrText } from "@/lib/study/ocr-format";
import type { StudyBook, StudyOcrDraft, StudyOcrDraftPage } from "@/lib/study/records";
import { StudyOcrLanguageFields, useStudyOcrLanguages } from "./study-ocr-languages";

type Result = { kind: "draft"; page: StudyOcrDraftPage } | { kind: "error"; message: string };

function draftPages(results: Map<number, Result>) {
  return [...results.values()].flatMap((result) => result.kind === "draft" ? [result.page] : []);
}

function PagePreview({ fileId, section, title }: { fileId: string; section: number; title: string }) {
  const { t } = useTranslation("home");
  const [preview, setPreview] = useState<string | null>();
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void renderStudyOcrPreview(fileId, section, controller.signal).then((image) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(image);
      setPreview(url);
    }).catch(() => { if (!controller.signal.aborted) setPreview(null); });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, section]);
  return preview ? (
    <img src={preview} alt={t("study.scan.originalPage", { title })} className="max-h-[40dvh] w-full rounded-lg border object-contain" />
  ) : (
    <p role="status" className="self-start text-sm text-muted-foreground">
      {t(preview === null ? "study.scan.previewFailed" : "study.scan.previewLoading")}
    </p>
  );
}

export function StudyBatchOcr({ book, fileId, page, draft, onClose, onSave }: {
  book: StudyBook;
  fileId: string;
  page: number;
  draft?: StudyOcrDraft;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  const choice = useStudyOcrLanguages(draft?.pages[0]?.languages ?? book.sections[page].ocrLanguages);
  const blankPages = book.sections.flatMap(({ text }, index) => text.trim() ? [] : [index]);
  const [from, setFrom] = useState(() => {
    const start = blankPages.find((index) => index >= page) ?? blankPages[0] ?? page;
    const firstDraft = draft?.pages.reduce((first, { section }) => Math.min(first, section), start) ?? start;
    return String(firstDraft + 1);
  });
  const [through, setThrough] = useState(() => String((blankPages.at(-1) ?? page) + 1));
  const [results, setResults] = useState(() => new Map<number, Result>(
    draft?.pages.map((page) => [page.section, { kind: "draft", page }]),
  ));
  const resultsRef = useRef(results);
  const version = useRef(draft?.version);
  const pendingDraft = useRef<StudyOcrDraftPage[] | undefined>(undefined);
  const writing = useRef<Promise<boolean> | null>(null);
  const [draftStatus, setDraftStatus] = useState<"writing" | "saved" | "failed">("saved");
  const [published, setPublished] = useState<Set<number>>(() => new Set());
  const [selected, setSelected] = useState<number>();
  const [progress, setProgress] = useState<Extract<StudyOcrBatchEvent, { kind: "started" }>>();
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirm, setConfirm] = useState<"discard" | "close">();
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const first = Number(from);
  const last = Number(through);
  const validRange = Number.isInteger(first) && Number.isInteger(last) && first >= 1 && last >= first && last <= book.sections.length;
  const pending = validRange ? blankPages.filter((index) => index + 1 >= first && index + 1 <= last &&
    !published.has(index) && results.get(index)?.kind !== "draft") : [];
  const ordered = [...results.entries()].sort(([left], [right]) => left - right);
  const drafts = draftPages(results);
  const reviewed = drafts.filter((page) => page.reviewed && page.text.trim());
  const active = selected !== undefined && results.has(selected) ? selected : ordered[0]?.[0];
  const result = active === undefined ? undefined : results.get(active);

  function replaceResults(next: Map<number, Result>) {
    resultsRef.current = next;
    setResults(next);
  }

  async function persist(pages: StudyOcrDraftPage[]) {
    const nextVersion = studyId();
    const saved = await writeStudyOcrDraft({ bookId: book.id, fileId, pages, version: nextVersion, replaces: version.current });
    if (saved) version.current = nextVersion;
    return saved;
  }

  function flushDraft() {
    if (writing.current) return writing.current;
    if (!pendingDraft.current) return Promise.resolve(true);
    setDraftStatus("writing");
    const task = (async () => {
      try {
        while (pendingDraft.current) {
          const pages = pendingDraft.current;
          if (!await persist(pages)) return false;
          if (pendingDraft.current === pages) pendingDraft.current = undefined;
        }
        return true;
      } catch {
        return false;
      }
    })();
    writing.current = task;
    void task.then((saved) => {
      writing.current = null;
      setDraftStatus(saved ? "saved" : "failed");
    });
    return task;
  }

  function put(section: number, result: Result) {
    const next = new Map(resultsRef.current).set(section, result);
    replaceResults(next);
    if (result.kind === "draft") {
      pendingDraft.current = draftPages(next);
      void flushDraft();
    }
  }

  async function recognize() {
    if (!pending.length || !choice.codes.length || request.current || saving) return;
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setStopped(false);
    setError(undefined);
    const codes = choice.codes;
    try {
      await recognizeStudyPdfPages(fileId, pending, codes, controller.signal, (event) => {
        if (event.kind === "started") {
          setProgress(event);
          return;
        }
        if (event.kind === "error" || !event.text.trim()) {
          put(event.section, { kind: "error", message: event.kind === "error" ? event.message || t("study.scan.failed") : t("study.scan.noText") });
        } else {
          put(event.section, { kind: "draft", page: {
            section: event.section, text: event.text, previousText: book.sections[event.section].text,
            languages: codes, reviewed: false,
          } });
        }
      });
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t("study.scan.failed"));
    } finally {
      request.current = null;
      setRunning(false);
      setProgress(undefined);
    }
  }

  async function save() {
    if (saving || running || !reviewed.length) return;
    setSaving(true);
    setError(undefined);
    try {
      if (!await flushDraft() || !version.current) return;
      await saveStudyOcrPages({ bookId: book.id, fileId, pages: reviewed, draftVersion: version.current });
      const saved = new Set(reviewed.map(({ section }) => section));
      setPublished((current) => new Set([...current, ...saved]));
      replaceResults(new Map([...resultsRef.current].filter(([index]) => !saved.has(index))));
      onSave();
    } catch (error) {
      setError(error instanceof StudyTextConflict ? t("study.reader.editConflict") : error instanceof Error ? error.message : t("study.scan.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function close() {
    if (saving || closing) return;
    setClosing(true);
    request.current?.abort();
    if (await flushDraft()) onClose();
    else setConfirm("close");
    setClosing(false);
  }

  async function discard() {
    if (saving || running || closing) return;
    setClosing(true);
    if (await flushDraft() && await persist([]).catch(() => false)) onClose();
    else setError(t("study.scan.discardFailed"));
    setClosing(false);
  }

  const locked = saving || closing;
  return (
    <Dialog open dismissible={!locked && !confirm} onOpenChange={(open) => { if (!open && !confirm) void close(); }}>
      <Dialog.Content size="lg" closeLabel={common("actions.close")}>
        <Dialog.Header title={t("study.scan.batch")} description={t("study.scan.batchDescription")} />
        <Dialog.Body>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2.5">
              <label className="grid gap-1 text-sm">{t("study.scan.fromPage")}
                <Input type="number" min={1} max={book.sections.length} value={from} disabled={running || locked}
                  onChange={(event) => setFrom(event.target.value)} className="w-24" />
              </label>
              <label className="grid gap-1 text-sm">{t("study.scan.throughPage")}
                <Input type="number" min={1} max={book.sections.length} value={through} disabled={running || locked}
                  onChange={(event) => setThrough(event.target.value)} className="w-24" />
              </label>
            </div>
            {choice.options.length ? (
              <div className="flex flex-wrap items-end gap-2.5">
                <StudyOcrLanguageFields choice={choice} disabled={running || locked} />
                {running ? (
                  <Button type="button" variant="outline" disabled={stopped} onClick={() => { setStopped(true); request.current?.abort(); }}>
                    {t("study.scan.stop")}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" disabled={!pending.length || locked} onClick={() => void recognize()}>
                    {t("study.scan.recognizePages")}
                  </Button>
                )}
              </div>
            ) : <p role="status" className="text-sm text-muted-foreground">{choice.fallback}</p>}
            <p role="status" className="text-sm text-muted-foreground">
              {running && progress ? t("study.scan.batchProgress", {
                title: book.sections[progress.section].title, current: progress.done + 1, total: progress.total,
              }) : stopped ? t("study.scan.stopped") : validRange ? t("study.scan.eligible", { count: pending.length }) : t("study.scan.invalidRange", { count: book.sections.length })}
            </p>
            {active !== undefined ? (
              <section className="space-y-3 border-t pt-3">
                <label className="grid gap-1 text-sm">
                  {t("study.scan.reviewPage")}
                  <select value={active} onChange={(event) => setSelected(Number(event.target.value))} className="rounded-lg border bg-background p-2">
                    {ordered.map(([index, item]) => <option key={index} value={index}>{t("study.scan.pageOption", {
                      title: book.sections[index].title,
                      status: t(item.kind === "error" ? "study.scan.unreadable" : item.page.reviewed ? "study.scan.approved" : "study.scan.pendingReview"),
                    })}</option>)}
                  </select>
                </label>
                {result?.kind === "draft" ? (
                  <>
                    <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                      <PagePreview key={active} fileId={fileId} section={active} title={book.sections[active].title} />
                      <label className="grid gap-1 text-sm">
                        {t("study.scan.review")}
                        <Textarea dir="auto" minRows={6} maxRows={12} maxLength={maxOcrText} value={result.page.text} disabled={locked}
                          onChange={(event) => put(active, { ...result, page: { ...result.page, text: event.target.value } })} />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={result.page.reviewed} disabled={locked || !result.page.text.trim()}
                        onChange={(event) => put(active, { ...result, page: { ...result.page, reviewed: event.target.checked } })} />
                      {t("study.scan.approvePage")}
                    </label>
                  </>
                ) : result?.kind === "error" ? <p className="text-sm text-muted-foreground">{result.message}</p> : null}
              </section>
            ) : null}
            {draftStatus === "failed" ? (
              <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="text-sm text-destructive">{t("study.scan.draftFailed")}</p>
                <Button type="button" variant="outline" size="sm" disabled={locked}
                  onClick={() => void flushDraft()}>{t("study.scan.retryDraft")}</Button>
              </div>
            ) : null}
            {drafts.length && !running ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                {draftStatus !== "failed" ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t(draftStatus === "writing" ? "study.scan.draftSaving" : "study.scan.draftSaved")}
                  </p>
                ) : null}
                <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => setConfirm("discard")}>
                  {t("study.scan.discardDraft")}
                </Button>
              </div>
            ) : null}
            {published.size ? <p role="status" className="text-sm">{t("study.scan.pagesSaved", { count: published.size })}</p> : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="secondary" disabled={locked} onClick={() => void close()}>{common("actions.close")}</Button>
          <Button type="button" className="max-sm:flex-[2]! max-sm:px-2"
            disabled={!reviewed.length || running || locked} onClick={() => void save()}>
            {t("study.scan.saveReviewed", { count: reviewed.length })}
          </Button>
        </Dialog.Footer>
        <ConfirmDialog open={confirm !== undefined} onOpenChange={(open) => { if (!open) setConfirm(undefined); }}
          title={t(confirm === "close" ? "study.scan.leaveTitle" : "study.scan.discardTitle")}
          body={t(confirm === "close" ? "study.scan.leaveDescription" : "study.scan.discardDescription")}
          confirmLabel={t(confirm === "close" ? "study.scan.leave" : "study.scan.discard")}
          onConfirm={confirm === "close" ? onClose : discard} />
      </Dialog.Content>
    </Dialog>
  );
}
