import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { Select } from "@/components/panelui/select";
import { Textarea } from "@/components/panelui/textarea";
import { textDirection } from "@/lib/text/direction";
import { newStudyCard, readFlashcardDraftPassages, saveStudyDraftCards, studyId } from "@/lib/db/study";
import { flashcardCitationsFor, flashcardMaterialLimit, maxDraftImages } from "@/lib/study/ai";
import { askStudyModel } from "@/lib/study/client";
import { AIModelPicker } from "@/components/ai/ai-model-picker";
import {
  clearFlashcardDraft,
  flashcardDraftKey,
  readFlashcardDraft,
  restoreFlashcardSource,
  snapshotFlashcardSource,
  writeFlashcardDraft,
  type FlashcardDraftState,
  type FlashcardSource,
} from "@/lib/study/flashcard-draft-recovery";
import { studyHref, tutorCardsScope } from "@/lib/study/links";
import { returnFromTutorCards } from "@/lib/study/return-links";

export type { FlashcardSource };
type Draft = FlashcardDraftState["batches"][number]["drafts"][number];

export function StudyFlashcardDraftDialog({
  source,
  vaultId,
  title,
  recoveryKey,
  onClose,
  onSave,
}: {
  source?: FlashcardSource;
  vaultId: string;
  title?: string;
  recoveryKey?: string;
  onClose: () => void;
  onSave: (count: number) => void;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content closeLabel={common("actions.close")}>
        <Dialog.Header title={title ?? t("study.capture.draftCards")} description={source?.title} />
        <Dialog.Body>
          <StudyFlashcardGenerator
            key={recoveryKey ?? flashcardDraftKey(vaultId, source)}
            close={onClose}
            source={source}
            recoveryKey={recoveryKey}
            vaultId={vaultId}
            onSave={onSave}
          />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog>
  );
}

export function StudyFlashcardGenerator({
  close,
  source: requestedSource,
  recoveryKey,
  vaultId,
  onSave,
}: {
  close: () => void;
  source?: FlashcardSource;
  recoveryKey?: string;
  vaultId: string;
  onSave?: (count: number) => void;
}) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const location = useLocation();
  const [key] = useState(() => recoveryKey ?? flashcardDraftKey(vaultId, requestedSource));
  const [restored] = useState(() => {
    const recovery = readFlashcardDraft(key);
    return recovery?.vaultId === vaultId ? recovery : undefined;
  });
  const [source] = useState(() => restored ? restoreFlashcardSource(restored.source) : requestedSource);
  const [editor, setEditor] = useState<FlashcardDraftState>(() => restored?.editor ?? ({
    freeText: "",
    part: 0,
    count: 5,
    batches: source?.cards?.length ? [{
      part: 0,
      origin: source.origin,
      drafts: source.cards.map((card) => ({ ...card, id: studyId() })),
      excerpts: [],
    }] : [],
  }));
  const { freeText, part, count, batches } = editor;
  const liveEditor = useRef(editor);
  const snapshot = useRef(restored?.source);
  const version = useRef(restored?.version);
  const warned = useRef(false);
  const [journaled, setJournaled] = useState(Boolean(restored));
  const [discarding, setDiscarding] = useState(false);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [choosingPart, setChoosingPart] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pendingSave = useRef<symbol | null>(null);
  const material = useMemo(() => source?.parts?.[part]?.load() ?? source, [part, source]);
  const input = material ? material.text.slice(0, flashcardMaterialLimit) : freeText;
  const batch = batches.find((entry) => entry.part === part);
  const drafts = batch?.drafts ?? [];
  const parts = source?.parts ?? [];
  const partOptions = parts.map(({ heading, preview }, index) => {
    const number = t("study.capture.partNumber", { number: index + 1 });
    return {
      value: String(index),
      label: heading ? `${heading} · ${number}` : number,
      description: heading ? undefined : preview,
    };
  });
  const pending = batches.toSorted((a, b) => a.part - b.part).flatMap(({ drafts, origin }) =>
    drafts.filter(({ front, back }) => front.trim() && back.trim()).map((draft) => ({ ...draft, origin })),
  );

  useEffect(
    () => () => {
      controller.current?.abort();
      pendingSave.current = null;
    },
    [],
  );

  function updateEditor(change: (current: FlashcardDraftState) => FlashcardDraftState) {
    const next = change(liveEditor.current);
    liveEditor.current = next;
    setEditor(next);
    if (source && !snapshot.current) snapshot.current = snapshotFlashcardSource(source);
    const nextVersion = studyId();
    const saved = writeFlashcardDraft({
      key,
      vaultId,
      source: snapshot.current,
      version: nextVersion,
      editor: next,
    }, version.current);
    if (saved) {
      version.current = nextVersion;
      setJournaled(true);
    } else if (!warned.current) {
      warned.current = true;
      toast.warning(t("study.capture.draftRecoveryUnavailable"));
    }
  }

  async function generate() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setWorking(true);
    updateEditor((current) => current);
    try {
      const passages = material?.passages ?? await readFlashcardDraftPassages(material?.evidence ?? [], vaultId);
      request.signal.throwIfAborted();
      const draftImages = passages.flatMap(({ image }, index) => image ? [{ passage: index + 1, image }] : []);
      const answer = await askStudyModel({
        use: "cards",
        action: "cards",
        input: input.trim(),
        passages,
        draftImages: draftImages.length ? draftImages : undefined,
        cardCount: count,
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        const unique = new Map(
          (answer.cards ?? [])
            .filter(({ front, back }) => front.trim() && back.trim())
            .map(({ front, back, citations }) => [
              front.trim().toLocaleLowerCase(),
              {
                id: studyId(),
                front,
                back,
                citations: material?.evidence?.length || material?.passages?.length
                  ? flashcardCitationsFor(citations, passages, answer.imageFallback)
                  : undefined,
              },
            ]),
        );
        const cards = [...unique.values()];
        if (!cards.length) toast.error("The model returned no flashcards.");
        else {
          if (answer.imageFallback) toast.info(t("study.capture.draftImageFallback"));
          updateEditor((current) => ({
            ...current,
            batches: [
              ...current.batches.filter((entry) => entry.part !== part),
              {
                part,
                origin: material?.origin,
                drafts: cards,
                excerpts: passages.map(({ text }) => text.slice(0, 280)),
              },
            ],
          }));
        }
      }
    } catch (error) {
      if (!request.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setWorking(false);
      }
    }
  }

  async function save(review: boolean) {
    if (working || pendingSave.current) return;
    const cards = pending.map(({ id, front, back, citations, origin }) =>
      newStudyCard({
        front: front.trim(),
        back: back.trim(),
        notebookId: source?.notebookId,
        vaultId,
        origin,
        citations,
        tags: source?.tags ?? [],
      }, id),
    );
    if (!cards.length) return;
    const transaction = Symbol();
    pendingSave.current = transaction;
    setSaving(true);
    try {
      await saveStudyDraftCards(cards);
      if (pendingSave.current !== transaction) return;
      if (version.current) clearFlashcardDraft(key, version.current);
      close();
      if (review) {
        const origin = source?.origin;
        const note = origin?.kind === "note" ? origin.noteId : undefined;
        navigate(studyHref("review", { vault: vaultId, note, ...tutorCardsScope(origin) }), {
          state: {
            ...returnFromTutorCards(location.pathname + location.search, location.state, origin),
            studyReviewVault: vaultId,
            studyReviewIds: cards.map(({ id }) => id),
          },
        });
      } else onSave?.(cards.length);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (pendingSave.current === transaction) {
        pendingSave.current = null;
        setSaving(false);
      }
    }
  }

  const canSave = !working && !saving && pending.length > 0;

  function changeDrafts(update: (current: Draft[]) => Draft[]) {
    updateEditor((current) => ({
      ...current,
      batches: current.batches.map((entry) =>
        entry.part === part ? { ...entry, drafts: update(entry.drafts) } : entry,
      ),
    }));
  }

  function updateDraft(position: number, change: Partial<Draft>) {
    changeDrafts((items) =>
      items.map((item, index) => (index === position ? { ...item, ...change } : item)),
    );
  }

  return (
    <section
      className={source ? "space-y-4" : "space-y-4 rounded-2xl border bg-card p-4"}
      aria-label={source ? t("study.capture.draftCards") : undefined}
    >
      {!source ? <h3 className="text-base font-semibold">Generate from text</h3> : null}
      {journaled ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t(restored ? "study.capture.draftRestored" : "study.capture.draftCheckpoint")}
        </p>
      ) : null}
      <form
        hidden={Boolean(source && (!input.trim() || source.cards?.length))}
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim() && !working && !saving) void generate();
        }}
        className="space-y-2"
      >
        {parts.length > 1 ? (
          <div
            onKeyDownCapture={(event) => {
              if (event.key !== "Escape" || !choosingPart) return;
              event.preventDefault();
              event.stopPropagation();
              setChoosingPart(false);
            }}
          >
            <Select
              items={partOptions}
              open={choosingPart}
              onOpenChange={setChoosingPart}
              value={String(part)}
              onValueChange={(value) => {
                if (value !== null) updateEditor((current) => ({ ...current, part: Number(value) }));
              }}
              disabled={working || saving}
            >
              <Select.Trigger aria-label={t("study.capture.materialPart")}>
                <Select.Value />
              </Select.Trigger>
              <Select.Content alignItemWithTrigger={false} className="max-w-(--anchor-width)">
                {partOptions.map(({ value, label, description }) => (
                  <Select.Item key={value} value={value} description={description}>{label}</Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
        ) : null}
        <Textarea
          aria-label="Text for flashcards"
          placeholder="Paste the material you want to study"
          dir={textDirection(input)}
          minRows={4}
          value={input}
          disabled={working || saving}
          readOnly={Boolean(source)}
          onChange={(event) => {
            const freeText = event.target.value;
            updateEditor((current) => ({ ...current, freeText }));
          }}
          maxLength={flashcardMaterialLimit}
        />
        {material?.evidence?.some((origin) => origin.kind === "card" || (origin.kind === "book" && origin.visual)) ? (
          <p className="text-xs text-muted-foreground">
            {t("study.capture.draftUsesImages", { count: maxDraftImages })}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            Cards
            <Input
              type="number"
              min={1}
              max={20}
              value={count}
              disabled={working || saving}
              onChange={(event) => {
                const count = Math.max(1, Math.min(20, Math.trunc(event.target.valueAsNumber) || 1));
                updateEditor((current) => ({ ...current, count }));
              }}
              className="w-20"
            />
          </label>
          <AIModelPicker use="cards" appearance="outline" side="bottom" />
          <Button type="submit" size="sm" disabled={!input.trim() || working || saving}>
            {working ? "Generating…" : drafts.length ? "Generate again" : "Generate cards"}
          </Button>
          {working ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => controller.current?.abort()}
            >
              Stop
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={close}>
            Close
          </Button>
        </div>
      </form>
      {drafts.length ? (
        <div className="space-y-2">
          <ul className="divide-y rounded-xl border">
            {drafts.map((draft, position) => (
              <li key={position} className="grid gap-2 p-3">
                <Textarea
                  aria-label={`Card ${position + 1} question`}
                  minRows={1}
                  value={draft.front}
                  dir={textDirection(draft.front)}
                  disabled={working || saving}
                  onChange={(event) => updateDraft(position, { front: event.target.value })}
                />
                <Textarea
                  aria-label={`Card ${position + 1} answer`}
                  minRows={1}
                  value={draft.back}
                  dir={textDirection(draft.back)}
                  disabled={working || saving}
                  onChange={(event) => updateDraft(position, { back: event.target.value })}
                />
                {draft.citations?.length ? (
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {t("study.capture.cardSources")}
                    </p>
                    <ul>
                      {draft.citations.map((citation) => (
                        <li key={citation.index} className="flex items-start justify-between gap-2">
                          <div className="min-w-0 py-1 text-sm wrap-break-word">
                            <p dir="auto">
                              [{citation.index}] {citation.title}
                            </p>
                            <p dir="auto" className="line-clamp-2 text-xs text-muted-foreground">
                              {batch?.excerpts[citation.index - 1] ||
                                ("origin" in citation && citation.origin.kind === "book" && citation.origin.visual
                                  ? t("study.reader.imageContext")
                                  : null)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={working || saving}
                            aria-label={t("study.capture.removeCardSource", {
                              title: citation.title,
                              number: citation.index,
                            })}
                            onClick={() =>
                              updateDraft(position, {
                                citations: draft.citations?.filter(
                                  ({ index }) => index !== citation.index,
                                ),
                              })
                            }
                          >
                            {t("study.capture.removeSource")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="justify-self-start"
                  disabled={working || saving}
                  onClick={() =>
                    changeDrafts((items) => items.filter((_, index) => index !== position))
                  }
                >
                  Remove draft
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {drafts.length || pending.length ? (
        <div className="space-y-2">
          {parts.length > 1 && pending.length > 0 ? (
            <p className="text-xs text-muted-foreground" role="status">
              {t("study.capture.pendingDrafts", { count: pending.length })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!canSave} onClick={() => void save(true)}>
              {t("study.capture.saveAndReview")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canSave}
              onClick={() => void save(false)}
            >
              {t("study.capture.saveDrafts")}
            </Button>
          </div>
        </div>
      ) : null}
      {journaled ? (
        <Button type="button" size="sm" variant="ghost" disabled={working || saving} onClick={() => setDiscarding(true)}>
          {t("study.capture.discardDraft")}
        </Button>
      ) : null}
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={t("study.capture.discardDraftTitle")}
        body={t("study.capture.discardDraftBody")}
        confirmLabel={t("study.capture.discardDraft")}
        onConfirm={() => {
          setDiscarding(false);
          if (version.current) clearFlashcardDraft(key, version.current);
          close();
        }}
      />
    </section>
  );
}
