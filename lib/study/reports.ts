import type { StudyOrigin, StudyReport, StudyThread, StudyThreadWrite } from "./records";

export const studyReportKey = (report: StudyReport) => report.id ?? "legacy";

export function studyReports(thread: StudyThread): StudyReport[] {
  return thread.report
    ? [thread.report, ...(thread.pastReports ?? [])]
    : [...(thread.pastReports ?? [])];
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

export function patchedStudyThread(
  thread: StudyThread,
  write: StudyThreadWrite,
): StudyThread | undefined {
  const { report, change, append, updatedAt } = write;
  const next = {
    ...thread,
    ...change,
    messages: [...thread.messages, ...append],
    updatedAt: Math.max(thread.updatedAt, updatedAt),
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
