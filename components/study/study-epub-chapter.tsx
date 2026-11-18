import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/panelui/button";
import { loadBlob } from "@/lib/db/blobs";
import { epubPath, openStudyEpub } from "@/lib/study/epub";
import type { StudyReadingAppearance, StudySection, StudyVisualOrigin } from "@/lib/study/records";
import type { StudyImageCapture } from "@/lib/study/visual-card";
import { textDirection, type TextDirection } from "@/lib/text/direction";
import { directionalInline } from "@/components/common/directional-text";
import { StudyImageRegion } from "./study-image-crop";
import { useRenderedStudyMarks, type StudyTextMark } from "./study-rendered-text";

const epubThemeClass = {
  system: "",
  light: "bg-white text-zinc-950",
  sepia: "bg-[#f5ead6] text-[#3d2a20]",
  dark: "bg-zinc-950 text-zinc-100",
} satisfies Record<StudyReadingAppearance["epubTheme"], string>;

const retainedTags = new Set([
  "div",
  "section",
  "span",
  "bdi",
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
type EpubPicture = { url: string; blob: Blob };

const textBlocks = new Set([
  "p",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "figcaption",
  "table",
  "td",
  "th",
]);

function bookDirection(value: string | null): TextDirection | undefined {
  const dir = value?.toLowerCase();
  if (dir === "ltr" || dir === "rtl" || dir === "auto") return dir;
}

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
  const pictures = new Map<string, EpubPicture>();
  await Promise.all(
    [...paths].slice(0, 20).map(async (path) => {
      if (!path) return;
      const image = await book.readImage(path);
      if (image) pictures.set(path, { url: createUrl(image), blob: image });
    }),
  );
  return pictures;
}

type FigureCapture = Extract<StudyImageCapture, { kind: "epub" }>;
type FigureOrigin = Extract<StudyVisualOrigin, { kind: "epub" }>;
type FigureActions = {
  onVisual: (capture: StudyImageCapture) => void;
  onDiscuss: (capture: StudyImageCapture) => void;
  onDiscussArea: (capture: StudyImageCapture) => void;
};

function FigureAction({
  capture,
  actions,
}: {
  capture: FigureCapture;
  actions: FigureActions;
}) {
  const { t } = useTranslation("home");
  return (
    <span className="inline-flex flex-wrap gap-1" data-study-reading-control>
      <Button
        type="button"
        className="select-none"
        variant="ghost"
        size="sm"
        aria-label={capture.description ? t("study.visualCard.captureNamedFigure", { description: capture.description }) : undefined}
        onClick={() => actions.onVisual(capture)}
      >
        {t("study.visualCard.captureFigure")}
      </Button>
      <Button
        type="button"
        className="select-none"
        variant="ghost"
        size="sm"
        aria-label={capture.description ? t("study.reader.discussNamedFigure", { description: capture.description }) : undefined}
        onClick={() => actions.onDiscuss(capture)}
      >
        {t("study.reader.discussFigure")}
      </Button>
      <Button
        type="button"
        className="select-none"
        variant="ghost"
        size="sm"
        aria-label={capture.description ? t("study.reader.discussNamedFigureArea", { description: capture.description }) : undefined}
        onClick={() => actions.onDiscussArea(capture)}
      >
        {t("study.reader.discussFigureArea")}
      </Button>
    </span>
  );
}

function displayChapter(
  chapter: Chapter,
  path: string,
  pictures: Map<string, EpubPicture>,
  destinations: ReadonlyMap<string, number>,
  go: (index: number) => void,
  actions: FigureActions,
  focus?: FigureOrigin,
) {
  const figures = new Map<Element, number>();
  chapter.body.querySelectorAll("img").forEach((image, index) => figures.set(image, index));
  function figureOf(node: Element) {
    const relative = epubPath(node.getAttribute("src") ?? "", path);
    const picture = relative ? pictures.get(relative) : undefined;
    const figure = figures.get(node);
    if (!picture || figure === undefined) return;
    const capture: FigureCapture = {
      kind: "epub",
      blob: picture.blob,
      figure,
      description: node.getAttribute("alt") ?? "",
    };
    return { picture, capture };
  }
  function chapterDestination(node: Element) {
    const href = node.getAttribute("href") ?? "";
    const target = href && !href.startsWith("#") ? epubPath(href, path) : null;
    return target ? destinations.get(target) : undefined;
  }
  function display(
    node: Node,
    key: number,
    inherited: TextDirection,
    authored?: TextDirection,
  ): ReactNode {
    if (node.nodeType === Node.TEXT_NODE)
      return directionalInline(node.textContent ?? "", inherited);
    if (!(node instanceof Element)) return null;
    const tag = node.localName;
    if (tag === "img") {
      const figure = figureOf(node);
      if (!figure) return null;
      const link = node.closest("a");
      const linked = link && chapterDestination(link) !== undefined;
      const crop = focus?.figure === figure.capture.figure ? focus.crop : undefined;
      return (
        <span
          key={key}
          className="my-3 inline-flex max-w-full flex-col items-start gap-1 align-middle"
        >
          <span className="relative block max-w-full">
            <img
              src={figure.picture.url}
              alt={figure.capture.description}
              loading="lazy"
              data-study-figure={figure.capture.figure}
              className="block max-h-[60vh] max-w-full object-contain"
            />
            {crop ? <StudyImageRegion crop={crop} /> : null}
          </span>
          {linked ? null : <FigureAction capture={figure.capture} actions={actions} />}
        </span>
      );
    }
    const heading = /^h[1-6]$/.test(tag);
    const declared = bookDirection(node.getAttribute("dir"));
    const lang = node.getAttribute("lang") ?? node.getAttribute("xml:lang") ?? undefined;
    const dir =
      declared ??
      (tag === "pre" || tag === "code"
        ? "ltr"
        : !authored && (heading || textBlocks.has(tag))
          ? textDirection(node.textContent ?? "")
          : undefined);
    const children = Array.from(node.childNodes, (child, index) =>
      display(child, index, dir ?? inherited, declared ?? authored),
    );
    if (tag === "a") {
      const destination = chapterDestination(node);
      return destination === undefined ? (
        <span key={key} dir={dir} lang={lang}>
          {children}
        </span>
      ) : (
        <span key={key} dir={dir} lang={lang}>
          <button
            type="button"
            className="cursor-pointer text-primary underline"
            onClick={() => go(destination)}
          >
            {children}
          </button>
          {[...node.querySelectorAll("img")].flatMap((image) => {
            const figure = figureOf(image);
            return figure
              ? [
                  <FigureAction
                    key={figure.capture.figure}
                    capture={figure.capture}
                    actions={actions}
                  />,
                ]
              : [];
          })}
        </span>
      );
    }
    if (heading)
      return (
        <h3 key={key} dir={dir} lang={lang} className="my-2 text-[1.11em] leading-snug font-semibold">
          {children}
        </h3>
      );
    if (!retainedTags.has(tag))
      return (
        <span key={key} dir={dir} lang={lang}>
          {children}
        </span>
      );
    return createElement(
      tag,
      {
        key,
        dir,
        lang,
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
  const authored = bookDirection(chapter.direction);
  return Array.from(chapter.body.childNodes, (node, index) =>
    display(node, index, authored ?? "auto", authored),
  );
}

export function StudyEpubChapter({
  fileId,
  section,
  index,
  sections,
  marks,
  font,
  theme,
  focus,
  onSelect,
  onReadingSurface,
  onVisual,
  onDiscuss,
  onDiscussArea,
  go,
}: {
  fileId: string;
  section: StudySection;
  index: number;
  sections: StudySection[];
  marks: readonly StudyTextMark[];
  font: number;
  theme: StudyReadingAppearance["epubTheme"];
  focus?: FigureOrigin;
  onSelect: (root: HTMLElement) => void;
  onReadingSurface: (surface: { section: number; root: HTMLElement | null }) => void;
  onVisual: (capture: StudyImageCapture) => void;
  onDiscuss: (capture: StudyImageCapture) => void;
  onDiscussArea: (capture: StudyImageCapture) => void;
  go: (index: number) => void;
}) {
  const [loaded, setLoaded] = useState<{
    chapter: Chapter;
    path: string;
    pictures: Map<string, EpubPicture>;
  } | null>();
  const content = useRef<HTMLDivElement>(null);
  useRenderedStudyMarks(content, Boolean(loaded), section.text, marks);
  useEffect(() => {
    if (loaded !== undefined) onReadingSurface({ section: index, root: content.current });
  }, [index, loaded, onReadingSurface]);

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
      dir={bookDirection(loaded.chapter.direction)}
      lang={loaded.chapter.language ?? undefined}
      className={`mx-auto max-w-prose rounded-md p-3 leading-relaxed wrap-break-word [&_ol]:list-decimal [&_ul]:list-disc ${epubThemeClass[theme]}`}
      style={{ fontSize: font }}
      onMouseUp={capture}
      onTouchEnd={capture}
      onKeyUp={capture}
    >
      {displayChapter(loaded.chapter, loaded.path, loaded.pictures, destinations, go, { onVisual, onDiscuss, onDiscussArea }, focus)}
    </div>
  );
}
