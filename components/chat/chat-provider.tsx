import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, generateId } from "ai";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useSearchParams } from "react-router";
import { toast } from "sonner";
import { stableContext } from "@/lib/context";
import { providers } from "@/lib/ai/catalog";
import type { ChatMessage, ChatMode } from "@/lib/chat/types";
import { latestConversation, loadChat, loadNotebookChat, saveChat } from "@/lib/db/messages";
import { contextCharsFor, credentialsFor, getSettings, modelFor } from "@/lib/db/settings";
import { getChunks, listSources } from "@/lib/db/sources";
import { selectedTextSource } from "@/lib/db/source-text";
import { selectPassages } from "@/lib/grounding/passages";
import { listSkills } from "@/lib/db/skills";
import { getStudioSettings } from "@/lib/studio/settings";
import { studyReturnState } from "@/lib/study/return-links";

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
  send: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  stop: () => void;
  /** Starts an empty conversation. */
  startNew: () => void;
  /** Shows a saved conversation. */
  open: (conversationId: string) => Promise<void>;
}

const ChatContext = stableContext<ChatSession | null>("chat-session", null);

const transport = new DefaultChatTransport<ChatMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: { ...body, messages: messages.slice(-HISTORY) },
  }),
});

/**
 * One Chat per conversation. Each saves only into its own conversation, so
 * an answer that is stopped by switching never lands in another one.
 */
function chatFor(notebookId: string, conversationId: string, messages: ChatMessage[]) {
  return new Chat<ChatMessage>({
    id: conversationId,
    messages,
    transport,
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
            chat: chatFor(notebookId, id, messages),
            requested: requested ?? undefined,
          });
      } catch (error) {
        if (alive && attempt === sequence.current) {
          toast.error(error instanceof Error ? error.message : String(error));
          show({
            notebookId,
            chat: chatFor(notebookId, generateId(), []),
            requested: requested ?? undefined,
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [notebookId, requested, show]);

  const clearAnswer = useCallback(() => {
    if (!params.has("answer")) return;
    const remaining = new URLSearchParams(params);
    remaining.delete("answer");
    remaining.delete("conversation");
    setParams(remaining, { replace: true, state: studyReturnState(state) });
  }, [params, setParams, state]);

  const startNew = useCallback(() => {
    sequence.current++;
    show({ notebookId, chat: chatFor(notebookId, generateId(), []) });
    clearAnswer();
  }, [clearAnswer, notebookId, show]);

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
        show({ notebookId, chat: chatFor(notebookId, conversationId, messages) });
        clearAnswer();
      } catch (error) {
        if (attempt === sequence.current)
          toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [clearAnswer, notebookId, show],
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
  children,
}: {
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

  const { sendMessage, regenerate, stop, messages, status, error } = chat;

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
        const body = await requestFor(text);
        await sendMessage({ text, metadata: { createdAt: Date.now() } }, { body });
      },
      retry: async () => {
        const question = textOf([...messages].reverse().find((message) => message.role === "user"));
        await regenerate({ body: await requestFor(question) });
      },
      stop: () => void stop(),
      startNew,
      open,
    }),
    [
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
      regenerate,
      stop,
      startNew,
      open,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatSession(): ChatSession {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChatSession must be used inside <ChatProvider>.");
  return context;
}
