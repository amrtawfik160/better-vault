import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import {
  removeStudyRecord,
  saveStudyWord,
  studyId,
  studyVocabularyCards,
  updateStudyWord,
} from "@/lib/db/study";
import type { StudyRecordOf, StudyWord } from "@/lib/study/records";
import {
  linkedVocabularyCard,
  vocabularyCardId,
  vocabularyCardSides,
} from "@/lib/study/vocabulary";
import { StudyOriginLink } from "./study-origin-link";

export function VocabularyLibrary({
  words,
  cards,
  vaultId,
  focusedWord,
  review,
}: {
  words: StudyWord[];
  cards: StudyRecordOf<"card">[];
  vaultId: string;
  focusedWord?: string;
  review: (ids: string[]) => void;
}) {
  const { t } = useTranslation("home");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ mode: "add" | "edit"; word: StudyWord } | null>(null);
  const [deleting, setDeleting] = useState<StudyWord | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const opening = useRef<AbortController | null>(null);
  const focus = useRef<HTMLLIElement>(null);
  useEffect(() => () => opening.current?.abort(), []);
  useEffect(() => {
    if (!focusedWord) return;
    focus.current?.scrollIntoView({ block: "center" });
    focus.current?.focus({ preventScroll: true });
  }, [focusedWord, words.length]);

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const search = query.trim().toLowerCase();
  const visible = words.filter((word) =>
    [
      word.term,
      word.translation,
      word.language,
      word.context,
      word.note,
      ...(word.examples ?? []).map(({ context }) => context),
    ]
      .join(" ")
      .toLowerCase()
      .includes(search),
  );
  const rows = visible.map((word) => {
    const card = linkedVocabularyCard(cardsById.get(vocabularyCardId(word.id)), word);
    return { word, card, reviewable: Boolean(card || vocabularyCardSides(word)) };
  });
  const available = rows.filter(({ reviewable }) => reviewable).map(({ word }) => word.id);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor?.word.term.trim() || saving) return;
    const { word, mode } = editor;
    setSaving(true);
    try {
      if (mode === "edit") await updateStudyWord(word, vaultId);
      else await saveStudyWord({ ...word, vaultId }, word.id);
      setEditor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function openReview(ids: string[]) {
    if (!ids.length || opening.current) return;
    const request = new AbortController();
    opening.current = request;
    setReviewing(true);
    try {
      const selected = await studyVocabularyCards(ids, vaultId);
      if (request.signal.aborted) return;
      if (selected.length) review(selected);
      else toast.info(t("study.vocabulary.noCards"));
    } catch (error) {
      if (!request.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      opening.current = null;
      if (!request.signal.aborted) setReviewing(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{t("study.tabs.vocabulary")}</h2>
        <div className="flex flex-wrap gap-2">
          {available.length ? (
            <Button disabled={reviewing} onClick={() => void openReview(available)}>
              {t(search ? "study.vocabulary.reviewMatches" : "study.vocabulary.review")}
            </Button>
          ) : null}
          <Button
            variant={available.length ? "outline" : "default"}
            onClick={() =>
              setEditor({
                mode: "add",
                word: {
                  id: studyId(),
                  kind: "word",
                  term: "",
                  translation: "",
                  context: "",
                  language: "",
                  note: "",
                  updatedAt: Date.now(),
                },
              })
            }
          >
            Add word
          </Button>
        </div>
      </div>
      {editor ? (
        <form
          className="grid max-w-lg gap-3 rounded-2xl border p-4"
          onSubmit={(event) => void save(event)}
        >
          {(["term", "translation", "language", "context", "note"] as const).map((name) => (
            <label key={name} className="text-sm capitalize">
              {name}
              <Input
                dir="auto"
                value={editor.word[name]}
                disabled={saving}
                required={name === "term"}
                onChange={(event) => {
                  const value = event.target.value;
                  setEditor(
                    (current) =>
                      current && { ...current, word: { ...current.word, [name]: value } },
                  );
                }}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving}>
              Save word
            </Button>
            <Button variant="ghost" disabled={saving} onClick={() => setEditor(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      <Input
        type="search"
        placeholder="Search vocabulary"
        aria-label="Search vocabulary"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {rows.length ? (
        <ul className="divide-y rounded-2xl border">
          {rows.map(({ word, card, reviewable }) => (
            <li
              key={word.id}
              ref={focusedWord === word.id ? focus : undefined}
              id={`study-word-${word.id}`}
              tabIndex={focusedWord === word.id ? -1 : undefined}
              className={`scroll-mt-32 space-y-2 p-4 ${focusedWord === word.id ? "bg-accent" : ""}`}
            >
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 basis-full sm:flex-1">
                  <p
                    id={`study-term-${word.id}`}
                    dir="auto"
                    className="font-medium wrap-break-word"
                  >
                    {word.term}
                    {word.translation ? ` — ${word.translation}` : ""}
                  </p>
                  {word.language ? (
                    <p className="text-sm text-muted-foreground" dir="auto">
                      {word.language}
                    </p>
                  ) : null}
                  {word.context ? (
                    <p dir="auto" className="text-sm wrap-break-word">
                      {word.context}
                    </p>
                  ) : null}
                  {word.note ? (
                    <p dir="auto" className="text-sm wrap-break-word text-muted-foreground">
                      {word.note}
                    </p>
                  ) : null}
                </div>
                {word.origin ? <StudyOriginLink origin={word.origin} /> : null}
                {card ? <StudyOriginLink origin={{ kind: "card", cardId: card.id }} /> : null}
                {reviewable ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reviewing}
                    aria-describedby={`study-term-${word.id}`}
                    onClick={() => void openReview([word.id])}
                  >
                    {t("study.vocabulary.reviewWord")}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setEditor({ mode: "edit", word })}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(word)}>
                  Delete
                </Button>
              </div>
              {word.examples?.length ? (
                <details className="text-sm text-muted-foreground">
                  <summary className="w-fit cursor-pointer">
                    {t("study.vocabulary.examples", { count: word.examples.length })}
                  </summary>
                  <ul className="mt-2 divide-y rounded-xl border px-3">
                    {word.examples.map(({ context, origin }, index) => (
                      <li key={index} className="flex flex-wrap items-center gap-2 py-2">
                        {context ? (
                          <p dir="auto" className="min-w-0 basis-full wrap-break-word sm:flex-1">
                            {context}
                          </p>
                        ) : null}
                        {origin ? <StudyOriginLink origin={origin} /> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t(words.length ? "study.vocabulary.noMatches" : "study.vocabulary.empty")}
        </p>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete word?"
        body="This removes the vocabulary entry and its saved examples."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleting) await removeStudyRecord(deleting.id);
          setDeleting(null);
        }}
      />
    </section>
  );
}
