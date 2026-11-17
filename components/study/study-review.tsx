import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import {
  freshSchedule,
  putStudyRecords,
  rateStudyItem,
  removeStudyRecord,
  studyId,
} from "@/lib/db/study";
import { studyRatings, type StudyRecordOf } from "@/lib/study/records";

type Card = StudyRecordOf<"card">;
type Highlight = StudyRecordOf<"highlight">;
type Word = StudyRecordOf<"word">;
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const textArea = "min-h-20 w-full rounded-xl border bg-background p-3 text-sm";

function useReviewClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return now;
}

export function StudyReview({
  cards,
  highlights,
  useHighlights,
}: {
  cards: Card[];
  highlights: Highlight[];
  useHighlights: boolean;
}) {
  const now = useReviewClock();
  const [revealed, setRevealed] = useState("");
  const [started, setStarted] = useState(Date.now);
  const [rated, setRated] = useState(0);
  const [busy, setBusy] = useState(false);
  const all = useHighlights ? highlights : cards;
  const due = all
    .filter(({ schedule }) => schedule.dueAt <= now)
    .toSorted((a, b) => a.schedule.dueAt - b.schedule.dueAt);
  const item = due[0];
  const remaining = all.toSorted((a, b) => a.schedule.dueAt - b.schedule.dueAt)[0];

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">
          {useHighlights ? "Review highlights" : "Review flashcards"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {due.length} due · {rated} reviewed this session
        </p>
      </div>
      {item ? (
        <div className="max-w-2xl space-y-4 rounded-2xl border bg-card p-6">
          <p dir="auto" className="text-xl font-medium whitespace-pre-wrap">
            {item.kind === "card" ? item.front : "Recall why you saved this passage."}
          </p>
          {item.kind === "card" && item.image ? (
            <img
              className="max-h-52 rounded-lg object-contain"
              src={item.image}
              alt="Flashcard attachment"
            />
          ) : null}
          {revealed !== item.id ? (
            <Button onClick={() => setRevealed(item.id)}>Show answer</Button>
          ) : (
            <>
              <p dir="auto" className="border-t pt-4 whitespace-pre-wrap">
                {item.kind === "card" ? item.back : item.quote}
              </p>
              {item.kind === "highlight" && item.note ? (
                <p dir="auto" className="text-sm text-muted-foreground">
                  {item.note}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {studyRatings.map((rating) => (
                  <Button
                    key={rating}
                    variant={rating === "good" ? "default" : "outline"}
                    className="capitalize"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void rateStudyItem(item.id, rating, (Date.now() - started) / 1000)
                        .then(() => {
                          setRated((value) => value + 1);
                          setRevealed("");
                          setStarted(Date.now());
                        })
                        .catch((error: Error) => toast.error(error.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {rating}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">
          {remaining
            ? `You’re caught up. Next review ${date.format(remaining.schedule.dueAt)}.`
            : "Add something to study first."}
        </p>
      )}
    </section>
  );
}

function ImagePicker({ image, change }: { image?: string; change: (value?: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">
        Card image{" "}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="mt-1 block"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 2 * 1024 * 1024) {
              toast.error("Choose a PNG, JPEG, WebP, or GIF under 2 MB.");
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") change(reader.result);
            };
            reader.onerror = () => toast.error("Could not open that image.");
            reader.readAsDataURL(file);
          }}
        />
      </label>
      {image ? (
        <>
          <img
            src={image}
            className="h-12 w-12 rounded object-cover"
            alt="Selected card attachment"
          />
          <Button size="sm" variant="ghost" onClick={() => change(undefined)}>
            Remove image
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function CardLibrary({ cards }: { cards: Card[] }) {
  const now = useReviewClock();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Card | null>(null);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState("all");
  const [saving, setSaving] = useState(false);
  const cardsShown = cards.filter((card) => {
    const matched = [card.front, card.back, ...card.tags]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase());
    return (
      matched &&
      (status === "all" ||
        (status === "due" ? card.schedule.dueAt <= now : card.schedule.dueAt > now))
    );
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing?.front.trim() || !editing.back.trim()) return;
    setSaving(true);
    try {
      await putStudyRecords({
        ...editing,
        front: editing.front.trim(),
        back: editing.back.trim(),
        tags: editing.tags.map((tag) => tag.trim()).filter(Boolean),
        updatedAt: Date.now(),
      });
      setEditing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="text-xl font-semibold">Flashcards</h2>
        <div className="flex flex-wrap gap-2">
          {selected.length ? (
            <Button variant="outline" onClick={() => setDeleting(selected)}>
              Delete selected ({selected.length})
            </Button>
          ) : null}
          <Button
            onClick={() =>
              setEditing({
                id: studyId(),
                kind: "card",
                front: "",
                back: "",
                tags: [],
                updatedAt: Date.now(),
                schedule: freshSchedule(),
              })
            }
          >
            New flashcard
          </Button>
        </div>
      </div>
      {editing ? (
        <form
          onSubmit={(event) => void save(event)}
          className="grid max-w-2xl gap-3 rounded-2xl border p-4"
        >
          <textarea
            className={textArea}
            dir="auto"
            aria-label="Front"
            placeholder="Front"
            required
            value={editing.front}
            onChange={(event) => setEditing({ ...editing, front: event.target.value })}
          />
          <textarea
            className={textArea}
            dir="auto"
            aria-label="Back"
            placeholder="Back"
            required
            value={editing.back}
            onChange={(event) => setEditing({ ...editing, back: event.target.value })}
          />
          <Input
            aria-label="Tags"
            placeholder="Tags, separated by commas"
            value={editing.tags.join(",")}
            onChange={(event) => setEditing({ ...editing, tags: event.target.value.split(",") })}
          />
          <ImagePicker
            image={editing.image}
            change={(image) => setEditing((value) => (value ? { ...value, image } : value))}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              Save flashcard
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          placeholder="Search flashcards"
          aria-label="Search flashcards"
          className="max-w-xs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter flashcards"
          className="rounded-lg border bg-background px-2 text-sm"
        >
          <option value="all">All cards</option>
          <option value="due">Due</option>
          <option value="scheduled">Scheduled</option>
        </select>
      </div>
      <ul className="divide-y rounded-2xl border">
        {cardsShown.map((card) => (
          <li key={card.id} className="flex flex-wrap items-center gap-3 p-4">
            <input
              type="checkbox"
              aria-label={`Select ${card.front}`}
              checked={selected.includes(card.id)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...selected, card.id]
                    : selected.filter((id) => id !== card.id),
                )
              }
            />
            <div className="min-w-0 flex-1">
              <p dir="auto" className="font-medium wrap-break-word">
                {card.front}
              </p>
              <p dir="auto" className="line-clamp-2 text-sm text-muted-foreground">
                {card.back}
              </p>
              <p className="text-xs text-muted-foreground">
                {card.schedule.dueAt <= now ? "Due now" : date.format(card.schedule.dueAt)}
                {card.tags.length ? ` · ${card.tags.join(", ")}` : ""}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(card)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleting([card.id])}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
      {!cardsShown.length ? (
        <p className="text-sm text-muted-foreground">No flashcards match.</p>
      ) : null}
      <ConfirmDialog
        open={deleting.length > 0}
        onOpenChange={(open) => {
          if (!open) setDeleting([]);
        }}
        title="Delete flashcards?"
        body="The selected cards will be removed from your study library."
        confirmLabel="Delete"
        onConfirm={async () => {
          const ids = [...deleting];
          await Promise.all(ids.map(removeStudyRecord));
          setSelected((value) => value.filter((id) => !ids.includes(id)));
          setDeleting([]);
        }}
      />
    </section>
  );
}

export function HighlightsLibrary({
  highlights,
  locate,
  review,
}: {
  highlights: Highlight[];
  locate: (item: Highlight) => void;
  review: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Highlight | null>(null);
  const [deleting, setDeleting] = useState<Highlight | null>(null);
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="text-xl font-semibold">Highlights</h2>
        <Button onClick={review}>Review highlights</Button>
      </div>
      <Input
        type="search"
        aria-label="Search highlights"
        placeholder="Search highlights"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="space-y-3">
        {highlights
          .filter((item) => (item.quote + item.note).toLowerCase().includes(query.toLowerCase()))
          .map((item) => (
            <li key={item.id} className="space-y-2 rounded-2xl border p-4">
              <blockquote dir="auto" className="font-medium">
                {item.quote}
              </blockquote>
              {editing?.id === item.id ? (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void putStudyRecords({ ...editing, updatedAt: Date.now() })
                      .then(() => setEditing(null))
                      .catch((error: Error) => toast.error(error.message));
                  }}
                >
                  <textarea
                    dir="auto"
                    className={textArea}
                    aria-label="Highlight note"
                    value={editing.note}
                    onChange={(event) => setEditing({ ...editing, note: event.target.value })}
                  />
                  <select
                    aria-label="Highlight color"
                    className="rounded-lg border bg-background p-2"
                    value={editing.color}
                    onChange={(event) =>
                      setEditing({ ...editing, color: event.target.value as Highlight["color"] })
                    }
                  >
                    {["yellow", "green", "blue", "pink"].map((color) => (
                      <option key={color}>{color}</option>
                    ))}
                  </select>
                  <Button type="submit" size="sm">
                    Save highlight
                  </Button>
                </form>
              ) : (
                <>
                  {item.note ? (
                    <p dir="auto" className="text-sm text-muted-foreground">
                      {item.note}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => locate(item)}>
                      Go to passage
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                      Edit note
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(item)}>
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
      </ul>
      {!highlights.length ? (
        <p className="text-sm text-muted-foreground">
          Select text in a document to save a highlight.
        </p>
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete highlight?"
        body="Its note and review schedule will be removed."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleting) await removeStudyRecord(deleting.id);
          setDeleting(null);
        }}
      />
    </section>
  );
}

export function VocabularyLibrary({ words }: { words: Word[] }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Word | null>(null);
  const [deleting, setDeleting] = useState<Word | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing?.term.trim()) return;
    const term = editing.term.trim();
    if (
      words.some(
        (word) =>
          word.id !== editing.id &&
          word.term.toLowerCase() === term.toLowerCase() &&
          word.language.toLowerCase() === editing.language.trim().toLowerCase(),
      )
    ) {
      toast.error("That word is already saved for this language.");
      return;
    }
    try {
      await putStudyRecords({
        ...editing,
        term,
        language: editing.language.trim(),
        updatedAt: Date.now(),
      });
      setEditing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="text-xl font-semibold">Vocabulary</h2>
        <Button
          onClick={() =>
            setEditing({
              id: studyId(),
              kind: "word",
              term: "",
              translation: "",
              context: "",
              language: "",
              note: "",
              updatedAt: Date.now(),
            })
          }
        >
          Add word
        </Button>
      </div>
      {editing ? (
        <form
          className="grid max-w-lg gap-3 rounded-2xl border p-4"
          onSubmit={(event) => void save(event)}
        >
          {(["term", "translation", "language", "context", "note"] as const).map((name) => (
            <label key={name} className="text-sm capitalize">
              {name}
              <Input
                dir="auto"
                value={editing[name]}
                onChange={(event) => setEditing({ ...editing, [name]: event.target.value })}
                required={name === "term"}
              />
            </label>
          ))}
          <Button type="submit" className="justify-self-start">
            Save word
          </Button>
        </form>
      ) : null}
      <Input
        type="search"
        placeholder="Search vocabulary"
        aria-label="Search vocabulary"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="divide-y rounded-2xl border">
        {words
          .filter((word) =>
            [word.term, word.translation, word.language, word.context, word.note]
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((word) => (
            <li className="flex flex-wrap items-start gap-2 p-4" key={word.id}>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="font-medium wrap-break-word">
                  {word.term}
                  {word.translation ? ` — ${word.translation}` : ""}
                </p>
                <p className="text-sm text-muted-foreground">{word.language}</p>
                {word.context ? (
                  <p dir="auto" className="text-sm">
                    {word.context}
                  </p>
                ) : null}
                {word.note ? (
                  <p dir="auto" className="text-sm text-muted-foreground">
                    {word.note}
                  </p>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void putStudyRecords({
                    id: studyId(),
                    kind: "card",
                    front: word.term,
                    back: word.translation || word.context,
                    tags: [word.language || "Vocabulary"],
                    updatedAt: Date.now(),
                    schedule: freshSchedule(),
                  })
                    .then(() => toast.success("Flashcard created"))
                    .catch((error: Error) => toast.error(error.message));
                }}
                disabled={!word.translation && !word.context}
              >
                Make flashcard
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(word)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(word)}>
                Delete
              </Button>
            </li>
          ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete word?"
        body="This removes the saved vocabulary entry."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleting) await removeStudyRecord(deleting.id);
          setDeleting(null);
        }}
      />
    </section>
  );
}
