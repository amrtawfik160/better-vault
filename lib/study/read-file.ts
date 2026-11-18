import { openStudyEpub } from "./epub";
import { studyMarkdownContent } from "./markdown-document";
import type { StudySection } from "./records";

export const epubMime = "application/epub+zip";
const maxFileSize = 50 * 1024 * 1024;
const maxTextLength = 2_000_000;

type ParsedDocument = {
  title: string;
  format: "pdf" | "epub" | "text";
  sections: StudySection[];
  bytes: Uint8Array;
  mime: string;
};

export async function readStudyEpub(bytes: Uint8Array) {
  const book = await openStudyEpub(bytes);
  const sections: StudySection[] = [];
  let characters = 0;
  for (const path of book.chapters) {
    const chapter = await book.readChapter(path);
    if (!chapter || (!chapter.text && !chapter.body.querySelector("img"))) continue;
    characters += chapter.text.length;
    if (characters > maxTextLength) throw new Error("This EPUB has too much text.");
    sections.push({
      title: chapter.title || `Chapter ${sections.length + 1}`,
      text: chapter.text,
      epubPath: path,
    });
  }
  return { title: book.title, sections };
}

export async function studyPdfSections(bytes: Uint8Array): Promise<StudySection[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes.slice());
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    const sections = text.map((page, index) => ({ title: `Page ${index + 1}`, text: page.trim() }));
    if (!sections.length) throw new Error("This document has no readable pages.");
    if (sections.reduce((total, section) => total + section.text.length, 0) > maxTextLength)
      throw new Error("This document has too much text.");
    return sections;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export async function readStudyFile(file: File): Promise<ParsedDocument> {
  if (file.size > maxFileSize) throw new Error("Choose a file under 50 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fallback = file.name.replace(/\.[^.]+$/, "").trim() || "Untitled";
  const extension = file.name.split(".").pop()?.toLowerCase();
  const markdown =
    extension === "md" ||
    extension === "markdown" ||
    extension === "mdx" ||
    file.type === "text/markdown";
  let result: ParsedDocument;
  if (extension === "pdf" || file.type === "application/pdf") {
    result = {
      title: fallback,
      format: "pdf",
      bytes,
      mime: "application/pdf",
      sections: await studyPdfSections(bytes),
    };
  } else if (extension === "epub" || file.type === epubMime) {
    const { title, sections } = await readStudyEpub(bytes);
    result = { title: title || fallback, format: "epub", bytes, mime: epubMime, sections };
  } else if (markdown || extension === "txt" || extension === "text" || file.type === "text/plain") {
    const text = new TextDecoder().decode(bytes);
    if (text.length > maxTextLength) throw new Error("This document has too much text.");
    const content = markdown ? studyMarkdownContent(text) : { text: text.trim() };
    result = {
      title: fallback,
      format: "text",
      bytes,
      mime: markdown ? "text/markdown" : "text/plain",
      sections: [{ title: fallback, ...content }],
    };
  } else throw new Error("Choose a PDF, EPUB, Markdown, or text file.");
  if (result.sections.reduce((total, section) => total + section.text.length, 0) > maxTextLength) {
    throw new Error("This document has too much text.");
  }
  if (!result.sections.length) throw new Error("This document has no readable pages.");
  return result;
}
