import type { ProviderCredentials } from "@/lib/ai/catalog";
import type { Source, SourceKind } from "@/lib/db/database";
import { addSource, attachImages } from "@/lib/db/sources";
import { epubMime, readStudyEpub } from "@/lib/study/read-file";
import { transcriptDocument } from "./transcript";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** What the file picker offers. */
export const SOURCE_EXTENSIONS = ["pdf", "epub", "md", "markdown", "mdx", "txt", "text", "csv"];
export const ACCEPTED_FILES = [
  ...SOURCE_EXTENSIONS.map((extension) => `.${extension}`),
  "application/pdf",
  epubMime,
  "text/plain",
  "text/markdown",
  "text/csv",
].join(",");

export type IngestFailure = "type" | "tooLarge" | "empty" | "read" | "noCaptions";

/** A YouTube video the server read, as the page needs it. */
export interface VideoInfo {
  id: string;
  title: string;
  author: string;
  seconds: number;
  url: string;
}

/** A source that could not be added, with the reason and the file or page it came from. */
export class IngestError extends Error {
  constructor(
    readonly reason: IngestFailure,
    /** The file name or address. */
    readonly subject: string,
    readonly detail = "",
    /** For `noCaptions`: the video, so it can be transcribed another way. */
    readonly video?: VideoInfo,
  ) {
    super(detail || reason);
    this.name = "IngestError";
  }
}

const extension = (name: string) => name.toLowerCase().split(".").pop() ?? "";
const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, "") || name;

async function save(input: Parameters<typeof addSource>[0]): Promise<Source> {
  try {
    return await addSource(input);
  } catch (error) {
    if (error instanceof Error && error.message === "empty-source") {
      throw new IngestError("empty", input.fileName ?? input.url ?? input.title);
    }
    throw error;
  }
}

/** The server read the address but found nothing to save: a video without captions. */
class NoCaptions extends Error {
  constructor(readonly video: VideoInfo) {
    super("noCaptions");
  }
}

async function postForText(body: BodyInit, headers?: HeadersInit) {
  const response = await fetch("/api/sources/parse", { method: "POST", body, headers });
  const json = (await response.json().catch(() => ({}))) as {
    title?: string;
    text?: string;
    kind?: SourceKind;
    url?: string;
    error?: string;
    code?: string;
    video?: VideoInfo;
  };
  if (json.code === "noCaptions" && json.video) throw new NoCaptions(json.video);
  if (!response.ok || json.text === undefined) throw new Error(json.error ?? response.statusText);
  return json as { title: string; text: string; kind: SourceKind; url?: string };
}

/** Reads a document and adds its text to the notebook. */
export async function ingestFile(notebookId: string, file: File): Promise<Source> {
  if (file.size > MAX_FILE_BYTES) throw new IngestError("tooLarge", file.name);
  const ext = extension(file.name);
  const base = { notebookId, title: titleFromFile(file.name), fileName: file.name };

  if (ext === "pdf" || file.type === "application/pdf") {
    const form = new FormData();
    form.append("file", file);
    let parsed;
    try {
      parsed = await postForText(form);
    } catch (error) {
      throw new IngestError(
        "read",
        file.name,
        error instanceof Error ? error.message : String(error),
      );
    }
    const source = await save({
      ...base,
      kind: "pdf",
      text: parsed.text,
      original: { mime: "application/pdf", data: new Uint8Array(await file.arrayBuffer()) },
    });
    // The pictures follow in the background; the source can be used at once.
    if (source.text) {
      void import("./pdf-images")
        .then(({ pdfImages }) => pdfImages(file, source.text))
        .then((images) => attachImages(source, images))
        .catch(() => undefined);
    }
    return source;
  }
  if (ext === "epub" || file.type === epubMime) {
    const data = new Uint8Array(await file.arrayBuffer());
    const book = await readStudyEpub(data).catch((error: unknown) => {
      throw new IngestError(
        "read",
        file.name,
        error instanceof Error ? error.message : String(error),
      );
    });
    if (!book.sections.length) throw new IngestError("empty", file.name);
    return save({
      ...base,
      title: book.title || base.title,
      kind: "epub",
      text: book.sections.map(({ text }) => text).join("\n\n"),
      original: { mime: epubMime, data },
    });
  }
  if (["md", "markdown", "mdx"].includes(ext) || file.type === "text/markdown") {
    const data = new Uint8Array(await file.arrayBuffer());
    return save({
      ...base,
      kind: "markdown",
      text: new TextDecoder().decode(data),
      original: { mime: "text/markdown", data },
    });
  }
  if (["txt", "text", "csv"].includes(ext) || file.type.startsWith("text/")) {
    return save({ ...base, kind: "text", text: await file.text() });
  }
  throw new IngestError("type", file.name);
}

/**
 * Reads a web page (or an online PDF) and adds its main text. A YouTube video
 * adds its captions as a timed transcript; one without captions fails with
 * `noCaptions`, carrying the video for `ingestYouTubeWithGemini`.
 */
export async function ingestUrl(notebookId: string, address: string): Promise<Source> {
  let parsed;
  try {
    parsed = await postForText(JSON.stringify({ url: address }), {
      "content-type": "application/json",
    });
  } catch (error) {
    if (error instanceof NoCaptions)
      throw new IngestError("noCaptions", error.video.title, "", error.video);
    throw new IngestError("read", address, error instanceof Error ? error.message : String(error));
  }
  return save({
    notebookId,
    title: parsed.title,
    kind: parsed.kind,
    text: parsed.text,
    url: parsed.url ?? address,
  });
}

/**
 * Asks Gemini, with the user's Google key, to write a video's transcript, and
 * adds it like captions would have been. Reads the server's newline-delimited
 * answer until it ends; `signal` stops it.
 */
export async function ingestYouTubeWithGemini(
  notebookId: string,
  video: VideoInfo,
  credentials: ProviderCredentials,
  signal?: AbortSignal,
): Promise<Source> {
  const response = await fetch("/api/sources/youtube", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: video.url, credentials }),
  });
  if (!response.ok || !response.body) {
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    throw new IngestError("read", video.title, json.error ?? response.statusText);
  }
  let text = "";
  let failure = "";
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { done?: boolean; text?: string; error?: string };
      if (event.error) failure = event.error;
      if (event.done && event.text) text = event.text;
    }
    if (done) break;
  }
  if (!text) throw new IngestError("read", video.title, failure || "Gemini sent no transcript.");
  return save({
    notebookId,
    title: video.title,
    kind: "text",
    text: transcriptDocument(text, video.url),
    url: video.url,
  });
}

export function ingestText(
  notebookId: string,
  title: string,
  text: string,
  url?: string,
): Promise<Source> {
  return save({ notebookId, title, kind: "text", text, url });
}
