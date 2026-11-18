const origin = "https://study-epub.invalid/";

function named(document: Document, name: string) {
  return [...document.getElementsByTagNameNS("*", name)];
}

export function epubPath(href: string, relativeTo = "") {
  try {
    const root = new URL(origin);
    const url = new URL(href, new URL(relativeTo, root));
    if (url.origin !== root.origin) return null;
    return decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
}

export async function openStudyEpub(bytes: Uint8Array) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();
  async function metadata(path: string) {
    const raw = await zip.file(path)?.async("string");
    if (!raw) throw new Error("This EPUB is missing a required file.");
    const document = parser.parseFromString(raw, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("This EPUB has invalid metadata.");
    return document;
  }
  const container = await metadata("META-INF/container.xml");
  const packageName = named(container, "rootfile")[0]?.getAttribute("full-path");
  if (!packageName) throw new Error("This EPUB has no reading order.");
  const manifest = await metadata(packageName);
  const members = new Map(
    named(manifest, "item").map((item) => [item.getAttribute("id"), item.getAttribute("href")]),
  );
  const chapters = named(manifest, "itemref").flatMap((item) => {
    const href = members.get(item.getAttribute("idref"));
    if (!href || item.getAttribute("linear") === "no") return [];
    const path = epubPath(href, packageName);
    return path ? [path] : [];
  });

  return {
    title: named(manifest, "title")[0]?.textContent?.trim(),
    chapters,
    async readChapter(path: string) {
      if (!chapters.includes(path)) return null;
      const raw = await zip.file(path)?.async("string");
      if (!raw) return null;

      // The fragment parser drops the document's html and body tags.
      const documentMeta = parser.parseFromString(raw, "application/xhtml+xml");
      const html = documentMeta.documentElement;
      const body = named(documentMeta, "body")[0];
      const direction = body?.getAttribute("dir") ?? html.getAttribute("dir");
      const language =
        body?.getAttribute("lang") ??
        body?.getAttribute("xml:lang") ??
        html.getAttribute("lang") ??
        html.getAttribute("xml:lang");

      // A detached template holds the book's HTML without loading its resources.
      const template = document.createElement("template");
      template.innerHTML = raw;
      template.content
        .querySelectorAll(
          "script, style, template, noscript, head, iframe, object, embed, video, audio, svg",
        )
        .forEach((item) => item.remove());
      const plain = template.content.cloneNode(true);
      if (!(plain instanceof DocumentFragment)) return null;
      plain
        .querySelectorAll("br, p, div, section, li, h1, h2, h3, h4, blockquote")
        .forEach((item) => item.after(document.createTextNode("\n\n")));
      return {
        body: template.content,
        direction,
        language,
        text: plain.textContent?.replace(/\n{3,}/g, "\n\n").trim() ?? "",
        title:
          template.content.querySelector("h1, h2, h3")?.textContent?.trim() ||
          template.content.querySelector("title")?.textContent?.trim(),
      };
    },
    async readImage(path: string) {
      const type = path.toLowerCase().split(".").pop();
      const mime =
        type === "jpg" || type === "jpeg"
          ? "image/jpeg"
          : type === "png" || type === "gif" || type === "webp"
            ? `image/${type}`
            : "";
      if (!mime) return null;
      const bytes = await zip.file(path)?.async("uint8array");
      if (!bytes || bytes.length > 8_000_000) return null;
      return new Blob([new Uint8Array(bytes).buffer], { type: mime });
    },
  };
}
