import type { StudyBook } from "./records";
import { locateStudyMark, studyTextRevision } from "./text-edits";

export function studyReadingProgress(book: StudyBook) {
  const current = book.sections[book.section];
  if (!current) return 0;

  const place = book.readingPlace?.section === book.section ? book.readingPlace : undefined;
  const anchor = book.format !== "pdf" && place?.anchor;
  const offset = anchor ? locateStudyMark(book, { ...anchor, section: book.section }) : -1;
  const withinSection =
    place?.endRevision === studyTextRevision(book)
      ? 1
      : offset >= 0 && current.text.length
        ? offset / current.text.length
        : (place?.progress ?? 0);

  return studyBookProgress(book, book.section, withinSection);
}

/** How far through the book a place is, from 0 to 1: pages count equally, other sections by length. */
export function studyBookProgress(
  book: Pick<StudyBook, "format" | "sections">,
  section: number,
  withinSection: number,
) {
  const within = Math.min(1, Math.max(0, withinSection));
  if (book.format === "pdf") return (section + within) / book.sections.length;

  let total = 0;
  let reached = 0;
  for (const [index, entry] of book.sections.entries()) {
    const size = Math.max(1, entry.text.length);
    total += size;
    if (index < section) reached += size;
    if (index === section) reached += size * within;
  }
  return reached / total;
}
