import type { Note } from "@/lib/db/types";
import { noteEditorText, type NoteMatch } from "@/lib/notes/search-match";
import { extractHeadings, readFrontmatter } from "@/lib/notes/syntax";
import { flashcardMaterialLimit, flashcardPassageSize } from "./ai";
import { flashcardDraftRanges } from "./flashcard-material";
import type { StudyDraftPassage } from "./passages";
import type { StudyOrigin } from "./records";

export type NoteStudySelection = { text: string; match?: NoteMatch };
export type NoteStudySnapshot = { body: string; selection?: NoteStudySelection };

function noteExcerpt(
  title: string,
  origin: Extract<StudyOrigin, { kind: "note" }>,
  raw: string,
  offset?: number,
) {
  const leading = raw.length - raw.trimStart().length;
  const text = raw.trim().slice(0, flashcardMaterialLimit);
  const passages: StudyDraftPassage[] = [];
  if (offset !== undefined) {
    for (let start = 0; start < text.length; start += flashcardPassageSize) {
      const quote = text.slice(start, start + flashcardPassageSize);
      if (!quote.trim()) continue;
      passages.push({
        title,
        text: quote,
        origin: { ...origin, passage: { offset: offset + leading + start, quote } },
      });
    }
  }
  return { origin, text, passages };
}

export function noteFlashcardMaterial(
  note: Pick<Note, "id" | "title" | "notebookId" | "tags">,
  { body, selection }: NoteStudySnapshot,
) {
  const { content, length } = readFrontmatter(noteEditorText(body));
  const raw = selection?.match?.quote ?? selection?.text ?? content;
  const offset = selection ? selection.match?.offset : length;
  const origin = { kind: "note" as const, noteId: note.id, passage: selection?.match };
  const ranges = !selection && content.trim().length > flashcardMaterialLimit
    ? flashcardDraftRanges(content, extractHeadings(content))
    : [];
  const parts = ranges.map(({ offset, length: size, heading }) => ({
    heading,
    preview: content.slice(offset, offset + Math.min(size, 100)).replace(/\s+/g, " "),
    load: () => {
      const excerpt = content.slice(offset, offset + size);
      const start = length + offset;
      return noteExcerpt(heading ? `${note.title} · ${heading}` : note.title, {
        ...origin,
        passage: { offset: start, quote: excerpt.slice(0, flashcardPassageSize) },
      }, excerpt, start);
    },
  }));
  return {
    title: note.title,
    ...noteExcerpt(note.title, origin, raw, offset),
    notebookId: note.notebookId ?? undefined,
    tags: note.tags,
    parts,
  };
}
