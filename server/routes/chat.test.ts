import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

let model: MockLanguageModelV4;

vi.mock("@/lib/ai/providers", () => ({
  createLanguageModel: async () => model,
  createWebSearchTools: () => undefined,
}));

const { POST } = await import("./chat");

/** A model that answers by calling `make` for a quiz. */
function callingMake() {
  return new MockLanguageModelV4({
    doStream: {
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "make",
          input: JSON.stringify({ tool: "quiz", focus: "pricing" }),
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage: {
            inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 2, text: 2, reasoning: 0 },
          },
        },
      ]),
    },
  });
}

function ask(provider: string) {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Make me a quiz" }] }],
        mode: "sources",
        model: { provider, modelId: "test" },
        credentials: { apiKey: "test" },
        passages: [],
      }),
    }),
  );
}

beforeEach(() => {
  model = callingMake();
});

describe("POST /api/chat actions", () => {
  it("gives a tool-capable model add_cards and make, and hands the call to the page", async () => {
    const response = await ask("openai");
    const stream = await response.text();
    const call = model.doStreamCalls[0];
    const names = (call.tools ?? []).map((tool) => ("name" in tool ? tool.name : ""));
    expect(names).toEqual(expect.arrayContaining(["add_cards", "make"]));
    expect(stream).toContain('"type":"tool-input-available"');
    expect(stream).toContain('"toolName":"make"');
    // Declared without execute: the server never answers the call itself.
    expect(stream).not.toContain('"type":"tool-output-available"');
  });

  it("leaves local models to the / commands", async () => {
    await (await ask("ollama")).text();
    const call = model.doStreamCalls[0];
    expect(call.tools ?? []).toEqual([]);
    const system = call.prompt.find((message) => message.role === "system");
    expect(system?.content).toContain("/cards");
  });
});
