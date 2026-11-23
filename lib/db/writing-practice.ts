import { studyCardPassage, passagesFor } from "@/lib/study/passages";
import { studyHighlightOrigin } from "@/lib/study/links";
import { clearPracticeSessionDrafts } from "@/lib/study/writing-practice-drafts";
import { practiceCitationPassage, type PracticeQuestionDraft } from "@/lib/study/writing-practice";
import { bookMaterialPassages, practiceMaterialBudgets, type TeachProbingQuestion } from "@/lib/study/teach";
import { studyTextRevision } from "@/lib/study/text-edits";
import type {
  StudyOrigin,
  StudyPractice,
  StudyPracticeAttempt,
  StudyPracticeAudience,
  StudyPracticePassage,
  StudyPracticeQuestion,
  StudyPracticeQuestionType,
  StudyTeachIdea,
  StudyTeachRound,
  StudyThread,
} from "@/lib/study/records";
import { DEFAULT_VAULT } from "@/lib/study/vault";
import { useStoreQuery } from "./live";
import { createNote } from "./notes";
import { store } from "./store";
import {
  readStudyCardsInVault,
  readStudyTutorSources,
  removeStudyRecord,
  saveStudyCard,
  saveStudyNote,
  studyId,
} from "./study";

export type PracticeMode = NonNullable<StudyPractice["mode"]>;

/** What a Practice session is made from, as the setup page picks it. */
export type PracticeMaterialChoice =
  | { kind: "learned"; text: string }
  | { kind: "book"; bookId: string; section?: number; sectionEnd?: number }
  | { kind: "highlights"; ids: string[] }
  | { kind: "notes"; ids: string[] }
  | { kind: "cards"; ids: string[] };

export type PracticeMaterial = { passages: StudyPracticePassage[]; origins: StudyOrigin[]; sampled: boolean };

function materialThread(scope: "book" | "materials" | "notes", vaultId: string, fields: Partial<StudyThread>): StudyThread {
  return {
    id: `practice:${studyId()}`,
    kind: "thread",
    title: "",
    goal: "general",
    messages: [],
    updatedAt: 0,
    vaultId,
    scope,
    ...fields,
  };
}

/**
 * The passages a session keeps, read from the vault. A book (or a span of its
 * sections) is sent whole when it fits the mode's budget and spread evenly
 * across otherwise, with an outline; see `bookMaterialPassages`. Highlights
 * and notes use the Tutor's retrieval, steered by `query`.
 */
export async function readPracticeMaterial(
  material: PracticeMaterialChoice,
  vaultId: string,
  mode: PracticeMode = "questions",
  query = "",
): Promise<PracticeMaterial> {
  const none = { passages: [], origins: [], sampled: false };
  switch (material.kind) {
    case "learned":
      return none;
    case "cards": {
      const cards = await readStudyCardsInVault(material.ids, vaultId);
      return {
        passages: cards.slice(0, practiceMaterialBudgets.questions.passages).map((card) => studyCardPassage(card, 1_300)),
        origins: cards.map(({ id }) => ({ kind: "card", cardId: id })),
        sampled: cards.length > practiceMaterialBudgets.questions.passages,
      };
    }
    case "book": {
      const thread = materialThread("book", vaultId, { bookId: material.bookId });
      const { book } = await readStudyTutorSources(thread, vaultId);
      if (!book) return none;
      const last = book.sections.length - 1;
      const start = Math.min(material.section ?? 0, last);
      const end = material.section === undefined ? last : Math.min(Math.max(material.sectionEnd ?? start, start), last);
      const revision = studyTextRevision(book);
      const sections = book.sections.slice(start, end + 1).map((section, index) => ({
        title: section.title === book.title ? book.title : `${book.title} · ${section.title}`,
        text: section.text,
        origin: { kind: "book" as const, bookId: book.id, section: start + index, revision },
      }));
      const { passages, sampled } = bookMaterialPassages(sections, practiceMaterialBudgets[mode]);
      const origin: StudyOrigin =
        material.section === undefined ? { kind: "book", bookId: book.id } : { kind: "book", bookId: book.id, section: start };
      return { passages, origins: [origin], sampled };
    }
    case "highlights":
    case "notes": {
      const thread =
        material.kind === "notes"
          ? materialThread("notes", vaultId, { noteIds: material.ids })
          : materialThread("materials", vaultId, { highlightIds: material.ids });
      const sources = await readStudyTutorSources(thread, vaultId);
      const passages = passagesFor(thread, sources, query)
        .filter(({ text }) => text.trim())
        .map(({ title, text, origin }) => ({ title, text, origin }));
      const origins: StudyOrigin[] =
        material.kind === "notes"
          ? (sources.notes ?? []).map(({ id }) => ({ kind: "note", noteId: id }))
          : (sources.highlights ?? []).map(({ highlight }) => studyHighlightOrigin(highlight));
      return { passages, origins, sampled: false };
    }
  }
}

/** A session's vault: its own, or the default vault once its own was deleted. */
export function practiceSessionsIn(rows: readonly { kind: string }[], vaultId: string, knownVaults: ReadonlySet<string>) {
  return rows
    .filter((row): row is StudyPractice => row.kind === "practice")
    .filter((row) => (row.vaultId && knownVaults.has(row.vaultId) ? row.vaultId : DEFAULT_VAULT) === vaultId)
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
}

/** The vault's practice sessions, most recently used first. `undefined` while loading. */
export function usePracticeSessions(vaultId: string) {
  return useStoreQuery(
    async () => {
      const backend = store();
      const [rows, vaults] = await Promise.all([backend.listStudy(), backend.listVaults()]);
      return practiceSessionsIn(rows, vaultId, new Set([DEFAULT_VAULT, ...vaults.map(({ id }) => id)]));
    },
    [vaultId],
    ["study", "vaults"],
  );
}

export async function readPracticeSession(id: string) {
  const row = await store().getStudy(id);
  if (row?.kind !== "practice") throw new Error("This practice session is no longer available.");
  return row;
}

function newQuestion(draft: PracticeQuestionDraft): StudyPracticeQuestion {
  return { ...draft, id: studyId(), attempts: [] };
}

export async function createPracticeSession(input: {
  vaultId: string;
  mode?: PracticeMode;
  title: string;
  audience: StudyPracticeAudience;
  scenario?: string;
  material: StudyPractice["material"];
  passages: StudyPracticePassage[];
  types: StudyPracticeQuestionType[];
  questions: PracticeQuestionDraft[];
  retryOf?: string;
}) {
  const now = Date.now();
  const scenario = input.scenario?.trim();
  const learned = input.material.learned?.trim();
  const session: StudyPractice = {
    id: studyId(),
    kind: "practice",
    ...(input.mode === "teach" ? { mode: "teach" as const, rounds: [] } : {}),
    vaultId: input.vaultId,
    title: input.title.trim() || "Practice",
    createdAt: now,
    updatedAt: now,
    audience: input.audience,
    ...(scenario ? { scenario } : {}),
    material: {
      origins: input.material.origins,
      ...(learned ? { learned } : {}),
      ...(input.material.label ? { label: input.material.label } : {}),
      ...(input.material.sampled ? { sampled: true as const } : {}),
    },
    passages: input.passages,
    types: input.types,
    questions: input.questions.map(newQuestion),
    position: 0,
    ...(input.retryOf ? { retryOf: input.retryOf } : {}),
  };
  await store().putStudy([session]);
  return session;
}

async function changeSession(id: string, change: (session: StudyPractice) => StudyPractice) {
  const session = await readPracticeSession(id);
  const next = { ...change(session), updatedAt: Date.now() };
  await store().putStudy([next]);
  return next;
}

function withAttempt(questions: StudyPracticeQuestion[], questionId: string, attempt: StudyPracticeAttempt) {
  if (!questions.some(({ id }) => id === questionId)) throw new Error("This question is no longer in the session.");
  return questions.map((question) => {
    if (question.id !== questionId) return question;
    const saved = question.attempts.some(({ id }) => id === attempt.id);
    return {
      ...question,
      attempts: saved
        ? question.attempts.map((entry) => (entry.id === attempt.id ? attempt : entry))
        : [...question.attempts, attempt],
    };
  });
}

/** Saves an attempt at one question, replacing an earlier save of the same attempt. */
export function savePracticeAttempt(sessionId: string, questionId: string, attempt: StudyPracticeAttempt) {
  return changeSession(sessionId, (session) => ({
    ...session,
    position: Math.max(0, session.questions.findIndex(({ id }) => id === questionId)),
    questions: withAttempt(session.questions, questionId, attempt),
  }));
}

/** Remembers which question the learner is on; `questions.length` means the summary. */
export async function setPracticePosition(id: string, position: number) {
  const session = await readPracticeSession(id);
  if (session.position === position) return session;
  return changeSession(id, (current) => ({ ...current, position: Math.max(0, Math.min(position, current.questions.length)) }));
}

export function renamePracticeSession(id: string, title: string) {
  const next = title.trim();
  if (!next) return readPracticeSession(id);
  return changeSession(id, (session) => ({ ...session, title: next }));
}

export async function deletePracticeSession(id: string) {
  await removeStudyRecord(id);
  clearPracticeSessionDrafts(id);
}

/** A new session with some of a session's questions, unanswered, on the same material. */
export function retryPracticeQuestions(session: StudyPractice, questionIds: readonly string[], title: string) {
  const chosen = new Set(questionIds);
  const questions = session.questions
    .filter(({ id }) => chosen.has(id))
    .map(({ id: _id, attempts: _attempts, ...question }) => question);
  if (!questions.length) throw new Error("There are no questions to retry.");
  return createPracticeSession({
    vaultId: session.vaultId ?? DEFAULT_VAULT,
    title,
    audience: session.audience,
    scenario: session.scenario,
    material: session.material,
    passages: session.passages,
    types: [...new Set(questions.map(({ type }) => type))],
    questions,
    retryOf: session.id,
  });
}

/* Teach it back ------------------------------------------------------------ */

/** Saves a round's explanation, and its analysis and probing questions once they arrive. */
export function saveTeachRound(
  sessionId: string,
  round: Pick<StudyTeachRound, "id" | "explanation"> & Partial<Pick<StudyTeachRound, "analysis">> & { probing?: TeachProbingQuestion[] },
) {
  return changeSession(sessionId, (session) => {
    const rounds = session.rounds ?? [];
    const existing = rounds.find(({ id }) => id === round.id);
    const questions = round.probing
      ? round.probing.map((question) => newQuestion({ type: "write", ...question }))
      : (existing?.questions ?? []);
    const next: StudyTeachRound = {
      id: round.id,
      at: existing?.at ?? Date.now(),
      explanation: round.explanation,
      ...((round.analysis ?? existing?.analysis) ? { analysis: round.analysis ?? existing?.analysis } : {}),
      questions,
    };
    return {
      ...session,
      mode: "teach",
      rounds: existing ? rounds.map((entry) => (entry.id === round.id ? next : entry)) : [...rounds, next],
    };
  });
}

/** Saves an answer to one of a round's probing questions. */
export function saveTeachAttempt(sessionId: string, roundId: string, questionId: string, attempt: StudyPracticeAttempt) {
  return changeSession(sessionId, (session) => {
    const rounds = session.rounds ?? [];
    if (!rounds.some(({ id }) => id === roundId)) throw new Error("This round is no longer in the session.");
    return {
      ...session,
      rounds: rounds.map((round) =>
        round.id === roundId ? { ...round, questions: withAttempt(round.questions, questionId, attempt) } : round,
      ),
    };
  });
}

/* Saving to review and notes ------------------------------------------------ */

function citedOrigin(session: StudyPractice, citations: readonly number[] | undefined) {
  for (const number of citations ?? []) {
    const origin = practiceCitationPassage(session, number)?.origin;
    if (origin) return origin;
  }
}

/** Where a saved card or note points back to: the passage the question cites, else the session's material. */
export function practiceQuestionOrigin(session: StudyPractice, question: Pick<StudyPracticeQuestion, "citations">): StudyOrigin | undefined {
  return citedOrigin(session, question.citations) ?? session.material.origins[0];
}

function practiceCardBack(question: StudyPracticeQuestion, answer: string) {
  if (question.type !== "choice" || !question.choices) return answer;
  const correct = question.answer === undefined ? undefined : question.choices[question.answer];
  return correct ? `${correct}\n\n${answer}`.trim() : answer;
}

/** Saves a question as a flashcard so it joins daily review. */
export function savePracticeCard(session: StudyPractice, question: StudyPracticeQuestion, answer: string) {
  const origin = practiceQuestionOrigin(session, question);
  return saveStudyCard({
    front: question.prompt,
    back: practiceCardBack(question, answer.trim() || question.reference),
    ...(question.type === "choice" && question.choices ? { quizChoices: question.choices } : {}),
    tags: ["practice"],
    vaultId: session.vaultId ?? DEFAULT_VAULT,
    ...(origin ? { origin } : {}),
  });
}

/**
 * Flashcards for the key ideas the learner has not explained yet. The back
 * is the source's own quote; the origin is the cited passage (its section and
 * place in the book) when there is one, else the session's material.
 */
export async function saveTeachGapCards(
  session: StudyPractice,
  cards: readonly { idea: StudyTeachIdea; front: string; back: string }[],
) {
  const saved = [];
  for (const { idea, front, back } of cards) {
    const origin = citedOrigin(session, idea.citations) ?? session.material.origins[0];
    saved.push(
      await saveStudyCard({
        front,
        back,
        tags: ["practice", "teach-back"],
        vaultId: session.vaultId ?? DEFAULT_VAULT,
        ...(origin ? { origin } : {}),
      }),
    );
  }
  return saved;
}

/** Saves text from a session as a note in its vault, linked to the material when it has a place to open. */
export function savePracticeNote(
  session: StudyPractice,
  { title, body, citations }: { title: string; body: string; citations?: readonly number[] },
) {
  const origin = citedOrigin(session, citations) ?? session.material.origins[0];
  const vaultId = session.vaultId ?? DEFAULT_VAULT;
  const name = title.slice(0, 120);
  if (origin) return saveStudyNote({ title: name, body, origin, vaultId });
  return createNote({ vaultId, title: name, body: body.trim() });
}
