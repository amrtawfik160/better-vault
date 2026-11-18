import { z } from "zod";
import { passageRefSchema } from "@/lib/grounding/passage-schema";
import { amounts, difficulties } from "@/studio/tools/flashcards/definition";
import { defineTool, textBlob } from "@/studio/types";

export const quizOptions = z.object({
  amount: z.enum(amounts),
  difficulty: z.enum(difficulties),
});

export const quizQuestion = z.object({
  question: z.string(),
  options: z.array(z.string()),
  /** Index of the right option. */
  answer: z.number().int(),
  explanation: z.string(),
  hint: z.string(),
  sources: z.array(passageRefSchema).optional(),
});

export const quizData = z.object({ questions: z.array(quizQuestion) });

export type QuizOptions = z.infer<typeof quizOptions>;
export type QuizQuestion = z.infer<typeof quizQuestion>;
export type QuizData = z.infer<typeof quizData>;

export const quizCounts = { fewer: 5, standard: 10, more: 20 } as const;

const LETTERS = "ABCDEFGH";

function markdownListItem(marker: string, label: string, content: string) {
  if (!content.includes("\n")) return `${marker} ${label} ${content}`.trimEnd();
  const indent = " ".repeat(marker.length + 1);
  const body = content.split("\n").map((line) => (line ? `${indent}${line}` : ""));
  return [`${marker} ${label}`, "", ...body].join("\n");
}

export const quizTool = defineTool({
  id: "quiz",
  options: quizOptions,
  defaults: { amount: "standard", difficulty: "medium" } satisfies QuizOptions,
  data: quizData,
  exports: [
    {
      format: "docx",
      build: async (title, data, text) => {
        const { HeadingLevel, isRightToLeft, Paragraph, TextRun, wordDocument } =
          await import("@/studio/exports/docx");
        const rtl = isRightToLeft(data.questions.map((q) => q.question).join(" "));
        const lines = (value: string, bold = false) =>
          value
            .split("\n")
            .map(
              (line, index) =>
                new TextRun({ text: line, bold, break: index === 0 ? undefined : 1 }),
            );
        const questions = data.questions.flatMap((q, at) => [
          new Paragraph({
            bidirectional: rtl,
            spacing: { before: 240 },
            children: lines(`${at + 1}. ${q.question}`, true),
          }),
          ...q.options.map(
            (option, i) =>
              new Paragraph({
                bidirectional: rtl,
                indent: { start: 360 },
                children: lines(`${LETTERS[i]}. ${option}`),
              }),
          ),
        ]);
        const key = [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            pageBreakBefore: true,
            bidirectional: rtl,
            children: [new TextRun(text.answerKey)],
          }),
          ...data.questions.flatMap((q, at) => [
            new Paragraph({
              bidirectional: rtl,
              children: lines(
                `${at + 1}. ${LETTERS[q.answer]}. ${q.options[q.answer] ?? ""}`,
                true,
              ),
            }),
            new Paragraph({
              bidirectional: rtl,
              indent: { start: 360 },
              children: lines(q.explanation),
            }),
          ]),
        ];
        return wordDocument({ title, rtl, children: [...questions, ...key] });
      },
    },
    {
      format: "md",
      build: async (title, data, text) =>
        textBlob(
          [
            `# ${title}`,
            ...data.questions.map((q, at) =>
              [
                q.question.includes("\n")
                  ? `## ${at + 1}\n\n${q.question}`
                  : `## ${at + 1}. ${q.question}`,
                q.options
                  .map((option, i) => markdownListItem("-", `${LETTERS[i]}.`, option))
                  .join("\n"),
              ].join("\n\n"),
            ),
            `## ${text.answerKey}`,
            ...data.questions.map((q, at) =>
              markdownListItem(`${at + 1}.`, `**${LETTERS[q.answer]}.**`, q.explanation),
            ),
          ].join("\n\n"),
          "text/markdown",
        ),
    },
  ],
});
