export type FirstScreen = "upgrade" | "none";

export interface FirstScreenInput {
  /** The welcome screens (components/onboarding/onboarding.tsx) were finished before this visit. */
  welcomed: boolean;
  upgradeNoticeSeen: boolean;
  notebookCount: number;
}

/**
 * What the home page shows once, on top of the welcome screens: someone who
 * already used the app gets the one-time note about the redesign. A newcomer
 * is still in (or just finished) the welcome screens and never sees it.
 */
export function firstScreen(input: FirstScreenInput): FirstScreen {
  if (!input.welcomed || input.upgradeNoticeSeen) return "none";
  return input.notebookCount > 0 ? "upgrade" : "none";
}
