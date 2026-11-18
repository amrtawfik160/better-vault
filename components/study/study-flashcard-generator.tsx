import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { Textarea } from "@/components/panelui/textarea";
import { newStudyCard, putStudyRecords } from "@/lib/db/study";
import { flashcardMaterialLimit } from "@/lib/study/ai";
import { askStudyModel } from "@/lib/study/client";
import { studyHref } from "@/lib/study/links";
import type { StudyOrigin } from "@/lib/study/records";

type Draft = { front: string; back: string };
export type FlashcardSource = {
  title: string;
  text: string;
  origin: StudyOrigin;
  notebookId?: string;
  tags: string[];
  cards?: Draft[];
};

export function StudyFlashcardDraftDialog({
  source,
  vaultId,
  onClose,
  onSave,
}: {
  source: FlashcardSource;
  vaultId: string;
  onClose: () => void;
  onSave: (count: number) => void;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content closeLabel={common("actions.close")}>
        <Dialog.Header title={t("study.capture.draftCards")} description={source.title} />
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
      const answer = await askStudyModel({
        action: "cards",
        input: input.trim(),
        cardCount: count,
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        const unique = new Map(
          (answer.cards ?? [])
            .filter(({ front, back }) => front.trim() && back.trim())
            .map((card) => [card.front.trim().toLocaleLowerCase(), card]),
        );
        const cards = [...unique.values()];
        if (!cards.length) toast.error("The model returned no flashcards.");
        else setDrafts(cards);
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
      .map(({ front, back }) =>
        newStudyCard({
          front: front.trim(),
          back: back.trim(),
          notebookId: source?.notebookId,
          vaultId,
          origin: source?.origin,
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
        navigate(studyHref("review", { vault: vaultId }), {
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
          dir="auto"
          minRows={4}
          value={input}
          disabled={working || saving}
          readOnly={Boolean(source)}
          onChange={(event) => setInput(event.target.value)}
          maxLength={flashcardMaterialLimit}
        />
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
                <Input
                  aria-label={`Card ${position + 1} question`}
                  value={draft.front}
                  dir="auto"
                  disabled={working || saving}
                  onChange={(event) =>
                    setDrafts((items) =>
                      items.map((item, index) =>
                        index === position ? { ...item, front: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Card ${position + 1} answer`}
                  value={draft.back}
                  dir="auto"
                  disabled={working || saving}
                  onChange={(event) =>
                    setDrafts((items) =>
                      items.map((item, index) =>
                        index === position ? { ...item, back: event.target.value } : item,
                      ),
                    )
                  }
                />
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
