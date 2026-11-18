import "fake-indexeddb/auto";
import {
  addQuizMissesToStudy,
  addStudyBook,
  addStudioFlashcards,
  deleteStudyBook,
  studyBookForSource,
  freshSchedule,
  putStudyRecords,
  rateStudyItem,
  readStudyThread,
  readStudyTutorSources,
  saveStudyCard,
  saveStudyReadingPlace,
  saveStudyText,
  startSourceTutor,
  startBookTutor,
  startCardTutor,
  startHighlightTutor,
  StudyTextConflict,
  updateStudyBook,
  updateStudyReport,
  updateStudyThread,
} from "./study";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAllData, exportBackup, importBackup } from "./backup";
import type { Backend } from "./backend";
import { createDexieBackend } from "./dexie-backend";
import { loadBlob, saveBlob } from "./blobs";
import { ancestors, createFolder, deleteFolder, moveFolder } from "./folders";
import { createNotebook, deleteNotebook, updateNotebook } from "./notebooks";
import { createOutput, deleteOutput, markInterruptedOutputs } from "./outputs";
import { asBackend, createSqliteStore, schemaVersion } from "./sqlite/store";
import { setStoreForTests, store } from "./store";
import { conversationTitle } from "@/lib/chat/title";
import { studyVaultIndex } from "@/lib/study/vault";
import { resolveStudyRange } from "@/lib/study/text-edits";
import { matchesStudyReport, plannedStudySteps, studyReports } from "@/lib/study/reports";
import {
  deleteConversation,
  latestConversation,
  loadChat,
  renameConversation,
  saveChat,
} from "./messages";
import {
  activeModel,
  availableModels,
  defaultSettings,
  getSettings,
  isProviderReady,
  updateProvider,
} from "./settings";
import { createNote, renameNote, saveNoteBody } from "./notes";
import { createSkill, deleteSkill, saveSkill } from "./skills";
import {
  createBot,
  deleteBot,
  listBots,
  loadBotThread,
  resetBotSeedingForTests,
  saveBotThread,
  seedBotsOnce,
  updateBot,
} from "./bots";
import { addSource, attachImages, deleteSource, getChunks } from "./sources";
import {
  DEFAULT_VAULT,
  createVault,
  deleteVault,
  listVaults,
  updateVault,
  vaultOf,
} from "./vaults";

const userMessage = (id: string, text = id) => ({
  id,
  role: "user" as const,
  parts: [{ type: "text" as const, text }],
});

/**
 * The same tests run on each store: IndexedDB for the web app and SQLite for
 * the desktop app. A change to `lib/db` must pass on both.
 */
const backends: [string, () => Backend][] = [
  ["IndexedDB", () => createDexieBackend()],
  ["SQLite", () => asBackend(createSqliteStore(new DatabaseSync(":memory:")))],
];

describe.each(backends)("%s store", (name, create) => {
  /** Conversation ids differ per store: a deleted one is remembered for the page's life. */
  const id = (base: string) => `${name}-${base}`;

  beforeEach(async () => {
    setStoreForTests(create());
    await deleteAllData();
    await store().clearSettings();
  });

  describe("sources", () => {
    it("stores normalised text and its passages", async () => {
      const notebookId = await createNotebook("Test");
      const source = await addSource({
        notebookId,
        title: "Notes",
        kind: "text",
        text: "First paragraph.\r\n\r\n\r\nSecond   paragraph.",
      });
      expect(source.text).toBe("First paragraph.\n\nSecond paragraph.");
      expect(source.selected).toBe(true);
      const chunks = await getChunks([source.id]);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(source.text);
    });

    it("refuses empty sources", async () => {
      const notebookId = await createNotebook("Test");
      await expect(
        addSource({ notebookId, title: "x", kind: "text", text: "  " }),
      ).rejects.toThrow();
    });
  });

  describe("notebooks", () => {
    it("deletes a notebook with everything in it", async () => {
      const notebookId = await createNotebook("Test");
      await addSource({ notebookId, title: "a", kind: "text", text: "hello" });
      await saveChat({ id: id("c1"), notebookId }, [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ]);
      await deleteNotebook(notebookId);
      expect(await store().count("sources")).toBe(0);
      expect(await store().count("chunks")).toBe(0);
      expect(await store().count("messages")).toBe(0);
      expect(await store().count("conversations")).toBe(0);
      expect(await store().count("notebooks")).toBe(0);
    });

    it("keeps an icon, a colour and a folder", async () => {
      const folderId = await createFolder("Biology", null);
      const notebookId = await createNotebook("Cells", { icon: "dna", color: "chart-2", folderId });
      expect(await store().getNotebook(notebookId)).toMatchObject({
        icon: "dna",
        color: "chart-2",
        folderId,
      });
      await updateNotebook(notebookId, { folderId: null });
      expect((await store().getNotebook(notebookId))?.folderId ?? null).toBeNull();
    });
  });

  describe("folders", () => {
    it("moves what a deleted folder held up a level", async () => {
      const school = await createFolder("School", null);
      const biology = await createFolder("Biology", school);
      const genetics = await createFolder("Genetics", biology);
      const notebookId = await createNotebook("Cells", { folderId: biology });
      await deleteFolder(biology);
      const folders = await store().listFolders();
      expect(folders.map((folder) => folder.name).sort()).toEqual(["Genetics", "School"]);
      expect(folders.find((folder) => folder.id === genetics)?.parentId).toBe(school);
      expect((await store().getNotebook(notebookId))?.folderId).toBe(school);
    });

    it("never moves a folder into itself", async () => {
      const a = await createFolder("A", null);
      const b = await createFolder("B", a);
      await moveFolder(a, b, await store().listFolders());
      expect((await store().listFolders()).find((folder) => folder.id === a)?.parentId).toBeNull();
      expect(ancestors(b, await store().listFolders()).map((folder) => folder.name)).toEqual([
        "A",
        "B",
      ]);
    });
  });

  describe("files", () => {
    it("keeps bytes and deletes them with their output and notebook", async () => {
      const notebookId = await createNotebook("Audio");
      const outputId = await createOutput({
        notebookId,
        toolId: "audio-overview",
        title: "A",
        options: {},
        sourceIds: [],
        model: { provider: "openai", modelId: "m" },
      });
      const kept = await saveBlob({
        notebookId,
        outputId,
        mime: "audio/mpeg",
        data: new Uint8Array([1, 2, 3]),
      });
      const loose = await saveBlob({ notebookId, mime: "audio/mpeg", data: new Uint8Array([4]) });
      const blob = await loadBlob(kept);
      expect(blob?.type).toBe("audio/mpeg");
      expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([1, 2, 3]);
      await deleteOutput(outputId);
      expect(await loadBlob(kept)).toBeNull();
      expect(await loadBlob(loose)).not.toBeNull();
      await deleteNotebook(notebookId);
      expect(await store().count("blobs")).toBe(0);
    });
  });

  describe("vaults", () => {
    it("has a default vault for everything made before vaults", async () => {
      const vaults = await listVaults();
      expect(vaults.map((vault) => vault.id)).toEqual([DEFAULT_VAULT]);
      const notebookId = await createNotebook("Old");
      expect(vaultOf((await store().getNotebook(notebookId))!)).toBe(DEFAULT_VAULT);
    });

    it("keeps vaults in order, renames them and deletes one with what is in it", async () => {
      const work = await createVault({ name: "Work", color: "chart-2" });
      await updateVault(DEFAULT_VAULT, { name: "Home" });
      expect((await listVaults()).map((vault) => vault.name)).toEqual(["Home", "Work"]);
      const kept = await createNotebook("Kept");
      const gone = await createNotebook("Gone", { vaultId: work });
      await addSource({ notebookId: gone, title: "a", kind: "text", text: "hello" });
      await createFolder("Projects", null, undefined, work);
      await deleteVault(work);
      expect((await listVaults()).map((vault) => vault.id)).toEqual([DEFAULT_VAULT]);
      expect((await store().listNotebooks()).map((notebook) => notebook.id)).toEqual([kept]);
      expect(await store().count("folders")).toBe(0);
      expect(await store().count("sources")).toBe(0);
      await deleteVault(DEFAULT_VAULT);
      expect(await listVaults()).toHaveLength(1);
    });

    it("round-trips vaults in a backup", async () => {
      const work = await createVault({ name: "Work" });
      await createNotebook("In work", { vaultId: work });
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect((await listVaults()).map((vault) => vault.name)).toEqual(["", "Work"]);
      expect((await store().listNotebooks())[0].vaultId).toBe(work);
    });

    it("keeps study material with its vault and carries notebook-linked material when moved", async () => {
      const work = await createVault({ name: "Work" });
      const note = await createNote({ title: "Work notes", vaultId: work });
      const book = await addStudyBook({
        title: "Work reading",
        format: "text",
        sections: [{ title: "Chapter", text: "A passage." }],
        vaultId: work,
      });
      const card = {
        kind: "card" as const,
        front: "Question",
        back: "Answer",
        tags: [],
        schedule: freshSchedule(0),
        updatedAt: 0,
      };
      await store().putStudy([
        { ...card, id: "old" },
        { ...card, id: "standalone", vaultId: work },
        { ...card, id: "note-card", origin: { kind: "note", noteId: note.id } },
        {
          ...card,
          id: "book-card",
          vaultId: work,
          origin: { kind: "book", bookId: book.id, section: 0 },
        },
      ]);
      expect(await rateStudyItem("standalone", "easy", 5)).toBe(true);

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      await updateNotebook(book.notebookId, { vaultId: DEFAULT_VAULT });

      const rows = await store().listStudy();
      const scope = studyVaultIndex({
        rows,
        notebooks: await store().listNotebooks(),
        notes: await store().listNotes(),
        vaults: await listVaults(),
        defaultVaultId: DEFAULT_VAULT,
      });
      expect(
        rows
          .filter((item) => scope.owner(item) === work)
          .map((item) => item.kind)
          .sort(),
      ).toEqual(["card", "card", "session"]);
      expect(scope.linkedVault(new URLSearchParams({ card: "note-card" }))).toBe(work);
      expect(scope.linkedVault(new URLSearchParams({ card: "book-card", vault: work }))).toBe(
        DEFAULT_VAULT,
      );

      await deleteVault(work);
      expect((await store().listStudy()).map(({ id }) => id).sort()).toEqual(
        [book.id, "book-card", "old"].sort(),
      );
      expect(await store().getNote(note.id)).toBeUndefined();
    });
  });

  describe("calendar", () => {
    it("replaces the calendar on save and keeps it in backups", async () => {
      const first = {
        id: "a",
        title: "Exam",
        start: "2026-11-10T09:00:00+01:00",
        end: "2026-11-10T11:00:00+01:00",
      };
      const second = {
        id: "b",
        title: "Holiday",
        allDay: true,
        start: "2026-12-24",
        end: "2026-12-27",
      };
      await store().saveCalendar([first, second]);
      await store().saveCalendar([second]);
      expect((await store().listCalendar()).map((entry) => entry.id)).toEqual(["b"]);
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      expect(await store().listCalendar()).toEqual([]);
      await importBackup(backup);
      expect(await store().listCalendar()).toEqual([second]);
    });
  });

  describe("bots", () => {
    const look = { shape: "drop", color: "chart-1" };

    it("keeps bots in roster order with their threads", async () => {
      const chief = await createBot({
        name: "Chief",
        title: "Runs things",
        instructions: "",
        avatar: look,
        canDelegate: true,
      });
      const helper = await createBot({
        name: "Helper",
        title: "Helps",
        instructions: "",
        avatar: look,
      });
      expect((await listBots()).map((bot) => bot.name)).toEqual(["Chief", "Helper"]);
      await saveBotThread(helper.id, [
        userMessage("a", "First"),
        userMessage("b", "**Second** one"),
      ]);
      expect((await loadBotThread(helper.id)).map((m) => m.id)).toEqual(["a", "b"]);
      expect((await store().getBot(helper.id))?.preview).toBe("Second one");
      await saveBotThread(helper.id, [userMessage("c")]);
      expect((await loadBotThread(helper.id)).map((m) => m.id)).toEqual(["c"]);
      await updateBot(chief.id, {
        name: "Chief of Staff",
        model: { provider: "openai", modelId: "x" },
      });
      await updateBot(chief.id, { model: undefined });
      const saved = await store().getBot(chief.id);
      expect(saved?.name).toBe("Chief of Staff");
      expect(saved && "model" in saved).toBe(false);
      await deleteBot(helper.id);
      expect(await store().count("botMessages")).toBe(0);
      expect((await listBots()).map((bot) => bot.id)).toEqual([chief.id]);
      // A run finishing after the delete does not bring the bot back.
      await saveBotThread(helper.id, [userMessage("late")]);
      expect(await store().count("bots")).toBe(1);
    });

    it("seeds starter bots once, and keeps bots in backups", async () => {
      resetBotSeedingForTests();
      const starters = () => [{ name: "Starter", title: "", instructions: "Hi", avatar: look }];
      await seedBotsOnce(starters);
      expect((await listBots()).map((bot) => bot.name)).toEqual(["Starter"]);
      const [starter] = await listBots();
      await saveBotThread(starter.id, [userMessage("a", "Hello")]);
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      resetBotSeedingForTests();
      await seedBotsOnce(starters);
      expect(await store().count("bots")).toBe(0);
      await importBackup(backup);
      expect((await listBots()).map((bot) => bot.name)).toEqual(["Starter"]);
      expect((await loadBotThread(starter.id)).map((m) => m.id)).toEqual(["a"]);
    });
  });

  describe("notes", () => {
    it("reads links and tags on save and renames links everywhere", async () => {
      const work = await createVault({ name: "Work" });
      const plan = await createNote({ vaultId: DEFAULT_VAULT, title: "Plan" });
      const log = await createNote({
        vaultId: DEFAULT_VAULT,
        title: "Log",
        body: "See [[Plan#Goals|goals]] and #daily",
      });
      const elsewhere = await createNote({ vaultId: work, title: "Elsewhere", body: "![[Plan]]" });
      expect((await store().getNote(log.id))?.links).toEqual([
        { kind: "note", target: "Plan", heading: "Goals", alias: "goals", embed: false },
      ]);
      expect((await store().getNote(log.id))?.tags).toEqual(["daily"]);

      expect(await renameNote(plan.id, "Roadmap")).toBe("Roadmap");
      expect((await store().getNote(log.id))?.body).toBe("See [[Roadmap#Goals|goals]] and #daily");
      expect((await store().getNote(elsewhere.id))?.body).toBe("![[Roadmap]]");

      // A second "Untitled" in the same vault gets a number; another vault may reuse it.
      const a = await createNote({ vaultId: DEFAULT_VAULT });
      const b = await createNote({ vaultId: DEFAULT_VAULT });
      const c = await createNote({ vaultId: work });
      expect([a.title, b.title, c.title]).toEqual(["Untitled", "Untitled 1", "Untitled"]);
    });

    it("saves bodies, deletes notes with their vault and keeps them in backups", async () => {
      const work = await createVault({ name: "Work" });
      const kept = await createNote({ vaultId: DEFAULT_VAULT, title: "Kept" });
      await createNote({ vaultId: work, title: "Gone" });
      await saveNoteBody(kept.id, "---\naliases: [K]\n---\nText #tag");
      expect((await store().getNote(kept.id))?.aliases).toEqual(["K"]);

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteVault(work);
      expect((await store().listNotes()).map((note) => note.title)).toEqual(["Kept"]);
      await deleteAllData();
      expect(await store().count("notes")).toBe(0);
      await importBackup(backup);
      expect((await store().listNotes()).map((note) => note.title).sort()).toEqual([
        "Gone",
        "Kept",
      ]);
    });
  });

  describe("skills", () => {
    it("keeps names unique in a vault, saves edits and round-trips backups", async () => {
      const one = await createSkill(DEFAULT_VAULT, {
        name: "Write Summaries",
        description: "How to summarise",
        body: "Be brief.",
      });
      const two = await createSkill(DEFAULT_VAULT, {
        name: "write summaries",
        description: "",
        body: "",
      });
      expect([one.name, two.name]).toEqual(["write-summaries", "write-summaries-2"]);
      await saveSkill(two.id, { body: "Use bullets." }, "Claude Code");
      const saved = await store().getSkill(two.id);
      expect([saved?.body, saved?.updatedBy]).toEqual(["Use bullets.", "Claude Code"]);

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteSkill(one.id);
      await deleteAllData();
      await importBackup(backup);
      expect((await store().listSkills()).map((skill) => skill.name).sort()).toEqual([
        "write-summaries",
        "write-summaries-2",
      ]);
    });
  });

  describe("search", () => {
    it("lists the sources and outputs of every notebook", async () => {
      const a = await createNotebook("A");
      const b = await createNotebook("B");
      await addSource({ notebookId: a, title: "one", kind: "text", text: "first" });
      await addSource({ notebookId: b, title: "two", kind: "text", text: "second" });
      await createOutput({
        notebookId: b,
        toolId: "report",
        title: "Report",
        options: {},
        sourceIds: [],
        model: { provider: "openai", modelId: "m" },
      });
      expect((await store().listAllSources()).map((source) => source.title).sort()).toEqual([
        "one",
        "two",
      ]);
      expect((await store().listAllOutputs()).map((output) => output.title)).toEqual(["Report"]);
    });
  });

  describe("source pictures", () => {
    it("keeps a PDF's pictures with its source and deletes them with it", async () => {
      const notebookId = await createNotebook("Pictures");
      const source = await addSource({
        notebookId,
        title: "Paper",
        kind: "pdf",
        text: "Page one.",
      });
      await attachImages(source, [
        { mime: "image/webp", data: new Uint8Array([7, 8]), width: 10, height: 20, at: 9 },
      ]);
      const saved = await store().getSource(source.id);
      expect(saved?.images).toHaveLength(1);
      expect(saved?.images?.[0]).toMatchObject({ at: 9, width: 10, height: 20 });
      const blob = await loadBlob(saved!.images![0].blobId);
      expect(blob?.type).toBe("image/webp");
      await deleteSource(source.id);
      expect(await store().count("blobs")).toBe(0);
    });
  });

  describe("chat", () => {
    it("keeps message order", async () => {
      const notebookId = await createNotebook("Test");
      await saveChat(
        { id: id("c1"), notebookId },
        ["a", "b", "c"].map((id) => userMessage(id)),
      );
      expect((await loadChat(id("c1"))).map((m) => m.id)).toEqual(["a", "b", "c"]);
    });

    it("keeps conversations apart, titled by their first question", async () => {
      const notebookId = await createNotebook("Test");
      await saveChat({ id: id("c1"), notebookId }, [userMessage("a", "What is a  cache?")]);
      await saveChat({ id: id("c2"), notebookId }, [userMessage("b", "Summarise the key ideas")]);
      expect((await loadChat(id("c1"))).map((m) => m.id)).toEqual(["a"]);
      expect((await store().getConversation(id("c1")))?.title).toBe("What is a cache?");
      expect((await latestConversation(notebookId))?.id).toBe(id("c2"));
    });

    it("keeps a renamed title when the chat goes on, and deletes a conversation", async () => {
      const notebookId = await createNotebook("Test");
      await saveChat({ id: id("c1"), notebookId }, [userMessage("a", "First")]);
      await renameConversation(id("c1"), "  Mine ");
      await saveChat({ id: id("c1"), notebookId }, [
        userMessage("a", "First"),
        userMessage("b", "Second"),
      ]);
      expect((await store().getConversation(id("c1")))?.title).toBe("Mine");
      await deleteConversation(id("c1"));
      expect(await store().count("conversations")).toBe(0);
      expect(await store().count("messages")).toBe(0);
    });
  });

  describe("conversation titles", () => {
    it("shortens long questions at a word", () => {
      const title = conversationTitle([userMessage("a", "word ".repeat(40))]);
      expect(title.length).toBeLessThanOrEqual(73);
      expect(title.endsWith("…")).toBe(true);
    });

    it("is empty without a question", () => {
      expect(conversationTitle([])).toBe("");
    });
  });

  describe("outputs", () => {
    it("marks abandoned generations as interrupted", async () => {
      const notebookId = await createNotebook("Test");
      const model = { provider: "openai" as const, modelId: "m" };
      const running = await createOutput({
        notebookId,
        toolId: "quiz",
        title: "Q",
        options: {},
        sourceIds: [],
        model,
      });
      const stale = await createOutput({
        notebookId,
        toolId: "quiz",
        title: "Q",
        options: {},
        sourceIds: [],
        model,
      });
      await markInterruptedOutputs(new Set([running]), "interrupted");
      expect((await store().getOutput(running))?.status).toBe("generating");
      expect((await store().getOutput(stale))?.status).toBe("error");
    });
  });

  describe("study", () => {
    it("adds just the missed quiz questions and preserves their schedules on a retry", async () => {
      const notebookId = await createNotebook("Quiz notes");
      const output = {
        id: "quiz",
        notebookId,
        title: "Check understanding",
        toolId: "quiz",
        status: "ready",
        createdAt: 0,
        updatedAt: 0,
        options: {},
        sourceIds: [],
        data: {
          questions: [
            {
              question: "First?",
              options: ["A", "B"],
              answer: 0,
              explanation: "Because A.",
              hint: "",
            },
            {
              question: "Second?",
              options: ["A", "B"],
              answer: 1,
              explanation: "Because B.",
              hint: "",
            },
          ],
        },
      } satisfies import("./types").StudioOutput;
      expect(await addQuizMissesToStudy(output, [1, 1, 9])).toBe(1);
      expect(await store().getStudy("quiz-quiz-0")).toBeUndefined();
      expect(await rateStudyItem("quiz-quiz-1", "easy", 1)).toBe(true);
      const card = await store().getStudy("quiz-quiz-1");
      expect(card).toMatchObject({
        front: "Second?",
        back: "B\n\nBecause B.",
        origin: { kind: "studio", notebookId, outputId: "quiz" },
      });
      expect(await addQuizMissesToStudy(output, [1])).toBe(0);
      expect(await store().getStudy("quiz-quiz-1")).toEqual(card);
    });
    it("keeps uploaded originals with notebook sources through a backup", async () => {
      const notebookId = await createNotebook("Engineering");
      const bytes = Uint8Array.of(37, 80, 68, 70);
      const source = await addSource({
        notebookId,
        title: "Lecture",
        kind: "pdf",
        text: "Critical points",
        original: { data: bytes, mime: "application/pdf" },
      });
      if (!source.originalFileId) throw new Error("Original was not saved");
      const fileId = source.originalFileId;
      expect((await store().getBlob(fileId))?.sourceId).toBe(source.id);
      const backup = await exportBackup();
      await deleteAllData();
      await importBackup(backup);
      expect((await store().getSource(source.id))?.originalFileId).toBe(fileId);
      expect(Array.from((await store().getBlob(fileId))?.data ?? [])).toEqual([...bytes]);
      await store().deleteSource(source.id);
      expect(await store().getBlob(fileId)).toBeUndefined();
    });
    it("preserves renames and concurrent Tutor replies, and never revives a removed thread", async () => {
      await putStudyRecords({
        id: "thread",
        kind: "thread",
        title: "Before rename",
        scope: "general",
        goal: "general",
        updatedAt: 0,
        messages: [],
      });
      await Promise.all([
        updateStudyThread("thread", { title: "Current title" }),
        updateStudyThread("thread", {}, [{ role: "user", text: "Question one" }]),
        updateStudyThread("thread", {}, [{ role: "assistant", text: "Answer one" }]),
      ]);
      expect(await store().getStudy("thread")).toMatchObject({
        title: "Current title",
        messages: [{ text: "Question one" }, { text: "Answer one" }],
      });
      await store().deleteStudy("thread");
      await expect(updateStudyThread("thread", { title: "Late edit" })).rejects.toThrow();
      expect(await store().getStudy("thread")).toBeUndefined();
    });
    it("reads a notebook source in Study without copying or deleting the notebook", async () => {
      const notebookId = await createNotebook("Notebook");
      const source = await addSource({
        notebookId,
        title: "Source",
        kind: "text",
        text: "Read this",
      });
      const [first, second] = await Promise.all([
        studyBookForSource(source.id),
        studyBookForSource(source.id),
      ]);
      expect(first.id).toBe(second.id);
      expect(await store().listStudy()).toHaveLength(1);
      expect(first).toMatchObject({ notebookId, sourceId: source.id, attachedToNotebook: true });
      await deleteStudyBook(first);
      expect(await store().getNotebook(notebookId)).toBeDefined();
      expect(await store().getSource(source.id)).toBeDefined();
      expect(await store().listStudy()).toEqual([]);
    });

    it("adds a Studio set once and commits only one review for a due card", async () => {
      const notebookId = await createNotebook("Notebook");
      const output = {
        id: "output",
        notebookId,
        title: "Practice",
        toolId: "flashcards",
        status: "ready",
        createdAt: 0,
        updatedAt: 0,
        options: {},
        sourceIds: [],
        data: { cards: [{ front: "Why?", back: "Because." }] },
      } satisfies import("./types").StudioOutput;
      const counts = await Promise.all([addStudioFlashcards(output), addStudioFlashcards(output)]);
      expect(counts.sort()).toEqual([0, 1]);
      const grades = await Promise.all([
        rateStudyItem("studio-output-0", "easy", 1),
        rateStudyItem("studio-output-0", "good", 1),
      ]);
      expect(grades.sort()).toEqual([false, true]);
      const reviewed = await store().getStudy("studio-output-0");
      expect(await addStudioFlashcards(output)).toBe(0);
      expect(await store().getStudy("studio-output-0")).toEqual(reviewed);
      expect((await store().listStudy()).filter(({ kind }) => kind === "session")).toHaveLength(1);
      const backup = await exportBackup();
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy("studio-output-0")).toMatchObject({
        origin: { kind: "studio", outputId: "output", notebookId },
      });
    });

    it("stores a study card without a linked notebook", async () => {
      await putStudyRecords({
        id: "standalone",
        kind: "card",
        front: "Question",
        back: "Answer",
        tags: [],
        schedule: freshSchedule(0),
        updatedAt: 0,
      });
      expect(await store().getStudy("standalone")).toMatchObject({ front: "Question" });
    });

    it("loads only selected Tutor materials still owned by the conversation's vault", async () => {
      const work = await createVault({ name: "Work materials" });
      const other = await createVault({ name: "Private materials" });
      const first = await addStudyBook({
        title: "First",
        format: "text",
        vaultId: work,
        sections: [{ title: "Page", text: "Original material" }],
      });
      const second = await addStudyBook({
        title: "Second",
        format: "text",
        vaultId: work,
        sections: [{ title: "Page", text: "Second source" }],
      });
      const external = await addStudyBook({
        title: "External",
        format: "text",
        vaultId: other,
        sections: [{ title: "Page", text: "Private document" }],
      });
      const note = await createNote({
        title: "Selected note",
        vaultId: work,
        body: "Selected note text",
      });
      const privateNote = await createNote({
        title: "Private note",
        vaultId: other,
        body: "Private note text",
      });
      const sourceNotebook = await createNotebook("Research notebook", { vaultId: work });
      const source = await addSource({
        notebookId: sourceNotebook,
        title: "Working paper",
        kind: "text",
        text: "Working paper passage",
      });
      const privateSource = await addSource({
        notebookId: external.notebookId,
        title: "Private working paper",
        kind: "text",
        text: "Private working paper passage",
      });
      const thread = {
        id: "selected-materials",
        kind: "thread",
        title: "Compare",
        goal: "book",
        scope: "materials",
        vaultId: work,
        bookIds: [first.id, second.id, external.id],
        noteIds: [note.id, privateNote.id],
        sourceIds: [source.id, privateSource.id],
        messages: [],
        updatedAt: 0,
      } satisfies import("@/lib/study/records").StudyThread;
      await putStudyRecords(thread);
      const sources = await readStudyTutorSources(thread, work);
      expect(sources.books?.map(({ id }) => id)).toEqual([first.id, second.id]);
      expect(sources.notes?.map(({ id }) => id)).toEqual([note.id]);
      expect(sources.notebookSources).toMatchObject([
        { id: source.id, chunks: [{ id: `${source.id}:0`, text: source.text }] },
      ]);
      await updateNotebook(second.notebookId, { vaultId: other });
      await updateNotebook(sourceNotebook, { vaultId: other });
      const moved = await readStudyTutorSources(thread, work);
      expect(moved.books?.map(({ id }) => id)).toEqual([first.id]);
      expect(moved.notebookSources).toEqual([]);
      expect(await readStudyTutorSources(thread, other)).toEqual({});

      const directThread = await startSourceTutor(source.id);
      expect(directThread).toMatchObject({
        scope: "materials",
        vaultId: other,
        sourceIds: [source.id],
      });
      expect(await store().listStudy()).not.toContainEqual(
        expect.objectContaining({ kind: "book", sourceId: source.id }),
      );
      const reader = await studyBookForSource(source.id);
      expect(await startSourceTutor(source.id)).toMatchObject({ bookIds: [reader.id] });
      expect((await readStudyTutorSources(directThread, other)).notebookSources).toHaveLength(1);
      await deleteSource(source.id);
      expect((await readStudyTutorSources(directThread, other)).notebookSources).toEqual([]);

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy(thread.id)).toMatchObject({
        scope: "materials",
        bookIds: thread.bookIds,
        noteIds: thread.noteIds,
        sourceIds: thread.sourceIds,
      });
    });

    it("loads selected Tutor highlights and excludes highlights whose documents have moved", async () => {
      const work = await createVault({ name: "Coursework" });
      const other = await createVault({ name: "Private" });
      const quote = "An election quorum intersects every previous election quorum.";
      const createHighlight = async (id: string, vaultId: string) => {
        const book = await addStudyBook({
          title: id, format: "text", vaultId, sections: [{ title: "Page", text: quote }],
        });
        await putStudyRecords({
          id, kind: "highlight", bookId: book.id, section: 0, quote, offset: 0,
          color: "yellow", note: "An annotation", schedule: freshSchedule(0), updatedAt: 0,
        });
        return book;
      };
      const first = await createHighlight("chosen-mark", work);
      await createHighlight("unchosen-mark", work);
      await createHighlight("private-mark", other);
      const thread = await startHighlightTutor(["chosen-mark", "private-mark", "chosen-mark"], work, "Discuss highlights");
      if (!thread) throw new Error("Expected a Tutor conversation for the available highlight");
      expect(thread).toMatchObject({ scope: "materials", highlightIds: ["chosen-mark"] });
      const selected = await readStudyTutorSources(thread, work);
      expect(selected.highlights).toMatchObject([{ highlight: { id: "chosen-mark" }, book: { id: first.id } }]);
      expect(selected.books).toEqual([]);
      expect((await readStudyTutorSources({ ...thread, highlightIds: ["private-mark"] }, work)).highlights).toEqual([]);

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect((await readStudyThread(thread.id)).highlightIds).toEqual(["chosen-mark"]);
      expect(await store().getStudy("chosen-mark")).toMatchObject({ schedule: freshSchedule(0) });
      await updateNotebook(first.notebookId, { vaultId: other });
      expect((await readStudyTutorSources(thread, work)).highlights).toEqual([]);
      await deleteStudyBook(first);
      expect(await startHighlightTutor(["chosen-mark"], work, "Discuss highlights")).toBeNull();
    });

    it("keeps a Tutor flashcard set ordered and drops cards that change vaults through their origins", async () => {
      const work = await createVault({ name: "Engineering" });
      const other = await createVault({ name: "Private" });
      const book = await addStudyBook({
        title: "Consensus",
        format: "text",
        vaultId: work,
        sections: [{ title: "Chapter", text: "Two majorities overlap." }],
      });
      const tutor = await startBookTutor(book, { scope: "book", goal: "book" });
      const linked = await saveStudyCard({
        front: "What overlaps?",
        back: "Two majorities.",
        origin: { kind: "tutor", threadId: tutor.id },
        vaultId: other,
        tags: [],
      });
      const own = await saveStudyCard({ front: "Define epoch", back: "Leader term", vaultId: work, tags: [] });
      const privateNote = await createNote({ title: "Personal", body: "Private topic", vaultId: other });
      const hidden = await saveStudyCard({
        front: "Private cue", back: "Private answer", vaultId: work, tags: [],
        origin: { kind: "note", noteId: privateNote.id },
      });
      const thread = await startCardTutor([linked.id, hidden.id, own.id, linked.id], work, "Practice");
      if (!thread) throw new Error("Tutor should open with the available cards");
      expect(thread).toMatchObject({ scope: "cards", cardIds: [linked.id, own.id], practiceCardId: linked.id });
      expect((await readStudyTutorSources(thread, work)).cards?.map(({ id }) => id)).toEqual([linked.id]);
      await updateNotebook(book.notebookId, { vaultId: other });
      expect((await readStudyTutorSources(thread, work)).cards?.map(({ id }) => id)).toEqual([own.id]);
      expect((await readStudyTutorSources(thread, other)).cards).toEqual([]);
      await updateStudyThread(thread.id, { practiceCardId: own.id }, [
        { role: "user", text: "A leadership term.", practiceCardId: own.id },
      ]);
      expect((await readStudyTutorSources(await readStudyThread(thread.id), work, "report")).cards?.map(({ id }) => id)).toEqual([own.id]);
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await readStudyThread(thread.id)).toMatchObject({
        cardIds: [linked.id, own.id], practiceCardId: own.id,
        messages: [{ role: "user", practiceCardId: own.id }],
      });
      expect(await store().getStudy(own.id)).toMatchObject({ schedule: own.schedule });
    });

    it("keeps dated reports, flashcard origins and follow-ups through regeneration and backup", async () => {
      const legacy = {
        summary: "First report",
        corrections: [],
        nextSteps: ["Draw the original proof."],
      };
      await putStudyRecords({
        id: "thread-report",
        kind: "thread",
        title: "Consensus",
        goal: "teach-back",
        scope: "general",
        messages: [],
        updatedAt: 0,
        report: legacy,
        practiceLanguage: "en-US",
      });
      const origin = { kind: "report", threadId: "thread-report" } as const;
      await putStudyRecords({
        id: "first-card",
        kind: "card",
        front: "Proof",
        back: "Shared replica",
        tags: [],
        updatedAt: 0,
        schedule: freshSchedule(0),
        origin,
      });
      expect(
        await updateStudyReport("thread-report", {
          kind: "step",
          reportId: "legacy",
          action: "plan",
          index: 0,
        }),
      ).toBe(true);
      const newReport = {
        ...legacy,
        id: "second-report",
        summary: "New report",
        nextSteps: ["Explain the replacement proof."],
      };
      const writes = await Promise.all([
        updateStudyReport("thread-report", {
          kind: "save",
          report: newReport,
          practiceLanguage: null,
        }),
        updateStudyReport("thread-report", {
          kind: "step",
          reportId: "legacy",
          action: "complete",
          index: 0,
        }),
        updateStudyReport("thread-report", {
          kind: "feedback",
          reportId: "legacy",
          helpful: true,
          key: "technical-0",
        }),
        updateStudyThread("thread-report", {}, [
          { role: "user", text: "How do the proofs differ?" },
        ]),
      ]);
      expect(writes.slice(0, 3)).toEqual([true, true, true]);
      expect(
        await updateStudyReport("thread-report", {
          kind: "step",
          reportId: "second-report",
          action: "plan",
          index: 2,
        }),
      ).toBe(false);
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      const thread = await store().getStudy("thread-report");
      if (thread?.kind !== "thread") throw new Error("The Tutor conversation was not restored");
      expect(thread.practiceLanguage).toBeUndefined();
      expect(thread.messages).toEqual([{ role: "user", text: "How do the proofs differ?" }]);
      expect(studyReports(thread)).toMatchObject([
        newReport,
        { summary: "First report", feedback: { "technical-0": true } },
      ]);
      expect(plannedStudySteps([thread])).toMatchObject([
        { text: "Draw the original proof.", reportId: "legacy", completedAt: expect.any(Number) },
      ]);
      const card = await store().getStudy("first-card");
      expect(card?.kind === "card" && matchesStudyReport(card.origin, thread.id, "legacy")).toBe(
        true,
      );
      expect(
        card?.kind === "card" && matchesStudyReport(card.origin, thread.id, "second-report"),
      ).toBe(false);
      expect(
        await updateStudyReport(thread.id, {
          kind: "step",
          reportId: "legacy",
          action: "reopen",
          index: 0,
        }),
      ).toBe(true);
      const reopened = await store().getStudy(thread.id);
      expect(
        reopened?.kind === "thread" && plannedStudySteps([reopened])[0].completedAt,
      ).toBeUndefined();
      await store().deleteStudy(thread.id);
      expect(await updateStudyReport(thread.id, { kind: "save", report: newReport })).toBe(false);
    });

    it("keeps the latest reading place when older scroll writes arrive after changing sections", async () => {
      const quote = "Quorum intersection";
      const book = await addStudyBook({
        title: "Reader position",
        format: "text",
        sections: [{ title: "Introduction", text: "First page" }, { title: "Quorums", text: quote }],
      });
      const openedAt = Date.now();
      const previous = { section: 0, surface: "text" as const, progress: 0.3 };
      const current = { section: 1, surface: "text" as const, progress: 0.2, anchor: { offset: 0, quote, revision: 0 } };
      await saveStudyReadingPlace(book.id, previous, openedAt);
      await store().patchStudyBook({ id: book.id, change: { section: 1 }, updatedAt: openedAt + 20 });
      await saveStudyReadingPlace(book.id, current, openedAt + 30);
      await saveStudyReadingPlace(book.id, previous, openedAt + 10);
      await store().patchStudyBook({ id: book.id, change: { section: 0 }, updatedAt: openedAt + 15 });
      await store().patchStudyBook({ id: book.id, change: { bookmarks: [0] }, updatedAt: openedAt + 40 });
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy(book.id)).toMatchObject({
        section: 1, readingPlace: current, lastReadAt: openedAt + 30, bookmarks: [0],
      });
    });

    it("saves passage positions and notebook chunks atomically with a text edit", async () => {
      const quote = "Overlap through a shared replica.";
      const original = `Proof\n\n${quote}\n\n    function quorum() { return true; }`;
      const updated = `Expanded introduction\n\n${original}`;
      const book = await addStudyBook({
        title: "Proof",
        format: "text",
        sections: [{ title: "Section", text: original }],
      });
      const initial = await getChunks([book.sourceId]);
      const draft = { section: 0, original };
      const [save, competing] = await Promise.allSettled([
        saveStudyText(book.id, updated, draft),
        saveStudyText(book.id, `${original}\n\nOther revision`, draft),
        updateStudyBook(book.id, { bookmarks: [0], section: 0 }),
      ]);
      expect([save.status, competing.status].sort()).toEqual(["fulfilled", "rejected"]);
      const blocked = save.status === "rejected" ? save : competing;
      expect(blocked.status === "rejected" && blocked.reason).toBeInstanceOf(StudyTextConflict);
      const expected = save.status === "fulfilled" ? updated : `${original}\n\nOther revision`;
      const saved = await store().getStudy(book.id);
      expect(saved).toMatchObject({
        bookmarks: [0],
        sections: [{ text: expected }],
        textEdits: [{ section: 0 }],
      });
      expect((await store().getSource(book.sourceId))?.studyRevision).toBe(1);
      const editedChunkIds = (await getChunks([book.sourceId])).map(({ id }) => id);
      expect(editedChunkIds).not.toContain(initial[0].id);

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      const restored = await store().getStudy(book.id);
      if (restored?.kind !== "book") throw new Error("The book was not restored");
      expect(
        resolveStudyRange(restored, 0, { offset: original.indexOf(quote), length: quote.length }),
      ).toEqual({ offset: expected.indexOf(quote), length: quote.length });
      expect((await getChunks([book.sourceId])).map(({ id }) => id)).toEqual(editedChunkIds);
    });

    it("keeps study documents, reading material and spaced reviews in both backends and backups", async () => {
      const book = await addStudyBook({
        title: "A study document",
        format: "text",
        sections: [{ title: "Introduction", text: "Original example" }],
      });
      await saveStudyText(book.id, "Revised example");
      expect((await store().getSource(book.sourceId))?.text).toBe("Revised example");
      expect(await getChunks([book.sourceId])).toMatchObject([{ text: "Revised example" }]);
      await putStudyRecords({
        id: "study-card",
        kind: "card",
        front: "Prompt",
        back: "Answer",
        tags: [],
        schedule: freshSchedule(0),
        updatedAt: 0,
        notebookId: book.notebookId,
      });
      await rateStudyItem("study-card", "good", 25);
      expect(await store().getStudy("study-card")).toMatchObject({
        schedule: { state: "learning", step: 1, repetitions: 0 },
      });
      const backup = await exportBackup();
      expect(backup.study).toHaveLength(3);
      await deleteAllData();
      expect(await store().listStudy()).toEqual([]);
      await importBackup(JSON.parse(JSON.stringify(backup)));
      expect(await store().getStudy(book.id)).toMatchObject({
        sections: [{ text: "Revised example" }],
      });
      await deleteNotebook(book.notebookId);
      expect(await store().listStudy()).toEqual([]);
    });
  });

  describe("backup", () => {
    it("round-trips notebooks and rebuilds passages, without settings", async () => {
      const notebookId = await createNotebook("Kept");
      await addSource({ notebookId, title: "a", kind: "text", text: "hello world" });
      await updateProvider("openai", { enabled: true, apiKey: "secret" });
      const backup = await exportBackup();
      expect(JSON.stringify(backup)).not.toContain("secret");
      await deleteAllData();
      expect(await importBackup(JSON.parse(JSON.stringify(backup)))).toBe(1);
      expect((await store().listNotebooks())[0].title).toBe("Kept");
      expect(await store().count("chunks")).toBe(1);
    });

    it("round-trips conversations", async () => {
      const notebookId = await createNotebook("Kept");
      await saveChat({ id: id("backup-c"), notebookId }, [userMessage("a", "Hello there")]);
      const backup = await exportBackup();
      expect(backup.format).toBe(8);
      await deleteAllData();
      await importBackup(JSON.parse(JSON.stringify(backup)));
      expect((await store().getConversation(id("backup-c")))?.title).toBe("Hello there");
      expect((await loadChat(id("backup-c"))).map((m) => m.id)).toEqual(["a"]);
    });

    it("imports a format 1 backup, turning each notebook's chat into a conversation", async () => {
      await importBackup({
        app: "better-vault",
        format: 1,
        exportedAt: 1,
        notebooks: [{ id: "n1", title: "Old", createdAt: 1, updatedAt: 1 }],
        sources: [],
        messages: [
          { id: "n1:a", notebookId: "n1", createdAt: 5, message: userMessage("a", "Old question") },
        ],
        outputs: [],
      });
      expect((await store().getConversation("n1"))?.title).toBe("Old question");
      expect((await loadChat("n1")).map((m) => m.id)).toEqual(["a"]);
    });

    it("round-trips folders and files", async () => {
      const folderId = await createFolder("School", null);
      const notebookId = await createNotebook("Kept", { folderId });
      const blobId = await saveBlob({
        notebookId,
        mime: "audio/mpeg",
        data: new Uint8Array([7, 8, 9]),
      });
      const backup = await exportBackup();
      await deleteAllData();
      await importBackup(JSON.parse(JSON.stringify(backup)));
      expect((await store().listFolders())[0].name).toBe("School");
      expect((await store().getNotebook(notebookId))?.folderId).toBe(folderId);
      const blob = await loadBlob(blobId);
      expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([7, 8, 9]);
    });

    it("imports a format 2 backup, with no folders or files", async () => {
      await importBackup({
        app: "better-vault",
        format: 2,
        exportedAt: 1,
        notebooks: [{ id: "n2", title: "Two", createdAt: 1, updatedAt: 1 }],
        sources: [],
        conversations: [],
        messages: [],
        outputs: [],
      });
      expect((await store().listNotebooks()).map((notebook) => notebook.title)).toEqual(["Two"]);
      expect(await store().count("folders")).toBe(0);
    });

    it("rejects files that are not backups", async () => {
      await expect(importBackup({ hello: 1 })).rejects.toThrow("invalid-backup");
    });
  });

  describe("settings", () => {
    it("starts with no provider ready", async () => {
      const settings = await getSettings();
      expect(availableModels(settings)).toEqual([]);
      expect(activeModel(settings)).toBeNull();
    });

    it("needs a key for cloud providers and an address for local ones", () => {
      const settings = defaultSettings();
      settings.providers.anthropic.enabled = true;
      expect(isProviderReady(settings, "anthropic")).toBe(false);
      settings.providers.anthropic.apiKey = "k";
      expect(isProviderReady(settings, "anthropic")).toBe(true);
      settings.providers.ollama.enabled = true;
      expect(isProviderReady(settings, "ollama")).toBe(true);
    });

    it("falls back to the first available model when the chosen one is gone", () => {
      const settings = defaultSettings();
      settings.providers.anthropic = {
        ...settings.providers.anthropic,
        enabled: true,
        apiKey: "k",
        models: ["x", "y"],
      };
      settings.model = { provider: "openai", modelId: "gone" };
      expect(activeModel(settings)).toEqual({ provider: "anthropic", modelId: "x" });
      settings.model = { provider: "anthropic", modelId: "y" };
      expect(activeModel(settings)).toEqual({ provider: "anthropic", modelId: "y" });
    });
  });
});

describe("version 2 upgrade", () => {
  it("cleans sources and passages saved before text cleaning, keeping their ids", async () => {
    const { default: Dexie } = await import("dexie");
    const name = "better-vault-upgrade-test";
    const old = new Dexie(name);
    old.version(1).stores({
      notebooks: "id, updatedAt",
      sources: "id, notebookId, createdAt",
      chunks: "id, notebookId, sourceId, [sourceId+index]",
      messages: "id, notebookId, [notebookId+createdAt]",
      outputs: "id, notebookId, status, [notebookId+createdAt]",
      settings: "key",
    });
    await old.open();
    await old.table("sources").add({
      id: "s1",
      notebookId: "n1",
      title: "PDF",
      kind: "pdf",
      text: "Q What CO5?",
      charCount: 18,
      selected: true,
      createdAt: 1,
    });
    await old
      .table("chunks")
      .add({ id: "s1:0", notebookId: "n1", sourceId: "s1", index: 0, text: "Q What CO5?" });
    old.close();

    const { BetterVaultDatabase } = await import("./database");
    const upgraded = new BetterVaultDatabase(name);
    const source = await upgraded.sources.get("s1");
    const chunk = await upgraded.chunks.get("s1:0");
    expect(source?.text).toBe("Q What CO5?");
    expect(source?.charCount).toBe("Q What CO5?".length);
    expect(chunk?.text).toBe("Q What CO5?");
    upgraded.close();
    await Dexie.delete(name);
  });
});

describe("version 3 upgrade", () => {
  it("turns each notebook's chat into its first conversation", async () => {
    const { default: Dexie } = await import("dexie");
    const name = "better-vault-upgrade-3-test";
    const old = new Dexie(name);
    old.version(2).stores({
      notebooks: "id, updatedAt",
      sources: "id, notebookId, createdAt",
      chunks: "id, notebookId, sourceId, [sourceId+index]",
      messages: "id, notebookId, [notebookId+createdAt]",
      outputs: "id, notebookId, status, [notebookId+createdAt]",
      settings: "key",
    });
    await old.open();
    await old.table("messages").bulkAdd([
      {
        id: "n1:a",
        notebookId: "n1",
        createdAt: 10,
        message: userMessage("a", "Why is the sky blue?"),
      },
      {
        id: "n1:b",
        notebookId: "n1",
        createdAt: 11,
        message: { id: "b", role: "assistant", parts: [] },
      },
    ]);
    await old.table("sources").add({
      id: "s1",
      notebookId: "n1",
      title: "PDF",
      kind: "pdf",
      text: "Contents\n Course outcome",
      charCount: 25,
      selected: true,
      createdAt: 1,
    });
    old.close();

    const { BetterVaultDatabase } = await import("./database");
    const upgraded = new BetterVaultDatabase(name);
    const conversation = await upgraded.conversations.get("n1");
    expect(conversation).toMatchObject({
      notebookId: "n1",
      title: "Why is the sky blue?",
      createdAt: 10,
      updatedAt: 11,
    });
    expect((await upgraded.messages.toArray()).map((row) => row.conversationId)).toEqual([
      "n1",
      "n1",
    ]);
    expect((await upgraded.sources.get("s1"))?.text).toBe("Contents\nCourse outcome");
    upgraded.close();
    await Dexie.delete(name);
  });
});

describe("version 4 upgrade", () => {
  it("keeps notebooks and adds folders and files", async () => {
    const { default: Dexie } = await import("dexie");
    const name = "better-vault-upgrade-4-test";
    const old = new Dexie(name);
    old.version(3).stores({
      notebooks: "id, updatedAt",
      sources: "id, notebookId, createdAt",
      chunks: "id, notebookId, sourceId, [sourceId+index]",
      messages: "id, notebookId, conversationId, [conversationId+createdAt]",
      conversations: "id, notebookId, [notebookId+updatedAt]",
      outputs: "id, notebookId, status, [notebookId+createdAt]",
      settings: "key",
    });
    await old.open();
    await old.table("notebooks").add({ id: "n1", title: "Old", createdAt: 1, updatedAt: 1 });
    old.close();

    const { BetterVaultDatabase } = await import("./database");
    const upgraded = new BetterVaultDatabase(name);
    expect((await upgraded.notebooks.get("n1"))?.title).toBe("Old");
    await upgraded.folders.add({
      id: "f1",
      name: "School",
      parentId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await upgraded.folders.where("parentId").equals("x").count()).toBe(0);
    expect(await upgraded.blobs.count()).toBe(0);
    upgraded.close();
  });
});

describe("SQLite migration 2", () => {
  it("adds folders and files to a database made by an older version", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE notebooks (id TEXT PRIMARY KEY, updated_at REAL NOT NULL, doc TEXT NOT NULL);
      CREATE TABLE sources (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, created_at REAL NOT NULL, doc TEXT NOT NULL);
      CREATE TABLE chunks (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, source_id TEXT NOT NULL, idx INTEGER NOT NULL, doc TEXT NOT NULL);
      CREATE TABLE conversations (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, updated_at REAL NOT NULL, doc TEXT NOT NULL);
      CREATE TABLE messages (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, conversation_id TEXT NOT NULL, created_at REAL NOT NULL, doc TEXT NOT NULL);
      CREATE TABLE outputs (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, status TEXT NOT NULL, created_at REAL NOT NULL, doc TEXT NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
    db.prepare("INSERT INTO notebooks (id, updated_at, doc) VALUES (?, ?, ?)").run(
      "n1",
      1,
      JSON.stringify({ id: "n1", title: "Old", createdAt: 1, updatedAt: 1 }),
    );
    const sqlite = createSqliteStore(db);
    expect(sqlite.listNotebooks().map((notebook) => notebook.title)).toEqual(["Old"]);
    expect(sqlite.listFolders()).toEqual([]);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(
      schemaVersion,
    );
  });
});
