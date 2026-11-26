import { Book02Icon, Idea01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notebookAnswerEvidence } from "@/lib/chat/study";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { useChatSession } from "@/components/chat/chat-provider";
import { Icon } from "@/components/icon";
import { Alert } from "@/components/panelui/alert";
import { Button } from "@/components/panelui/button";
import { Message } from "@/components/panelui/message";
import {
  StudyFlashcardDraftDialog,
  type FlashcardSource,
} from "@/components/study/study-flashcard-generator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { providers } from "@/lib/ai/catalog";
import { modelFor, useSettings } from "@/lib/db/settings";
import { useSources } from "@/lib/db/sources";
import { vaultOf } from "@/lib/db/vaults";
import { studyHref } from "@/lib/study/links";
import { QuoteChip } from "@/components/chat/quote";
import { SelectableText } from "@/components/selection/selectable-text";
import { useWorkspace } from "./workspace-context";

const SUGGESTIONS = ["summary", "questions", "terms", "plan"] as const;

/** The conversation with the notebook. */
export function ChatView() {
  const { t } = useTranslation("chat");
  const { t: tHome } = useTranslation("home");
  const location = useLocation();
  const navigate = useNavigate();
  const chat = useChatSession();
  const { notebook, readSource, companion, openModelSetup } = useWorkspace();
  const scroller = useRef<HTMLDivElement>(null);
  const focusedAnswer = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<FlashcardSource | null>(null);
  const last = chat.messages.at(-1);
  const params = new URLSearchParams(location.search);
  const answer = params.get("answer");
  const focusId =
    answer &&
    params.get("conversation") === chat.conversationId &&
    chat.messages.some((message) => message.id === answer && message.role === "assistant")
      ? answer
      : null;
  const missingAnswer = Boolean(answer && !focusId);
  const vaultId = vaultOf(notebook);

  useLayoutEffect(() => {
    if (focusId && companion === "ask") {
      focusedAnswer.current?.scrollIntoView({ block: "start" });
      focusedAnswer.current?.focus({ preventScroll: true });
    }
  }, [focusId, location.key, companion]);

  // Follows the answer as it is written, unless the reader has scrolled up.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 240) {
      element.scrollTo({ top: element.scrollHeight });
    }
  }, [chat.messages]);

  if (chat.messages.length === 0) return <EmptyChat missingAnswer={missingAnswer} />;

  const retry = () =>
    chat
      .retry()
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );

  return (
    <ScrollArea className="h-full" viewportRef={scroller}>
      <SelectableText
        className="mx-auto flex max-w-3xl flex-col gap-8 px-4 pt-4 pb-6"
        place={{
          title: notebook.title,
          notebookId: notebook.id,
          vaultId,
          tags: [notebook.title],
          origin: (block) => {
            const messageId = block.dataset.notebookAnswer;
            return messageId
              ? { kind: "notebook-answer", notebookId: notebook.id, conversationId: chat.conversationId, messageId }
              : undefined;
          },
          onAsk: (text) => chat.setQuote({ text }),
        }}
      >
        {missingAnswer ? <AnswerUnavailable /> : null}
        {chat.messages.map((message, at) =>
          message.role === "user" ? (
            <Message key={message.id} from="user">
              <Message.Content>
                {message.metadata?.quote ? <QuoteChip quote={message.metadata.quote} /> : null}
                <Message.Bubble>
                  <Message.BubbleContent className="whitespace-pre-wrap">
                    {message.parts
                      .flatMap((part) => (part.type === "text" ? [part.text] : []))
                      .join("\n")}
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
              onOpenPassage={(passage) =>
                readSource(passage.sourceId, passage.chunkId, passage.snippet)
              }
              focusRef={focusId === message.id ? focusedAnswer : undefined}
              onMakeCards={({ text, cards }) =>
                setDraft({
                  title: notebook.title,
                  text,
                  cards,
                  evidence: notebookAnswerEvidence(message, notebook.id),
                  origin: {
                    kind: "notebook-answer",
                    notebookId: notebook.id,
                    conversationId: chat.conversationId,
                    messageId: message.id,
                  },
                  notebookId: notebook.id,
                  tags: [notebook.title],
                })
              }
            />
          ),
        )}
        {chat.status === "submitted" && last?.role === "user" ? (
          <Message from="assistant">
            <Message.Content>
              <Message.Status>{t("status.thinking")}</Message.Status>
            </Message.Content>
          </Message>
        ) : null}
        {chat.status === "error" && chat.error ? (
          // design-system §7, inline AI errors: where it happened, with the fix beside it.
          <Alert tone="destructive" variant="plain" className="rounded-xl">
            <Alert.Icon />
            <Alert.Title>{t("errorTitle")}</Alert.Title>
            <Alert.Description>{t("errorLine", { error: chat.error.message })}</Alert.Description>
            <Alert.Actions>
              <Button size="sm" variant="secondary" className="border border-input" onClick={retry}>
                {t("actions.retry")}
              </Button>
              <Button size="sm" variant="ghost" onClick={openModelSetup}>
                {t("chooseModel")}
              </Button>
            </Alert.Actions>
          </Alert>
        ) : null}
      </SelectableText>
      {draft ? (
        <StudyFlashcardDraftDialog
          source={draft}
          vaultId={vaultId}
          onClose={() => setDraft(null)}
          onSave={(count) =>
            toast.success(tHome("study.capture.cardsSaved", { count }), {
              action: {
                label: tHome("study.capture.viewCards"),
                onClick: () => void navigate(studyHref("cards", { notebook: notebook.id })),
              },
            })
          }
        />
      ) : null}
    </ScrollArea>
  );
}

function AnswerUnavailable() {
  const { t } = useTranslation("chat");
  return (
    <p
      role="status"
      className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
    >
      {t("answerUnavailable")}
    </p>
  );
}

function EmptyChat({ missingAnswer }: { missingAnswer: boolean }) {
  const { t } = useTranslation("chat");
  const chat = useChatSession();
  const { notebook, setAddSourceOpen } = useWorkspace();
  const sources = useSources(notebook.id);
  const settings = useSettings();
  const model = settings && modelFor(settings, "chat")?.model;
  const webAvailable = model && providers[model.provider].webSearch;
  const selected = sources?.filter((source) => source.selected).length ?? 0;

  return (
    // design-system §7, empty states: one title naming the scope, one muted line, then the action.
    <ScrollArea className="h-full">
      <div className="flex min-h-full flex-col justify-center gap-5 px-4 py-6">
        {missingAnswer ? <AnswerUnavailable /> : null}
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-pretty" dir="auto">
            {t("empty.titleScope", { scope: notebook.title })}
          </h2>
          <p className="text-[0.8125rem] text-pretty text-muted-foreground">
            {sources && selected === 0
              ? t(webAvailable ? "empty.noSources" : "empty.noSourcesLocal")
              : t("empty.body", { count: selected })}
          </p>
        </div>
        {sources && selected === 0 ? (
          <Button
            variant="secondary"
            className="self-start border border-input"
            onClick={() => setAddSourceOpen(true)}
          >
            <Icon icon={Book02Icon} size={16} />
            {t("addSource")}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            {SUGGESTIONS.map((key) => (
              <Button
                key={key}
                variant="outline"
                disabled={chat.status === "submitted" || chat.status === "streaming"}
                onClick={() =>
                  chat
                    .send(t(`empty.suggestions.${key}`))
                    .catch((error: unknown) =>
                      toast.error(error instanceof Error ? error.message : String(error)),
                    )
                }
                className="h-auto min-h-9 justify-start rounded-lg px-3 py-1.5 text-start text-[0.8125rem] font-normal whitespace-normal shadow-none active:not-disabled:scale-100"
              >
                <Icon icon={Idea01Icon} size={16} className="text-chart-4" />
                {t(`empty.suggestions.${key}`)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
