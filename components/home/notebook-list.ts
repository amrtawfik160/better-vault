export type NotebookSort = "recent" | "name";

const collator = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/**
 * Orders the list's folders or notebooks: pinned ones first, then by the
 * sort chosen, Recent (changed last first) or Name (A to Z).
 */
export function sortItems<T extends { updatedAt: number; pinned?: boolean }>(
  items: readonly T[],
  sort: NotebookSort,
  name: (item: T) => string,
): T[] {
  return [...items].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      (sort === "name" ? collator(name(a), name(b)) : b.updatedAt - a.updatedAt) ||
      collator(name(a), name(b)),
  );
}

/** Lower case without accents, so "Zafon" finds "Zafón". */
function fold(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

/** Each notebook's document titles, for search and for its row. */
export function titlesByNotebook(sources: readonly { notebookId: string; title: string }[]) {
  const titles = new Map<string, string[]>();
  for (const { notebookId, title } of sources) titles.set(notebookId, [...(titles.get(notebookId) ?? []), title]);
  return titles;
}

/**
 * The notebooks a search finds: those whose name, or the title of one of
 * their documents, holds every word typed. An empty search finds them all.
 */
export function searchNotebooks<T extends { id: string; title: string }>(
  query: string,
  notebooks: readonly T[],
  titles: ReadonlyMap<string, readonly string[]>,
): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...notebooks];
  return notebooks.filter((notebook) => {
    const haystack = fold([notebook.title, ...(titles.get(notebook.id) ?? [])].join("\n"));
    return words.every((word) => haystack.includes(word));
  });
}

/** "The book, Interview script v2", the start of what a notebook holds; the rest is counted. */
export function documentSummary(titles: readonly string[], max = 2) {
  return titles.slice(0, max).join(", ");
}
