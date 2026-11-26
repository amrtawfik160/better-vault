import { describe, expect, it } from "vitest";
import { noteMarkdown } from "./markdown";

describe("note reading positions", () => {
  it("maps visible links and nearby text to the original note after rewrites", () => {
    const prefix = "---\naliases: [Timing]\n---\n";
    const body = "Earlier %%private%% and #timing. See [[Election#Notes|the proof]] and ==the bound==.";
    const projection = noteMarkdown(body, prefix.length);
    const original = prefix + body;
    const sourceFor = (text: string) => {
      const start = projection.text.indexOf(text);
      expect(start).toBeGreaterThanOrEqual(0);
      const { from, to } = projection.sourceRange(start, start + text.length);
      return original.slice(from, to);
    };
    expect(sourceFor("#timing")).toBe("#timing");
    expect(sourceFor("the proof")).toBe("[[Election#Notes|the proof]]");
    expect(sourceFor("the bound")).toBe("==the bound==");
    expect(sourceFor(" and [the bound]")).toBe(" and ==the bound==");
  });

  it("keeps code examples and repeated wording at their own positions", () => {
    const body = "Replica overlap. %%observation%% Replica overlap. `[[not a link]] #tag`";
    const projection = noteMarkdown(body);
    expect(projection.text).toContain("`[[not a link]] #tag`");
    const wording = "Replica overlap.";
    const start = projection.text.lastIndexOf(wording);
    expect(projection.sourceRange(start, start + wording.length)).toEqual({
      from: body.lastIndexOf(wording),
      to: body.lastIndexOf(wording) + wording.length,
    });
  });
});
