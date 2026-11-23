import { generateId } from "ai";
import { normaliseText } from "@/lib/grounding/chunk";
import { saveBlob } from "./blobs";
import { useStoreQuery } from "./live";
import { chunksForSource, sourceHasText } from "./source-text";
import { store } from "./store";
import type { Chunk, Source, SourceImage, SourceKind, StoredBlob } from "./types";

export interface NewSource {
  notebookId: string;
  title: string;
  kind: SourceKind;
  text: string;
  url?: string;
  fileName?: string;
  original?: Pick<StoredBlob, "data" | "mime">;
}

/** Adds a source and splits its text into passages. */
export async function addSource(input: NewSource): Promise<Source> {
  const text = normaliseText(input.text);
  const originalMime = input.kind === "pdf" ? "application/pdf" : input.kind === "epub" ? "application/epub+zip" : undefined;
  if (!text && (!originalMime || input.original?.mime !== originalMime || !input.original.data.byteLength)) {
    throw new Error("empty-source");
  }
  const id = generateId();
  const now = Date.now();
  const original = input.original
    ? {
        id: generateId(),
        sourceId: id,
        notebookId: input.notebookId,
        createdAt: now,
        ...input.original,
      }
    : undefined;
  const source: Source = {
    id,
    notebookId: input.notebookId,
    title: input.title.trim() || "Untitled",
    kind: input.kind,
    url: input.url,
    fileName: input.fileName,
    originalFileId: original?.id,
    text,
    charCount: text.length,
    selected: Boolean(text),
    createdAt: now,
  };
  await store().addSource(source, chunksForSource(source), now, original);
  return source;
}

export { chunksForSource } from "./source-text";

export interface NewSourceImage {
  mime: string;
  data: Uint8Array;
  width: number;
  height: number;
  /** A character offset in the source's text. */
  at: number;
}

/** Keeps pictures with a source (from its PDF); they are deleted with it. */
export async function attachImages(source: Source, images: NewSourceImage[]): Promise<void> {
  if (images.length === 0) return;
  const kept: SourceImage[] = [];
  for (const image of images) {
    const blobId = await saveBlob({
      notebookId: source.notebookId,
      sourceId: source.id,
      mime: image.mime,
      data: image.data,
    });
    kept.push({ blobId, at: image.at, width: image.width, height: image.height });
  }
  await store().patchSource(source.id, { images: kept });
}

export async function setSourceSelected(id: string, selected: boolean) {
  if (selected) {
    const source = await store().getSource(id);
    if (!source || !sourceHasText(source)) return;
  }
  await store().patchSource(id, { selected });
}

export async function setAllSourcesSelected(notebookId: string, selected: boolean) {
  await store().patchNotebookSources(notebookId, { selected });
}

export async function renameSource(id: string, title: string) {
  const name = title.trim();
  if (name) await store().renameDocument({ kind: "source", id, title: name, updatedAt: Date.now() });
}

export async function deleteSource(id: string) {
  await store().deleteSource(id);
}

/** A notebook's sources, oldest first. `undefined` while loading. */
export function useSources(notebookId: string): Source[] | undefined {
  return useStoreQuery(() => store().listSources(notebookId), [notebookId], ["sources"]);
}

export function useSource(id: string) {
  return useStoreQuery(async () => (await store().getSource(id)) ?? null, [id], ["sources"]);
}

/** The passages of the given sources, in reading order. */
export async function getChunks(sourceIds: readonly string[]): Promise<Chunk[]> {
  const chunks = await store().getChunks([...sourceIds]);
  const order = new Map(sourceIds.map((id, at) => [id, at]));
  return chunks.sort(
    (a, b) => (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0) || a.index - b.index,
  );
}

/** A notebook's sources, oldest first. */
export function listSources(notebookId: string): Promise<Source[]> {
  return store().listSources(notebookId);
}

/** The sources that still exist among `ids`, in that order. */
export function getSources(ids: readonly string[]): Promise<Source[]> {
  return store().getSources([...ids]);
}

/** One source, live, with its passages in reading order. `undefined` while loading. */
export function useSourceWithChunks(
  id: string,
): { source: Source | undefined; chunks: Chunk[] } | undefined {
  return useStoreQuery(
    async () => ({ source: await store().getSource(id), chunks: await getChunks([id]) }),
    [id],
    ["sources", "chunks"],
  );
}

/** Every source's title and notebook, for `[[src:…]]` links in notes. */
export function useSourceTitles(
  enabled = true,
  textOnly = false,
): Pick<Source, "id" | "notebookId" | "title">[] | undefined {
  return useStoreQuery(
    async () =>
      (enabled ? await store().listSourceSummaries() : [])
        .filter((source) => !textOnly || source.hasText)
        .map(({ id, notebookId, title }) => ({ id, notebookId, title })),
    [enabled, textOnly],
    ["sources"],
  );
}
