import { z } from "zod";
import { originHref } from "./links";
import { studyCitationSchema, studyOriginSchema } from "./records";

const draftCard = z.object({
  front: z.string(),
  back: z.string(),
  citations: z.array(studyCitationSchema).optional(),
});
const material = z.object({
  text: z.string(),
  origin: studyOriginSchema,
  evidence: z.array(studyOriginSchema).optional(),
  passages: z.array(z.object({
    title: z.string(),
    text: z.string(),
    origin: studyOriginSchema,
    image: z.string().optional(),
    previousCitations: z.array(z.number()).optional(),
  })).optional(),
});
const sourceSchema = material.extend({
  title: z.string(),
  notebookId: z.string().optional(),
  tags: z.array(z.string()),
  cards: z.array(draftCard).optional(),
  parts: z.array(z.object({
    heading: z.string().optional(),
    preview: z.string().optional(),
    material,
  })).optional(),
});
const draftStateSchema = z.object({
  freeText: z.string(),
  part: z.number().int().nonnegative(),
  count: z.number().int().min(1).max(20),
  batches: z.array(z.object({
    part: z.number().int().nonnegative(),
    origin: studyOriginSchema.optional(),
    drafts: z.array(draftCard.extend({ id: z.string() })),
    excerpts: z.array(z.string()),
  })),
});
const recoverySchema = z.object({
  key: z.string(),
  vaultId: z.string(),
  version: z.string(),
  updatedAt: z.number(),
  source: sourceSchema.optional(),
  editor: draftStateSchema,
});

type FlashcardMaterial = z.infer<typeof material>;
export type FlashcardSource = Omit<z.infer<typeof sourceSchema>, "parts"> & {
  parts?: { heading?: string; preview?: string; load: () => FlashcardMaterial }[];
};
export type FlashcardDraftState = z.infer<typeof draftStateSchema>;
export type FlashcardDraftRecovery = z.infer<typeof recoverySchema>;

const prefix = "better-vault:flashcard-draft:";
const changeEvent = "better-vault:flashcard-drafts-changed";

export function flashcardDraftKey(vaultId: string, source?: FlashcardSource) {
  const origin = source?.origin;
  return prefix + JSON.stringify([
    vaultId,
    origin ? originHref(origin) : "text",
    Boolean(source?.cards?.length),
    origin?.kind === "note" && origin.passage
      ? [origin.passage.offset, origin.passage.quote.length]
      : undefined,
  ]);
}

export function snapshotFlashcardSource(source: FlashcardSource): FlashcardDraftRecovery["source"] {
  return {
    ...source,
    parts: source.parts?.map(({ heading, preview, load }) => ({ heading, preview, material: load() })),
  };
}

export function restoreFlashcardSource(source: FlashcardDraftRecovery["source"]): FlashcardSource | undefined {
  return source && {
    ...source,
    parts: source.parts?.map(({ heading, preview, material }) => ({ heading, preview, load: () => material })),
  };
}

export function readFlashcardDraft(key: string) {
  try {
    const value = localStorage.getItem(key);
    const saved = value && recoverySchema.safeParse(JSON.parse(value)).data;
    if (saved && saved.key === key) return saved;
  } catch {
    // An unavailable journal does not prevent studying or saving cards.
  }
}

export function writeFlashcardDraft(draft: Omit<FlashcardDraftRecovery, "updatedAt">, replaces?: string) {
  try {
    const stored = readFlashcardDraft(draft.key);
    if (stored?.version !== replaces) return false;
    localStorage.setItem(draft.key, JSON.stringify({ ...draft, updatedAt: Date.now() }));
    if (!stored) window.dispatchEvent(new Event(changeEvent));
    return true;
  } catch {
    return false;
  }
}

export function clearFlashcardDraft(key: string, version: string) {
  try {
    if (readFlashcardDraft(key)?.version !== version) return;
    localStorage.removeItem(key);
    window.dispatchEvent(new Event(changeEvent));
  } catch {
    // The database keeps saved cards even when the draft journal is unavailable.
  }
}

export function flashcardDrafts(vaultId?: string) {
  try {
    const result: FlashcardDraftRecovery[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const draft = readFlashcardDraft(key);
      if (draft && (vaultId === undefined || draft.vaultId === vaultId)) result.push(draft);
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function clearFlashcardDrafts(vaultId?: string) {
  if (vaultId === undefined) {
    try {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (key?.startsWith(prefix)) localStorage.removeItem(key);
      }
      window.dispatchEvent(new Event(changeEvent));
    } catch {
      // Browser storage can be disabled.
    }
    return;
  }
  for (const draft of flashcardDrafts(vaultId)) clearFlashcardDraft(draft.key, draft.version);
}

export function clearFlashcardDraftsFrom(matches: (source: NonNullable<FlashcardDraftRecovery["source"]>) => boolean) {
  for (const draft of flashcardDrafts()) {
    if (draft.source && matches(draft.source)) clearFlashcardDraft(draft.key, draft.version);
  }
}

export function subscribeFlashcardDrafts(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (!event.key || (event.key.startsWith(prefix) && (!event.newValue || !event.oldValue))) listener();
  };
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", storage);
  };
}
