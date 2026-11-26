import { describe, expect, it } from "vitest";
import { firstScreen } from "./visibility";

const base = { welcomed: true, upgradeNoticeSeen: false, notebookCount: 2 };

describe("firstScreen", () => {
  it("shows the upgrade notice to someone who already used the app", () => {
    expect(firstScreen(base)).toBe("upgrade");
  });
  it("never repeats it once dismissed", () => {
    expect(firstScreen({ ...base, upgradeNoticeSeen: true })).toBe("none");
  });
  it("leaves a newcomer to the welcome screens", () => {
    expect(firstScreen({ ...base, welcomed: false })).toBe("none");
    expect(firstScreen({ ...base, notebookCount: 0 })).toBe("none");
  });
});
