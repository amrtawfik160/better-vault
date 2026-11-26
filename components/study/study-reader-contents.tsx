import { Bookmark02Icon, Cancel01Icon, MoreHorizontalIcon, VolumeHighIcon } from "@hugeicons/core-free-icons";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Menu } from "@/components/panelui/menu";
import { Tabs } from "@/components/panelui/tabs";
import { Textarea } from "@/components/panelui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { removeStudyRecord, studyVocabularyCards, updateStudyBook, updateStudyReviewItem } from "@/lib/db/study";
import { originHref } from "@/lib/study/links";
import {
  studyHighlightColor,
  type StudyBook,
  type StudyHighlightColor,
  type StudyRecordOf,
  type StudyWord,
} from "@/lib/study/records";
import { studyReturnState } from "@/lib/study/return-links";
import { locateStudyMark, studyTextRevision } from "@/lib/study/text-edits";
import { speechLanguage } from "@/lib/study/translation-language";
import { speakStudyReply } from "@/lib/study/voice-session";
import { textDirection } from "@/lib/text/direction";
import { cn } from "@/lib/utils";
import { highlightColors } from "./study-highlight-colors";
import { StudyText } from "./study-text";

export type ReaderContentsTab = "outline" | "highlights" | "words";
type Highlight = StudyRecordOf<"highlight">;

function speak(text: string, unavailable: string) {
  void speakStudyReply(text, speechLanguage(text)).then((spoken) => {
    if (!spoken) toast.info(unavailable);
  });
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-[0.8125rem] text-pretty text-muted-foreground">{children}</p>;
}

function HighlightCard({
  item,
  book,
  now,
  openingTutor,
  goTo,
  ask,
  remove,
}: {
  item: Highlight;
  book: StudyBook;
  now: number;
  openingTutor: boolean;
  goTo: () => void;
  ask: () => void;
  remove: () => void;
}) {
  const { t, i18n } = useTranslation(["home", "common"]);
  const [editing, setEditing] = useState<string>();
  const [saving, setSaving] = useState(false);
  const due = item.schedule.dueAt <= now
    ? t("study.reader.panel.dueNow")
    : t("study.reader.panel.nextReview", {
        date: new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" }).format(item.schedule.dueAt),
      });

  async function change(next: { color?: StudyHighlightColor; note?: string }) {
    setSaving(true);
    try {
      const saved = await updateStudyReviewItem({
        kind: "highlight",
        id: item.id,
        change: { note: next.note ?? item.note, cue: item.cue, color: next.color ?? item.color },
        updatedAt: Date.now(),
      });
      if (!saved) toast.error(t("study.recall.editUnavailable"));
      setEditing(undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-2.5 rounded-xl border bg-background p-3 dark:bg-muted/30">
      <blockquote className="flex gap-3">
        <span aria-hidden className={cn("w-1 shrink-0 rounded-full", highlightColors[item.color])} />
        <StudyText text={item.quote} className="line-clamp-6 min-w-0 font-serif text-[0.9375rem] leading-relaxed wrap-break-word" />
      </blockquote>
      {editing !== undefined ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void change({ note: editing.trim() });
          }}
        >
          <Textarea
            autoFocus
            value={editing}
            dir={textDirection(editing)}
            aria-label={t("study.selection.noteLabel")}
            placeholder={t("study.selection.notePlaceholder")}
            minRows={2}
            maxRows={6}
            onChange={(event) => setEditing(event.target.value)}
          />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" disabled={saving}>{t("study.selection.saveNote")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(undefined)}>
              {t("common:actions.cancel")}
            </Button>
          </div>
        </form>
      ) : item.note.trim() ? (
        <DirectionalText multiline text={item.note} className="rounded-lg bg-muted px-2.5 py-2 text-sm wrap-break-word" />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          <span dir="auto">{book.sections[item.section]?.title}</span>
          {" · "}
          {due}
        </p>
        <div className="flex shrink-0 items-center">
          <Button size="sm" variant="ghost" className="px-2" onClick={goTo}>{t("study.reader.panel.goTo")}</Button>
          <Button size="sm" variant="ghost" className="px-2" disabled={openingTutor} onClick={ask}>
            {t("study.selection.ask")}
          </Button>
          <Menu>
            <Menu.Trigger
              render={<Button size="icon-sm" variant="ghost" aria-label={t("study.reader.panel.highlightActions")} />}
            >
              <Icon icon={MoreHorizontalIcon} size={16} />
            </Menu.Trigger>
            <Menu.Content align="end">
              <Menu.Group>
                <Menu.GroupLabel>{t("study.highlights.colorLabel")}</Menu.GroupLabel>
                <Menu.RadioGroup
                  value={item.color}
                  onValueChange={(value) => {
                    const color = studyHighlightColor.safeParse(value);
                    if (color.success && color.data !== item.color) void change({ color: color.data });
                  }}
                >
                  {studyHighlightColor.options.map((name) => (
                    <Menu.RadioItem key={name} value={name} closeOnClick>
                      <span aria-hidden className={cn("size-3 rounded-full", highlightColors[name])} />
                      {t(`study.highlights.colors.${name}`)}
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Group>
              <Menu.Separator />
              <Menu.Item onClick={() => setEditing(item.note)}>
                {t(item.note.trim() ? "study.reader.panel.editNote" : "study.reader.panel.addNote")}
              </Menu.Item>
              <Menu.Item variant="destructive" onClick={remove}>{t("study.reader.panel.deleteHighlight")}</Menu.Item>
            </Menu.Content>
          </Menu>
        </div>
      </div>
    </li>
  );
}

/** A heading over a group of rows in the panel. */
function GroupTitle({ children }: { children: ReactNode }) {
  return <h3 className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">{children}</h3>;
}

const rowClass =
  "flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-[0.8125rem] outline-none hover:bg-foreground/5 focus-visible:ring-[3px] focus-visible:ring-ring/40";

/** The document's sections, the one on screen marked, with its bookmarks under them. */
function Outline({ book, index, go }: { book: StudyBook; index: number; go: (section: number) => void }) {
  const { t } = useTranslation("home");
  const location = useLocation();
  const returnState = studyReturnState(location.state);
  const readerParams = new URLSearchParams(location.search);
  const revision = studyTextRevision(book);
  const places = book.bookmarkPlaces ?? [];
  return (
    <nav aria-label={t("study.readerCompanion.contents.outline")} className="p-2">
      <ol className="space-y-px">
        {book.sections.map((entry, at) => (
          <li key={at}>
            <button
              type="button"
              aria-current={at === index ? "location" : undefined}
              onClick={() => go(at)}
              className={cn(rowClass, at === index && "bg-muted font-medium text-foreground inset-ring inset-ring-border")}
            >
              <span className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums">{at + 1}</span>
              <span className="min-w-0 flex-1 truncate" dir="auto">{entry.title}</span>
              {book.bookmarks.includes(at) ? (
                <>
                  <Icon icon={Bookmark02Icon} size={14} className="shrink-0 text-muted-foreground" />
                  <span className="sr-only">{t("study.readerCompanion.contents.bookmarked")}</span>
                </>
              ) : null}
            </button>
          </li>
        ))}
      </ol>
      {places.length ? (
        <section>
          <GroupTitle>{t("study.reader.bookmarkedPassages")}</GroupTitle>
          <ul className="space-y-px">
            {places.map((place) => {
              const at = locateStudyMark(book, place);
              return (
                <li key={place.id} className="flex items-center gap-1">
                  <Link
                    to={originHref({
                      kind: "book",
                      bookId: book.id,
                      section: place.section,
                      offset: at < 0 ? place.offset : at,
                      length: place.quote.length,
                      revision: at < 0 ? place.revision : revision,
                    }, readerParams)}
                    state={returnState}
                    className={cn(rowClass, "min-w-0 flex-1")}
                  >
                    <span className="min-w-0 truncate font-serif" dir="auto">{place.quote}</span>
                  </Link>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    aria-label={t("study.reader.removeBookmark")}
                    title={t("study.reader.removeBookmark")}
                    onClick={() =>
                      void updateStudyBook(book.id, { bookmarkPlaces: places.filter(({ id }) => id !== place.id) })
                    }
                  >
                    <Icon icon={Cancel01Icon} size={14} />
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </nav>
  );
}

/**
 * The reader's Contents, at the inline start: the outline with the section on
 * screen marked, this document's highlights and the words saved from it.
 * It lies over the text and closes with Escape or its close button.
 */
export function StudyReaderContents({
  id,
  tab,
  chooseTab,
  close,
  full,
  book,
  vaultId,
  index,
  highlights,
  words,
  openingTutor,
  go,
  goToHighlight,
  askHighlight,
  reviewHighlights,
  reviewWords,
  panelRef,
}: {
  id: string;
  tab: ReaderContentsTab;
  chooseTab: (tab: ReaderContentsTab) => void;
  close: () => void;
  /** Covers the whole reader, on phones. */
  full: boolean;
  book: StudyBook;
  vaultId: string;
  index: number;
  highlights: Highlight[];
  words: StudyWord[];
  openingTutor: boolean;
  go: (section: number) => void;
  goToHighlight: (item: Highlight) => void;
  askHighlight: (item: Highlight) => void;
  reviewHighlights: () => void;
  reviewWords: (cardIds: string[]) => void;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation("home");
  const [deleting, setDeleting] = useState<Highlight>();
  const [openingWords, setOpeningWords] = useState(false);
  const opening = useRef(false);
  const [now] = useState(Date.now);
  const sorted = [...highlights].sort((a, b) => a.section - b.section || a.offset - b.offset);

  async function practiseWords() {
    if (opening.current) return;
    opening.current = true;
    setOpeningWords(true);
    try {
      const cards = await studyVocabularyCards(words.map(({ id }) => id), vaultId);
      if (cards.length) reviewWords(cards);
      else toast.info(t("study.vocabulary.noCards"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      opening.current = false;
      setOpeningWords(false);
    }
  }

  return (
    <aside
      id={id}
      ref={panelRef}
      tabIndex={-1}
      data-reader-panel=""
      aria-label={t("study.readerCompanion.contents.label")}
      className={cn(
        "absolute inset-y-0 start-0 z-30 flex min-h-0 flex-col bg-card outline-none",
        full ? "inset-x-0" : "w-[min(20rem,100%)] border-e shadow-2xl",
        "animate-in fade-in-0 slide-in-from-start-2 duration-200 motion-reduce:animate-none",
      )}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === "outline" || value === "highlights" || value === "words") chooseTab(value);
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex h-13 shrink-0 items-center gap-2 border-b px-3">
          {/* Three tabs fit the 20rem panel: tighter padding, and a count only when there is something. */}
          <Tabs.List aria-label={t("study.readerCompanion.contents.label")} className="min-w-0 flex-1">
            <Tabs.Trigger value="outline" className="px-2.5">
              {t("study.readerCompanion.contents.outline")}
            </Tabs.Trigger>
            <Tabs.Trigger value="highlights" className="gap-1.5 px-2.5">
              {t("study.reader.panel.highlights")}
              {highlights.length ? <Tabs.Badge>{highlights.length}</Tabs.Badge> : null}
            </Tabs.Trigger>
            <Tabs.Trigger value="words" className="gap-1.5 px-2.5">
              {t("study.reader.panel.words")}
              {words.length ? <Tabs.Badge>{words.length}</Tabs.Badge> : null}
            </Tabs.Trigger>
          </Tabs.List>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("study.readerCompanion.contents.close")}
            title={t("study.readerCompanion.contents.close")}
            onClick={close}
          >
            <Icon icon={Cancel01Icon} size={16} />
          </Button>
        </div>

        <Tabs.Content value="outline" className="flex min-h-0 flex-col focus-visible:ring-offset-0">
          <p className="shrink-0 px-4 pt-3 text-xs text-muted-foreground">
            {t(book.format === "pdf" ? "study.reader.pageOf" : "study.reader.sectionOf", {
              current: index + 1,
              count: book.sections.length,
            })}
          </p>
          <ScrollArea className="min-h-0 flex-1">
            <Outline book={book} index={index} go={go} />
          </ScrollArea>
        </Tabs.Content>

        <Tabs.Content value="highlights" className="flex min-h-0 flex-col focus-visible:ring-offset-0">
          <p className="shrink-0 px-4 pt-3 text-xs text-muted-foreground">{t("study.readerCompanion.contents.inThisDocument")}</p>
          <ScrollArea className="min-h-0 flex-1">
            {sorted.length ? (
              <ul className="space-y-2.5 p-3">
                {sorted.map((item) => (
                  <HighlightCard
                    key={item.id}
                    item={item}
                    book={book}
                    now={now}
                    openingTutor={openingTutor}
                    goTo={() => goToHighlight(item)}
                    ask={() => askHighlight(item)}
                    remove={() => setDeleting(item)}
                  />
                ))}
              </ul>
            ) : (
              <Empty>{t("study.reader.panel.noHighlights")}</Empty>
            )}
          </ScrollArea>
          {sorted.length ? (
            <div className="shrink-0 border-t p-3">
              <Button variant="secondary" className="w-full border border-input" onClick={reviewHighlights}>
                {t("study.reader.panel.reviewHighlights")}
              </Button>
            </div>
          ) : null}
        </Tabs.Content>

        <Tabs.Content value="words" className="flex min-h-0 flex-col focus-visible:ring-offset-0">
          <p className="shrink-0 px-4 pt-3 text-xs text-muted-foreground">{t("study.readerCompanion.contents.savedFromHere")}</p>
          <ScrollArea className="min-h-0 flex-1">
            {words.length ? (
              <ul className="space-y-2.5 p-3">
                {words.map((word) => (
                  <li key={word.id} className="space-y-1.5 rounded-xl border bg-background p-3 dark:bg-muted/30">
                    <div className="flex items-start justify-between gap-2">
                      <DirectionalText text={word.term} className="min-w-0 font-serif text-lg font-medium wrap-break-word" />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("study.reader.panel.listenTo", { term: word.term })}
                        onClick={() => speak(word.term, t("study.selection.noVoice"))}
                      >
                        <Icon icon={VolumeHighIcon} size={16} />
                      </Button>
                    </div>
                    {word.translation ? (
                      <DirectionalText multiline text={word.translation} className="text-base wrap-break-word" />
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("study.reader.panel.noTranslation")}</p>
                    )}
                    {word.context ? (
                      <DirectionalText
                        text={word.context}
                        className="line-clamp-3 font-serif text-sm text-muted-foreground italic wrap-break-word"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{t("study.reader.panel.noWords")}</Empty>
            )}
          </ScrollArea>
          {words.length ? (
            <div className="shrink-0 border-t p-3">
              <Button
                variant="secondary"
                className="w-full border border-input"
                disabled={openingWords}
                onClick={() => void practiseWords()}
              >
                {t("study.reader.panel.practiseWords")}
              </Button>
            </div>
          ) : null}
        </Tabs.Content>
      </Tabs>
      <ConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title={t("study.reader.panel.deleteTitle")}
        body={t("study.reader.panel.deleteBody")}
        confirmLabel={t("study.reader.panel.deleteHighlight")}
        onConfirm={async () => {
          if (deleting) await removeStudyRecord(deleting.id);
          setDeleting(undefined);
        }}
      />
    </aside>
  );
}
