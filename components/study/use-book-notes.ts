import { useMemo } from "react";
import { useNotesWorld } from "@/components/notes/use-notes-world";
import { notesAboutBook } from "@/lib/study/related-notes";
import type { StudyBook } from "@/lib/study/records";

/** The notes about a Study book (linked to its source or saved from it), live. `undefined` while loading. */
export function useBookNotes(book: Pick<StudyBook, "id" | "sourceId"> | undefined) {
  const world = useNotesWorld();
  const id = book?.id;
  const sourceId = book?.sourceId;
  return useMemo(
    () => (world && id && sourceId ? notesAboutBook({ id, sourceId }, world) : undefined),
    [world, id, sourceId],
  );
}
