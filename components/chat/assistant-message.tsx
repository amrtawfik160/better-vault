import { Cards01Icon, Globe02Icon, RepeatIcon } from "@hugeicons/core-free-icons";
import { getToolName, isToolUIPart } from "ai";
import { useMemo, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Message } from "@/components/panelui/message";
import { sourceFormatIcons } from "@/components/sources/source-format";
import { sourceFormatOf } from "@/lib/sources/formats";
import { ListenIcon, useListen, useListenLabel } from "@/components/speech/listen";
import { isChatActionPart } from "@/lib/chat/actions";
import { answerFlashcardMaterial } from "@/lib/chat/study";
import type { ChatMessage, PassageRef } from "@/lib/chat/types";
import { cleanText } from "@/lib/grounding/clean";
import { citedNumbers, stripCitations } from "@/lib/grounding/passages";
import { canSpeak, warmUpSpeech } from "@/lib/speech/speak";

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
import { AnswerAvatar } from "@/components/bot/answer-avatar";
import { FileApprovalCard } from "@/components/files/file-approval-card";
import type { BotAvatar as BotLook } from "@/lib/db/types";
import { ActionRow } from "./action-row";
import { AnswerReferences, SearchStatus, type Reference } from "./answer-references";
import { BookActivity, readingBook, type BookLinks } from "./book-activity";
import { Markdown } from "./markdown";
import { isVisualPart, VisualPart } from "./visual/visual-part";

const SEARCH_TOOLS = new Set(["web_search", "google_search"]);

type FilePart = Extract<ChatMessage["parts"][number], { toolCallId: string }>;

interface AssistantMessageProps {
  /** The character shown once the answer is finished; none when `null`. */
  avatar?: BotLook | null;
  message: ChatMessage;
  streaming: boolean;
  isLast: boolean;
  onRetry: () => void;
  onOpenPassage: (passage: PassageRef) => void;
  /** Makes or declines a file the AI asked to make. */
  onAnswerFile?: (toolCallId: string, approved: boolean) => Promise<void>;
  onMakeCards: (material: ReturnType<typeof answerFlashcardMaterial>) => void;
  focusRef?: Ref<HTMLDivElement>;
  /** Ask AI beside the reader: the book's sections the answer read, opening in the reader. */
  book?: BookLinks;
}

/** Reads the answer aloud, and stops it while it reads. */
function ListenAction({ text }: { text: string }) {
  const { t } = useTranslation("chat");
  const { state, toggle } = useListen();
  const label = useListenLabel(state, t("actions.listen"));
  if (!canSpeak()) return null;
  return (
    <Message.Action
      label={label}
      aria-busy={state === "preparing" || undefined}
      onPointerEnter={warmUpSpeech}
      onFocus={warmUpSpeech}
      onClick={() =>
        void toggle(stripCitations(text)).then((spoken) => {
          if (!spoken) toast.info(t("actions.noVoice"));
        })
      }
    >
      <ListenIcon state={state} />
    </Message.Action>
  );
}

/** An answer: the sources it read or searched, the text with citations, and actions. */
export function AssistantMessage({
  avatar,
  message,
  streaming,
  isLast,
  onRetry,
  onOpenPassage,
  onAnswerFile,
  onMakeCards,
  focusRef,
  book,
}: AssistantMessageProps) {
  const { t } = useTranslation("chat");
  const { t: tSources } = useTranslation("sources");
  const passages = useMemo(() => message.metadata?.passages ?? [], [message.metadata?.passages]);
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
  const material = useMemo(
    () => (streaming ? undefined : answerFlashcardMaterial(message)),
    [streaming, message],
  );
  const canMakeCards = Boolean(material?.text || material?.cards.length);
  // Text and visuals in the order the model wrote them; runs of text join up.
  const blocks = useMemo(() => {
    const out: (
      | { kind: "text"; text: string }
      | { kind: "visual"; part: ChatMessage["parts"][number] }
      | { kind: "file"; part: FilePart }
    )[] = [];
    for (const part of message.parts) {
      if (part.type === "text") {
        const last = out.at(-1);
        if (last?.kind === "text") last.text += `\n\n${part.text}`;
        else out.push({ kind: "text", text: part.text });
      } else if (isToolUIPart(part) && isVisualPart(part)) {
        out.push({ kind: "visual", part });
      } else if (isToolUIPart(part) && getToolName(part) === "create_file") {
        out.push({ kind: "file", part });
      }
    }
    return out;
  }, [message.parts]);
  const hasVisual = blocks.some((block) => block.kind === "visual");
  const files = blocks.flatMap((block) => (block.kind === "file" ? [block.part] : []));
  // What the chat made (cards, Studio outputs), shown as rows under the answer.
  const actions = useMemo(() => message.parts.filter(isChatActionPart), [message.parts]);

  const web = useMemo(() => {
    const references: Reference[] = [];
    const seen = new Set<string>();
    for (const part of message.parts) {
      if (part.type === "source-url" && !seen.has(part.url)) {
        seen.add(part.url);
        const host = hostOf(part.url);
        references.push({
          key: part.url,
          numbers: [],
          title: part.title || host,
          place: host,
          icon: Globe02Icon,
          href: part.url,
        });
      }
    }
    const searches = message.parts.filter(
      (part) => isToolUIPart(part) && SEARCH_TOOLS.has(getToolName(part)),
    );
    const pending = searches.find(
      (part) => isToolUIPart(part) && part.state !== "output-available",
    );
    const input =
      pending && isToolUIPart(pending)
        ? (pending.input as { query?: unknown } | undefined)
        : undefined;
    return {
      references,
      searching: streaming && (pending !== undefined || (searches.length > 0 && !text)),
      query: typeof input?.query === "string" ? input.query : undefined,
    };
  }, [message.parts, streaming, text]);

  // Notebook sources: the ones the answer cites, with their numbers; else every one it was given.
  const notebook = useMemo(() => {
    const cited = new Set(citedNumbers(text));
    const bySource = new Map<string, { first: PassageRef; numbers: number[] }>();
    const read = new Set(passages.map((passage) => passage.sourceId));
    const citedPassages = passages.filter((passage) => cited.has(passage.n));
    for (const passage of citedPassages.length > 0 ? citedPassages : passages) {
      const entry = bySource.get(passage.sourceId);
      if (entry) {
        if (cited.has(passage.n)) entry.numbers.push(passage.n);
      } else {
        bySource.set(passage.sourceId, {
          first: passage,
          numbers: cited.has(passage.n) ? [passage.n] : [],
        });
      }
    }
    const references = [...bySource.values()].map<Reference>(({ first, numbers }) => ({
      key: first.sourceId,
      numbers: numbers.sort((a, b) => a - b),
      title: first.title,
      place: tSources(`formats.${sourceFormatOf(first)}`),
      // Snippets saved with older answers may hold characters no font can draw.
      snippet: cleanText(first.snippet),
      icon: sourceFormatIcons[sourceFormatOf(first)],
      onOpen: () => onOpenPassage(first),
    }));
    return { references, read: read.size };
  }, [passages, text, tSources, onOpenPassage]);

  const showNotebook = notebook.read > 0 && !streaming;
  const showWeb = message.metadata?.mode === "web" && web.references.length > 0 && !streaming;
  const summary = [
    showNotebook ? t("sources.read", { count: notebook.read }) : "",
    showWeb ? t("sources.searched", { count: web.references.length }) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const answer = (
    <Message
      from="assistant"
      streaming={streaming && text !== ""}
      ref={focusRef}
      tabIndex={focusRef ? -1 : undefined}
      data-notebook-answer={message.id}
      data-selection-block=""
      className={
        focusRef
          ? "rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          : undefined
      }
    >
      <Message.Content className="gap-3">
        {book ? <BookActivity parts={message.parts} streaming={streaming} book={book} /> : null}
        {message.metadata?.mode === "web" && web.searching ? (
          <SearchStatus
            label={
              web.query ? t("sources.searchingFor", { query: web.query }) : t("sources.searching")
            }
          />
        ) : null}
        {text || hasVisual ? (
          <Message.Bubble>
            <Message.BubbleContent className="flex flex-col gap-3">
              {blocks.map((block, at) =>
                block.kind === "file" ? null : block.kind === "text" ? (
                  <Markdown
                    key={at}
                    text={block.text}
                    passages={passages}
                    onCite={onOpenPassage}
                    bare
                  />
                ) : isToolUIPart(block.part) ? (
                  <VisualPart key={block.part.toolCallId} part={block.part} />
                ) : null,
              )}
            </Message.BubbleContent>
          </Message.Bubble>
        ) : streaming &&
          actions.length === 0 &&
          !web.searching &&
          !(book && readingBook(message.parts)) ? (
          <Message.Status>
            {passages.length > 0 ? t("status.reading") : t("status.thinking")}
          </Message.Status>
        ) : null}
        {files.map((part) => (
          <FileApprovalCard
            key={part.toolCallId}
            part={part}
            onAnswer={(approved) => onAnswerFile?.(part.toolCallId, approved) ?? Promise.resolve()}
          />
        ))}
        {actions.length > 0 ? (
          <div className="flex flex-col gap-2">
            {actions.map((part) => (
              <ActionRow key={part.toolCallId} part={part} live={isLast} />
            ))}
          </div>
        ) : null}
        {(text || hasVisual) && (showNotebook || showWeb) ? (
          <AnswerReferences
            notebook={showNotebook ? notebook.references : []}
            web={showWeb ? web.references : []}
            summary={summary}
          />
        ) : null}
        {!streaming && (text || canMakeCards) ? (
          <Message.Actions aria-label={t("actions.label")} reveal={isLast ? "always" : "hover"}>
            {text ? (
              <Message.Action
                label={t("actions.copy")}
                copiedLabel={t("actions.copied")}
                copy={() => stripCitations(text)}
              />
            ) : null}
            {text ? <ListenAction text={text} /> : null}
            {material && canMakeCards ? (
              <Message.Action label={t("actions.flashcards")} onClick={() => onMakeCards(material)}>
                <Icon icon={Cards01Icon} />
              </Message.Action>
            ) : null}
            {isLast && text ? (
              <Message.Action label={t("actions.retry")} onClick={onRetry}>
                <Icon icon={RepeatIcon} />
              </Message.Action>
            ) : null}
          </Message.Actions>
        ) : null}
      </Message.Content>
    </Message>
  );
  if (avatar === undefined || avatar === null) return answer;
  // The character sits beside the answer, at its top, as in messaging apps;
  // its column stays while the answer streams, so the text does not move.
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex w-[30px] shrink-0 justify-center">
        {!streaming && (text || hasVisual) ? <AnswerAvatar avatar={avatar} fresh={isLast} /> : null}
      </div>
      <div className="min-w-0 flex-1">{answer}</div>
    </div>
  );
}
