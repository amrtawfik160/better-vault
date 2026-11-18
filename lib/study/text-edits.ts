import { diffChars } from "diff";
import type {
  StudyBook,
  StudyBookTextWrite,
  StudyBookWrite,
  StudyRecord,
  StudyTextEdit,
} from "./records";

type Range = { offset: number; length: number };
type Passage = Range & { revision?: number };

export const studyTextRevision = (book: Pick<StudyBook, "textEdits">) =>
  book.textEdits?.length ?? 0;

function uniqueParagraphs(text: string) {
  const positions = new Map<string, number>();
  let at = 0;
  for (const part of text.split(/(\n{2,})/)) {
    if (part.trim().length >= 16) positions.set(part, positions.has(part) ? -1 : at);
    at += part.length;
  }
  return positions;
}

// Store only positions. An edit can move or remove text without keeping a second copy of it.
export function studyTextEdit(section: number, before: string, after: string): StudyTextEdit {
  const ranges: StudyTextEdit["ranges"] = [];
  const shared = Math.min(before.length, after.length);
  let start = 0;
  while (start < shared && before[start] === after[start]) start++;
  let tail = 0;
  while (
    tail < shared - start &&
    before[before.length - tail - 1] === after[after.length - tail - 1]
  )
    tail++;
  if (start) ranges.push({ before: 0, after: 0, length: start });

  const changes = diffChars(
    before.slice(start, before.length - tail),
    after.slice(start, after.length - tail),
    {
      timeout: 80,
      maxEditLength: 4096,
    },
  );
  let previous = start;
  let next = start;
  for (const { added, removed, value } of changes ?? []) {
    if (!value) continue;
    if (!removed && !added) {
      ranges.push({ before: previous, after: next, length: value.length });
    }
    if (!added) previous += value.length;
    if (!removed) next += value.length;
  }
  if (tail) ranges.push({ before: before.length - tail, after: after.length - tail, length: tail });

  const joined: StudyTextEdit["ranges"] = [];
  for (const range of ranges) {
    const last = joined.at(-1);
    if (
      last &&
      last.before + last.length === range.before &&
      last.after + last.length === range.after
    )
      last.length += range.length;
    else joined.push(range);
  }
  const currentParagraphs = uniqueParagraphs(after);
  const moved: StudyTextEdit["ranges"] = [];
  let span = 0;
  for (const [paragraph, previous] of uniqueParagraphs(before)) {
    const current = currentParagraphs.get(paragraph);
    if (previous < 0 || current === undefined || current < 0) continue;
    while (span < joined.length && joined[span].before + joined[span].length <= previous) span++;
    const mapped = joined[span];
    if (
      !mapped ||
      mapped.before > previous ||
      mapped.before + mapped.length < previous + paragraph.length ||
      mapped.after - mapped.before !== current - previous
    )
      moved.push({ before: previous, after: current, length: paragraph.length });
  }
  return { section, ranges: [...moved, ...joined] };
}

export function resolveStudyRange(
  book: StudyBook,
  section: number,
  passage: Passage,
): Range | undefined {
  const text = book.sections[section]?.text;
  const revision = passage.revision ?? 0;
  if (
    text === undefined ||
    revision > studyTextRevision(book) ||
    passage.length < 1 ||
    passage.offset < 0
  )
    return;
  const { length } = passage;
  let { offset } = passage;
  for (const edit of book.textEdits?.slice(revision) ?? []) {
    if (edit.section !== section) continue;
    const range = edit.ranges.find(
      ({ before, length: span }) => before <= offset && offset + length <= before + span,
    );
    if (!range) return;
    offset += range.after - range.before;
  }
  if (offset + length <= text.length) return { offset, length };
}

export function locateStudyMark(
  book: StudyBook,
  {
    section,
    quote,
    offset,
    revision,
  }: { section: number; quote: string; offset: number; revision?: number },
) {
  const text = book.sections[section]?.text;
  if (!text || !quote) return -1;
  const range = resolveStudyRange(book, section, { offset, length: quote.length, revision });
  if (range && text.slice(range.offset, range.offset + range.length) === quote) return range.offset;
  if ((revision ?? 0) !== studyTextRevision(book)) return -1;
  const unique = text.indexOf(quote);
  return unique === text.lastIndexOf(quote) ? unique : -1;
}

export function patchedStudyBook(
  book: StudyBook,
  { change, updatedAt }: StudyBookWrite,
): StudyBook {
  const { section: requestedSection, readingPlace, ...properties } = change;
  const fresh = updatedAt >= (book.lastReadAt ?? 0);
  const section = fresh && requestedSection !== undefined && book.sections[requestedSection]
    ? requestedSection : book.section;
  const position = fresh && readingPlace?.section === section ? readingPlace : undefined;
  const read = fresh && (requestedSection === section || position);
  return {
    ...book,
    ...properties,
    section,
    readingPlace: position ?? (section === book.section ? book.readingPlace : undefined),
    updatedAt: Math.max(book.updatedAt, updatedAt),
    lastReadAt: read ? updatedAt : book.lastReadAt,
  };
}

export function renamedStudyBook(book: StudyBook, title: string, updatedAt: number): StudyBook {
  const section = book.sections[0];
  const renameHeading =
    book.format === "text" && book.sections.length === 1 && section.title === book.title;
  return {
    ...book,
    title,
    sections: renameHeading ? [{ ...section, title }] : book.sections,
    updatedAt: Math.max(book.updatedAt, updatedAt),
  };
}

export function revisedStudyBook(
  book: StudyRecord | undefined,
  write: StudyBookTextWrite,
): StudyBook | undefined {
  if (
    book?.kind !== "book" ||
    book.sourceId !== write.sourceId ||
    studyTextRevision(book) !== write.revision ||
    book.sections[write.edit.section]?.text !== write.previousText ||
    book.sections[write.edit.section]?.markdown !== write.previousMarkdown
  )
    return;
  return {
    ...book,
    sections: book.sections.map((section, index) =>
      index === write.edit.section ? { ...section, text: write.text, markdown: write.markdown } : section,
    ),
    textEdits: write.text === write.previousText ? book.textEdits : [...(book.textEdits ?? []), write.edit],
    updatedAt: Math.max(book.updatedAt, write.updatedAt),
  };
}
