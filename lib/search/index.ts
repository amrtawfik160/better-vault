import MiniSearch, { type SearchResult } from "minisearch";
import { store } from "@/lib/db/store";
import { listVaults } from "@/lib/db/vaults";
import type { Folder, Notebook, Source, StudioOutput, Vault } from "@/lib/db/types";
import { originHref } from "@/lib/study/links";
import { studyTextRevision } from "@/lib/study/text-edits";
import { studyTextWindows } from "@/lib/study/text-windows";
import { studySearchCatalogue, type StudySearchLink } from "./study";

/**
 * One search index over everything in the app: vaults, folders, notebooks,
 * sources (by title), every passage of every source (the full text, PDFs
 * included), Studio outputs, and saved Study material. Linked Study documents
 * use their own page and chapter boundaries. The index lives in memory
 * and follows changes while the command palette is open.
 */

export type HitKind = "vault" | "folder" | "notebook" | "source" | "passage" | "study-passage" | "output" | "study";

type StudyAnchor = { bookId: string; section: number; offset: number; revision: number };

interface Doc {
  id: string;
  kind: HitKind;
  title: string;
  text: string;
  notebookId?: string;
  sourceId?: string;
  chunkId?: string;
  vaultId?: string;
  folderId?: string;
  outputId?: string;
  study?: StudySearchLink;
  studyAnchor?: StudyAnchor;
}

export interface Hit extends Omit<Doc, "text"> {
  score: number;
  /** Around the first match in the indexed body. */
  snippet?: string;
  /** The words that matched, to mark in the snippet. */
  terms: string[];
}

type CatalogueSource = Pick<Source, "id" | "notebookId" | "title" | "studyRevision">;

export interface Catalogue {
  vaults: Vault[];
  folders: Folder[];
  notebooks: Notebook[];
  sources: CatalogueSource[];
  outputs: StudioOutput[];
  study: ReturnType<typeof studySearchCatalogue>;
}

type StudyDocument = Catalogue["study"]["documents"][number];

const options = {
  fields: ["title", "text"],
  storeFields: [
    "kind",
    "title",
    "text",
    "notebookId",
    "sourceId",
    "chunkId",
    "vaultId",
    "folderId",
    "outputId",
    "study",
    "studyAnchor",
  ],
  searchOptions: {
    boost: { title: 3 },
    prefix: true,
    fuzzy: 0.2,
    combineWith: "AND" as const,
  },
};

/** The words of an output's data, so its content can be found too. */
function textOf(value: unknown, out: string[] = [], budget = { left: 6000 }): string[] {
  if (budget.left <= 0) return out;
  if (typeof value === "string") {
    out.push(value);
    budget.left -= value.length;
  } else if (Array.isArray(value)) for (const item of value) textOf(item, out, budget);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) textOf(item, out, budget);
  return out;
}

function snippetAt(text: string, at: number, size = 160): string {
  const start = Math.max(0, at - Math.floor(size / 3));
  const piece = text.slice(start, start + size).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${piece}${start + size < text.length ? "…" : ""}`;
}

function snippetOf(text: string, terms: string[]): string {
  const lower = text.toLocaleLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term.toLocaleLowerCase());
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  return snippetAt(text, at);
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function studyMatch(text: string, query: string, terms: string[]) {
  const phrase = query.trim().split(/\s+/u).map(escapePattern).join("\\s+");
  return new RegExp(phrase, "iu").exec(text) ??
    new RegExp(terms.toSorted((a, b) => b.length - a.length).map(escapePattern).join("|"), "iu").exec(text);
}

function sameStudyDocument(left: StudyDocument, right: StudyDocument) {
  const a = left.book;
  const b = right.book;
  return left.vaultId === right.vaultId && a.title === b.title && a.sourceId === b.sourceId &&
    a.notebookId === b.notebookId && studyTextRevision(a) === studyTextRevision(b) &&
    a.sections.length === b.sections.length && a.sections.every((section, index) =>
      section.title === b.sections[index].title && section.text === b.sections[index].text,
    );
}

class SearchIndex {
  private mini = new MiniSearch<Doc>(options);
  private others = new Map<string, Doc>();
  private passages = new Map<
    string,
    { ids: string[]; title: string; revision?: number; vaultId?: string }
  >();
  private studyPassages = new Map<string, StudyDocument & { ids: string[] }>();
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private current?: Catalogue;

  isCurrent(catalogue: Catalogue | null | undefined) {
    return !!catalogue && this.current === catalogue;
  }

  /** Brings the index in line with what is stored. Calls are queued, so they never overlap. */
  sync(catalogue: Catalogue): Promise<void> {
    this.queue = this.queue
      .then(() => this.apply(catalogue))
      .catch((error: unknown) => {
        console.error("Search index", error);
      });
    return this.queue;
  }

  private async syncStudyPassages(documents: StudyDocument[]) {
    const next = new Map(documents.map((entry) => [entry.book.id, entry]));
    for (const [bookId, indexed] of this.studyPassages) {
      const current = next.get(bookId);
      if (current && sameStudyDocument(indexed, current)) continue;
      for (const id of indexed.ids) if (this.mini.has(id)) this.mini.discard(id);
      this.studyPassages.delete(bookId);
    }
    for (const entry of documents) {
      const { book, vaultId } = entry;
      if (this.studyPassages.has(book.id)) continue;
      const revision = studyTextRevision(book);
      const passages = book.sections.flatMap(({ title, text }, section) =>
        Array.from(studyTextWindows(text), (window): Doc => ({
          id: `study-passage:${book.id}:${section}:${window.start}`,
          kind: "study-passage",
          title: title === book.title ? book.title : `${book.title} · ${title}`,
          text: window.text,
          vaultId,
          notebookId: book.notebookId,
          sourceId: book.sourceId,
          studyAnchor: { bookId: book.id, section, offset: window.offset, revision },
        })),
      );
      await this.mini.addAllAsync(passages, { chunkSize: 200 });
      this.studyPassages.set(book.id, { ...entry, ids: passages.map(({ id }) => id) });
    }
  }

  private async apply(catalogue: Catalogue) {
    this.current = undefined;
    const notebookVault = new Map(
      catalogue.notebooks.map((notebook) => [notebook.id, notebook.vaultId]),
    );
    const docs: Doc[] = [
      ...catalogue.vaults.map((vault) => ({
        id: `vault:${vault.id}`,
        kind: "vault" as const,
        title: vault.name,
        text: "",
        vaultId: vault.id,
      })),
      ...catalogue.folders.map((folder) => ({
        id: `folder:${folder.id}`,
        kind: "folder" as const,
        title: folder.name,
        text: "",
        folderId: folder.id,
        vaultId: folder.vaultId,
      })),
      ...catalogue.notebooks.map((notebook) => ({
        id: `notebook:${notebook.id}`,
        kind: "notebook" as const,
        title: notebook.title,
        text: "",
        notebookId: notebook.id,
        vaultId: notebook.vaultId,
      })),
      ...catalogue.sources.map((source) => ({
        id: `source:${source.id}`,
        kind: "source" as const,
        title: source.title,
        text: "",
        notebookId: source.notebookId,
        sourceId: source.id,
        vaultId: notebookVault.get(source.notebookId),
      })),
      ...catalogue.outputs
        .filter((output) => output.status === "ready")
        .map((output) => ({
          id: `output:${output.id}`,
          kind: "output" as const,
          title: output.title,
          text: textOf(output.data).join(" "),
          notebookId: output.notebookId,
          outputId: output.id,
          vaultId: notebookVault.get(output.notebookId),
        })),
      ...catalogue.study.entries,
    ];
    const nextDocs = new Map(docs.map((doc) => [doc.id, doc]));
    for (const id of this.others.keys()) {
      if (!nextDocs.has(id)) this.mini.discard(id);
    }
    const changed = docs.filter((doc) => {
      const previous = this.others.get(doc.id);
      return (
        previous?.title !== doc.title ||
        previous.text !== doc.text ||
        previous.vaultId !== doc.vaultId ||
        previous.notebookId !== doc.notebookId ||
        previous.study?.context !== doc.study?.context
      );
    });
    for (const { id } of changed) if (this.mini.has(id)) this.mini.discard(id);
    await this.mini.addAllAsync(changed);
    this.others = nextDocs;

    await this.syncStudyPassages(catalogue.study.documents);
    const studySources = new Set<string>();
    for (const { book, ids } of this.studyPassages.values()) {
      if (book.sourceId && ids.length) studySources.add(book.sourceId);
    }
    const notebookSources = catalogue.sources.filter(({ id }) => !studySources.has(id));
    const sources = new Map(notebookSources.map((source) => [source.id, source]));
    for (const [sourceId, indexed] of this.passages) {
      const source = sources.get(sourceId);
      if (
        source &&
        source.title === indexed.title &&
        source.studyRevision === indexed.revision &&
        notebookVault.get(source.notebookId) === indexed.vaultId
      )
        continue;
      for (const id of indexed.ids) if (this.mini.has(id)) this.mini.discard(id);
      this.passages.delete(sourceId);
    }
    const added = notebookSources.filter((source) => !this.passages.has(source.id));
    for (let at = 0; at < added.length; at += 20) {
      const batch = added.slice(at, at + 20);
      const chunks = await store().getChunks(batch.map((source) => source.id));
      const bySource = new Map(batch.map((source) => [source.id, source]));
      const passageDocs: Doc[] = chunks.map((chunk) => ({
        id: `passage:${chunk.id}`,
        kind: "passage",
        title: bySource.get(chunk.sourceId)?.title ?? "",
        text: chunk.text,
        notebookId: chunk.notebookId,
        sourceId: chunk.sourceId,
        chunkId: chunk.id,
        vaultId: notebookVault.get(chunk.notebookId),
      }));
      await this.mini.addAllAsync(passageDocs, { chunkSize: 200 });
      for (const source of batch) {
        this.passages.set(source.id, {
          ids: passageDocs.filter((doc) => doc.sourceId === source.id).map((doc) => doc.id),
          title: source.title,
          revision: source.studyRevision,
          vaultId: notebookVault.get(source.notebookId),
        });
      }
    }
    this.current = catalogue;
    for (const listener of this.listeners) listener();
  }

  /** Results by score, at most `limit` of each kind. */
  search(query: string, limit = 6): Hit[] {
    if (!query.trim()) return [];
    const results = this.mini.search(query) as (SearchResult & Doc)[];
    const taken = new Map<HitKind, number>();
    const studySections = new Set<string>();
    const hits: Hit[] = [];
    for (const result of results) {
      const count = taken.get(result.kind) ?? 0;
      if (count >= limit) continue;
      const { text, ...doc } = result;
      if (doc.studyAnchor) {
        const { bookId, section, offset, revision } = doc.studyAnchor;
        const key = JSON.stringify([bookId, section]);
        if (studySections.has(key)) continue;
        const terms = result.terms.filter((term) => result.match[term]?.includes("text"));
        if (!terms.length) continue;
        const match = studyMatch(text, query, terms);
        if (!match) continue;
        studySections.add(key);
        taken.set(result.kind, count + 1);
        hits.push({
          ...doc,
          score: result.score,
          terms: [...new Set([match[0], ...terms])],
          snippet: snippetAt(text, match.index),
          study: {
            type: "passage",
            href: originHref({ kind: "book", bookId, section, offset: offset + match.index, length: match[0].length, revision }),
          },
        });
        continue;
      }
      taken.set(result.kind, count + 1);
      hits.push({
        ...doc,
        id: result.id as string,
        title:
          result.kind === "study" && result.title.length > 160
            ? snippetOf(result.title, result.terms)
            : result.title,
        score: result.score,
        terms: result.terms,
        snippet:
          result.kind === "passage" ||
          ((result.kind === "output" || result.kind === "study") && text.trim())
            ? snippetOf(text, result.terms)
            : undefined,
      });
    }
    return hits;
  }

  /** Called whenever an update finishes. Returns an unsubscribe. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const searchIndex = new SearchIndex();

/** What the index is built from, read fresh. Source texts are left out: passages carry them. */
export async function readCatalogue(): Promise<Catalogue> {
  const [vaults, folders, notebooks, sources, outputs, rows, notes] = await Promise.all([
    listVaults(),
    store().listFolders(),
    store().listNotebooks(),
    store().listAllSources(),
    store().listAllOutputs(),
    store().listStudy(),
    store().listNotes(),
  ]);
  return {
    vaults,
    folders,
    notebooks,
    sources: sources.map(({ id, notebookId, title, studyRevision }) => ({
      id,
      notebookId,
      title,
      studyRevision,
    })),
    outputs,
    study: studySearchCatalogue({ rows, notebooks, notes, vaults }),
  };
}
