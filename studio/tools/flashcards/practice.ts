import { z } from "zod";
import type { StudioOutput } from "@/lib/db/types";
import { flashcardsData } from "./definition";

const practiceSchema = z.object({
  revision: z.number().int().nonnegative(),
  order: z.array(z.number().int().nonnegative()),
  position: z.number().int().nonnegative(),
  flipped: z.boolean(),
  grades: z.record(z.string(), z.enum(["known", "missed"])),
});

export type FlashcardPractice = z.infer<typeof practiceSchema>;
export type FlashcardAction =
  | { kind: "flip" }
  | { kind: "move"; offset: -1 | 1 }
  | { kind: "grade"; grade: "known" | "missed" }
  | { kind: "restart"; mode: "all" | "shuffle" | "missed" | "unrated" };

const fullDeck = (size: number) => Array.from({ length: size }, (_, index) => index);

function newRound(order: number[], revision: number): FlashcardPractice {
  return { revision, order, position: 0, flipped: false, grades: {} };
}

export function readFlashcardPractice(size: number, saved: unknown): FlashcardPractice {
  const parsed = practiceSchema.safeParse(saved);
  if (parsed.success) {
    const { order, position, grades } = parsed.data;
    const positions = new Set(order.map(String));
    if (
      order.length === positions.size &&
      (size === 0 || order.length > 0) &&
      order.every((index) => index < size) &&
      position <= order.length &&
      Object.keys(grades).every((index) => positions.has(index))
    )
      return parsed.data;
  }
  return newRound(fullDeck(size), parsed.success ? parsed.data.revision : 0);
}

export function nextFlashcardPractice(
  size: number,
  practice: FlashcardPractice,
  action: FlashcardAction,
) {
  const { order, position, grades } = practice;
  const index = order[position];
  const revision = practice.revision + 1;
  switch (action.kind) {
    case "flip":
      if (index === undefined) return;
      return { ...practice, revision, flipped: !practice.flipped };
    case "move": {
      const next = position + action.offset;
      if (!Number.isInteger(next) || next < 0 || next > order.length) return;
      return { ...practice, revision, position: next, flipped: false };
    }
    case "grade":
      if (index === undefined) return;
      return {
        ...practice,
        revision,
        position: position + 1,
        flipped: false,
        grades: { ...grades, [index]: action.grade },
      };
    case "restart": {
      const next =
        action.mode === "missed"
          ? order.filter((index) => grades[index] === "missed")
          : action.mode === "unrated"
            ? order.filter((index) => grades[index] === undefined)
            : fullDeck(size);
      if (action.mode === "shuffle") {
        for (let i = next.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [next[i], next[j]] = [next[j], next[i]];
        }
      }
      if (next.length) return newRound(next, revision);
    }
  }
}

export function updatedFlashcardPractice(
  output: StudioOutput | undefined,
  revision: number,
  action: FlashcardAction,
) {
  if (output?.status !== "ready" || output.toolId !== "flashcards") return;
  const data = flashcardsData.safeParse(output.data);
  if (!data.success) return;
  const size = data.data.cards.length;
  const practice = readFlashcardPractice(size, output.flashcardPractice);
  if (practice.revision !== revision) return;
  return nextFlashcardPractice(size, practice, action);
}
