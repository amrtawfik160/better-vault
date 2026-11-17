import type { StudySection } from "./records";

const epubMime = "application/epub+zip";
const maxFileSize = 50 * 1024 * 1024;
const maxTextLength = 2_000_000;

type ParsedDocument = {
  title: string;
  format: "pdf" | "epub" | "text";
  sections: StudySection[];
  bytes: Uint8Array;
  mime: string;
};

function elements(document: Document, name: string) {
  return [...document.getElementsByTagNameNS("*", name)];
}

async function readEpub(bytes: Uint8Array) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();
  async function xml(name: string) {
    const member = await zip.file(name)?.async("string");
    if (!member) throw new Error("This EPUB is missing a required file.");
    return parser.parseFromString(member, "application/xml");
  }
  const container = await xml("META-INF/container.xml");
  const packageName = elements(container, "rootfile")[0]?.getAttribute("full-path");
  if (!packageName) throw new Error("This EPUB has no reading order.");
  const manifest = await xml(packageName);
  const members = new Map(
    elements(manifest, "item").map((item) => [item.getAttribute("id"), item.getAttribute("href")]),
  );
  const base = new URL(packageName, "https://ebook.local/");
  const sections: StudySection[] = [];
  let characters = 0;
  for (const item of elements(manifest, "itemref")) {
    const href = members.get(item.getAttribute("idref"));
    if (!href || item.getAttribute("linear") === "no") continue;
    const member = new URL(href, base);
    if (member.origin !== base.origin) continue;
    const raw = await zip.file(decodeURIComponent(member.pathname.slice(1)))?.async("string");
    if (!raw) continue;
    const html = parser.parseFromString(raw, "text/html");
    html
      .querySelectorAll("script, style, noscript, template")
      .forEach((element) => element.remove());
    html.body
      .querySelectorAll("br, p, div, section, li, h1, h2, h3, h4, blockquote")
      .forEach((element) => {
        element.after(html.createTextNode("\n\n"));
      });
    const text = html.body.textContent?.replace(/\n{3,}/g, "\n\n").trim() ?? "";
    if (!text) continue;
    characters += text.length;
    if (characters > maxTextLength) throw new Error("This EPUB has too much text.");
    const heading = html.body.querySelector("h1, h2, h3")?.textContent?.trim();
    const title = heading || html.title.trim() || `Chapter ${sections.length + 1}`;
    sections.push({ title, text });
  }
  return { title: elements(manifest, "title")[0]?.textContent?.trim(), sections };
}

export async function readStudyFile(file: File): Promise<ParsedDocument> {
  if (file.size > maxFileSize) throw new Error("Choose a file under 50 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fallback = file.name.replace(/\.[^.]+$/, "").trim() || "Untitled";
  const extension = file.name.split(".").pop()?.toLowerCase();
  let result: ParsedDocument;
  if (extension === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes.slice());
    try {
      const { text } = await extractText(pdf, { mergePages: false });
      result = {
        title: fallback,
        format: "pdf",
        bytes,
        mime: "application/pdf",
        sections: text.map((page, index) => ({ title: `Page ${index + 1}`, text: page.trim() })),
      };
    } finally {
      await pdf.loadingTask.destroy();
    }
  } else if (extension === "epub") {
    const { title, sections } = await readEpub(bytes);
    result = { title: title || fallback, format: "epub", bytes, mime: epubMime, sections };
  } else if (extension === "txt" || extension === "md") {
    const text = new TextDecoder().decode(bytes).trim();
    result = {
      title: fallback,
      format: "text",
      bytes,
      mime: "text/plain",
      sections: [{ title: fallback, text }],
    };
  } else throw new Error("Choose a PDF, EPUB, Markdown, or text file.");
  if (result.sections.reduce((total, section) => total + section.text.length, 0) > maxTextLength) {
    throw new Error("This document has too much text.");
  }
  if (!result.sections.length) throw new Error("This document has no readable pages.");
  return result;
}
