export type FirstScreen = "onboarding" | "upgrade" | "none";

export interface FirstScreenInput {
  onboardingDone: boolean;
  upgradeNoticeSeen: boolean;
  notebookCount: number;
  hasModel: boolean;
}

/**
 * What the home page shows once on first look. Someone with notebooks or a
 * model already uses the app, so they get the one-time upgrade notice and
 * never the first-run flow; a newcomer gets the flow and never the notice.
 */
export function firstScreen(input: FirstScreenInput): FirstScreen {
  const existing = input.notebookCount > 0 || input.hasModel;
  if (existing) return input.upgradeNoticeSeen ? "none" : "upgrade";
  if (input.onboardingDone) return "none";
  return "onboarding";
}
