import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { Textarea } from "@/components/panelui/textarea";
import { textDirection } from "@/lib/text/direction";
import { newStudyCard, putStudyRecords, readFlashcardDraftPassages } from "@/lib/db/study";
import { flashcardCitationsFor, flashcardMaterialLimit, maxDraftImages } from "@/lib/study/ai";
import { askStudyModel } from "@/lib/study/client";
import { studyHref } from "@/lib/study/links";
import type { StudyDraftPassage } from "@/lib/study/passages";
import type { StudyCitation, StudyOrigin } from "@/lib/study/records";

type Draft = { front: string; back: string; citations?: StudyCitation[] };
export type FlashcardSource = {
  title: string;
  text: string;
  origin: StudyOrigin;
  evidence?: StudyOrigin[];
  passages?: StudyDraftPassage[];
  notebookId?: string;
  tags: string[];
  cards?: Draft[];
};

export function StudyFlashcardDraftDialog({
  source,
  vaultId,
  title,
  onClose,
  onSave,
}: {
  source: FlashcardSource;
  vaultId: string;
  title?: string;
  onClose: () => void;
  onSave: (count: number) => void;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content closeLabel={common("actions.close")}>
        <Dialog.Header title={title ?? t("study.capture.draftCards")} description={source.title} />
        <Dialog.Body>
          <StudyFlashcardGenerator
            close={onClose}
            source={source}
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
  source,
  vaultId,
  onSave,
}: {
  close: () => void;
  source?: FlashcardSource;
  vaultId: string;
  onSave?: (count: number) => void;
}) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const [input, setInput] = useState(source?.text.slice(0, flashcardMaterialLimit) ?? "");
  const [count, setCount] = useState(5);
  const [drafts, setDrafts] = useState<Draft[]>(source?.cards ?? []);
  const [referenceExcerpts, setReferenceExcerpts] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pendingSave = useRef<symbol | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
      pendingSave.current = null;
    },
    [],
  );

  async function generate() {
    const request = new AbortController();
    controller.current = request;
    setWorking(true);
    try {
      const passages = source?.passages ?? await readFlashcardDraftPassages(source?.evidence ?? [], vaultId);
      request.signal.throwIfAborted();
      const draftImages = passages.flatMap(({ image }, index) => image ? [{ passage: index + 1, image }] : []);
      const answer = await askStudyModel({
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
                front,
                back,
                citations: source?.evidence?.length || source?.passages?.length
                  ? flashcardCitationsFor(
                      answer.imageFallback ? citations?.filter((index) => !passages[index - 1]?.image) : citations,
                      passages,
                    )
                  : undefined,
              },
            ]),
        );
        const cards = [...unique.values()];
        if (!cards.length) toast.error("The model returned no flashcards.");
        else {
          if (answer.imageFallback) toast.info(t("study.capture.draftImageFallback"));
          setDrafts(cards);
          setReferenceExcerpts(passages.map(({ text }) => text.slice(0, 280)));
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
    const cards = drafts
      .filter(({ front, back }) => front.trim() && back.trim())
      .map(({ front, back, citations }) =>
        newStudyCard({
          front: front.trim(),
          back: back.trim(),
          notebookId: source?.notebookId,
          vaultId,
          origin: source?.origin,
          citations,
          tags: source?.tags ?? [],
        }),
      );
    if (!cards.length) return;
    const transaction = Symbol();
    pendingSave.current = transaction;
    setSaving(true);
    try {
      await putStudyRecords(...cards);
      if (pendingSave.current !== transaction) return;
      close();
      if (review) {
        const note = source?.origin.kind === "note" ? source.origin.noteId : undefined;
        navigate(studyHref("review", { vault: vaultId, note }), {
          state: { studyReviewVault: vaultId, studyReviewIds: cards.map(({ id }) => id) },
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

  const canSave =
    !working && !saving && drafts.some(({ front, back }) => front.trim() && back.trim());

  function updateDraft(position: number, change: Partial<Draft>) {
    setDrafts((items) =>
      items.map((item, index) => (index === position ? { ...item, ...change } : item)),
    );
  }

  return (
    <section
      className={source ? "space-y-4" : "space-y-4 rounded-2xl border bg-card p-4"}
      aria-label={source ? t("study.capture.draftCards") : undefined}
    >
      {!source ? <h3 className="text-base font-semibold">Generate from text</h3> : null}
      <form
        hidden={Boolean(source && (!input.trim() || source.cards?.length))}
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim() && !working && !saving) void generate();
        }}
        className="space-y-2"
      >
        <Textarea
          aria-label="Text for flashcards"
          placeholder="Paste the material you want to study"
          dir={textDirection(input)}
          minRows={4}
          value={input}
          disabled={working || saving}
          readOnly={Boolean(source)}
          onChange={(event) => setInput(event.target.value)}
          maxLength={flashcardMaterialLimit}
        />
        {source?.evidence?.some((origin) => origin.kind === "book" && origin.visual) ? (
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
              onChange={(event) => setCount(event.target.valueAsNumber || 1)}
              className="w-20"
            />
          </label>
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
                              {referenceExcerpts[citation.index - 1] ||
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
                    setDrafts((items) => items.filter((_, index) => index !== position))
                  }
                >
                  Remove draft
                </Button>
              </li>
            ))}
          </ul>
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
    </section>
  );
}
