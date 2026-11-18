import { getToolName, isToolUIPart } from "ai";
import { citedNumbers, stripCitations } from "@/lib/grounding/passages";
import { passageRefSchema } from "@/lib/grounding/passage-schema";
import type { StudyOrigin } from "@/lib/study/records";
import type { ChatMessage } from "./types";
import { visualSchemas, visualToolName } from "./visuals";

export function notebookAnswerEvidence(message: ChatMessage, notebookId: string): StudyOrigin[] {
  const cited = new Set(
    message.parts.flatMap((part) => (part.type === "text" ? citedNumbers(part.text) : [])),
  );
  const passages = passageRefSchema.array().safeParse(message.metadata?.passages);
  return passages.success
    ? passages.data.flatMap(({ n, chunkId, sourceId, snippet }) =>
        cited.has(n) ? [{ kind: "source", notebookId, chunkId, sourceId, snippet }] : [],
      )
    : [];
}

export function answerFlashcardMaterial(message: ChatMessage) {
  const text = stripCitations(
    message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n"),
  ).trim();
  const cards = message.parts.flatMap((part) => {
    if (
      !isToolUIPart(part) ||
      part.state !== "output-available" ||
      getToolName(part) !== visualToolName("flashcards")
    )
      return [];
    if (
      part.output &&
      typeof part.output === "object" &&
      "ok" in part.output &&
      part.output.ok === false
    )
      return [];
    const parsed = visualSchemas.flashcards.safeParse(part.input);
    return parsed.success ? parsed.data.cards : [];
  });
  const unique = new Map<string, (typeof cards)[number]>();
  for (const { front, back } of cards) {
    const question = front.trim();
    const answer = back.trim();
    const key = question.toLocaleLowerCase();
    if (question && answer && !unique.has(key)) unique.set(key, { front: question, back: answer });
  }
  return { text, cards: [...unique.values()] };
}
