import { Chat, useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  generateId,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type ChatOnToolCallCallback,
} from "ai";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useStudioRunner } from "@/components/studio/studio-runner";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  ADD_CARDS,
  chatActionSchemas,
  isChatAction,
  parseSlash,
  type ChatActionName,
  type ChatActionOutput,
  type ChatActionPart,
} from "@/lib/chat/actions";
import { vaultOf } from "@/lib/db/vaults";
import {
  generateChatCards,
  needsConfirmation,
  saveChatCards,
  startChatOutput,
  undoChatAction,
  type ActionContext,
} from "./chat-actions";
import { stableContext } from "@/lib/context";
import { providers } from "@/lib/ai/catalog";
import type { ChatMessage, ChatMode } from "@/lib/chat/types";
import { latestConversation, loadChat, loadNotebookChat, saveChat } from "@/lib/db/messages";
import { contextCharsFor, credentialsFor, getSettings, modelFor } from "@/lib/db/settings";
import { getChunks, listSources } from "@/lib/db/sources";
import { store } from "@/lib/db/store";
import { DEFAULT_VAULT } from "@/lib/db/vaults";
import { createFileFromTool } from "@/lib/files/create";
import { createFileInput, type CreateFileOutput } from "@/lib/files/tools";
import { selectedTextSource } from "@/lib/db/source-text";
import { selectPassages } from "@/lib/grounding/passages";
import { listSkills } from "@/lib/db/skills";
import { getStudioSettings } from "@/lib/studio/settings";
import { studyReturnState } from "@/lib/study/return-links";
import type { ChatQuote } from "@/lib/chat/quote";

/** How many earlier messages are sent with each question. */
const HISTORY = 24;

interface ChatSession {
  /** The conversation shown; it is saved once it has an answer. */
  conversationId: string;
  messages: ChatMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
  /** Skills (ids) attached to this chat; their instructions go with each question. */
  skills: string[];
  setSkills: (ids: string[]) => void;
  /** Sends a question, with the passage quoted for it, if any. */
  send: (text: string) => Promise<void>;
  /** A passage selected to ask about with the next question. */
  quote: ChatQuote | undefined;
  setQuote: (quote: ChatQuote | undefined) => void;
  retry: () => Promise<void>;
  stop: () => void;
  /** Starts an empty conversation. */
  startNew: () => void;
  /** Shows a saved conversation. */
  open: (conversationId: string) => Promise<void>;
  /** Makes (or declines) a file the AI asked to make, then lets the answer carry on. */
  answerFile: (toolCallId: string, approved: boolean) => Promise<void>;
  /** Runs a "/" command typed in the prompt; false when the text is not one. */
  runCommand: (text: string) => boolean;
  /** The actions (tool calls) being run now. */
  runningActions: ReadonlySet<string>;
  /** Runs an action that waited for the user's OK, or ran into an error. */
  runAction: (toolCallId: string) => void;
  /** Answers a waiting action with "not now". */
  cancelAction: (toolCallId: string) => void;
  /** Removes what an action made. */
  undoAction: (toolCallId: string) => void;
}

const ChatContext = stableContext<ChatSession | null>("chat-session", null);

/**
 * The last request body each conversation sent. When an approved file lets
 * the answer carry on, the follow-up request reuses it (model, key, passages).
 */
const lastBodies = new Map<string, object>();

const transport = new DefaultChatTransport<ChatMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ id, messages, body }) => {
    // A question sends the full body; the automatic carry-on sends none (or an empty one).
    const full = body && "model" in body ? body : lastBodies.get(id);
    if (full) lastBodies.set(id, full);
    return { body: { ...full, messages: messages.slice(-HISTORY) } };
  },
});

type ToolCallHandler = ChatOnToolCallCallback<ChatMessage>;

/**
 * Sends the answer on once every call in it has its result, when one of them
 * is a file the user just made or declined (`create_file`).
 */
function carriesOnAfterFile({ messages }: { messages: ChatMessage[] }) {
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) return false;
  const parts = messages[messages.length - 1]?.parts ?? [];
  const step = parts.slice(parts.findLastIndex((part) => part.type === "step-start") + 1);
  return step.some((part) => isToolUIPart(part) && getToolName(part) === "create_file");
}

/**
 * One Chat per conversation. Each saves only into its own conversation, so
 * an answer that is stopped by switching never lands in another one. Its
 * tool calls (the chat's actions) run in the page, through `onToolCall`.
 */
function chatFor(
  notebookId: string,
  conversationId: string,
  messages: ChatMessage[],
  onToolCall: ToolCallHandler,
) {
  return new Chat<ChatMessage>({
    id: conversationId,
    messages,
    transport,
    // Once the user answers a file the AI asked to make, the answer carries on.
    // The chat's own actions (cards, Studio outputs) end the answer instead.
    sendAutomaticallyWhen: carriesOnAfterFile,
    onToolCall,
    onFinish: ({ messages: finished }) =>
      void saveChat({ id: conversationId, notebookId }, finished),
  });
}

type ActiveChat = { notebookId: string; chat: Chat<ChatMessage>; requested?: string };

/** Opens the notebook's most recent conversation (or a new one), and runs it. */
export function ChatProvider({
  notebookId,
  children,
}: {
  notebookId: string;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState<ActiveChat | null>(null);
  const [mode, setMode] = useState<ChatMode>("sources");
  const [skills, setSkills] = useState<string[]>([]);
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const requested = params.has("answer") ? params.get("conversation") : null;
  const shown = useRef<ActiveChat | null>(null);
  const sequence = useRef(0);
  // Set by the runner of the conversation shown, which has what the actions need.
  const toolCalls = useRef<ToolCallHandler | null>(null);
  const onToolCall = useCallback<ToolCallHandler>((call) => toolCalls.current?.(call), []);

  const show = useCallback((next: ActiveChat) => {
    void shown.current?.chat.stop();
    shown.current = next;
    setCurrent(next);
  }, []);

  useEffect(
    () => () => {
      sequence.current++;
    },
    [notebookId],
  );

  useEffect(() => {
    const active = shown.current;
    if (
      active?.notebookId === notebookId &&
      (!requested || active.chat.id === requested || active.requested === requested)
    )
      return;
    let alive = true;
    const attempt = ++sequence.current;
    void (async () => {
      try {
        const opened = requested ? await loadNotebookChat(notebookId, requested) : undefined;
        const latest = opened ? undefined : await latestConversation(notebookId);
        const id = opened && requested ? requested : (latest?.id ?? generateId());
        const messages = opened ?? (latest ? await loadChat(id) : []);
        if (alive && attempt === sequence.current)
          show({
            notebookId,
            chat: chatFor(notebookId, id, messages, onToolCall),
            requested: requested ?? undefined,
          });
      } catch (error) {
        if (alive && attempt === sequence.current) {
          toast.error(error instanceof Error ? error.message : String(error));
          show({
            notebookId,
            chat: chatFor(notebookId, generateId(), [], onToolCall),
            requested: requested ?? undefined,
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [notebookId, requested, show, onToolCall]);

  const clearAnswer = useCallback(() => {
    if (!params.has("answer")) return;
    const remaining = new URLSearchParams(params);
    remaining.delete("answer");
    remaining.delete("conversation");
    setParams(remaining, { replace: true, state: studyReturnState(state) });
  }, [params, setParams, state]);

  const startNew = useCallback(() => {
    sequence.current++;
    show({ notebookId, chat: chatFor(notebookId, generateId(), [], onToolCall) });
    clearAnswer();
  }, [clearAnswer, notebookId, show, onToolCall]);

  const open = useCallback(
    async (conversationId: string) => {
      const attempt = ++sequence.current;
      if (shown.current?.chat.id === conversationId) {
        clearAnswer();
        return;
      }
      try {
        const messages = await loadNotebookChat(notebookId, conversationId);
        if (!messages || attempt !== sequence.current) return;
        show({ notebookId, chat: chatFor(notebookId, conversationId, messages, onToolCall) });
        clearAnswer();
      } catch (error) {
        if (attempt === sequence.current)
          toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [clearAnswer, notebookId, show, onToolCall],
  );

  if (!current || current.notebookId !== notebookId) return null;
  if (requested && current.chat.id !== requested && current.requested !== requested) return null;
  return (
    <ChatRunner
      notebookId={notebookId}
      chat={current.chat}
      mode={mode}
      setMode={setMode}
      skills={skills}
      setSkills={setSkills}
      startNew={startNew}
      open={open}
      toolCallsRef={toolCalls}
    >
      {children}
    </ChatRunner>
  );
}

function textOf(message: ChatMessage | undefined): string {
  return (
    message?.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? ""
  );
}

function ChatRunner({
  notebookId,
  chat: instance,
  mode,
  setMode,
  skills,
  setSkills,
  startNew,
  open,
  toolCallsRef,
  children,
}: {
  toolCallsRef: { current: ToolCallHandler | null };
  notebookId: string;
  skills: string[];
  setSkills: (ids: string[]) => void;
  chat: Chat<ChatMessage>;
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
  startNew: () => void;
  open: (conversationId: string) => Promise<void>;
  children: ReactNode;
}) {
  const chat = useChat<ChatMessage>({ chat: instance });
  const [quote, setQuote] = useState<ChatQuote>();
  const actions = useChatActions(notebookId, instance, toolCallsRef);

  /** The model, the key and the passages for a question, read fresh each time. */
  const requestFor = useCallback(
    async (question: string) => {
      const settings = await getSettings();
      const choice = modelFor(settings, "chat");
      if (!choice) throw new Error("No model is set up.");
      const { model, effort } = choice;
      const sources = (await listSources(notebookId)).filter(selectedTextSource);
      const chunks = await getChunks(sources.map((source) => source.id));
      const passages = selectPassages({
        sources,
        chunks,
        budget: contextCharsFor(settings, model.provider),
        query: question,
      });
      const [allSkills, studio] = await Promise.all([listSkills(), getStudioSettings()]);
      return {
        mode: mode === "web" && providers[model.provider].webSearch ? "web" : "sources",
        model,
        credentials: credentialsFor(settings, model.provider),
        effort,
        passages,
        skills: allSkills
          .filter((skill) => skills.includes(skill.id))
          .map(({ name, description, body }) => ({ name, description, body })),
        visuals: studio.visuals,
      };
    },
    [notebookId, mode, skills],
  );

  const { sendMessage, regenerate, stop, messages, status, error, addToolOutput } = chat;

  const value = useMemo<ChatSession>(
    () => ({
      conversationId: instance.id,
      messages,
      status,
      error,
      mode,
      setMode,
      skills,
      setSkills,
      send: async (text) => {
        // The passages are found for the quote and the question together.
        const body = await requestFor(quote ? `${quote.text}\n\n${text}` : text);
        setQuote(undefined);
        await sendMessage({ text, metadata: { createdAt: Date.now(), quote } }, { body });
      },
      quote,
      setQuote,
      retry: async () => {
        const question = textOf([...messages].reverse().find((message) => message.role === "user"));
        await regenerate({ body: await requestFor(question) });
      },
      stop: () => void stop(),
      startNew,
      open,
      answerFile: async (toolCallId, approved) => {
        const part = messages
          .flatMap((message) => message.parts)
          .find((each) => "toolCallId" in each && each.toolCallId === toolCallId);
        if (!part || !("input" in part)) return;
        const parsed = createFileInput.safeParse(part.input);
        const output: CreateFileOutput = !approved
          ? { ok: false, declined: true }
          : parsed.success
            ? await createFileFromTool(parsed.data, {
                vaultId: (await store().getNotebook(notebookId))?.vaultId ?? DEFAULT_VAULT,
                createdBy: "ai",
              })
            : { ok: false, error: parsed.error.message };
        // After a reload there is no earlier request to reuse; build one for the carry-on.
        if (!lastBodies.has(instance.id)) {
          const question = textOf(
            [...messages].reverse().find((message) => message.role === "user"),
          );
          lastBodies.set(instance.id, await requestFor(question));
        }
        await addToolOutput({ tool: "create_file", toolCallId, output } as never);
      },
      ...actions,
    }),
    [
      actions,
      instance.id,
      messages,
      skills,
      setSkills,
      status,
      error,
      mode,
      setMode,
      requestFor,
      sendMessage,
      quote,
      regenerate,
      stop,
      startNew,
      open,
      addToolOutput,
      notebookId,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/** Sets a conversation's messages while no answer is streaming into it. */
function replaceMessages(chat: Chat<ChatMessage>, messages: ChatMessage[]) {
  chat.messages = messages;
}

/** Where an action's tool call is in the conversation. */
function locate(messages: ChatMessage[], toolCallId: string) {
  for (const message of messages) {
    const part = message.parts.find(
      (each): each is ChatActionPart => isToolUIPart(each) && each.toolCallId === toolCallId,
    );
    if (part) return { message, part, name: getToolName(part) as ChatActionName };
  }
  return undefined;
}

/** The "/" command a message was, for the focus typed after it. */
function commandBefore(messages: ChatMessage[], assistant: ChatMessage | undefined) {
  const at = assistant ? messages.indexOf(assistant) : -1;
  const asked = at > 0 ? messages[at - 1] : undefined;
  return asked?.role === "user" ? parseSlash(textOf(asked)) : null;
}

/**
 * The chat's actions: the model's add_cards and make calls, and the same
 * actions typed as "/" commands. Each runs here, and its result (what was
 * made, or why not) is kept in the conversation as the call's output.
 */
function useChatActions(
  notebookId: string,
  instance: Chat<ChatMessage>,
  toolCallsRef: { current: ToolCallHandler | null },
) {
  const { t } = useTranslation("chat");
  const { notebook, openTool } = useWorkspace();
  const runner = useStudioRunner();
  const [runningActions, setRunning] = useState<ReadonlySet<string>>(() => new Set());

  const contextFor = useCallback(
    (messageId: string): ActionContext => ({
      notebookId,
      notebookTitle: notebook.title,
      vaultId: vaultOf(notebook),
      origin: { kind: "notebook-answer", notebookId, conversationId: instance.id, messageId },
      createOutput: runner.create,
      messages: {
        noSources: t("make.errors.noSources"),
        noCards: t("make.errors.noCards"),
        noImageModel: t("make.errors.noImageModel"),
      },
    }),
    [notebookId, notebook, instance.id, runner.create, t],
  );

  /** Keeps the result in the call, and saves it at once: what was made is never offered again. */
  const finish = useCallback(
    async (name: ChatActionName, toolCallId: string, output: ChatActionOutput) => {
      await instance.addToolOutput({ tool: name as never, toolCallId, output: output as never });
      await saveChat({ id: instance.id, notebookId }, instance.messages);
    },
    [instance, notebookId],
  );

  const track = useCallback(async (toolCallId: string, work: () => Promise<void>) => {
    setRunning((current) => new Set(current).add(toolCallId));
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning((current) => {
        const next = new Set(current);
        next.delete(toolCallId);
        return next;
      });
    }
  }, []);

  const execute = useCallback(
    (toolCallId: string, name: ChatActionName, raw: unknown, message: ChatMessage | undefined) =>
      track(toolCallId, async () => {
        const context = contextFor(message?.id ?? "");
        let output: ChatActionOutput;
        if (name === ADD_CARDS) {
          const input = chatActionSchemas[ADD_CARDS].safeParse(raw);
          if (input.success && input.data.cards.length > 0) {
            output = await saveChatCards(context, input.data, message?.metadata?.passages ?? []);
          } else {
            // "/cards": the study model writes them from the selected sources.
            const focus = commandBefore(instance.messages, message)?.focus ?? "";
            const made = await generateChatCards(context, focus);
            replaceMessages(
              instance,
              instance.messages.map((each) =>
                each.id !== message?.id
                  ? each
                  : {
                      ...each,
                      metadata: { ...each.metadata, passages: made.passages },
                      parts: each.parts.map((part) =>
                        isToolUIPart(part) && part.toolCallId === toolCallId
                          ? ({ ...part, input: made.input } as typeof part)
                          : part,
                      ),
                    },
              ),
            );
            output = made.output;
          }
        } else {
          const input = chatActionSchemas.make.safeParse(raw);
          output = input.success
            ? await startChatOutput(context, input.data)
            : { error: t("make.errors.invalid") };
        }
        await finish(name, toolCallId, output);
      }),
    [contextFor, finish, instance, t, track],
  );

  // The model's calls run as they arrive, except the slow or paid ones, which wait for an OK.
  useEffect(() => {
    const handler: ToolCallHandler = ({ toolCall }) => {
      if (toolCall.dynamic || !isChatAction(toolCall.toolName)) return;
      const name = toolCall.toolName;
      if (needsConfirmation(name, toolCall.input)) return;
      // The answer is already in the conversation: the stream writes it before each call.
      const message =
        locate(instance.messages, toolCall.toolCallId)?.message ??
        instance.messages.findLast((each) => each.role === "assistant");
      // Not awaited: the result is added once the answer's stream has ended.
      void execute(toolCall.toolCallId, name, toolCall.input, message);
    };
    toolCallsRef.current = handler;
    return () => {
      if (toolCallsRef.current === handler) toolCallsRef.current = null;
    };
  }, [execute, instance, toolCallsRef]);

  return useMemo(
    () => ({
      runningActions,
      runCommand: (text: string) => {
        const parsed = parseSlash(text);
        if (!parsed) return false;
        const { command, focus } = parsed;
        const name = command.action;
        const input = command.action === ADD_CARDS ? { cards: [] } : { tool: command.tool, focus };
        const toolCallId = generateId();
        const createdAt = Date.now();
        const answer: ChatMessage = {
          id: generateId(),
          role: "assistant",
          metadata: { createdAt },
          parts: [
            { type: `tool-${name}`, toolCallId, state: "input-available", input },
          ] as ChatMessage["parts"],
        };
        replaceMessages(instance, [
          ...instance.messages,
          {
            id: generateId(),
            role: "user",
            metadata: { createdAt },
            parts: [{ type: "text", text: text.trim() }],
          },
          answer,
        ]);
        void saveChat({ id: instance.id, notebookId }, instance.messages);
        if (!needsConfirmation(name, input)) void execute(toolCallId, name, input, answer);
        return true;
      },
      runAction: (toolCallId: string) => {
        const found = locate(instance.messages, toolCallId);
        if (!found || runningActions.has(toolCallId)) return;
        const tool = (found.part.input as { tool?: string } | undefined)?.tool;
        if (found.name !== ADD_CARDS && tool === "audio-overview") {
          // Its voices are chosen in its own dialog, which shows the cost too.
          openTool("audio-overview");
          void finish(found.name, toolCallId, { dialog: true, tool });
          return;
        }
        void execute(toolCallId, found.name, found.part.input, found.message);
      },
      cancelAction: (toolCallId: string) => {
        const found = locate(instance.messages, toolCallId);
        if (found) void finish(found.name, toolCallId, { cancelled: true });
      },
      undoAction: (toolCallId: string) => {
        const found = locate(instance.messages, toolCallId);
        if (!found || found.part.state !== "output-available") return;
        const output = found.part.output as ChatActionOutput;
        void track(toolCallId, async () => {
          await finish(found.name, toolCallId, await undoChatAction(output));
        });
      },
    }),
    [execute, finish, instance, notebookId, openTool, runningActions, track],
  );
}

export function useChatSession(): ChatSession {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChatSession must be used inside <ChatProvider>.");
  return context;
}
