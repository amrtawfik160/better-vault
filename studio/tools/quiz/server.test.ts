import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { seededRandom } from "@/studio/server/shared";
import { generateQuiz, shuffleOptions } from "./server";

describe("generateQuiz", () => {
  it("preserves equations and code and grades by the original option index", async () => {
    const snippet = "```ts\nif (ready) {\n  run();\n}\n```";
    const question = `What happens when $x > 0$?\n\n${snippet}`;
    const correct = "$f(x) = 1$";
    const explanation = `It runs once.\n\n${snippet}`;
    const hint = "Check the boundary.\n\n$$\nx = 0\n$$";
    const valid = {
      question,
      options: [" ", correct, snippet, "$f(x) = 0$"],
      answer: 1,
      explanation,
      hint,
      citations: [],
    };
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              title: "Conditions",
              questions: [valid, { ...valid, answer: 0 }, { ...valid, answer: 4 }],
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    const { data } = await generateQuiz({
      model,
      options: { amount: "fewer", difficulty: "medium" },
      language: "auto",
      focus: "",
      passages: [],
    });
    expect(data.questions).toHaveLength(1);
    const [result] = data.questions;
    expect(result).toMatchObject({ question, explanation, hint });
    expect(result.options).toHaveLength(3);
    expect(result.options).toContain(snippet);
    expect(result.options[result.answer]).toBe(correct);
  });
});

describe("shuffleOptions", () => {
  it("keeps the right answer pointing at the same text", () => {
    const random = seededRandom("seed");
    for (let i = 0; i < 20; i++) {
      const shuffled = shuffleOptions(
        { question: "q", options: ["right", "a", "b", "c"], answer: 0, explanation: "", hint: "" },
        random,
      );
      expect(shuffled.options[shuffled.answer]).toBe("right");
      expect([...shuffled.options].sort()).toEqual(["a", "b", "c", "right"]);
    }
  });

  it("does not always leave the answer first", () => {
    const random = seededRandom("spread");
    const places = new Set(
      Array.from(
        { length: 30 },
        () =>
          shuffleOptions(
            { question: "q", options: ["r", "a", "b", "c"], answer: 0, explanation: "", hint: "" },
            random,
          ).answer,
      ),
    );
    expect(places.size).toBeGreaterThan(1);
  });
});
