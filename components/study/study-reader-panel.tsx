import { Cancel01Icon, MoreHorizontalIcon, VolumeHighIcon } from "@hugeicons/core-free-icons";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Menu } from "@/components/panelui/menu";
import { Tabs } from "@/components/panelui/tabs";
import { Textarea } from "@/components/panelui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { removeStudyRecord, studyVocabularyCards, updateStudyReviewItem } from "@/lib/db/study";
import {
  studyHighlightColor,
  type StudyBook,
  type StudyHighlightColor,
  type StudyRecordOf,
  type StudyThread,
  type StudyWord,
} from "@/lib/study/records";
import { speechLanguage } from "@/lib/study/translation-language";
import { speakStudyReply } from "@/lib/study/voice-session";
import { textDirection } from "@/lib/text/direction";
import { cn } from "@/lib/utils";
import { highlightColors } from "./study-highlight-colors";
import { StudyText } from "./study-text";

export type ReaderPanelTab = "highlights" | "words" | "ai";
type Highlight = StudyRecordOf<"highlight">;

export type ReaderTutor = {
  thread: StudyThread;
  /** The Tutor pane is showing, as the address says. */
  visible: boolean;
  content: ReactNode;
  show: () => void;
  hide: () => void;
  openFull: () => void;
};

function speak(text: string, unavailable: string) {
  void speakStudyReply(text, speechLanguage(text)).then((spoken) => {
    if (!spoken) toast.info(unavailable);
  });
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center gap-3 px-4 py-12 text-center text-sm text-muted-foreground">{children}</div>;
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
    <li className="space-y-2.5 rounded-2xl border bg-background p-3.5 dark:bg-muted/30">
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

/** The reader's side panel: this book's highlights, its words, and the Tutor beside the page. */
export function StudyReaderPanel({
  tab,
  chooseTab,
  close,
  wide,
  book,
  vaultId,
  highlights,
  words,
  tutor,
  openingTutor,
  canDiscussPage,
  canDiscussBook,
  goToHighlight,
  askHighlight,
  discuss,
  reviewHighlights,
  reviewWords,
  panelRef,
  tutorPane,
}: {
  tab: ReaderPanelTab;
  chooseTab: (tab: ReaderPanelTab) => void;
  close: () => void;
  wide: boolean;
  book: StudyBook;
  vaultId: string;
  highlights: Highlight[];
  words: StudyWord[];
  tutor?: ReaderTutor;
  openingTutor: boolean;
  canDiscussPage: boolean;
  canDiscussBook: boolean;
  goToHighlight: (item: Highlight) => void;
  askHighlight: (item: Highlight) => void;
  discuss: (what: "chapter" | "book" | "teach-back") => void;
  reviewHighlights: () => void;
  reviewWords: (cardIds: string[]) => void;
  panelRef: RefObject<HTMLElement | null>;
  tutorPane: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation("home");
  const [deleting, setDeleting] = useState<Highlight>();
  const [openingWords, setOpeningWords] = useState(false);
  const opening = useRef(false);
  const [now] = useState(Date.now);
  const sorted = [...highlights].sort((a, b) => a.section - b.section || a.offset - b.offset);
  const pageNoun = book.format === "pdf" ? "page" : "chapter";

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
      ref={panelRef}
      tabIndex={-1}
      aria-label={t("study.reader.panel.label")}
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-card outline-none",
        wide ? "w-[25rem] shrink-0 border-s xl:w-[28rem]" : "absolute inset-0 z-20",
        "animate-in fade-in-0 slide-in-from-end-2 duration-200 motion-reduce:animate-none",
      )}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === "highlights" || value === "words" || value === "ai") chooseTab(value);
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <Tabs.List aria-label={t("study.reader.panel.label")}>
            <Tabs.Trigger value="highlights">
              {t("study.reader.panel.highlights")}
              <Tabs.Badge>{highlights.length}</Tabs.Badge>
            </Tabs.Trigger>
            <Tabs.Trigger value="words">
              {t("study.reader.panel.words")}
              <Tabs.Badge>{words.length}</Tabs.Badge>
            </Tabs.Trigger>
            <Tabs.Trigger value="ai">{t("study.selection.ask")}</Tabs.Trigger>
          </Tabs.List>
          <span className="flex-1" />
          <Button size="icon-sm" variant="ghost" aria-label={t("study.reader.panel.close")} title={t("study.reader.panel.close")} onClick={close}>
            <Icon icon={Cancel01Icon} size={16} />
          </Button>
        </div>

        <Tabs.Content value="highlights" className="flex min-h-0 flex-col focus-visible:ring-offset-0">
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
              <Button className="w-full" onClick={reviewHighlights}>{t("study.reader.panel.reviewHighlights")}</Button>
            </div>
          ) : null}
        </Tabs.Content>

        <Tabs.Content value="words" className="flex min-h-0 flex-col focus-visible:ring-offset-0">
          <ScrollArea className="min-h-0 flex-1">
            {words.length ? (
              <ul className="space-y-2.5 p-3">
                {words.map((word) => (
                  <li key={word.id} className="space-y-1.5 rounded-2xl border bg-background p-3.5 dark:bg-muted/30">
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
              <Button className="w-full" disabled={openingWords} onClick={() => void practiseWords()}>
                {t("study.reader.panel.practiseWords")}
              </Button>
            </div>
          ) : null}
        </Tabs.Content>

        <Tabs.Content value="ai" keepMounted className="flex min-h-0 flex-col focus-visible:ring-offset-0">
          {tutor ? (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                <p className="min-w-0 truncate text-sm font-medium" dir="auto">{tutor.thread.title}</p>
                <Button size="sm" variant="outline" onClick={tutor.openFull}>{t("study.reader.fullTutor")}</Button>
              </div>
              <section ref={tutorPane} tabIndex={-1} aria-label={t("study.reader.tutorPane")} className="flex min-h-0 flex-1 flex-col outline-none">
                <ScrollArea className="min-h-0 flex-1">
                  <div className="p-3 sm:p-4">{tutor.content}</div>
                </ScrollArea>
              </section>
            </>
          ) : (
            <Empty>
              <p>{t("study.reader.panel.askHint")}</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                <Button size="sm" variant="outline" disabled={openingTutor || !canDiscussPage} onClick={() => discuss("chapter")}>
                  {t(`study.reader.discuss.${pageNoun}`)}
                </Button>
                <Button size="sm" variant="outline" disabled={openingTutor || !canDiscussBook} onClick={() => discuss("book")}>
                  {t("study.reader.discuss.book")}
                </Button>
                <Button size="sm" variant="outline" disabled={openingTutor || !canDiscussPage} onClick={() => discuss("teach-back")}>
                  {t("study.reader.teachBack")}
                </Button>
              </div>
            </Empty>
          )}
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
