import { getToolName, isToolUIPart } from "ai";
import { z } from "zod";
import type { StudioToolId } from "@/studio/tools";
import type { ChatMessage } from "./types";

/**
 * What the notebook's chat can make when asked: flashcards for the study deck
 * (`add_cards`) and Studio outputs (`make`). The server only declares the
 * tools; the page runs them on the user's data and shows a result row with
 * Open and Undo. The same actions run from the prompt's "/" menu, so models
 * that can't call tools make the same things.
 */

/** Studio tools the chat can start. Flashcards go to the study deck instead. */
export const chatMakeTools = [
  "report",
  "quiz",
  "mind-map",
  "data-table",
  "slide-deck",
  "anatomy",
  "infographic",
  "audio-overview",
] as const satisfies readonly StudioToolId[];

export type ChatMakeTool = (typeof chatMakeTools)[number];

/** Slow or paid: they wait for the user's OK in the thread. */
export const confirmedMakeTools = new Set<ChatMakeTool>(["infographic", "audio-overview"]);

export const ADD_CARDS = "add_cards";
export const MAKE = "make";
export type ChatActionName = typeof ADD_CARDS | typeof MAKE;

export const chatActionSchemas = {
  [ADD_CARDS]: z.object({
    cards: z
      .array(
        z.object({
          front: z.string().min(1).max(1000).describe("A question that stands on its own"),
          back: z.string().min(1).max(2000).describe("A short answer, with the reason"),
          sources: z
            .array(z.number().int().positive())
            .max(3)
            .optional()
            .describe("The numbers of the passages the card comes from"),
        }),
      )
      .max(40),
  }),
  [MAKE]: z.object({
    tool: z.enum(chatMakeTools),
    focus: z
      .string()
      .max(2000)
      .optional()
      .describe("What it should cover or stress, in the user's words; empty for everything"),
  }),
} as const;

export type AddCardsInput = z.infer<(typeof chatActionSchemas)[typeof ADD_CARDS]>;
export type MakeInput = z.infer<(typeof chatActionSchemas)[typeof MAKE]>;

export const chatActionDescriptions: Record<ChatActionName, string> = {
  [ADD_CARDS]:
    "Add flashcards to the notebook's study deck when the user asks for flashcards or cards. Write the cards yourself from the passages (or from the conversation when it is about them), one idea per card, and give each the passage numbers it comes from. The page saves them and shows the result with Open and Undo, so do not list the cards in your answer.",
  [MAKE]:
    "Make a Studio output from the notebook's selected sources when the user asks for one: a report, a quiz, a mind map, a data table, a slide deck, an anatomy figure, an infographic or an audio overview. Studio writes it; do not write its content yourself. The page shows the result with Open and Undo. Infographics and audio overviews wait for the user's OK, because they are slow and paid.",
};

/** What a finished action left: what it made, or why it made nothing. */
export type AddCardsOutput =
  { added: number; cardIds: string[]; undone?: boolean } | { error: string };
export type MakeOutput =
  | { outputId: string; tool: ChatMakeTool; undone?: boolean }
  /** Its options were opened instead (an audio overview's voices are chosen there). */
  | { dialog: true; tool: ChatMakeTool }
  | { cancelled: true }
  | { error: string };
export type ChatActionOutput = AddCardsOutput | MakeOutput;

export function isChatAction(name: string): name is ChatActionName {
  return name === ADD_CARDS || name === MAKE;
}

export type ChatActionPart = Extract<ChatMessage["parts"][number], { toolCallId: string }>;

export function isChatActionPart(part: ChatMessage["parts"][number]): part is ChatActionPart {
  return isToolUIPart(part) && isChatAction(getToolName(part));
}

export type SlashCommand =
  | { id: "cards"; action: typeof ADD_CARDS }
  | { id: ChatMakeTool; action: typeof MAKE; tool: ChatMakeTool };

/** The commands of the prompt's "/" menu, in the order it lists them. */
export const slashCommands: readonly SlashCommand[] = [
  { id: "cards", action: ADD_CARDS },
  ...chatMakeTools.map((tool) => ({ id: tool, action: MAKE, tool }) as const),
];

/** Short names the menu also answers to. */
const aliases: Record<string, SlashCommand["id"]> = {
  flashcards: "cards",
  card: "cards",
  mindmap: "mind-map",
  map: "mind-map",
  table: "data-table",
  slides: "slide-deck",
  deck: "slide-deck",
  audio: "audio-overview",
  podcast: "audio-overview",
};

/**
 * Reads "/quiz the second chapter" as the quiz command with its focus. Null
 * when the text is not a command.
 */
export function parseSlash(text: string): { command: SlashCommand; focus: string } | null {
  const match = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const id = aliases[name] ?? name;
  const command = slashCommands.find((each) => each.id === id);
  return command ? { command, focus: (match[2] ?? "").trim() } : null;
}
