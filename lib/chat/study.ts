import { getToolName, isToolUIPart } from "ai";
import { stripCitations } from "@/lib/grounding/passages";
import type { ChatMessage } from "./types";
import { visualSchemas, visualToolName } from "./visuals";

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
