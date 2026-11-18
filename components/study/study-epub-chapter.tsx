import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { loadBlob } from "@/lib/db/blobs";
import { epubPath, openStudyEpub } from "@/lib/study/epub";
import type { StudyRecordOf, StudySection } from "@/lib/study/records";
import { useRenderedStudyMarks } from "./study-rendered-text";

const epubThemeClass = {
  system: "",
  light: "bg-white text-zinc-950",
  sepia: "bg-[#f5ead6] text-[#3d2a20]",
  dark: "bg-zinc-950 text-zinc-100",
};
export type StudyEpubTheme = keyof typeof epubThemeClass;

const retainedTags = new Set([
  "p",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "b",
  "strong",
  "em",
  "i",
  "u",
  "s",
  "sup",
  "sub",
  "blockquote",
  "hr",
  "br",
  "pre",
  "code",
  "cite",
  "figure",
  "figcaption",
  "table",
  "tr",
  "td",
  "th",
  "thead",
  "tbody",
]);

type EpubArchive = Awaited<ReturnType<typeof openStudyEpub>>;
type Chapter = NonNullable<Awaited<ReturnType<EpubArchive["readChapter"]>>>;

async function findChapter(book: EpubArchive, section: StudySection, index: number) {
  if (section.epubPath)
    return { path: section.epubPath, data: await book.readChapter(section.epubPath) };
  const likely = book.chapters[index];
  for (const path of new Set([likely, ...book.chapters])) {
    if (!path) continue;
    const data = await book.readChapter(path);
    if (data?.text === section.text) return { path, data };
  }
  return null;
}

async function loadPictures(
  book: EpubArchive,
  chapter: Chapter,
  path: string,
  createUrl: (blob: Blob) => string,
) {
  const paths = new Set(
    [...chapter.body.querySelectorAll("img")].map((item) =>
      epubPath(item.getAttribute("src") ?? "", path),
    ),
  );
  const pictures = new Map<string, string>();
  await Promise.all(
    [...paths].slice(0, 20).map(async (path) => {
      if (!path) return;
      const image = await book.readImage(path);
      if (image) pictures.set(path, createUrl(image));
    }),
  );
  return pictures;
}

function displayChapter(
  chapter: Chapter,
  path: string,
  pictures: Map<string, string>,
  destinations: ReadonlyMap<string, number>,
  go: (index: number) => void,
) {
  function display(node: Node, key: number): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element)) return null;
    const tag = node.localName;
    if (tag === "img") {
      const pathToImage = epubPath(node.getAttribute("src") ?? "", path);
      const url = pathToImage ? pictures.get(pathToImage) : undefined;
      return url ? (
        <img
          key={key}
          src={url}
          alt={node.getAttribute("alt") ?? ""}
          loading="lazy"
          className="my-3 max-h-[60vh] max-w-full object-contain"
        />
      ) : null;
    }
    const children = Array.from(node.childNodes, display);
    if (tag === "a") {
      const href = node.getAttribute("href") ?? "";
      const target = href && !href.startsWith("#") ? epubPath(href, path) : null;
      const destination = target ? destinations.get(target) : undefined;
      return destination === undefined ? (
        <span key={key}>{children}</span>
      ) : (
        <button
          type="button"
          key={key}
          className="cursor-pointer text-primary underline"
          onClick={() => go(destination)}
        >
          {children}
        </button>
      );
    }
    if (/^h[1-6]$/.test(tag))
      return (
        <h3 key={key} dir="auto" className="my-2 text-xl font-semibold">
          {children}
        </h3>
      );
    if (!retainedTags.has(tag)) return <span key={key}>{children}</span>;
    return createElement(
      tag,
      {
        key,
        dir: /^(p|li|blockquote|figcaption|td|th)$/.test(tag) ? "auto" : undefined,
        className: /^p$/.test(tag)
          ? "my-3"
          : /^(ul|ol)$/.test(tag)
            ? "list-outside ps-6"
            : tag === "li"
              ? "list-item marker:text-muted-foreground"
              : tag === "blockquote"
                ? "my-2 border-s-2 ps-3"
                : tag === "pre"
                  ? "overflow-auto rounded-md bg-muted p-3"
                  : tag === "td" || tag === "th"
                    ? "border p-2"
                    : undefined,
      },
      children,
    );
  }
  return Array.from(chapter.body.childNodes, display);
}

export function StudyEpubChapter({
  fileId,
  section,
  index,
  sections,
  marks,
  font,
  theme,
  onSelect,
  go,
}: {
  fileId: string;
  section: StudySection;
  index: number;
  sections: StudySection[];
  marks: StudyRecordOf<"highlight">[];
  font: number;
  theme: StudyEpubTheme;
  onSelect: (root: HTMLElement) => void;
  go: (index: number) => void;
}) {
  const [loaded, setLoaded] = useState<{
    chapter: Chapter;
    path: string;
    pictures: Map<string, string>;
  } | null>();
  const content = useRef<HTMLDivElement>(null);
  useRenderedStudyMarks(content, Boolean(loaded), section.text, marks);

  useEffect(() => {
    let live = true;
    const urls = new Set<string>();
    void (async () => {
      const blob = await loadBlob(fileId);
      if (!blob) return null;
      const book = await openStudyEpub(new Uint8Array(await blob.arrayBuffer()));
      const found = await findChapter(book, section, index);
      if (!found?.data || !live) return null;
      const pictures = await loadPictures(book, found.data, found.path, (image) => {
        const url = URL.createObjectURL(image);
        if (live) urls.add(url);
        else URL.revokeObjectURL(url);
        return url;
      });
      return { chapter: found.data, path: found.path, pictures };
    })()
      .then((found) => {
        if (live) setLoaded(found);
      })
      .catch(() => {
        if (live) setLoaded(null);
      });
    return () => {
      live = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [fileId, section, index]);

  function capture() {
    if (content.current) onSelect(content.current);
  }

  if (loaded === undefined)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Opening book layout…
      </p>
    );
  if (loaded === null)
    return (
      <p className="text-sm text-muted-foreground">
        The book layout could not be displayed. Its extracted text is below.
      </p>
    );
  const destinations = new Map(
    sections.flatMap((item, index) => (item.epubPath ? [[item.epubPath, index]] : [])),
  );
  return (
    <div
      ref={content}
      role="region"
      aria-label="EPUB chapter layout"
      className={`mx-auto max-w-prose rounded-md p-3 leading-relaxed wrap-break-word [&_ol]:list-decimal [&_ul]:list-disc ${epubThemeClass[theme]}`}
      style={{ fontSize: font }}
      onMouseUp={capture}
      onTouchEnd={capture}
      onKeyUp={capture}
    >
      {displayChapter(loaded.chapter, loaded.path, loaded.pictures, destinations, go)}
    </div>
  );
}
