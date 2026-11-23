import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { checkStudyVisual, generateStudyVisual, StudyVisualError } from "./study-visual";

type Call = { toolName: string; input: unknown } | null;

function answering(...replies: Call[]) {
  const prompts: string[] = [];
  const choices: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const reply = replies[Math.min(prompts.length, replies.length - 1)];
      prompts.push(JSON.stringify(options.prompt));
      choices.push(options.toolChoice);
      return {
        content: reply
          ? [
              {
                type: "tool-call",
                toolCallId: `call-${prompts.length}`,
                toolName: reply.toolName,
                input: JSON.stringify(reply.input),
              },
            ]
          : [{ type: "text", text: "Here is my explanation instead." }],
        finishReason: { unified: reply ? "tool-calls" : "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts, choices };
}

const flowchart = { title: "Elections", mermaid: "flowchart TD\n  A[Timeout] --> B[Vote]" };
const broken = { title: "Elections", mermaid: "flowchart TD\n  A[Timeout --> (((" };
const steps = {
  title: "Elections",
  steps: [{ title: "A follower times out" }, { title: "It asks for votes" }],
};
const ask = { system: "Tutor", prompt: '{"request":"Raft elections"}' };

describe("generateStudyVisual", () => {
  it("returns the kind the model chose", async () => {
    const { model, choices } = answering({ toolName: "show_steps", input: steps });
    expect(await generateStudyVisual({ ...ask, model })).toEqual({ kind: "steps", data: steps });
    expect(choices).toEqual([{ type: "required" }]);
  });

  it("asks for a fixed diagram when Pele cannot draw the Mermaid", async () => {
    const { model, prompts, choices } = answering(
      { toolName: "show_diagram", input: broken },
      { toolName: "show_diagram", input: { ...flowchart, mermaid: `\`\`\`mermaid\n${flowchart.mermaid}\n\`\`\`` } },
    );
    expect(await generateStudyVisual({ ...ask, model })).toEqual({
      kind: "diagram",
      data: flowchart,
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("could not be drawn");
    expect(prompts[1]).toContain("A[Timeout --> (((");
    expect(choices[1]).toEqual({ type: "tool", toolName: "show_diagram" });
  });

  it("gives up after two repairs with a clear error", async () => {
    const { model, prompts } = answering({ toolName: "show_diagram", input: broken });
    const failure = generateStudyVisual({ ...ask, model });
    await expect(failure).rejects.toBeInstanceOf(StudyVisualError);
    await expect(failure).rejects.toThrow(/could not draw a visual/);
    expect(prompts).toHaveLength(3);
  });

  it("asks again when the model answers without a visual", async () => {
    const { model, prompts } = answering(null, { toolName: "show_steps", input: steps });
    expect((await generateStudyVisual({ ...ask, model })).kind).toBe("steps");
    expect(prompts).toHaveLength(2);
  });
});

describe("checkStudyVisual", () => {
  it("rejects kinds that are not explanations and input outside the schema", () => {
    expect(checkStudyVisual("show_flashcards", { title: "Cards", cards: [] })).toHaveProperty(
      "problem",
    );
    expect(checkStudyVisual("show_steps", { title: "One", steps: [{ title: "Only" }] })).toEqual({
      problem: expect.stringContaining("did not match its schema"),
    });
  });
});
