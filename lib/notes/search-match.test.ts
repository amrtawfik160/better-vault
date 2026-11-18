import { describe, expect, it } from "vitest";
import { locateNoteMatch } from "./search-match";

describe("note search selection", () => {
  it("keeps the nearest occurrence if intervening edits move the quote", () => {
    const old = "Quorum evidence is carried over. A second round verifies the quorum.";
    const quote = "quorum";
    const match = { offset: old.indexOf(quote), quote };
    const edited = `quorum assumptions. ${old}`;
    expect(locateNoteMatch(old, match)).toBe(match.offset);
    expect(locateNoteMatch(edited, match)).toBe(edited.lastIndexOf(quote));
  });

  it("leaves the note unselected if the quote disappeared", () => {
    expect(locateNoteMatch("Rewritten notes.", { offset: 5, quote: "previous phrase" })).toBeUndefined();
  });
});
