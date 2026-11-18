import { DEFAULT_VAULT } from "@/lib/db/vaults";
import { originHref, studyHighlightOrigin } from "@/lib/study/links";
import type { StudyRecord, StudyReport } from "@/lib/study/records";
import { studyReportKey, studyReports } from "@/lib/study/reports";
import { studyVaultIndex } from "@/lib/study/vault";

export type StudySearchLink = {
  type: Exclude<StudyRecord["kind"], "session" | "document-draft"> | "message" | "report";
  href: string;
  context?: string;
};

type StudySearchEntry = {
  id: string;
  kind: "study";
  title: string;
  text: string;
  vaultId: string;
  study: StudySearchLink;
};

function reportText(report: StudyReport) {
  return [
    ...report.corrections,
    ...report.nextSteps,
    ...(report.technicalFeedback ?? []).map(({ text }) => text),
    ...(report.languageFeedback ?? []).map(({ original, suggestion, reason }) =>
      [original, suggestion, reason].join(" "),
    ),
    ...(report.vocabulary ?? []).map(({ term, definition, translation, example, language }) =>
      [term, definition, translation, example, language].join(" "),
    ),
  ].join("\n");
}

export function studySearchEntries(
  input: Omit<Parameters<typeof studyVaultIndex>[0], "defaultVaultId">,
) {
  const { owner } = studyVaultIndex({ ...input, defaultVaultId: DEFAULT_VAULT });
  const books = new Map(
    input.rows.flatMap((row) => (row.kind === "book" ? [[row.id, row.title] as const] : [])),
  );
  const entries: StudySearchEntry[] = [];

  for (const row of input.rows) {
    if (row.kind === "session" || row.kind === "document-draft") continue;
    const vaultId = owner(row);
    const add = (study: StudySearchLink, title: string, text = "") => {
      if (!title.trim() && !text.trim()) return;
      entries.push({ id: `study:${study.href}`, kind: "study", title, text, vaultId, study });
    };
    switch (row.kind) {
      case "book":
        add({ type: "book", href: originHref({ kind: "book", bookId: row.id }) }, row.title);
        break;
      case "card":
        add(
          { type: "card", href: originHref({ kind: "card", cardId: row.id }) },
          row.front,
          [row.back, ...row.tags].join("\n"),
        );
        break;
      case "highlight":
        if (!books.has(row.bookId)) break;
        add(
          {
            type: "highlight",
            href: originHref(studyHighlightOrigin(row)),
            context: books.get(row.bookId),
          },
          row.quote,
          [row.note, row.cue].filter(Boolean).join("\n"),
        );
        break;
      case "word":
        add(
          { type: "word", href: originHref({ kind: "word", wordId: row.id }) },
          row.term,
          [
            row.translation,
            row.context,
            row.note,
            row.language,
            ...(row.examples ?? []).map(({ context }) => context),
          ].join("\n"),
        );
        break;
      case "thread": {
        add({ type: "thread", href: originHref({ kind: "tutor", threadId: row.id }) }, row.title);
        row.messages.forEach(({ text }, message) => {
          add(
            {
              type: "message",
              href: originHref({ kind: "tutor", threadId: row.id, message }),
              context: row.title,
            },
            "",
            text,
          );
        });
        const reportIds = new Set<string>();
        for (const report of studyReports(row)) {
          const reportId = studyReportKey(report);
          if (reportIds.has(reportId)) continue;
          reportIds.add(reportId);
          add(
            {
              type: "report",
              href: originHref({ kind: "report", threadId: row.id, reportId }),
              context: row.title,
            },
            report.summary,
            reportText(report),
          );
        }
        break;
      }
    }
  }
  return entries;
}
