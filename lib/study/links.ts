import { routes } from "@/lib/routes";
import type { StudyOrigin } from "./records";

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

export function originHref(origin: StudyOrigin) {
  switch (origin.kind) {
    case "book":
      return studyHref("library", {
        book: origin.bookId,
        page: origin.section,
        highlight: origin.highlightId,
        at: origin.offset,
        length: origin.length,
        rev: origin.revision,
      });
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
    case "report":
      return studyHref("tutor", {
        thread: origin.threadId,
        report: "1",
        reportId: origin.reportId,
      });
    case "studio":
      return withQuery(routes.notebook(origin.notebookId), { output: origin.outputId });
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
    case "report":
      return "Open session report";
    case "studio":
      return "Open Studio output";
    case "word":
      return "Open vocabulary";
  }
}

export function queryIndex(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}
