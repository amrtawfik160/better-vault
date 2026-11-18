import { z } from "zod";

const noteMatch = z.object({
  offset: z.number().int().nonnegative(),
  quote: z.string().min(1),
});

export type NoteMatch = z.infer<typeof noteMatch>;

const noteMatchState = z.object({ noteMatch });

export function readNoteMatch(state: unknown): NoteMatch | undefined {
  return noteMatchState.safeParse(state).data?.noteMatch;
}

/** CodeMirror stores all line breaks as a single character. */
export function noteEditorText(body: string) {
  return body.replace(/\r\n?/g, "\n");
}

export function locateNoteMatch(text: string, { offset, quote }: NoteMatch): number | undefined {
  if (text.startsWith(quote, offset)) return offset;
  const before = text.lastIndexOf(quote, offset);
  const after = text.indexOf(quote, offset);
  if (after < 0) return before < 0 ? undefined : before;
  return before >= 0 && offset - before <= after - offset ? before : after;
}
