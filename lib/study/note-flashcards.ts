import type { Note } from "@/lib/db/types";
import { noteEditorText, type NoteMatch } from "@/lib/notes/search-match";
import { readFrontmatter } from "@/lib/notes/syntax";
import { flashcardMaterialLimit, flashcardPassageSize } from "./ai";
import type { StudyDraftPassage } from "./passages";
import type { StudyOrigin } from "./records";

export type NoteStudySelection = { text: string; match?: NoteMatch };
export type NoteStudySnapshot = { body: string; selection?: NoteStudySelection };

export function noteFlashcardMaterial(
  note: Pick<Note, "id" | "title" | "notebookId" | "tags">,
  { body, selection }: NoteStudySnapshot,
) {
  const { content, length } = readFrontmatter(noteEditorText(body));
  const raw = selection?.match?.quote ?? selection?.text ?? content;
  const leading = raw.length - raw.trimStart().length;
  const text = raw.trim().slice(0, flashcardMaterialLimit);
  const offset = selection ? selection.match?.offset : length;
  const origin: Extract<StudyOrigin, { kind: "note" }> = {
    kind: "note",
    noteId: note.id,
    passage: selection?.match,
  };
  const passages: StudyDraftPassage[] = [];
  if (offset !== undefined) {
    for (let start = 0; start < text.length; start += flashcardPassageSize) {
      const quote = text.slice(start, start + flashcardPassageSize);
      if (!quote.trim()) continue;
      passages.push({
        title: note.title,
        text: quote,
        origin: { ...origin, passage: { offset: offset + leading + start, quote } },
      });
    }
  }
  return {
    title: note.title,
    origin,
    text,
    passages,
    notebookId: note.notebookId ?? undefined,
    tags: note.tags,
  };
}
