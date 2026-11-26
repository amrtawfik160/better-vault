import { studyTutorDraftSchema, type StudyTutorDraft } from "./records";

const prefix = "better-vault:study-draft:";

export function readTutorDraftRecovery(threadId: string) {
  try {
    const saved = localStorage.getItem(prefix + threadId);
    if (saved) return studyTutorDraftSchema.safeParse(JSON.parse(saved)).data;
  } catch {
    // The conversation database still receives the normal save.
  }
}

export function recordTutorDraftRecovery(threadId: string, draft: StudyTutorDraft) {
  try {
    if (draft.at >= (readTutorDraftRecovery(threadId)?.at ?? -Infinity))
      localStorage.setItem(prefix + threadId, JSON.stringify(draft));
  } catch {
    // The conversation database still receives the normal save.
  }
}

export function clearTutorDraftRecovery(threadId: string, draftId?: string) {
  try {
    if (!draftId || readTutorDraftRecovery(threadId)?.id === draftId)
      localStorage.removeItem(prefix + threadId);
  } catch {
    // Browser storage can be disabled.
  }
}

export function clearAllTutorDraftRecovery() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    // Browser storage can be disabled.
  }
}
