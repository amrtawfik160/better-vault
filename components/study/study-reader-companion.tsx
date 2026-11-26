import { ArrowLeft01Icon, Cancel01Icon, Chatting01Icon } from "@hugeicons/core-free-icons";
import { useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Icon } from "@/components/icon";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Tabs } from "@/components/panelui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { notebookChatHref } from "@/lib/study/links";
import {
  readerColumnQuery,
  readerCompanionLayout,
  readerOverlayQuery,
  type ReaderCompanionLayout,
  type ReaderPart,
} from "@/lib/study/reader-companion";
import type { StudyBook, StudyThread } from "@/lib/study/records";
import { cn } from "@/lib/utils";
import { ReaderChat, type ReaderChatSeed, type ReaderQuote } from "./reader-chat";
import { StudyReaderMake } from "./study-reader-make";
import { StudyReaderPractise, usePartName } from "./study-reader-practise";

export type ReaderCompanionTab = "ask" | "practise" | "make";

export type ReaderTutor = {
  thread: StudyThread;
  /** The conversation is showing in the Ask tab, as the address says. */
  visible: boolean;
  content: ReactNode;
  show: () => void;
  hide: () => void;
  openFull: () => void;
};

/** This document's conversations, listed in Ask's History to reopen. */
export type ReaderConversations = {
  threads: StudyThread[];
  open: (thread: StudyThread) => void;
  /** Closes the open conversation and lists them all. */
  leave: () => void;
};

function subscribe(change: () => void) {
  const queries = [window.matchMedia(readerColumnQuery), window.matchMedia(readerOverlayQuery)];
  for (const query of queries) query.addEventListener("change", change);
  return () => {
    for (const query of queries) query.removeEventListener("change", change);
  };
}

/** Three columns from 1280px; the companion lies over the text from 768px, and covers the screen on phones. */
export function useReaderCompanionLayout(): ReaderCompanionLayout {
  return useSyncExternalStore(
    subscribe,
    () => readerCompanionLayout(window.matchMedia(readerColumnQuery).matches, window.matchMedia(readerOverlayQuery).matches),
    () => "column",
  );
}

/**
 * The companion beside the reader: Ask (the chat about this document, or a
 * tutor session opened beside it), Practise (an exercise on what is open) and
 * Make (cards, Studio tools, this notebook's outputs and cards).
 */
export function StudyReaderCompanion({
  id,
  tab,
  chooseTab,
  close,
  layout,
  book,
  vaultId,
  index,
  part,
  notebookTitle,
  tutor,
  conversations,
  canDiscussPage,
  chatQuote,
  clearChatQuote,
  chatSeed,
  openSection,
  makeCards,
  setupModel,
  panelRef,
  tutorPane,
}: {
  id: string;
  tab: ReaderCompanionTab;
  chooseTab: (tab: ReaderCompanionTab) => void;
  close: () => void;
  layout: ReaderCompanionLayout;
  book: StudyBook;
  vaultId: string;
  /** The section on screen, from 0. */
  index: number;
  part: ReaderPart;
  notebookTitle?: string;
  tutor?: ReaderTutor;
  conversations: ReaderConversations;
  /** Whether the part on screen has text, to make cards from. */
  canDiscussPage: boolean;
  chatQuote?: ReaderQuote;
  clearChatQuote: () => void;
  chatSeed?: ReaderChatSeed;
  /** Opens a section, from 1. */
  openSection: (section: number) => void;
  makeCards: () => void;
  setupModel?: () => void;
  panelRef: RefObject<HTMLElement | null>;
  tutorPane: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation("home");
  const name = usePartName(part);
  const label = t("study.readerCompanion.label");

  return (
    <aside
      id={id}
      ref={panelRef}
      tabIndex={-1}
      data-reader-panel=""
      aria-label={label}
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-card outline-none",
        layout === "column" && "w-[26rem] shrink-0 border-s",
        layout === "overlay" && "absolute inset-y-0 end-0 z-30 w-[min(26rem,100%)] border-s shadow-2xl",
        layout === "sheet" && "fixed inset-0 z-40",
        layout === "sheet"
          ? "animate-in fade-in-0 slide-in-from-bottom-4 duration-200 motion-reduce:animate-none"
          : "animate-in fade-in-0 slide-in-from-end-2 duration-200 motion-reduce:animate-none",
      )}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === "ask" || value === "practise" || value === "make") chooseTab(value);
        }}
        className="min-h-0 flex-1 gap-0"
      >
        {/* On a phone the tabs and Close are 44px targets. */}
        <div className={cn("flex h-13 shrink-0 items-center gap-2 border-b px-3", layout === "sheet" && "h-15")}>
          <Tabs.List aria-label={label} className="min-w-0 flex-1">
            <Tabs.Trigger value="ask" className={cn("flex-1", layout === "sheet" && "h-11")}>
              {t("study.readerCompanion.tabs.ask")}
            </Tabs.Trigger>
            <Tabs.Trigger value="practise" className={cn("flex-1", layout === "sheet" && "h-11")}>
              {t("study.readerCompanion.tabs.practise")}
            </Tabs.Trigger>
            <Tabs.Trigger value="make" className={cn("flex-1", layout === "sheet" && "h-11")}>
              {t("study.readerCompanion.tabs.make")}
            </Tabs.Trigger>
          </Tabs.List>
          <Button
            size="icon-sm"
            variant="ghost"
            className={layout === "sheet" ? "size-11" : undefined}
            aria-label={t("study.readerCompanion.close")}
            title={t("study.readerCompanion.close")}
            onClick={close}
          >
            <Icon icon={Cancel01Icon} size={16} />
          </Button>
        </div>

        {/* Ask stays in the page while another tab is open, so its draft and its conversation survive. */}
        <Tabs.Content value="ask" keepMounted className="flex min-h-0 flex-col focus-visible:ring-offset-0">
          {tutor ? (
            <>
              <div className="flex shrink-0 items-center gap-1 border-b px-2 py-2">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("study.reader.panel.allConversations")}
                  title={t("study.reader.panel.allConversations")}
                  onClick={conversations.leave}
                >
                  <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
                </Button>
                <p className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">{tutor.thread.title}</p>
                <Link
                  to={notebookChatHref(book.notebookId)}
                  aria-label={t("study.reader.panel.openInNotebook")}
                  title={t("study.reader.panel.openInNotebook")}
                  className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
                >
                  <Icon icon={Chatting01Icon} size={16} />
                </Link>
                <Button size="sm" variant="outline" onClick={tutor.openFull}>{t("study.reader.fullTutor")}</Button>
              </div>
              <section ref={tutorPane} tabIndex={-1} aria-label={t("study.reader.tutorPane")} className="flex min-h-0 flex-1 flex-col outline-none">
                <ScrollArea className="min-h-0 flex-1">
                  <div className="p-3 sm:p-4">{tutor.content}</div>
                </ScrollArea>
              </section>
            </>
          ) : (
            <ReaderChat
              book={book}
              vaultId={vaultId}
              index={index}
              partTitle={name.title}
              partInline={name.inline}
              quote={chatQuote}
              clearQuote={clearChatQuote}
              seed={chatSeed}
              openSection={openSection}
              tutorThreads={conversations.threads}
              openTutorThread={conversations.open}
              setupModel={setupModel}
            />
          )}
        </Tabs.Content>

        <Tabs.Content value="practise" className="flex min-h-0 flex-col focus-visible:ring-offset-0">
          <StudyReaderPractise book={book} index={index} part={part} vaultId={vaultId} setupModel={setupModel} />
        </Tabs.Content>

        <Tabs.Content value="make" className="flex min-h-0 flex-col focus-visible:ring-offset-0">
          <StudyReaderMake
            book={book}
            partInline={name.inline}
            notebookTitle={notebookTitle}
            canMakeCards={canDiscussPage}
            makeCards={makeCards}
            setupModel={setupModel}
          />
        </Tabs.Content>
      </Tabs>
    </aside>
  );
}
