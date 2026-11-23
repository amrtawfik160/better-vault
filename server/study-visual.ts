import {
  generateText,
  InvalidToolInputError,
  NoSuchToolError,
  tool,
  ToolChoiceViolationError,
  type LanguageModel,
  type ToolChoice,
  type ToolSet,
} from "ai";
import type { z } from "zod";
import { visualDescriptions, visualKindOf, visualSchemas, visualToolName } from "@/lib/chat/visuals";
import { studyExplanationVisuals } from "@/lib/study/ai";
import { studyVisualSchema, type StudyVisual } from "@/lib/study/records";
import { renderDiagram } from "@/studio/tools/mind-map/render";
import { cleanMermaid } from "@/studio/tools/mind-map/server";

/** A visual the model could not get right, even after its repairs. */
export class StudyVisualError extends Error {
  name = "StudyVisualError";
}

export const studyVisualRepairs = 2;

export const studyVisualInstructions = `The learner did not fully understand the explanation in request and asked to see it as a visual. Show it as exactly one visual by calling one show_* tool. Choose the kind that explains it best: a diagram for a process, structure, cause and effect or relationships (prefer a flowchart; use sequenceDiagram, stateDiagram, mindmap or classDiagram only when they fit better); steps for a procedure; comparison for two to four alternatives; timeline for dated events; a table for items across several attributes; a chart only for numbers stated in the material. Keep labels short and plain, at most about six words. Take facts only from the explanation, the conversation and the numbered passages, and add no new claims. Write the title and labels in the language of the explanation. For Mermaid, write only the code, without fences, and quote labels that contain punctuation.`;

type Attempt = { visual: StudyVisual } | { problem: string; mermaid?: string };

const tools: ToolSet = Object.fromEntries(
  studyExplanationVisuals.map((kind) => [
    visualToolName(kind),
    tool({
      description: visualDescriptions[kind],
      inputSchema: visualSchemas[kind] as z.ZodType<Record<string, unknown>>,
    }),
  ]),
);

/** Why this tool call cannot be shown, or the visual it draws. */
export function checkStudyVisual(toolName: string, input: unknown): Attempt {
  const kind = visualKindOf(toolName);
  if (!kind || !(studyExplanationVisuals as readonly string[]).includes(kind))
    return { problem: `${toolName} is not one of the visual tools.` };
  const data =
    kind === "diagram" && input && typeof input === "object" && "mermaid" in input
      ? { ...input, mermaid: cleanMermaid(String(input.mermaid)) }
      : input;
  const parsed = studyVisualSchema.safeParse({ kind, data });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 4)
      .map(({ path, message }) => `${path.slice(1).join(".") || "input"}: ${message}`);
    return { problem: `The ${kind} did not match its schema (${issues.join("; ")}).` };
  }
  if (parsed.data.kind === "diagram") {
    const drawn = renderDiagram(parsed.data.data.mermaid);
    if ("error" in drawn)
      return { problem: drawn.error.slice(0, 600), mermaid: parsed.data.data.mermaid };
  }
  return { visual: parsed.data };
}

function repairPrompt(prompt: string, failed: Extract<Attempt, { problem: string }>) {
  return failed.mermaid
    ? `${prompt}\n\nThis Mermaid code could not be drawn:\n\n${failed.mermaid}\n\nError: ${failed.problem}\n\nFix it and call show_diagram with the whole corrected diagram.`
    : `${prompt}\n\nYour previous visual could not be shown: ${failed.problem}\n\nCall one show_* tool again with valid input.`;
}

/**
 * One visual explaining an answer, chosen by the model among the explanation
 * kinds. A diagram's Mermaid is drawn with Pele first; when it fails, or the
 * input does not fit its schema, the model is asked to fix it, twice at most.
 */
export async function generateStudyVisual({
  prompt,
  ...options
}: {
  model: LanguageModel;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<StudyVisual> {
  let outcome = await attemptVisual(options, prompt, "required");
  for (let repair = 1; !("visual" in outcome); repair++) {
    if (repair > studyVisualRepairs)
      throw new StudyVisualError(
        `The Tutor could not draw a visual for this answer: ${outcome.problem} Try again or choose another model.`,
      );
    outcome = await attemptVisual(
      options,
      repairPrompt(prompt, outcome),
      outcome.mermaid ? { type: "tool", toolName: visualToolName("diagram") } : "required",
    );
  }
  return outcome.visual;
}

async function attemptVisual(
  options: { model: LanguageModel; system: string; abortSignal?: AbortSignal },
  prompt: string,
  toolChoice: ToolChoice<ToolSet>,
): Promise<Attempt> {
  try {
    const { toolCalls } = await generateText({
      ...options,
      prompt,
      tools,
      toolChoice,
      maxOutputTokens: 3500,
    });
    const call = toolCalls[0];
    if (!call) return { problem: "No visual was returned." };
    if (call.invalid)
      return { problem: call.error instanceof Error ? call.error.message : "The input was invalid." };
    return checkStudyVisual(call.toolName, call.input);
  } catch (error) {
    if (
      options.abortSignal?.aborted ||
      !(
        InvalidToolInputError.isInstance(error) ||
        NoSuchToolError.isInstance(error) ||
        ToolChoiceViolationError.isInstance(error)
      )
    )
      throw error;
    return { problem: error.message.slice(0, 600) };
  }
}
