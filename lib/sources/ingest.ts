import type { ProviderCredentials } from "@/lib/ai/catalog";
import type { Source, SourceFormat, SourceKind } from "@/lib/db/database";
import { addSource, attachImages } from "@/lib/db/sources";
import {
  SOURCE_EXTENSIONS,
  formatOfFile,
  kindOfFormat,
  serverFormats,
  textFormats,
} from "@/lib/sources/formats";
import { epubMime, readStudyEpub } from "@/lib/study/read-file";
import { transcriptDocument } from "./transcript";
import { youTubeId, youTubeWatchUrl, type YouTubeVideoInfo } from "./youtube";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** What the file picker offers. */
export const ACCEPTED_FILES = [
  ...SOURCE_EXTENSIONS.map((ext) => `.${ext}`),
  "application/pdf",
  epubMime,
  "text/*",
].join(",");

export type IngestFailure = "type" | "tooLarge" | "empty" | "read" | "noCaptions" | "private";

/** A YouTube video the server read, as the page needs it. */
export type VideoInfo = YouTubeVideoInfo;

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

async function postForText(body: BodyInit, headers?: HeadersInit) {
  const response = await fetch("/api/sources/parse", { method: "POST", body, headers });
  const json = (await response.json().catch(() => ({}))) as {
    title?: string;
    text?: string;
    kind?: SourceKind;
    format?: SourceFormat;
    url?: string;
    error?: string;
    reason?: string;
    video?: VideoInfo;
  };
  if (!response.ok || json.text === undefined)
    throw new ParseError(json.error ?? response.statusText, json.reason, json.video);
  return json as {
    title: string;
    text: string;
    kind: SourceKind;
    format?: SourceFormat;
    url?: string;
  };
}

class ParseError extends Error {
  constructor(
    message: string,
    readonly reason?: string,
    readonly video?: VideoInfo,
  ) {
    super(message);
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Reads a file and adds it to the notebook. Text files (CSV, JSON, code…) and
 * EPUB books are read here; PDF, HTML, Word, Excel and PowerPoint go to the
 * server. PDF, EPUB and Markdown files are also kept whole, so Study can read
 * them with their own layout.
 */
export async function ingestFile(notebookId: string, file: File): Promise<Source> {
  if (file.size > MAX_FILE_BYTES) throw new IngestError("tooLarge", file.name);
  const format = formatOfFile(file.name, file.type);
  if (!format) throw new IngestError("type", file.name);
  const base = { notebookId, title: titleFromFile(file.name), fileName: file.name, format };

  if (format === "epub") {
    const data = new Uint8Array(await file.arrayBuffer());
    const book = await readStudyEpub(data).catch((error: unknown) => {
      throw new IngestError("read", file.name, message(error));
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
  if (serverFormats.has(format)) {
    const form = new FormData();
    form.append("file", file);
    let parsed;
    try {
      parsed = await postForText(form);
    } catch (error) {
      throw new IngestError("read", file.name, message(error));
    }
    const source = await save({
      ...base,
      title: parsed.title || base.title,
      kind: parsed.kind,
      text: parsed.text,
      ...(format === "pdf"
        ? { original: { mime: "application/pdf", data: new Uint8Array(await file.arrayBuffer()) } }
        : {}),
    });
    if (format === "pdf" && source.text) {
      // The pictures follow in the background; the source can be used at once.
      void import("./pdf-images")
        .then(({ pdfImages }) => pdfImages(file, source.text))
        .then((images) => attachImages(source, images))
        .catch(() => undefined);
    }
    return source;
  }
  if (format === "markdown") {
    const data = new Uint8Array(await file.arrayBuffer());
    return save({
      ...base,
      kind: "markdown",
      text: new TextDecoder().decode(data),
      original: { mime: "text/markdown", data },
    });
  }
  if (textFormats.has(format)) {
    let text = await file.text();
    // Tabs are folded into spaces with the rest of the text; keep the columns apart.
    if (format === "tsv") text = text.replace(/\t/g, " | ");
    return save({ ...base, kind: kindOfFormat(format), text });
  }
  throw new IngestError("type", file.name);
}

/**
 * Reads a web page, an online PDF or a YouTube video's captions and adds its
 * text. A video without captions fails with `noCaptions`, carrying the video
 * for `ingestYouTubeWithGemini`.
 */
export async function ingestUrl(notebookId: string, address: string): Promise<Source> {
  let parsed;
  try {
    parsed = await postForText(JSON.stringify({ url: address }), {
      "content-type": "application/json",
    });
  } catch (error) {
    const reason = error instanceof ParseError ? error.reason : undefined;
    if (reason === "no-captions") {
      const video = error instanceof ParseError ? error.video : undefined;
      throw new IngestError("noCaptions", video?.title ?? address, "", video);
    }
    if (reason === "private") throw new IngestError("private", address);
    throw new IngestError("read", address, message(error));
  }
  return save({
    notebookId,
    title: parsed.title,
    kind: parsed.kind,
    format: parsed.format,
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
    kind: "youtube",
    format: "youtube",
    text,
    url: video.url,
  });
}

/**
 * Adds a transcript the user pasted, loaded from subtitles or had a recording
 * transcribed into (`[mm:ss]` paragraphs). With a YouTube link it is saved as
 * that video's transcript, the same way its captions would be; with another
 * link, the link is written above the text so the model can cite it.
 */
export function ingestTranscript(
  notebookId: string,
  { title, text, link }: { title: string; text: string; link?: string },
): Promise<Source> {
  const video = link ? youTubeId(link) : null;
  if (video) {
    return save({
      notebookId,
      title,
      kind: "youtube",
      format: "youtube",
      text: text.trim(),
      url: youTubeWatchUrl(video),
    });
  }
  return save({ notebookId, title, kind: "text", text: transcriptDocument(text, link), url: link });
}

export function ingestText(
  notebookId: string,
  title: string,
  text: string,
  url?: string,
): Promise<Source> {
  return save({ notebookId, title, kind: "text", text, url });
}
