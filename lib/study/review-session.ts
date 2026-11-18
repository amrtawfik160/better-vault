import { z } from "zod";
import { routes } from "@/lib/routes";

const snapshotSchema = z.object({
  revealed: z.string(),
  rated: z.number().int().nonnegative(),
  practiced: z.array(z.string()).nullable(),
});
const savedSessions = z.array(z.tuple([z.string(), snapshotSchema]));
const storageKey = "better-vault:study-review-sessions";
export type ReviewSnapshot = z.infer<typeof snapshotSchema>;

const selectionSchema = z.object({
  studyReviewSession: z.string().min(1).max(80).optional(),
  studyReviewIds: z.array(z.string()).optional(),
  studyReviewVault: z.string().optional(),
});
const returnSchema = z.object({
  studyReturn: z.object({
    path: z.string(),
    state: selectionSchema.extend({ studyReviewSession: z.string().min(1).max(80) }),
  }),
});

export function reviewSelection(state: unknown) {
  const parsed = selectionSchema.safeParse(state);
  return parsed.success ? parsed.data : undefined;
}

export function reviewReturnState(state: unknown) {
  const parsed = returnSchema.safeParse(state);
  if (!parsed.success) return;
  const [path, query] = parsed.data.studyReturn.path.split("?", 2);
  const params = new URLSearchParams(query);
  if (path === routes.home && params.get("view") === "study" && params.get("tab") === "review")
    return parsed.data;
}

function readSessions(): z.infer<typeof savedSessions> {
  try {
    const parsed = savedSessions.safeParse(JSON.parse(sessionStorage.getItem(storageKey) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function loadReviewSession(key: string) {
  return readSessions().find(([id]) => id === key)?.[1];
}

export function saveReviewSession(key: string, snapshot: ReviewSnapshot) {
  try {
    const recent = readSessions()
      .filter(([id]) => id !== key)
      .slice(0, 11);
    sessionStorage.setItem(storageKey, JSON.stringify([[key, snapshot], ...recent]));
  } catch {
    // Review grades are in the database even when this tab cannot retain its UI.
  }
}
