import type { Note } from "@/lib/db/types";
import { resolveLink, type LinkWorld } from "@/lib/notes/resolve";
import type { StudyBook } from "./records";

const markdownHref = /\]\(([^)\s]+)\)/g;

/** Whether a note body links to a place in this Study book (as notes saved from Study do). */
function linksToBook(body: string, bookId: string) {
  for (const [, href] of body.matchAll(markdownHref)) {
    const query = href.indexOf("?");
    if (query < 0) continue;
    const params = new URLSearchParams(href.slice(query + 1));
    if (params.get("view") === "study" && params.get("book") === bookId) return true;
  }
  return false;
}

/**
 * The notes about a Study book, newest first: those that `[[src:…]]`-link the
 * book's source, and those saved from the book in Study (they link back to it).
 */
export function notesAboutBook(book: Pick<StudyBook, "id" | "sourceId">, world: LinkWorld): Note[] {
  return world.notes
    .filter(
      (note) =>
        linksToBook(note.body, book.id) ||
        note.links.some((link) => {
          if (link.kind !== "source") return false;
          const target = resolveLink(link, world, note.vaultId);
          return target?.kind === "source" && target.source.id === book.sourceId;
        }),
    )
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
}
