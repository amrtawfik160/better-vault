import { routes } from "@/lib/routes";
import type { StudyBook, StudyCitation, StudyOrigin, StudyRecordOf, StudyVisualOrigin } from "./records";
import { readStudyImageCrop, studyImageCropKey } from "./visual-card";

function withQuery(path: string, values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) params.set(name, String(value));
  }
  return `${path}?${params}`;
}

export function studyHref(tab: string, params: Record<string, string | number | undefined> = {}) {
  return withQuery(routes.home, { view: "study", tab, ...params });
}

export function tutorCardsScope(origin?: StudyOrigin) {
  if (origin?.kind === "tutor" && origin.message !== undefined)
    return { thread: origin.threadId, fromAnswer: String(origin.message) };
  if (origin?.kind === "report")
    return { thread: origin.threadId, fromReport: origin.reportId ?? "legacy" };
}

export function isFocusedStudyReader(params: URLSearchParams) {
  return params.get("view") === "study" && params.get("tab") === "library" &&
    Boolean(params.get("book")) && params.get("readerFocus") === "1";
}

export function isStudyHref(href: string) {
  const [path, query] = href.split("#")[0].split("?", 2);
  return (
    path === "/study" ||
    (path === routes.home && new URLSearchParams(query).get("view") === "study")
  );
}

export function studyNotesHref(notebookId: string) {
  return withQuery(routes.home, { view: "notes", notebook: notebookId });
}

export function studyCitationOrigin(citation: StudyCitation): StudyOrigin {
  if ("origin" in citation) return citation.origin;
  return { kind: "book", bookId: citation.bookId, section: citation.section };
}

export function studyHighlightOrigin({ id, bookId, section }: StudyRecordOf<"highlight">) {
  return { kind: "book" as const, bookId, section, highlightId: id };
}

export function originHref(origin: StudyOrigin, reader?: URLSearchParams) {
  switch (origin.kind) {
    case "book": {
      const sameReader = reader?.get("view") === "study" && reader.get("tab") === "library" &&
        reader.get("book") === origin.bookId;
      const readerTutor = sameReader ? (reader.get("readerTutor") ?? undefined) : undefined;
      return studyHref("library", {
        book: origin.bookId,
        page: origin.section,
        highlight: origin.highlightId,
        at: origin.offset,
        length: origin.length,
        rev: origin.revision,
        figure: origin.visual?.kind === "epub" ? origin.visual.figure : undefined,
        pageTop: origin.visual?.kind === "pdf" ? origin.visual.top : undefined,
        crop: origin.visual?.crop ? studyImageCropKey(origin.visual.crop) : undefined,
        reference: origin.section === undefined ? undefined : "1",
        readerFocus: sameReader && isFocusedStudyReader(reader) ? "1" : undefined,
        readerTutor,
        readerView: readerTutor ? "book" : undefined,
        notebook: sameReader ? (reader.get("notebook") ?? undefined) : undefined,
        vault: sameReader ? (reader.get("vault") ?? undefined) : undefined,
      });
    }
    case "note":
      return withQuery(routes.home, {
        view: "notes",
        note: origin.noteId,
        heading: origin.heading,
      });
    case "source":
      return withQuery(routes.notebook(origin.notebookId), {
        source: origin.sourceId,
        passage: origin.chunkId,
      });
    case "tutor":
      return studyHref("tutor", { thread: origin.threadId, message: origin.message });
    case "notebook-answer":
      return withQuery(routes.notebook(origin.notebookId), {
        tab: "chat",
        conversation: origin.conversationId,
        answer: origin.messageId,
      });
    case "report":
      return studyHref("tutor", {
        thread: origin.threadId,
        report: "1",
        reportId: origin.reportId,
        suggestion: origin.suggestion,
      });
    case "studio":
      return withQuery(routes.notebook(origin.notebookId), { output: origin.outputId });
    case "card":
      return studyHref("cards", { card: origin.cardId });
    case "word":
      return studyHref("vocabulary", { word: origin.wordId });
  }
}

export function originLabel(origin: StudyOrigin) {
  switch (origin.kind) {
    case "book":
      return origin.length || origin.highlightId ? "Open passage" : "Open document";
    case "note":
      return "Open note";
    case "source":
      return "Open passage";
    case "tutor":
      return "Open conversation";
    case "notebook-answer":
      return "Open notebook answer";
    case "report":
      return "Open session report";
    case "studio":
      return "Open Studio output";
    case "card":
      return "Open flashcard";
    case "word":
      return "Open vocabulary";
  }
}

export function queryIndex(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

export function studyVisualFromReader(params: URLSearchParams, format?: StudyBook["format"]): StudyVisualOrigin | undefined {
  const crop = readStudyImageCrop(params.get("crop"));
  const figure = queryIndex(params.get("figure"));
  const top = queryIndex(params.get("pageTop"));
  if (format === "epub" && figure !== undefined) return { kind: "epub", figure, ...(crop && { crop }) };
  if (format === "pdf" && top !== undefined && top <= 10_000)
    return { kind: "pdf", top, ...(crop && { crop }) };
}
