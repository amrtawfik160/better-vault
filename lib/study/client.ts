import { activeModel, credentialsFor, getSettings } from "@/lib/db/settings";
import { studyAnswerSchema, type StudyAction, type StudyCardImages } from "./ai";
import type { StudyThread } from "./records";
import type { StudyPassage } from "./passages";

export async function askStudyModel({
  action,
  input,
  passages = [],
  thread,
  signal,
  cardCount,
  cardImages,
  documentImage,
  spoken,
}: {
  action: StudyAction;
  input: string;
  passages?: Pick<StudyPassage, "title" | "text" | "previousCitations">[];
  thread?: StudyThread;
  signal?: AbortSignal;
  cardCount?: number;
  cardImages?: StudyCardImages;
  documentImage?: string;
  spoken?: boolean;
}) {
  const settings = await getSettings();
  const model = activeModel(settings);
  if (!model) throw new Error("Connect or choose an AI model in Settings to continue.");
  const response = await fetch("/api/study", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      input,
      model,
      credentials: credentialsFor(settings, model.provider),
      passages: passages
        .slice(0, 8)
        .map(({ title, text, previousCitations }) => ({
          title: title.slice(0, 500),
          text: text.slice(0, 12_000),
          previousCitations,
        })),
      history: thread?.messages
        .slice(-16)
        .map(({ role, text }) => ({ role, text: text.slice(0, 12_000) })),
      goal: thread?.goal,
      followUp: thread?.followUp?.text.slice(0, 20_000),
      flashcardPractice: thread?.scope === "cards" || undefined,
      correct: thread?.corrections === "live",
      cardCount,
      cardImages,
      documentImage,
      correctionMode: thread?.corrections ?? "off",
      practiceLanguage: thread?.practiceLanguage,
      spoken,
    }),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(typeof result?.error === "string" ? result.error : "Study request failed.");
  return studyAnswerSchema.parse(result);
}
