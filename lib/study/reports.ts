import type { StudyTutorSources } from "./passages";
import {
  studyTutorContextSchema,
  type StudyFollowUp,
  type StudyOrigin,
  type StudyRecordOf,
  type StudyReport,
  type StudyThread,
  type StudyThreadWrite,
  type StudyWord,
} from "./records";
import { vocabularyKey } from "./vocabulary";

export const studyReportKey = (report: StudyReport) => report.id ?? "legacy";

export function studyReports(thread: StudyThread): StudyReport[] {
  return thread.report
    ? [thread.report, ...(thread.pastReports ?? [])]
    : [...(thread.pastReports ?? [])];
}

export function studyFollowUpId({ threadId, reportId, index }: Omit<StudyFollowUp, "text">) {
  return `follow-up:${encodeURIComponent(threadId)}:${encodeURIComponent(reportId)}:${index}`;
}

export function captureReportPracticeContext(thread: StudyThread, sources: StudyTutorSources) {
  const context = studyTutorContextSchema.parse(thread);
  if (thread.scope === "cards") {
    const cardIds = sources.cards?.map(({ id }) => id) ?? [];
    return { ...context, cardIds, practiceCardId: cardIds[0] };
  }
  if (thread.scope === "notes" || thread.scope === "materials") {
    return {
      ...context,
      noteIds: sources.notes?.map(({ id }) => id),
      bookIds: sources.books?.map(({ id }) => id),
      sourceIds: sources.notebookSources?.map(({ id }) => id),
      highlightIds: sources.highlights?.map(({ highlight }) => highlight.id),
    };
  }
  return { ...context, section: context.section ?? sources.book?.section };
}

export function matchesStudyReport(
  origin: StudyOrigin | undefined,
  threadId: string | null,
  reportId: string,
) {
  return (
    origin?.kind === "report" &&
    origin.threadId === threadId &&
    (origin.reportId ?? "legacy") === reportId
  );
}

export function reportSuggestionId(
  kind: "card" | "word",
  threadId: string,
  report: StudyReport,
  key: string,
) {
  return `report-${kind}-${threadId}-${report.id ?? report.generatedAt ?? 0}-${key}`;
}

export function savedReportSuggestions({
  threadId,
  report,
  cards,
  words,
}: {
  threadId: string;
  report: StudyReport;
  cards: readonly StudyRecordOf<"card">[];
  words: readonly StudyWord[];
}) {
  const reportId = studyReportKey(report);
  const saved = new Map<string, StudyOrigin>();
  const reportCards = cards.filter(({ origin }) => matchesStudyReport(origin, threadId, reportId));
  for (const [index] of (report.languageFeedback ?? []).entries()) {
    const key = `language-${index}`;
    const id = reportSuggestionId("card", threadId, report, key);
    const card = reportCards.find(
      ({ id: cardId, origin }) =>
        cardId === id || (origin?.kind === "report" && origin.suggestion === key),
    );
    if (card) saved.set(key, { kind: "card", cardId: card.id });
  }

  for (const [index, suggestion] of (report.vocabulary ?? []).entries()) {
    const key = `word-${index}`;
    const id = reportSuggestionId("word", threadId, report, key);
    const term = vocabularyKey(suggestion);
    const word = words.find((word) =>
      [word, ...(word.examples ?? [])].some(
        ({ origin, context }) =>
          origin?.kind === "report" &&
          matchesStudyReport(origin, threadId, reportId) &&
          (origin.suggestion
            ? origin.suggestion === key
            : word.id === id ||
              (vocabularyKey(word) === term && context.trim() === suggestion.example.trim())),
      ),
    );
    if (word) saved.set(key, { kind: "word", wordId: word.id });
  }
  return saved;
}

export function patchedStudyThread(
  thread: StudyThread,
  write: StudyThreadWrite,
): StudyThread | undefined {
  const { report, change, append, updatedAt } = write;
  const draftChange = write.draft;
  let draft = thread.draft;
  if (
    draftChange?.kind === "save" &&
    (!draftChange.draft.speech || thread.keepVoiceTranscripts) &&
    draftChange.draft.at > (draft?.at ?? -Infinity)
  ) {
    draft = draftChange.draft;
  } else if (draftChange?.kind === "consume" && draft?.id === draftChange.id) {
    draft = { id: draft.id, text: "", at: draft.at };
  }
  const delivery = append.find((entry) => entry.role === "user")?.draftId;
  const alreadyDelivered = delivery && thread.messages.some((entry) => entry.draftId === delivery);
  const next = {
    ...thread,
    ...change,
    messages: alreadyDelivered ? thread.messages : [...thread.messages, ...append],
    ...(draft ? { draft } : {}),
    updatedAt:
      draftChange && !append.length && !report && !Object.keys(change).length
        ? thread.updatedAt
        : Math.max(thread.updatedAt, updatedAt),
  };
  if (!report) return next;
  const reports = studyReports(thread);
  if (report.kind === "save") {
    if (reports.some((entry) => studyReportKey(entry) === report.report.id)) return next;
    return {
      ...next,
      report: report.report,
      pastReports: reports,
      practiceLanguage:
        report.practiceLanguage === null
          ? undefined
          : (report.practiceLanguage ?? next.practiceLanguage),
    };
  }

  const position = reports.findIndex((entry) => studyReportKey(entry) === report.reportId);
  const entry = reports[position];
  if (!entry) return;
  if (report.kind === "feedback") {
    reports[position] = { ...entry, feedback: { ...entry.feedback, [report.key]: report.helpful } };
  } else {
    if (!Number.isSafeInteger(report.index) || !entry.nextSteps[report.index]?.trim()) return;
    const plannedSteps = { ...entry.plannedSteps };
    const previous = plannedSteps[report.index];
    switch (report.action) {
      case "plan":
        plannedSteps[report.index] = previous ?? { savedAt: updatedAt };
        break;
      case "remove":
        delete plannedSteps[report.index];
        break;
      case "complete":
        if (previous && previous.completedAt === undefined)
          plannedSteps[report.index] = { ...previous, completedAt: updatedAt };
        break;
      case "reopen":
        if (previous) plannedSteps[report.index] = { savedAt: previous.savedAt };
        break;
    }
    reports[position] = { ...entry, plannedSteps };
  }
  const [latest, ...pastReports] = reports;
  return { ...next, report: latest, pastReports };
}

export function plannedStudySteps(threads: StudyThread[]) {
  return threads
    .flatMap((thread) =>
      studyReports(thread).flatMap((report) => {
        const reportId = studyReportKey(report);
        return report.nextSteps.flatMap((text, index) => {
          const state = report.plannedSteps?.[index];
          return state && text.trim()
            ? [{ ...state, text, index, reportId, threadId: thread.id, title: thread.title }]
            : [];
        });
      }),
    )
    .sort((a, b) => a.savedAt - b.savedAt);
}
