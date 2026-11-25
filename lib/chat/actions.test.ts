import { describe, expect, it } from "vitest";
import { chatSystemPrompt } from "@/lib/ai/prompts";
import { chatActionSchemas, isChatActionPart, parseSlash } from "./actions";

describe("parseSlash", () => {
  it("reads a command and the focus typed after it", () => {
    expect(parseSlash("/quiz the second chapter")).toMatchObject({
      command: { id: "quiz", action: "make", tool: "quiz" },
      focus: "the second chapter",
    });
    expect(parseSlash("  /cards ")).toMatchObject({ command: { id: "cards" }, focus: "" });
  });

  it("answers to short names", () => {
    expect(parseSlash("/flashcards")?.command.id).toBe("cards");
    expect(parseSlash("/MINDMAP")?.command.id).toBe("mind-map");
    expect(parseSlash("/podcast about pricing")).toMatchObject({
      command: { id: "audio-overview" },
      focus: "about pricing",
    });
  });

  it("leaves questions and unknown commands to the chat", () => {
    expect(parseSlash("make a quiz")).toBeNull();
    expect(parseSlash("/whiteboard")).toBeNull();
    expect(parseSlash("/ quiz")).toBeNull();
    expect(parseSlash("and/or")).toBeNull();
  });
});

describe("chat action schemas", () => {
  it("accepts cards the model wrote and a Studio tool the chat can start", () => {
    expect(
      chatActionSchemas.add_cards.safeParse({
        cards: [{ front: "What do users lie about?", back: "The future.", sources: [2] }],
      }).success,
    ).toBe(true);
    expect(chatActionSchemas.make.safeParse({ tool: "mind-map" }).success).toBe(true);
    expect(chatActionSchemas.make.safeParse({ tool: "whiteboard" }).success).toBe(false);
  });

  it("finds action parts among an answer's parts", () => {
    const part = { type: "tool-make", toolCallId: "c1", state: "input-available", input: {} };
    expect(isChatActionPart(part as never)).toBe(true);
    expect(isChatActionPart({ type: "tool-show_chart", toolCallId: "c2" } as never)).toBe(false);
    expect(isChatActionPart({ type: "text", text: "Hi" })).toBe(false);
  });
});

describe("chat prompt", () => {
  it("names the tools when the model has them, and the / commands when it does not", () => {
    expect(chatSystemPrompt("sources", [], { actions: true })).toContain("call add_cards");
    const local = chatSystemPrompt("sources", []);
    expect(local).toContain("/cards");
    expect(local).not.toContain("call add_cards");
  });
});
