import { describe, expect, it } from "vitest";
import { pastedTitle } from "./pasted-title";

describe("pastedTitle", () => {
  it("takes the first sentence when it is short enough", () => {
    expect(pastedTitle("Chapter 1. The Mom Test. Talk about their life.")).toBe("Chapter 1. The Mom Test.");
  });

  it("cuts a long first line at a word, with an ellipsis", () => {
    const title = pastedTitle("Talk about their life instead of your idea and ask about specifics in the past instead");
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title).not.toMatch(/\s…$/);
    expect(title.slice(0, -1).split(" ").every((word) => word.length > 0)).toBe(true);
  });

  it("keeps a short line as it is", () => {
    expect(pastedTitle("My notes\nmore")).toBe("My notes");
  });
});
