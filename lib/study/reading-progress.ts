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

  if (book.format === "pdf") return (book.section + withinSection) / book.sections.length;

  let total = 0;
  let reached = 0;
  for (const [index, section] of book.sections.entries()) {
    const size = Math.max(1, section.text.length);
    total += size;
    if (index < book.section) reached += size;
    if (index === book.section) reached += size * withinSection;
  }
  return reached / total;
}
