import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/panelui/button";
import { startSourceTutor, studyBookForSource, useSavedStudyBookForSource } from "@/lib/db/study";
import { originHref, studyHref } from "@/lib/study/links";
import { locateCitedChunk } from "@/lib/study/locators";
import { findStudyDocumentExcerpt } from "@/lib/study/markdown-document";
import type { StudyBook } from "@/lib/study/records";
import { studyTextRevision } from "@/lib/study/text-edits";
import { Icon } from "@/components/icon";
import { Markdown } from "@/components/chat/markdown";
import { Dialog } from "@/components/panelui/dialog";
import { StudyReturnLinks } from "@/components/study/study-return-links";
import { studyReturnState } from "@/lib/study/return-links";
import { Sheet } from "@/components/panelui/sheet";
import { loadBlob } from "@/lib/db/blobs";
import { useSourceWithChunks } from "@/lib/db/sources";
import { sourceHasText } from "@/lib/db/source-text";
import type { Chunk, Source, SourceImage } from "@/lib/db/types";
import { countWords } from "@/lib/format";
import { sourceFormatOf } from "@/lib/sources/formats";
import { parseTimestamp } from "@/lib/sources/transcript";
import { youTubeId } from "@/lib/sources/youtube";
import { reflow } from "@/lib/sources/reflow";
import { cn } from "@/lib/utils";

interface SourceReaderProps {
  notebookId: string;
  reading: { sourceId: string; passage?: string; snippet?: string } | null;
  onClose: () => void;
}

/** Shows a source's text, scrolled to a cited passage when there is one. */
export function SourceReader({ notebookId, reading, onClose }: SourceReaderProps) {
  const { t: tCommon } = useTranslation();
  return (
    <Sheet side="right" open={reading !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <Sheet.Content
        closeLabel={tCommon("actions.close")}
        className="w-[min(36rem,calc(100vw-2*var(--sheet-gap)))]"
      >
        <StudyReturnLinks className="px-3 pt-3" />
        {reading ? (
          <ReaderBody key={reading.sourceId} notebookId={notebookId} {...reading} />
        ) : null}
      </Sheet.Content>
    </Sheet>
  );
}

/** The Study reader on a document, at the passage an excerpt quotes when it is found. */
export function readingLink(book: StudyBook, excerpt: string | undefined) {
  const anchor = excerpt ? findStudyDocumentExcerpt(book, excerpt) : undefined;
  return studyHref("library", {
    book: book.id,
    notebook: book.notebookId,
    page: anchor?.section,
    at: anchor?.offset,
    length: anchor?.length,
    rev: anchor ? studyTextRevision(book) : undefined,
    reference: anchor ? "1" : undefined,
  });
}

function ReaderBody({
  notebookId,
  sourceId,
  passage,
  snippet,
}: NonNullable<SourceReaderProps["reading"]> & { notebookId: string }) {
  const { t, i18n } = useTranslation("sources");
  const read = useSourceWithChunks(sourceId);
  const navigate = useNavigate();
  const returnState = studyReturnState(useLocation().state);
  const [opening, setOpening] = useState(false);
  const source = read?.source?.notebookId === notebookId ? read.source : undefined;
  const saved = useSavedStudyBookForSource(notebookId, sourceId, Boolean(read && !source));
  const chunks = read?.chunks;
  const excerpt = snippet?.replace(/…$/u, "").trim();
  const cited = useMemo(
    () => locateCitedChunk(chunks ?? [], passage, excerpt),
    [chunks, passage, excerpt],
  );
  const highlighted = useRef<HTMLDivElement>(null);
  // Where the video player starts: null until a time in the transcript is pressed.
  const [start, setStart] = useState<number | null>(null);
  const placed = useMemo(
    () => (source && chunks ? imagesByChunk(source, chunks) : new Map<string, PlacedImage[]>()),
    [source, chunks],
  );

  useEffect(() => {
    if (cited) highlighted.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cited]);

  if (!read) return null;
  if (!source) {
    return (
      <Sheet.Header
        title={t("unavailable")}
        description={saved ? t("savedStudyDescription") : undefined}
      >
        {saved ? (
          <Link
            to={readingLink(saved, excerpt)}
            state={returnState}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("openSavedStudy")}
          </Link>
        ) : null}
      </Sheet.Header>
    );
  }
  const words = countWords(source.text);
  const video = source.kind === "youtube" && source.url ? youTubeId(source.url) : null;
  const hasText = sourceHasText(source);
  const sourceSize = hasText
    ? t("words", { count: words, formattedCount: words.toLocaleString(i18n.language) })
    : t("noSelectableText");

  async function openStudy(destination: () => Promise<string>) {
    setOpening(true);
    try {
      navigate(await destination(), { state: returnState });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setOpening(false);
    }
  }

  return (
    <>
      <Sheet.Header
        title={source.title}
        description={`${t(`formats.${sourceFormatOf(source)}`)} · ${sourceSize}`}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={opening}
            onClick={() =>
              void openStudy(async () =>
                readingLink(await studyBookForSource(source.id), excerpt || cited?.text),
              )
            }
          >
            {t("openStudy")}
          </Button>
          {hasText ? (
            <Button
              variant="outline"
              size="sm"
              disabled={opening}
              onClick={() =>
                void openStudy(async () => {
                  const thread = await startSourceTutor(source.id);
                  return originHref({ kind: "tutor", threadId: thread.id });
                })
              }
            >
              {t("askTutor")}
            </Button>
          ) : null}
        </div>
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {source.kind === "youtube" ? t("openVideo") : t("openPage")}
            <Icon icon={ArrowUpRight01Icon} size={14} className="rtl:-scale-x-100" />
          </a>
        ) : null}
      </Sheet.Header>
      <Sheet.Body>
        {video ? <YouTubePlayer id={video} start={start} title={source.title} /> : null}
        {!hasText && source.originalFileId ? (
          <p className="pb-4 text-sm text-muted-foreground">{t("readOriginalInStudy")}</p>
        ) : null}
        {passage && !cited ? (
          <div role="status" className="mb-4 rounded-xl border p-3 text-sm text-muted-foreground">
            {t("citationChanged")}
            {snippet ? (
              <blockquote dir="auto" className="mt-2 border-s-2 ps-3">
                {snippet}
              </blockquote>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-3 pb-6 text-[0.9375rem] leading-7">
          {chunks?.map((chunk) => {
            const active = chunk.id === cited?.id;
            return (
              <Fragment key={chunk.id}>
                <div
                  ref={active ? highlighted : undefined}
                  data-cited-passage={active || undefined}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl transition-colors",
                    active && "-mx-3 bg-info/10 px-3 py-2 ring-1 ring-info/30",
                  )}
                >
                  {source.kind === "markdown" ? (
                    <Markdown text={chunk.text} bare />
                  ) : video ? (
                    <TranscriptText text={chunk.text} onSeek={setStart} />
                  ) : (
                    <ChunkWithPictures
                      text={chunk.text}
                      images={placed.get(chunk.id) ?? []}
                      title={source.title}
                    />
                  )}
                </div>
                {source.kind === "markdown"
                  ? placed
                      .get(chunk.id)
                      ?.map(({ image }) => (
                        <SourcePicture key={image.blobId} image={image} title={source.title} />
                      ))
                  : null}
              </Fragment>
            );
          })}
        </div>
      </Sheet.Body>
    </>
  );
}

/**
 * A YouTube video, from YouTube's privacy-enhanced address (no cookies until
 * it plays). Pressing a time in the transcript starts it there.
 */
function YouTubePlayer({ id, start, title }: { id: string; start: number | null; title: string }) {
  const params = new URLSearchParams({ rel: "0", modestbranding: "1" });
  if (start !== null) {
    params.set("start", String(start));
    params.set("autoplay", "1");
  }
  return (
    <div className="sticky top-0 z-10 -mx-1 mb-4 bg-background px-1 pb-3">
      <iframe
        key={start ?? "start"}
        src={`https://www.youtube-nocookie.com/embed/${id}?${params}`}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="aspect-video w-full rounded-2xl bg-muted"
      />
    </div>
  );
}

/** A transcript passage: one paragraph per time mark, each mark a button that starts the video there. */
function TranscriptText({ text, onSeek }: { text: string; onSeek: (seconds: number) => void }) {
  const { t } = useTranslation("sources");
  return text
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim())
    .map((paragraph, index) => {
      const match = /^\[((?:\d+:)?\d{1,2}:\d{2})\]\s*/.exec(paragraph);
      const seconds = match ? (parseTimestamp(match[1]) ?? null) : null;
      return (
        <p key={index}>
          {match && seconds !== null ? (
            <button
              type="button"
              onClick={() => onSeek(seconds)}
              aria-label={t("playFrom", { time: match[1] })}
              className="me-2 inline-flex h-6 cursor-pointer items-center rounded-md bg-muted px-1.5 align-[0.1em] font-mono text-xs text-muted-foreground tabular-nums outline-none hover:bg-info hover:text-info-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {match[1]}
            </button>
          ) : null}
          {match ? paragraph.slice(match[0].length) : paragraph}
        </p>
      );
    });
}

/** A passage as paragraphs, with the lines a PDF broke joined again. */
function ChunkText({ text }: { text: string }) {
  const blocks = useMemo(() => reflow(text), [text]);
  return blocks.map((block, index) =>
    block.kind === "item" ? (
      <p
        key={index}
        className="relative ps-5 before:absolute before:start-1.5 before:content-['•']"
      >
        {block.text}
      </p>
    ) : (
      <p key={index} className={cn(block.kind === "heading" && "font-medium text-foreground")}>
        {block.text}
      </p>
    ),
  );
}

interface PlacedImage {
  image: SourceImage;
  /** Where in the passage it goes, in characters. */
  offset: number;
}

/** A passage with its pictures where their pages end, and the text between them reflowed. */
function ChunkWithPictures({
  text,
  images,
  title,
}: {
  text: string;
  images: PlacedImage[];
  title: string;
}) {
  if (images.length === 0) return <ChunkText text={text} />;
  const parts: ReactNode[] = [];
  let from = 0;
  images.forEach(({ image, offset }, index) => {
    const piece = text.slice(from, offset);
    if (piece.trim()) parts.push(<ChunkText key={`text-${index}`} text={piece} />);
    parts.push(<SourcePicture key={image.blobId} image={image} title={title} />);
    from = offset;
  });
  const rest = text.slice(from);
  if (rest.trim()) parts.push(<ChunkText key="text-end" text={rest} />);
  return parts;
}

/** Each picture in the passage its page's text ends in. */
function imagesByChunk(source: Source, chunks: Chunk[]): Map<string, PlacedImage[]> {
  const out = new Map<string, PlacedImage[]>();
  if (!source.images?.length || chunks.length === 0) return out;
  const starts: number[] = [];
  const ends: number[] = [];
  let from = 0;
  for (const chunk of chunks) {
    const at = source.text.indexOf(chunk.text, from);
    const start = at >= 0 ? at : from;
    starts.push(start);
    ends.push(start + chunk.text.length);
    from = start + chunk.text.length;
  }
  for (const image of [...source.images].sort((a, b) => a.at - b.at)) {
    let index = ends.findIndex((end) => image.at <= end);
    if (index < 0) index = chunks.length - 1;
    const id = chunks[index].id;
    const offset = Math.min(Math.max(0, image.at - starts[index]), chunks[index].text.length);
    out.set(id, [...(out.get(id) ?? []), { image, offset }]);
  }
  return out;
}

/** A picture from the PDF, loaded from its stored file; pressing it shows it larger. */
function SourcePicture({ image, title }: { image: SourceImage; title: string }) {
  const { t } = useTranslation("sources");
  const { t: tCommon } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let live = true;
    let made: string | null = null;
    void loadBlob(image.blobId).then((blob) => {
      if (!blob || !live) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [image.blobId]);

  const label = t("picture", { title });
  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        aria-label={label}
        className="block w-full cursor-zoom-in overflow-hidden rounded-xl bg-muted ring-1 ring-border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        style={{ aspectRatio: `${image.width} / ${image.height}` }}
      >
        {url ? <img src={url} alt="" loading="lazy" className="size-full object-contain" /> : null}
      </button>
      <Dialog open={zoomed} onOpenChange={setZoomed}>
        <Dialog.Content size="lg" closeLabel={tCommon("actions.close")}>
          <Dialog.Header title={label} />
          {url ? (
            <img src={url} alt="" className="max-h-[75vh] w-full rounded-xl object-contain" />
          ) : null}
        </Dialog.Content>
      </Dialog>
    </>
  );
}
