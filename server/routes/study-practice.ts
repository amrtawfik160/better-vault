import { generateText, Output } from "ai";
import { z } from "zod";
import { rejectCliProxyRequest } from "@/lib/ai/cliproxyapi";
import { describeError } from "@/lib/ai/errors";
import { credentialsSchema, modelRefSchema } from "@/lib/ai/request";
import { createLanguageModel } from "@/lib/ai/providers";
import {
  normalisePracticeFeedback,
  normalisePracticeQuestions,
  practiceExplainReplySchema,
  practiceFeedbackReplySchema,
  practicePrompt,
  practiceQuestionsReplySchema,
  practiceRequestSchema,
  practiceSystemPrompt,
} from "@/lib/study/writing-practice";
import { normaliseTeachReply, teachReplySchema } from "@/lib/study/teach";

const connection = z.object({ model: modelRefSchema, credentials: credentialsSchema });

/**
 * Practice: writes questions from the learner's material, gives feedback on
 * one answer, judged for the audience the learner is preparing for, and
 * analyses a Teach it back explanation against the material's key ideas.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const decoded = connection.safeParse(body);
  const practice = practiceRequestSchema.safeParse(body);
  if (!decoded.success || !practice.success)
    return Response.json({ error: "Invalid practice request." }, { status: 400 });
  const { model, credentials } = decoded.data;
  const denied = rejectCliProxyRequest(request, model.provider);
  if (denied) return denied;
  const input = practice.data;
  try {
    const languageModel = await createLanguageModel(model, credentials);
    const common = {
      model: languageModel,
      system: practiceSystemPrompt(input),
      prompt: practicePrompt(input),
      abortSignal: request.signal,
    };
    switch (input.action) {
      case "questions": {
        const { output } = await generateText({
          ...common,
          output: Output.object({ schema: practiceQuestionsReplySchema }),
          maxOutputTokens: 6000,
        });
        const result = normalisePracticeQuestions(output, {
          types: input.types,
          count: input.count,
          passages: input.passages.length,
        });
        if (!result.questions.length)
          return Response.json({ error: "The model did not write usable questions. Try again." }, { status: 502 });
        return Response.json(result);
      }
      case "feedback": {
        const { output } = await generateText({
          ...common,
          output: Output.object({ schema: practiceFeedbackReplySchema }),
          maxOutputTokens: 4000,
        });
        return Response.json({
          feedback: normalisePracticeFeedback(output, input.passages.length, Boolean(input.previous)),
        });
      }
      case "explain": {
        const { output } = await generateText({
          ...common,
          output: Output.object({ schema: practiceExplainReplySchema }),
          maxOutputTokens: 800,
        });
        return Response.json({ explanation: output.explanation.trim() });
      }
      case "teach": {
        const { output } = await generateText({
          ...common,
          output: Output.object({ schema: teachReplySchema }),
          maxOutputTokens: 8000,
        });
        const result = normaliseTeachReply(output, { passages: input.passages.length, previous: input.previous });
        if (!result.analysis.ideas.length)
          return Response.json({ error: "The model did not find the key ideas. Try again." }, { status: 502 });
        return Response.json(result);
      }
    }
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
