import { z } from "zod";
import { locateStudyQuote } from "@/lib/study/locators";

const noteMatchSchema = z.object({
  offset: z.number().int().nonnegative(),
  quote: z.string().min(1),
});

export type NoteMatch = z.infer<typeof noteMatchSchema>;

const noteMatchState = z.object({ noteMatch: noteMatchSchema });
export const noteCaptureLimit = 3000;
export const notePassageSchema = noteMatchSchema.extend({
  quote: noteMatchSchema.shape.quote.max(noteCaptureLimit),
});

export function readNoteMatch(state: unknown): NoteMatch | undefined {
  return noteMatchState.safeParse(state).data?.noteMatch;
}

/** CodeMirror stores all line breaks as a single character. */
export function noteEditorText(body: string) {
  return body.replace(/\r\n?/g, "\n");
}

export function locateNoteMatch(text: string, { offset, quote }: NoteMatch): number | undefined {
  const at = locateStudyQuote(text, quote, offset);
  return at < 0 ? undefined : at;
}
