import { describe, expect, it } from "vitest";
import { firstScreen } from "./visibility";

const base = { onboardingDone: false, upgradeNoticeSeen: false, notebookCount: 0, hasModel: false };

describe("firstScreen", () => {
  it("shows onboarding to a newcomer", () => {
    expect(firstScreen(base)).toBe("onboarding");
  });
  it("shows it once", () => {
    expect(firstScreen({ ...base, onboardingDone: true })).toBe("none");
  });
  it("shows the upgrade notice to people with notebooks or a model", () => {
    expect(firstScreen({ ...base, notebookCount: 2 })).toBe("upgrade");
    expect(firstScreen({ ...base, hasModel: true })).toBe("upgrade");
  });
  it("never repeats the notice once dismissed", () => {
    expect(firstScreen({ ...base, notebookCount: 2, upgradeNoticeSeen: true })).toBe("none");
  });
  it("does not show the notice to a newcomer who finished onboarding", () => {
    expect(firstScreen({ ...base, onboardingDone: true, upgradeNoticeSeen: true })).toBe("none");
  });
});
