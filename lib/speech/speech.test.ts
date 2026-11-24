import { describe, expect, it } from "vitest";
import { spokenText } from "./spoken-text";
import { voiceScore } from "./system-voice";

describe("spoken text", () => {
  it("drops Markdown marks, link addresses and citations", () => {
    expect(
      spokenText(
        "## The idea\n\n- **Customers** lie to be *nice* [1, 2].\n- See [the book](https://example.com).\n\n```js\nx()\n```",
      ),
    ).toBe("The idea\n\nCustomers lie to be nice.\nSee the book.");
  });

  it("keeps plain words and apostrophes as they are", () => {
    expect(spokenText("don't snake_case 3 * 4")).toBe("don't snake_case 3 * 4");
  });
});

describe("system voices", () => {
  const voice = (name: string) => ({ name, localService: true, default: false });

  it("never picks a novelty voice, and prefers premium ones", () => {
    expect(voiceScore(voice("Albert"))).toBeLessThan(0);
    expect(voiceScore(voice("Bad News"))).toBeLessThan(0);
    expect(voiceScore(voice("Eddy (English (US))"))).toBe(0);
    expect(voiceScore(voice("Samantha"))).toBeGreaterThan(0);
    expect(voiceScore(voice("Ava (Premium)"))).toBeGreaterThan(voiceScore(voice("Samantha")));
  });
});
