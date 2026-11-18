import { originHref } from "./links";
import type {
  StudyRecord,
  StudyRecordOf,
  StudyWord,
  StudyWordResult,
  StudyWordWrite,
} from "./records";
import { freshSchedule } from "./schedule";
import { DEFAULT_VAULT, studyVaultIndex } from "./vault";

const normalized = (text: string) =>
  text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
export const vocabularyCardId = (id: string) => `word-card-${id}`;
const defaultTag = (word: StudyWord) => word.language || "Vocabulary";
type Card = StudyRecordOf<"card">;

export function vocabularyOrigin(word: StudyWord) {
  return word.origin ?? word.examples?.find(({ origin }) => origin)?.origin;
}

export function linkedVocabularyCard(
  row: StudyRecord | undefined,
  word: StudyWord,
): Card | undefined {
  return row?.kind === "card" &&
    row.id === vocabularyCardId(word.id) &&
    row.origin?.kind === "word" &&
    row.origin.wordId === word.id
    ? row
    : undefined;
}

function vocabularyKey(word: StudyWord) {
  return JSON.stringify([normalized(word.term), normalized(word.language)]);
}

function defaultBack(word: StudyWord) {
  const context =
    word.context.trim() || word.examples?.find(({ context }) => context.trim())?.context || "";
  return [
    ...new Set([word.translation, word.note, context].map((text) => text.trim()).filter(Boolean)),
  ].join("\n\n");
}

export function vocabularyCardSides(word: StudyWord) {
  const term = word.term.trim();
  const back = defaultBack(word);
  if (!term || !back || normalized(term) === normalized(back)) return;
  if (word.translation.trim() || word.note.trim()) return { front: term, back };
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fill = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, "giu");
  const front = back.replace(fill, "[…]");
  return front === back ? { front: term, back } : { front, back };
}

function cleanWord(word: StudyWord): StudyWord {
  return {
    ...word,
    term: word.term.trim(),
    language: word.language.trim(),
    translation: word.translation.trim(),
    context: word.context.trim(),
    note: word.note.trim(),
  };
}

function mergeCapture(word: StudyWord, input: StudyWord): StudyWord {
  const incoming = { context: input.context, origin: input.origin };
  const key = (place: Pick<StudyWord, "context" | "origin">) =>
    JSON.stringify([normalized(place.context), place.origin && originHref(place.origin)]);
  const existing = [word, ...(word.examples ?? [])];
  const append =
    (incoming.context || incoming.origin) &&
    !existing.some((place) => key(place) === key(incoming));
  return {
    ...word,
    translation: word.translation || input.translation,
    note: word.note || input.note,
    ...(append ? { examples: [...(word.examples ?? []), incoming] } : {}),
    updatedAt: Math.max(word.updatedAt, input.updatedAt),
  };
}

function newVocabularyCard(word: StudyWord, vaultId: string, updatedAt: number): Card | undefined {
  const sides = vocabularyCardSides(word);
  if (!sides) return;
  return {
    ...sides,
    id: vocabularyCardId(word.id),
    kind: "card",
    notebookId: word.notebookId,
    vaultId,
    origin: { kind: "word", wordId: word.id },
    tags: [defaultTag(word)],
    schedule: freshSchedule(updatedAt),
    updatedAt,
  };
}

function updatedVocabularyCard(card: Card, previous: StudyWord, word: StudyWord) {
  const old = vocabularyCardSides(previous);
  const next = vocabularyCardSides(word);
  if (!old || !next) return;
  const generated = card.front === old.front && card.back === old.back;
  const legacy = card.front === previous.term && card.back === defaultBack(previous);
  if (!generated && !legacy) return;
  const tags =
    card.tags.length === 1 && card.tags[0] === defaultTag(previous)
      ? [defaultTag(word)]
      : card.tags;
  return { ...card, ...next, tags };
}

export function vocabularyChanges(
  data: Omit<Parameters<typeof studyVaultIndex>[0], "defaultVaultId">,
  write: StudyWordWrite,
): { result: StudyWordResult; updates: StudyRecord[] } {
  const { owner, notebookOwner } = studyVaultIndex({ ...data, defaultVaultId: DEFAULT_VAULT });
  const words = data.rows.filter(
    (row): row is StudyWord => row.kind === "word" && owner(row) === write.vaultId,
  );
  const byId = new Map(data.rows.map((row) => [row.id, row]));
  if (write.kind === "cards") {
    const allowed = new Map(words.map((word) => [word.id, word]));
    const updates: Card[] = [];
    const cardIds = [...new Set(write.ids)].flatMap((id) => {
      const word = allowed.get(id);
      if (!word) return [];
      const existing = byId.get(vocabularyCardId(id));
      if (existing) {
        const card = linkedVocabularyCard(existing, word);
        return card ? [card.id] : [];
      }
      const card = newVocabularyCard(word, write.vaultId, write.updatedAt);
      if (!card) return [];
      updates.push(card);
      return [card.id];
    });
    return { result: { kind: "cards", cardIds }, updates };
  }

  const input = cleanWord(write.word);
  const existing = byId.get(input.id);
  if (
    !input.term ||
    (existing && (existing.kind !== "word" || owner(existing) !== write.vaultId)) ||
    (write.kind === "edit" && !existing) ||
    (write.kind === "capture" &&
      (input.notebookId
        ? notebookOwner(input.notebookId) !== write.vaultId
        : owner(input) !== write.vaultId))
  )
    return { result: { kind: "unavailable" }, updates: [] };
  const key = vocabularyKey(input);
  const sameTerm = words.find((word) => word.id !== input.id && vocabularyKey(word) === key);
  if (write.kind === "edit" && sameTerm) return { result: { kind: "duplicate" }, updates: [] };
  const previous = existing?.kind === "word" ? existing : sameTerm;
  const word = previous
    ? write.kind === "capture"
      ? mergeCapture(previous, input)
      : {
          ...previous,
          term: input.term,
          translation: input.translation,
          language: input.language,
          note: input.note,
          context: input.context,
          updatedAt: Math.max(previous.updatedAt, input.updatedAt),
        }
    : input;
  const occupied = byId.get(vocabularyCardId(word.id));
  const linked = linkedVocabularyCard(occupied, word);
  const card =
    linked && previous
      ? updatedVocabularyCard(linked, previous, word)
      : !occupied && (!previous || write.kind === "capture" || !vocabularyCardSides(previous))
        ? newVocabularyCard(word, write.vaultId, input.updatedAt)
        : undefined;
  return { result: { kind: "word", word }, updates: card ? [word, card] : [word] };
}

export function detachedVocabularyCard(card: StudyRecord | undefined, word: StudyWord) {
  const linked = linkedVocabularyCard(card, word);
  return linked ? { ...linked, origin: vocabularyOrigin(word) } : undefined;
}
