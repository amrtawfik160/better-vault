import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  getToolName,
  isToolUIPart,
  stepCountIs,
  streamText,
  tool,
  toUIMessageStream,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { providers } from "@/lib/ai/catalog";
import { rejectCliProxyRequest } from "@/lib/ai/cliproxyapi";
import { describeError } from "@/lib/ai/errors";
import { createLanguageModel } from "@/lib/ai/providers";
import { credentialsSchema, effortSchema, modelRefSchema } from "@/lib/ai/request";
import type { ChatMessage, ChatMessageMetadata, TokenUsage } from "@/lib/chat/types";
import {
  isReaderTool,
  readerContextSchema,
  readerSystemPrompt,
  readerToolBudget,
  readerToolDescriptions,
  readerToolNames,
  readerToolSchemas,
} from "@/lib/study/reader-chat";
import { createVisualTools } from "../visual-tools";

const bodySchema = z.object({
  messages: z
    .array(z.looseObject({ id: z.string(), role: z.enum(["system", "user", "assistant"]) }))
    .min(1),
  model: modelRefSchema,
  credentials: credentialsSchema,
  effort: effortSchema,
  reader: readerContextSchema,
  visuals: z.boolean().default(true),
});

function tokenUsage(usage: LanguageModelUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
  };
}

/** The book tools, declared without `execute`: the page reads its own copy of the book. */
function bookTools(): ToolSet {
  return Object.fromEntries(
    readerToolNames.map((name) => {
      const inputSchema: z.ZodType<Record<string, unknown>> = readerToolSchemas[name];
      return [name, tool({ description: readerToolDescriptions[name], inputSchema })];
    }),
  );
}

/**
 * The messages as the model reads them: a selected passage goes before the
 * question it was asked with, and tool calls this request can't take (a local
 * model, or tools from another chat) are left out.
 */
function forModel(messages: ChatMessage[], tools: ToolSet | undefined): ChatMessage[] {
  return messages.map((message) => {
    const parts = message.parts.filter(
      (part) => !isToolUIPart(part) || (tools !== undefined && getToolName(part) in tools),
    );
    const quote = message.role === "user" ? message.metadata?.quote : undefined;
    return {
      ...message,
      parts: quote
        ? [
            {
              type: "text" as const,
              text: `The passage I selected (section ${quote.section}):\n"""\n${quote.text}\n"""`,
            },
            ...parts,
          ]
        : parts,
    };
  });
}

/** Book tool calls made since the user's latest question. */
function toolCallsSinceQuestion(messages: ChatMessage[]): number {
  const question = messages.findLastIndex((message) => message.role === "user");
  return messages
    .slice(question + 1)
    .flatMap((message) => message.parts)
    .filter((part) => isToolUIPart(part) && isReaderTool(getToolName(part))).length;
}

/** One turn of Ask AI beside the reader, knowing the section on screen. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { model, credentials, effort, reader } = parsed.data;
  const denied = rejectCliProxyRequest(request, model.provider);
  if (denied) return denied;
  const messages = parsed.data.messages as unknown as ChatMessage[];

  let languageModel;
  try {
    languageModel = await createLanguageModel(model, credentials, effort);
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 400 });
  }

  // Local models often can't call tools, so they answer from the section on screen.
  const canUseTools = !providers[model.provider].local;
  const visuals = canUseTools && parsed.data.visuals;
  const tools: ToolSet | undefined = canUseTools
    ? { ...bookTools(), ...(visuals ? createVisualTools() : {}) }
    : undefined;
  // After enough reading, the model answers with what it has.
  const exhausted = toolCallsSinceQuestion(messages) >= readerToolBudget;

  const result = streamText({
    model: languageModel,
    system: readerSystemPrompt(reader, { tools: canUseTools && !exhausted, visuals }),
    messages: await convertToModelMessages(forModel(messages, tools), {
      ignoreIncompleteToolCalls: true,
    }),
    tools,
    toolChoice: exhausted ? "none" : undefined,
    stopWhen: stepCountIs(5),
    abortSignal: request.signal,
  });

  const metadata: ChatMessageMetadata = { createdAt: Date.now(), model };

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: messages,
      messageMetadata: ({ part }): ChatMessageMetadata | undefined => {
        if (part.type === "start") return metadata;
        if (part.type === "finish") return { usage: tokenUsage(part.totalUsage) };
        return undefined;
      },
      onError: describeError,
    }),
  });
}
