import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAllData, exportBackup, importBackup } from "./backup";
import type { Backend } from "./backend";
import { createDexieBackend } from "./dexie-backend";
import { asBackend, createSqliteStore } from "./sqlite/store";
import { setStoreForTests, store } from "./store";
import { addStudyBook } from "./study";
import { createVault, deleteVault } from "./vaults";
import {
  createPracticeSession,
  deletePracticeSession,
  practiceSessionsIn,
  readPracticeMaterial,
  readPracticeSession,
  renamePracticeSession,
  retryPracticeQuestions,
  saveTeachAttempt,
  saveTeachGapCards,
  saveTeachRound,
  savePracticeAttempt,
  savePracticeCard,
} from "./writing-practice";

const backends: [string, () => Backend][] = [
  ["IndexedDB", () => createDexieBackend()],
  ["SQLite", () => asBackend(createSqliteStore(new DatabaseSync(":memory:")))],
];

const draft = { type: "write" as const, prompt: "Explain the outbox to your CTO.", reference: "Atomic write and event.", keyPoints: ["atomic"], citations: [1] };
const analysis = {
  ideas: [{ title: "Atomicity", quote: "write and event commit together", citations: [1], status: "missing" as const, note: "" }],
  misconceptions: [],
  teaching: [],
  summary: "",
  accuracy: 3,
  language: [],
  vocabulary: [],
};

describe.each(backends)("%s store: writing practice", (_name, create) => {
  beforeEach(async () => {
    setStoreForTests(create());
    await deleteAllData();
  });

  async function book() {
    return addStudyBook({
      title: "Designing systems",
      format: "text",
      sections: [
        { title: "Outbox", text: "The write and the event commit together in one transaction." },
        { title: "Sagas", text: "A saga undoes earlier steps with compensating actions." },
      ],
    });
  }

  it("reads a section span of a book as passages that point back into it", async () => {
    const saved = await book();
    const material = await readPracticeMaterial({ kind: "book", bookId: saved.id, section: 0, sectionEnd: 1 }, "default", "teach");
    expect(material.sampled).toBe(false);
    expect(material.origins).toEqual([{ kind: "book", bookId: saved.id, section: 0 }]);
    expect(material.passages.map(({ origin }) => origin)).toMatchObject([
      { kind: "book", bookId: saved.id, section: 0, offset: 0 },
      { kind: "book", bookId: saved.id, section: 1, offset: 0 },
    ]);
    expect(await readPracticeMaterial({ kind: "book", bookId: saved.id }, "elsewhere")).toEqual({ passages: [], origins: [], sampled: false });
  });

  it("saves attempts, renames, retries and deletes a session", async () => {
    const saved = await book();
    const { passages, origins } = await readPracticeMaterial({ kind: "book", bookId: saved.id, section: 0 }, "default");
    const session = await createPracticeSession({
      vaultId: "default",
      title: "Outbox",
      audience: "business",
      scenario: "  Pitch it to the CTO ",
      material: { origins },
      passages,
      types: ["write"],
      questions: [draft, { ...draft, prompt: "Second" }],
    });
    expect(session.scenario).toBe("Pitch it to the CTO");
    const [first, second] = session.questions;
    await savePracticeAttempt(session.id, second.id, { id: "a1", at: 1, answer: "Draft" });
    await savePracticeAttempt(session.id, second.id, { id: "a1", at: 2, answer: "Final" });
    await savePracticeAttempt(session.id, first.id, { id: "a2", at: 3, answer: "Other" });
    await renamePracticeSession(session.id, " Outbox for the CTO ");
    const updated = await readPracticeSession(session.id);
    expect(updated.title).toBe("Outbox for the CTO");
    expect(updated.position).toBe(0);
    expect(updated.questions[1].attempts).toEqual([{ id: "a1", at: 2, answer: "Final" }]);

    const card = await savePracticeCard(updated, updated.questions[0], "Better answer");
    expect(card).toMatchObject({ front: draft.prompt, back: "Better answer", tags: ["practice"], origin: { kind: "book", bookId: saved.id, section: 0 } });

    const retry = await retryPracticeQuestions(updated, [second.id], "Retry");
    expect(retry).toMatchObject({ retryOf: session.id, audience: "business", questions: [{ prompt: "Second", attempts: [] }] });
    expect(retry.questions[0].id).not.toBe(second.id);

    await deletePracticeSession(session.id);
    await expect(readPracticeSession(session.id)).rejects.toThrow("no longer available");
  });

  it("keeps teach-back rounds and their probing questions", async () => {
    const saved = await book();
    const { passages, origins } = await readPracticeMaterial({ kind: "book", bookId: saved.id, section: 0 }, "default", "teach");
    const session = await createPracticeSession({
      vaultId: "default",
      mode: "teach",
      title: "Outbox",
      audience: "friend",
      material: { origins },
      passages,
      types: ["write"],
      questions: [],
    });
    expect(session.rounds).toEqual([]);
    await saveTeachRound(session.id, { id: "r1", explanation: "It is a queue." });
    const analysed = await saveTeachRound(session.id, { id: "r1", explanation: "It is a queue.", analysis, probing: [draft] });
    const round = analysed.rounds?.[0];
    expect(round).toMatchObject({ explanation: "It is a queue.", analysis, questions: [{ type: "write", prompt: draft.prompt, attempts: [] }] });
    await saveTeachAttempt(session.id, "r1", round!.questions[0].id, { id: "t1", at: 1, answer: "Because…" });
    expect((await readPracticeSession(session.id)).rounds?.[0].questions[0].attempts).toHaveLength(1);

    const [card] = await saveTeachGapCards(analysed, [{ idea: analysis.ideas[0], front: "Explain atomicity", back: analysis.ideas[0].quote }]);
    expect(card.origin).toMatchObject({ kind: "book", bookId: saved.id, section: 0, offset: 0 });
  });

  it("lists sessions by vault, deletes them with their vault, and round-trips them in backups", async () => {
    const vault = await createVault({ name: "Work" });
    const empty = { audience: "exam" as const, material: { origins: [] }, passages: [], types: ["recall" as const], questions: [] };
    const theirs = await createPracticeSession({ vaultId: vault, title: "Work", ...empty });
    const mine = await createPracticeSession({ vaultId: "default", title: "A", ...empty });
    const rows = await store().listStudy();
    expect(practiceSessionsIn(rows, vault, new Set(["default", vault])).map(({ id }) => id)).toEqual([theirs.id]);
    expect(practiceSessionsIn(rows, "default", new Set(["default"])).map(({ id }) => id).toSorted()).toEqual([mine.id, theirs.id].toSorted());
    await deleteVault(vault);
    await expect(readPracticeSession(theirs.id)).rejects.toThrow("no longer available");

    const backup = await exportBackup();
    await deleteAllData();
    await importBackup(JSON.parse(JSON.stringify(backup)));
    expect(await readPracticeSession(mine.id)).toEqual(mine);
  });
});
