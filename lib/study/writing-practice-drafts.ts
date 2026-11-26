import { z } from "zod";
import { maxPracticeAnswer, maxPracticeLearned, maxPracticeScenario, studyPracticeAudiences, studyPracticeQuestionTypes } from "./records";

/**
 * What the learner is typing in Practice, kept in this browser so nothing is
 * lost on navigation or reload: answer drafts per question, and the setup
 * form (most of all the "what I learned" text) per vault.
 */
const answerPrefix = "better-vault:practice-answer:";
const setupPrefix = "better-vault:practice-setup:";

function read(key: string) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as unknown) : undefined;
  } catch {
    return undefined;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser storage can be disabled; the draft then lives only on this page.
  }
}

const answerDraft = z.object({ text: z.string().max(maxPracticeAnswer), choice: z.number().int().nonnegative().optional() });
export type PracticeAnswerDraft = z.infer<typeof answerDraft>;
const answerKey = (sessionId: string, questionId: string) => `${answerPrefix}${sessionId}:${questionId}`;

export function readPracticeAnswerDraft(sessionId: string, questionId: string): PracticeAnswerDraft | undefined {
  return answerDraft.safeParse(read(answerKey(sessionId, questionId))).data;
}
export function savePracticeAnswerDraft(sessionId: string, questionId: string, draft: PracticeAnswerDraft) {
  write(answerKey(sessionId, questionId), draft.text.trim() || draft.choice !== undefined ? draft : undefined);
}
export function clearPracticeAnswerDraft(sessionId: string, questionId: string) {
  write(answerKey(sessionId, questionId), undefined);
}

const setupDraft = z.object({
  source: z.enum(["learned", "book", "highlights", "notes", "cards"]),
  learned: z.string().max(maxPracticeLearned),
  bookId: z.string().optional(),
  section: z.number().int().nonnegative().optional(),
  sectionEnd: z.number().int().nonnegative().optional(),
  ids: z.array(z.string()),
  audience: z.enum(studyPracticeAudiences),
  scenario: z.string().max(maxPracticeScenario),
  types: z.array(z.enum(studyPracticeQuestionTypes)).min(1),
  count: z.number().int().min(1).max(10),
});
export type PracticeSetupDraft = z.infer<typeof setupDraft>;

export function readPracticeSetupDraft(vaultId: string): PracticeSetupDraft | undefined {
  return setupDraft.safeParse(read(setupPrefix + vaultId)).data;
}
export function savePracticeSetupDraft(vaultId: string, draft: PracticeSetupDraft | undefined) {
  write(setupPrefix + vaultId, draft);
}

function clearWhere(matches: (key: string) => boolean) {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key && matches(key)) localStorage.removeItem(key);
    }
  } catch {
    // Browser storage can be disabled.
  }
}

export function clearPracticeSessionDrafts(sessionId: string) {
  clearWhere((key) => key.startsWith(`${answerPrefix}${sessionId}:`));
}

export function clearAllPracticeDrafts() {
  clearWhere((key) => key.startsWith(answerPrefix) || key.startsWith(setupPrefix));
}
