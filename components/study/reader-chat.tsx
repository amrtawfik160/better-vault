import {
  BubbleChatAddIcon,
  Chatting01Icon,
  Clock01Icon,
  Idea01Icon,
  QuoteDownIcon,
  TeachingIcon,
} from "@hugeicons/core-free-icons";
import { Chat, useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  generateId,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { AIModelPicker } from "@/components/ai/ai-model-picker";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { PromptQuote, QuoteChip } from "@/components/chat/quote";
import { SelectableText } from "@/components/selection/selectable-text";
import type { ChatQuote } from "@/lib/chat/quote";
import type { BookLinks } from "@/components/chat/book-activity";
import { UsageRing } from "@/components/chat/usage-ring";
import { Icon } from "@/components/icon";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Menu } from "@/components/panelui/menu";
import { Message } from "@/components/panelui/message";
import { Prompt, type PromptState } from "@/components/panelui/prompt";
import { ScrollArea } from "@/components/ui/scroll-area";
import { notebookAnswerEvidence } from "@/lib/chat/study";
import type { ChatMessage } from "@/lib/chat/types";
import { loadNotebookChat, saveChat, useConversations } from "@/lib/db/messages";
import { credentialsFor, getSettings, modelFor, useSettings } from "@/lib/db/settings";
import { notebookAnswerHref, studyHref } from "@/lib/study/links";
import { goalLabel } from "@/lib/study/practice";
import {
  isReaderTool,
  readerContext,
  runReaderTool,
  type ReaderToolName,
} from "@/lib/study/reader-chat";
import type { StudyBook, StudyThread } from "@/lib/study/records";
import { getStudioSettings } from "@/lib/studio/settings";
import { cn } from "@/lib/utils";
import { StudyFlashcardDraftDialog, type FlashcardSource } from "./study-flashcard-generator";

/** How many earlier messages go with each question. */
const HISTORY = 24;
const SUGGESTIONS = ["summary", "explain", "quiz", "connect"] as const;
const rememberKey = (bookId: string) => `deeple:reader-chat:${bookId}`;

/** A passage of the book, to ask about. */
export type ReaderQuote = { text: string; section: number };

/** An explanation given in the selection menu, carried on in a new conversation. */
export type ReaderChatSeed = { id: string; quote: ReaderQuote; explanation: string };

type Reading = { book: StudyBook; index: number };

/**
 * The tool results the model has already seen are dropped from older turns, so
 * a long conversation doesn't resend whole chapters. It can read them again.
 */
function trimmed(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages.slice(-HISTORY);
  const question = recent.findLastIndex((message) => message.role === "user");
  return recent.map((message, at) =>
    at >= question
      ? message
      : {
          ...message,
          parts: message.parts.map((part) =>
            isToolUIPart(part) && isReaderTool(getToolName(part)) && part.state === "output-available"
              ? { ...part, output: { note: "Read earlier. Read it again if you need it." } }
              : part,
          ),
        },
  );
}

/** One conversation, saved in the book's notebook so its History lists it too. */
function readerChat(id: string, messages: ChatMessage[], reading: { current: Reading }) {
  const notebookId = reading.current.book.notebookId;
  const transport = new DefaultChatTransport<ChatMessage>({
    api: "/api/study/reader-chat",
    // Read at every request, the automatic ones after a tool too: the model, and the page on screen now.
    prepareSendMessagesRequest: async ({ messages: all }) => {
      const settings = await getSettings();
      const choice = modelFor(settings, "ask");
      if (!choice) throw new Error("Connect or choose an AI model in Settings to continue.");
      const { book, index } = reading.current;
      return {
        body: {
          messages: trimmed(all),
          model: choice.model,
          effort: choice.effort,
          credentials: credentialsFor(settings, choice.model.provider),
          reader: readerContext(book, index),
          visuals: (await getStudioSettings()).visuals,
        },
      };
    },
  });
  const chat: Chat<ChatMessage> = new Chat<ChatMessage>({
    id,
    messages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: ({ toolCall }) => {
      if (toolCall.dynamic || !isReaderTool(toolCall.toolName)) return;
      const output = runReaderTool(
        toolCall.toolName as ReaderToolName,
        toolCall.input,
        reading.current.book.sections,
      );
      void chat.addToolOutput({
        tool: toolCall.toolName as never,
        toolCallId: toolCall.toolCallId,
        output: output as never,
      });
    },
    onFinish: ({ messages: finished }) => void saveChat({ id, notebookId }, finished),
  });
  return chat;
}

/** A question's metadata: when it was asked, and the passage it was asked about. */
function questionMetadata(quote: ChatQuote | undefined) {
  return { createdAt: Date.now(), quote };
}

/** The first two messages of a conversation that carries on an explanation. */
function seededMessages(seed: ReaderChatSeed, question: string): ChatMessage[] {
  const now = Date.now();
  return [
    {
      id: generateId(),
      role: "user",
      parts: [{ type: "text", text: question }],
      metadata: { createdAt: now, quote: seed.quote },
    },
    {
      id: generateId(),
      role: "assistant",
      parts: [{ type: "text", text: seed.explanation }],
      metadata: { createdAt: now },
    },
  ];
}

function textOf(message: ChatMessage) {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

/**
 * Ask AI beside the reader, built like the notebook's chat: it knows the
 * section on screen, reads and searches the rest of the book when a question
 * needs it, and keeps its conversations in the notebook's History.
 */
export function ReaderChat({
  book,
  vaultId,
  index,
  quote,
  clearQuote,
  seed,
  openSection,
  teachBack,
  canTeachBack,
  openingTutor,
  tutorThreads,
  openTutorThread,
}: {
  book: StudyBook;
  vaultId: string;
  /** The section on screen, from 0. */
  index: number;
  /** A passage to ask about with the next question. */
  quote?: ReaderQuote;
  clearQuote: () => void;
  seed?: ReaderChatSeed;
  /** Opens a section in the reader, from 1. */
  openSection: (section: number) => void;
  teachBack: () => void;
  canTeachBack: boolean;
  openingTutor: boolean;
  /** This book's Study tutor sessions (Teach it back, pictures), opened in the panel. */
  tutorThreads: StudyThread[];
  openTutorThread: (thread: StudyThread) => void;
}) {
  const { t: tHome } = useTranslation("home");
  const reading = useRef<Reading>({ book, index });
  useLayoutEffect(() => {
    reading.current = { book, index };
  }, [book, index]);
  const [chat, setChat] = useState<Chat<ChatMessage> | null>(null);
  const seeded = useRef<string | undefined>(undefined);

  const start = (id = generateId(), messages: ChatMessage[] = []) => {
    void chat?.stop();
    try {
      localStorage.setItem(rememberKey(book.id), id);
    } catch {
      // The conversation still works; it just won't reopen next time.
    }
    setChat(readerChat(id, messages, reading));
  };

  // Reopens the conversation this book had last.
  useEffect(() => {
    let alive = true;
    void (async () => {
      let id: string | null = null;
      try {
        id = localStorage.getItem(rememberKey(book.id));
      } catch {
        id = null;
      }
      const messages = id ? await loadNotebookChat(book.notebookId, id).catch(() => undefined) : undefined;
      if (alive) setChat(readerChat(id && messages ? id : generateId(), messages ?? [], reading));
    })();
    return () => {
      alive = false;
    };
  }, [book.id, book.notebookId]);

  // An explanation from the selection menu starts a conversation of its own, once saved.
  useEffect(() => {
    if (!seed || seeded.current === seed.id) return;
    seeded.current = seed.id;
    const id = generateId();
    const messages = seededMessages(seed, tHome("study.reader.explainPassage"));
    void saveChat({ id, notebookId: book.notebookId }, messages).then(() => start(id, messages));
    // `start` is recreated each render; the seed's id decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, book.notebookId, tHome]);

  if (!chat) return <div className="flex-1" aria-busy="true" />;
  return (
    <ReaderConversation
      key={chat.id}
      chat={chat}
      book={book}
      vaultId={vaultId}
      index={index}
      quote={quote}
      clearQuote={clearQuote}
      start={start}
      openSection={openSection}
      teachBack={teachBack}
      canTeachBack={canTeachBack}
      openingTutor={openingTutor}
      tutorThreads={tutorThreads}
      openTutorThread={openTutorThread}
    />
  );
}

function ReaderConversation({
  chat: instance,
  book,
  vaultId,
  index,
  quote: fromReader,
  clearQuote: clearReaderQuote,
  start,
  openSection,
  teachBack,
  canTeachBack,
  openingTutor,
  tutorThreads,
  openTutorThread,
}: {
  chat: Chat<ChatMessage>;
  book: StudyBook;
  vaultId: string;
  index: number;
  quote?: ReaderQuote;
  clearQuote: () => void;
  start: (id?: string, messages?: ChatMessage[]) => void;
  openSection: (section: number) => void;
  teachBack: () => void;
  canTeachBack: boolean;
  openingTutor: boolean;
  tutorThreads: StudyThread[];
  openTutorThread: (thread: StudyThread) => void;
}) {
  const { t } = useTranslation("chat");
  const { t: tHome } = useTranslation("home");
  const navigate = useNavigate();
  const settings = useSettings();
  const conversations = useConversations(book.notebookId);
  const chat = useChat<ChatMessage>({ chat: instance });
  const [draft, setDraft] = useState("");
  const [cards, setCards] = useState<FlashcardSource | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLDivElement>(null);

  const model = settings ? (modelFor(settings, "ask")?.model ?? null) : null;
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const status: PromptState = chat.status === "ready" ? "idle" : chat.status;
  const context = readerContext(book, index);
  const noun = t(`book.nouns.${context.noun}`);
  const links = useMemo<BookLinks>(() => ({ noun: context.noun, open: openSection }), [context.noun, openSection]);
  const title = conversations?.find(({ id }) => id === instance.id)?.title;
  const lastAnswer = chat.messages.findLast((message) => message.role === "assistant");

  // A passage selected in an answer here; one the reader sends later comes first.
  const [fromAnswer, setFromAnswer] = useState<ChatQuote>();
  const quote: ChatQuote | undefined = fromReader ?? fromAnswer;
  const clearQuote = () => {
    setFromAnswer(undefined);
    clearReaderQuote();
  };

  // A passage sent from the reader, or chosen in an answer, is asked about next.
  useEffect(() => {
    if (quote) textarea.current?.querySelector("textarea")?.focus();
  }, [quote]);

  // Follows the answer as it is written, unless the reader has scrolled up.
  useEffect(() => {
    const element = scroller.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 240)
      element.scrollTo({ top: element.scrollHeight });
  }, [chat.messages]);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const metadata = questionMetadata(quote);
    clearQuote();
    chat.sendMessage({ text: question, metadata }).catch((error: unknown) => {
      toast.error(t("error", { error: error instanceof Error ? error.message : String(error) }));
    });
  };
  const retry = () => void chat.regenerate().catch(() => undefined);

  const notebookHref = notebookAnswerHref(book.notebookId, instance.id, lastAnswer?.id);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <Menu>
          <Menu.Trigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("reader.history")}
                title={t("reader.history")}
              />
            }
          >
            <Icon icon={Clock01Icon} size={16} />
          </Menu.Trigger>
          <Menu.Content align="start" className="max-h-96 w-72">
            <Menu.Group>
              <Menu.GroupLabel>{t("reader.notebookConversations")}</Menu.GroupLabel>
              {conversations?.length ? (
                conversations.slice(0, 30).map((conversation) => (
                  <Menu.Item
                    key={conversation.id}
                    onClick={() =>
                      void loadNotebookChat(book.notebookId, conversation.id).then(
                        (messages) => messages && start(conversation.id, messages),
                      )
                    }
                    className={cn(conversation.id === instance.id && "font-medium")}
                  >
                    <span className="truncate" dir="auto">{conversation.title}</span>
                  </Menu.Item>
                ))
              ) : (
                <Menu.Item disabled>{t("reader.noConversations")}</Menu.Item>
              )}
            </Menu.Group>
            {tutorThreads.length ? (
              <>
                <Menu.Separator />
                <Menu.Group>
                  <Menu.GroupLabel>{t("reader.tutorSessions")}</Menu.GroupLabel>
                  {tutorThreads.slice(0, 20).map((thread) => (
                    <Menu.Item key={thread.id} onClick={() => openTutorThread(thread)}>
                      <span className="truncate" dir="auto">
                        {[goalLabel(thread, tHome(`study.goals.labels.${thread.goal}`)), thread.title]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Menu.Item>
                  ))}
                </Menu.Group>
              </>
            ) : null}
          </Menu.Content>
        </Menu>
        <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium" dir="auto">
          {chat.messages.length ? (title ?? textOf(chat.messages[0])) : t("newChat")}
        </p>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("newChat")}
          title={t("newChat")}
          disabled={chat.messages.length === 0}
          onClick={() => start()}
        >
          <Icon icon={BubbleChatAddIcon} size={16} />
        </Button>
        <Link
          to={notebookHref}
          aria-label={tHome("study.reader.panel.openInNotebook")}
          title={tHome("study.reader.panel.openInNotebook")}
          className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
        >
          <Icon icon={Chatting01Icon} size={16} />
        </Link>
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportRef={scroller}>
        {chat.messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-6 px-4 pt-6 pb-60 text-center">
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{t("reader.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("reader.body", { noun, section: context.section })}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={busy || !model}
                  onClick={() => send(t(`reader.suggestions.${key}`, { noun }))}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <Icon icon={Idea01Icon} size={15} className="text-chart-4" />
                  {t(`reader.suggestions.${key}`, { noun })}
                </button>
              ))}
              <button
                type="button"
                disabled={openingTutor || !canTeachBack}
                onClick={teachBack}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Icon icon={TeachingIcon} size={15} className="text-chart-2" />
                {tHome("study.reader.teachBack")}
              </button>
            </div>
          </div>
        ) : (
          <SelectableText
            className="flex flex-col gap-6 px-3 pt-4 pb-60"
            place={{
              title: book.title,
              notebookId: book.notebookId,
              bookId: book.id,
              vaultId,
              tags: [book.title],
              origin: (block) => {
                const messageId = block.dataset.notebookAnswer;
                return messageId
                  ? { kind: "notebook-answer", notebookId: book.notebookId, conversationId: instance.id, messageId }
                  : undefined;
              },
              onAsk: (text) => {
                clearReaderQuote();
                setFromAnswer({ text });
              },
            }}
          >
            {chat.messages.map((message, at) =>
              message.role === "user" ? (
                <Message key={message.id} from="user">
                  <Message.Content>
                    {message.metadata?.quote ? (
                      <QuoteChip
                        quote={message.metadata.quote}
                        place={message.metadata.quote.section === undefined ? undefined : `${noun} ${message.metadata.quote.section}`}
                        open={openSection}
                      />
                    ) : null}
                    <Message.Bubble>
                      <Message.BubbleContent className="whitespace-pre-wrap" dir="auto">
                        {textOf(message)}
                      </Message.BubbleContent>
                    </Message.Bubble>
                  </Message.Content>
                </Message>
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  streaming={chat.status === "streaming" && at === chat.messages.length - 1}
                  isLast={at === chat.messages.length - 1}
                  onRetry={retry}
                  onOpenPassage={() => undefined}
                  book={links}
                  onMakeCards={({ text, cards: drafted }) =>
                    setCards({
                      title: book.title,
                      text,
                      cards: drafted,
                      evidence: notebookAnswerEvidence(message, book.notebookId),
                      origin: {
                        kind: "notebook-answer",
                        notebookId: book.notebookId,
                        conversationId: instance.id,
                        messageId: message.id,
                      },
                      notebookId: book.notebookId,
                      tags: [book.title],
                    })
                  }
                />
              ),
            )}
            {chat.status === "submitted" && chat.messages.at(-1)?.role === "user" ? (
              <Message from="assistant">
                <Message.Content>
                  <Message.Status>{t("status.thinking")}</Message.Status>
                </Message.Content>
              </Message>
            ) : null}
            {chat.status === "error" && chat.error ? (
              <div
                role="alert"
                className="flex items-center gap-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                <span className="min-w-0 flex-1">{t("error", { error: chat.error.message })}</span>
                <button
                  type="button"
                  onClick={retry}
                  className="shrink-0 cursor-pointer font-medium underline-offset-4 hover:underline"
                >
                  {t("actions.retry")}
                </button>
              </div>
            ) : null}
          </SelectableText>
        )}
      </ScrollArea>

      <div
        ref={textarea}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background/80 to-transparent px-2 pt-8 pb-2"
      >
        <div className="pointer-events-auto">
          <Prompt
            value={draft}
            onValueChange={setDraft}
            status={status}
            disabled={!model}
            onStop={() => void chat.stop()}
            onSubmit={({ text }) => send(text)}
          >
            <Prompt.Banner open={settings !== undefined && !model}>{t("setup.banner")}</Prompt.Banner>
            <Prompt.Field>
              {quote ? <PromptQuote quote={quote} clear={clearQuote} /> : null}
              <Prompt.Textarea
                placeholder={t(quote ? "reader.placeholderQuote" : "reader.placeholder", { noun })}
                aria-label={t("reader.placeholder", { noun })}
              />
              <Prompt.Footer>
                <Prompt.Tools>
                  <AIModelPicker use="ask" className="max-w-40" />
                </Prompt.Tools>
                <Prompt.Submit sendLabel={t("send")} stopLabel={t("stop")} />
              </Prompt.Footer>
            </Prompt.Field>
            <Prompt.Context open>
              <Prompt.ContextItem onSelect={() => openSection(context.section)}>
                <Icon icon={QuoteDownIcon} size={14} />
                <span className="max-w-48 truncate" dir="auto">
                  {t("reader.onScreen", { noun, section: context.section })}
                  {context.sectionTitle ? ` · ${context.sectionTitle}` : ""}
                </span>
              </Prompt.ContextItem>
              {model && settings ? (
                <span className="ms-auto flex items-center gap-3">
                  <UsageRing messages={chat.messages} settings={settings} model={model} busy={busy} />
                </span>
              ) : null}
            </Prompt.Context>
          </Prompt>
        </div>
      </div>

      {cards ? (
        <StudyFlashcardDraftDialog
          source={cards}
          vaultId={vaultId}
          onClose={() => setCards(null)}
          onSave={(count) =>
            toast.success(tHome("study.capture.cardsSaved", { count }), {
              action: {
                label: tHome("study.capture.viewCards"),
                onClick: () => void navigate(studyHref("cards", { book: book.id })),
              },
            })
          }
        />
      ) : null}
    </div>
  );
}

