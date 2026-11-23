import { activeModel, credentialsFor, getSettings } from "@/lib/db/settings";
import {
  practiceExplainAnswerSchema,
  practiceFeedbackAnswerSchema,
  practiceQuestionsAnswerSchema,
  type PracticeRequest,
} from "./writing-practice";
import { teachAnswerSchema } from "./teach";
import { translationLanguageLabel } from "./translation-language";

/** No model is set up: the page offers to open Settings instead of an error. */
export class PracticeModelMissing extends Error {
  constructor() {
    super("Connect or choose an AI model in Settings to continue.");
    this.name = "PracticeModelMissing";
  }
}

async function ask(request: PracticeRequest, signal?: AbortSignal): Promise<unknown> {
  const settings = await getSettings();
  const model = activeModel(settings);
  if (!model) throw new PracticeModelMissing();
  const response = await fetch("/api/study/practice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request, model, credentials: credentialsFor(settings, model.provider) }),
    signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(typeof result?.error === "string" ? result.error : "Practice request failed.");
  return result;
}

export async function writePracticeQuestions(
  request: Omit<Extract<PracticeRequest, { action: "questions" }>, "action">,
  signal?: AbortSignal,
) {
  return practiceQuestionsAnswerSchema.parse(await ask({ action: "questions", ...request }, signal));
}

async function translateTo() {
  const { study } = await getSettings();
  return study?.translateTo ? translationLanguageLabel(study.translateTo) : undefined;
}

export async function reviewPracticeAnswer(
  request: Omit<Extract<PracticeRequest, { action: "feedback" }>, "action" | "translateTo">,
  signal?: AbortSignal,
) {
  const { feedback } = practiceFeedbackAnswerSchema.parse(
    await ask({ action: "feedback", ...request, translateTo: await translateTo() }, signal),
  );
  return feedback;
}

export async function explainPracticeChoice(
  request: Omit<Extract<PracticeRequest, { action: "explain" }>, "action">,
  signal?: AbortSignal,
) {
  return practiceExplainAnswerSchema.parse(await ask({ action: "explain", ...request }, signal)).explanation;
}

/** Analyses one Teach it back explanation: key ideas, misconceptions, teaching advice and probing questions. */
export async function analyseTeachBack(
  request: Omit<Extract<PracticeRequest, { action: "teach" }>, "action" | "translateTo">,
  signal?: AbortSignal,
) {
  return teachAnswerSchema.parse(await ask({ action: "teach", ...request, translateTo: await translateTo() }, signal));
}
