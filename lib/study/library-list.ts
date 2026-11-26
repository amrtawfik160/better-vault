import type { SourceKind } from "@/lib/db/types";
import type { StudyLibraryEntry } from "./library";
import type { StudyBook } from "./records";

export type LibraryEntry = StudyLibraryEntry<StudyBook>;
export type LibraryType = SourceKind;

/** The type a document is listed and filtered by. */
export function libraryEntryType(entry: LibraryEntry): LibraryType {
  if (entry.kind === "source") return entry.source.kind;
  const { book } = entry;
  if (book.format === "pdf" || book.format === "epub") return book.format;
  return book.sections.some((section) => section.markdown !== undefined) ? "markdown" : "text";
}

/** Every document, the most recently read first; the ones never opened follow, newest first. */
export function sortLibraryEntries(entries: readonly LibraryEntry[]): LibraryEntry[] {
  const read = (entry: LibraryEntry) => (entry.kind === "book" ? (entry.book.lastReadAt ?? 0) : 0);
  const added = (entry: LibraryEntry) => (entry.kind === "source" ? entry.source.createdAt : 0);
  return [...entries].sort((a, b) => read(b) - read(a) || added(b) - added(a));
}

export interface LibraryFilter {
  query: string;
  /** A notebook id, or "all". */
  notebook: string;
  /** A document type, or "all". */
  type: LibraryType | "all";
}

/** Documents matching the search (title or notebook name) and both filters, in the order given. */
export function filterLibraryEntries(
  entries: readonly LibraryEntry[],
  filter: LibraryFilter,
  notebookTitles: ReadonlyMap<string, string>,
): LibraryEntry[] {
  const needle = filter.query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (filter.notebook === "all" || entry.notebookId === filter.notebook) &&
      (filter.type === "all" || libraryEntryType(entry) === filter.type) &&
      (!needle ||
        `${entry.title} ${notebookTitles.get(entry.notebookId) ?? ""}`
          .toLowerCase()
          .includes(needle)),
  );
}

/** How many documents each value of a facet has, for the filter menus. */
export function countBy<Key extends string>(
  entries: readonly LibraryEntry[],
  key: (entry: LibraryEntry) => Key,
) {
  const counts = new Map<Key, number>();
  for (const entry of entries) counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1);
  return counts;
}
