import { studyDocumentDraftSchema, type StudyDocumentRecovery, type StudyRecord } from "./records";

const prefix = "better-vault:document-draft:";

export function studyDocumentDraftId(
  target: { vaultId: string } | { bookId: string; section: number },
) {
  return "bookId" in target
    ? `document-draft:book:${target.bookId}:${target.section}`
    : `document-draft:vault:${target.vaultId}`;
}

export function canWriteStudyDocumentDraft(
  existing: StudyRecord | undefined,
  next: StudyDocumentRecovery,
  replaces?: string,
) {
  if (!existing) return replaces === undefined;
  if (
    existing.kind !== "document-draft" ||
    next.updatedAt < existing.updatedAt ||
    (next.updatedAt === existing.updatedAt && next.version !== existing.version)
  )
    return false;
  return replaces === undefined || existing.version === replaces;
}

export function readDocumentRecovery(id: string) {
  try {
    const saved = localStorage.getItem(prefix + id);
    if (saved) {
      const row = studyDocumentDraftSchema.safeParse(JSON.parse(saved)).data;
      if (row?.id === id) return row;
    }
  } catch {
    // The database remains available when the browser journal is full or disabled.
  }
}

export function journalDocumentRecovery(row: StudyDocumentRecovery) {
  try {
    if (canWriteStudyDocumentDraft(readDocumentRecovery(row.id), row)) {
      localStorage.setItem(prefix + row.id, JSON.stringify(row));
      return true;
    }
  } catch {
    // The database receives the same draft, including when it exceeds the journal quota.
  }
  return false;
}

export function clearDocumentRecovery(id: string, version?: string) {
  try {
    if (!version || readDocumentRecovery(id)?.version === version)
      localStorage.removeItem(prefix + id);
  } catch {
    // Browser storage can be disabled.
  }
}

export function clearDocumentRecoveries(scope = "") {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix + scope)) localStorage.removeItem(key);
    }
  } catch {
    // Browser storage can be disabled.
  }
}
