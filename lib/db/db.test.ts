import "fake-indexeddb/auto";
import {
  addQuizMissesToStudy,
  addStudyBook,
  addStudioFlashcards,
  deleteStudyDocument,
  removeStudyReadingProgress,
  studyBookForSource,
  freshSchedule,
  putStudyRecords,
  rateStudyItem,
  renameStudyBook,
  readStudyThread,
  readStudyTutorSources,
  readFlashcardDraftPassages,
  removeStudyRecord,
  saveStudyCard,
  saveStudyDraftCards,
  saveStudyNote,
  saveStudyWord,
  saveStudyReadingPlace,
  saveStudyOcrText,
  saveStudyOcrPages,
  saveStudyVisualCard,
  writeStudyOcrDraft,
  saveStudyText,
  startSourceTutor,
  startBookTutor,
  startBookImageTutor,
  startCardTutor,
  startHighlightTutor,
  startStudyFollowUp,
  StudyTextConflict,
  studyVocabularyCards,
  updateStudyBook,
  updateStudyReport,
  updateStudyReviewItem,
  updateStudyThread,
  updateStudyWord,
} from "./study";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAllData, exportBackup, importBackup } from "./backup";
import type { Backend } from "./backend";
import { createDexieBackend } from "./dexie-backend";
import { loadBlob, saveBlob } from "./blobs";
import { ancestors, createFolder, deleteFolder, moveFolder } from "./folders";
import { createNotebook, deleteNotebook, updateNotebook } from "./notebooks";
import {
  createOutput,
  createReadyOutput,
  deleteOutput,
  markInterruptedOutputs,
  saveFlashcardPractice,
  saveQuizAttempt,
} from "./outputs";
import { asBackend, createSqliteStore, schemaVersion } from "./sqlite/store";
import { setStoreForTests, store } from "./store";
import { conversationTitle } from "@/lib/chat/title";
import { studyVaultIndex } from "@/lib/study/vault";
import { originHref, studyCitationOrigin } from "@/lib/study/links";
import { passagesFor } from "@/lib/study/passages";
import { studyDocumentDraftId } from "@/lib/study/document-drafts";
import { scanDraftId } from "@/lib/study/ocr-write";
import type { StudyBook, StudyDocumentRecovery } from "@/lib/study/records";
import { studyImageId } from "@/lib/study/visual-card";
import { duplicateBooksFixture, expectMergedFixture } from "@/lib/study/book-merge.fixture";
import { toBase64 } from "@/lib/base64";
import { ingestFile } from "@/lib/sources/ingest";
import { resolveStudyRange } from "@/lib/study/text-edits";
import { captureReportPracticeContext, matchesStudyReport, plannedStudySteps, studyReports } from "@/lib/study/reports";
import {
  deleteConversation,
  latestConversation,
  loadChat,
  loadNotebookChat,
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
import {
  addSource,
  attachImages,
  deleteSource,
  getChunks,
  renameSource,
  setAllSourcesSelected,
  setSourceSelected,
} from "./sources";
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

    it("keeps original-only documents out of source selection and text passages", async () => {
      const notebookId = await createNotebook("Visual sources");
      const original = { mime: "application/pdf", data: Uint8Array.of(37, 80, 68, 70) };
      const scanned = await addSource({ notebookId, title: "Scan", kind: "pdf", text: "", original });
      const notes = await addSource({ notebookId, title: "Notes", kind: "text", text: "Read me." });
      expect(scanned).toMatchObject({ text: "", charCount: 0, selected: false });
      expect(await getChunks([scanned.id])).toEqual([]);
      expect(await store().getBlob(scanned.originalFileId ?? "")).toMatchObject(original);

      await setAllSourcesSelected(notebookId, false);
      expect((await store().getSource(notes.id))?.selected).toBe(false);
      await setAllSourcesSelected(notebookId, true);
      expect((await store().getSource(notes.id))?.selected).toBe(true);
      await setSourceSelected(scanned.id, true);
      expect((await store().getSource(scanned.id))?.selected).toBe(false);
      await expect(startSourceTutor(scanned.id)).rejects.toThrow("no selectable text");

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getSource(scanned.id)).toEqual(scanned);
      expect(await getChunks([scanned.id])).toEqual([]);
      expect(await store().getBlob(scanned.originalFileId ?? "")).toMatchObject(original);
    });

    it("keeps physical page positions without adding empty page headings to a notebook", async () => {
      const bytes = Uint8Array.of(37, 80, 68, 70);
      const mime = "application/pdf";
      const sections = [{ title: "Page 1", text: "" }, { title: "Page 2", text: "Genuine text." }];
      const mixed = await addStudyBook({ title: "Mixed", format: "pdf", bytes, mime, sections });
      const scanned = await addStudyBook({ title: "Scan", format: "pdf", bytes, mime, sections: sections.slice(0, 1) });
      expect(mixed.sections).toEqual(sections);
      expect((await getChunks([mixed.sourceId])).map(({ text }) => text)).toEqual(["Page 2\n\nGenuine text."]);
      expect(scanned.sections).toEqual(sections.slice(0, 1));
      expect(await getChunks([scanned.sourceId])).toEqual([]);
      expect((await store().getSource(scanned.sourceId))?.selected).toBe(false);
    });

    it("restores an image conversation with its exact page and checks vault and source ownership", async () => {
      const book = await addStudyBook({
        title: "Graphics",
        format: "pdf",
        sections: [{ title: "Page 1", text: "" }, { title: "Page 2", text: "Other text on the page." }],
        bytes: Uint8Array.of(37, 80, 68, 70),
        mime: "application/pdf",
      });
      const anchor = { kind: "pdf", top: 0 } as const;
      const snapshot = { context: { anchor }, file: { mime: "image/png", data: Uint8Array.of(1, 2, 3) } };
      const tutor = await startBookImageTutor(book, 1, snapshot);
      await updateStudyThread(tutor.id, {}, [{ role: "user", text: "Explain the diagram." }]);
      const reopened = await startBookImageTutor(book, 1, snapshot);
      expect(reopened.id).toBe(tutor.id);
      expect(reopened.messages).toHaveLength(1);
      expect((await startBookImageTutor(book, 0, snapshot)).id).not.toBe(tutor.id);
      const sources = await readStudyTutorSources(reopened, DEFAULT_VAULT);
      expect(sources.documentImage).toBe("data:image/png;base64,AQID");
      const visualOrigin = { kind: "book", bookId: book.id, section: 1, visual: anchor } as const;
      const visualPassage = {
        origin: visualOrigin,
        title: "Graphics · Page 2",
        text: "Other text on the page.",
      };
      expect(passagesFor(reopened, sources, "Explain the diagram.")).toEqual([visualPassage]);
      expect(await readFlashcardDraftPassages([visualOrigin, visualOrigin], DEFAULT_VAULT)).toEqual([
        { ...visualPassage, text: "", image: sources.documentImage },
      ]);
      const crop = { left: 10, top: 25, right: 40, bottom: 70 };
      const cropAnchor = { ...anchor, top: 2500, crop };
      const cropSnapshot = { context: { anchor: cropAnchor }, file: { mime: "image/png", data: Uint8Array.of(4, 5) } };
      const cropped = await startBookImageTutor(book, 1, cropSnapshot);
      const other = await startBookImageTutor(book, 1, {
        context: { anchor: { ...cropAnchor, crop: { ...crop, left: 60, right: 90 } } },
        file: { mime: "image/png", data: Uint8Array.of(6, 7) },
      });
      expect(new Set([tutor.id, cropped.id, other.id]).size).toBe(3);
      expect((await startBookImageTutor(book, 1, cropSnapshot)).id).toBe(cropped.id);
      const croppedSources = await readStudyTutorSources(cropped, DEFAULT_VAULT);
      const cropOrigin = { ...visualOrigin, visual: cropAnchor };
      expect(croppedSources.documentImage).toBe("data:image/png;base64,BAU=");
      expect(passagesFor(cropped, croppedSources, "Explain this area.")).toEqual([
        { ...visualPassage, origin: cropOrigin, text: "" },
      ]);
      expect(await readFlashcardDraftPassages([visualOrigin], "another-vault")).toEqual([]);
      const replyOrigin = { kind: "tutor", threadId: reopened.id, message: 0 } as const;
      const note = await saveStudyNote({
        title: "Diagram recap",
        body: "The diagram is the example.",
        notebookId: book.notebookId,
        origin: replyOrigin,
        imageReferences: [visualOrigin, visualOrigin],
      });
      expect(note.body).toBe([
        "The diagram is the example.",
        `[Open original](${originHref(replyOrigin)})`,
        `[Open image source](${originHref(visualOrigin)})`,
      ].join("\n\n"));
      expect((await readStudyTutorSources(reopened, "another-vault")).documentImage).toBeUndefined();
      expect((await readStudyTutorSources(reopened, DEFAULT_VAULT, "report")).documentImage).toBeUndefined();

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      const restored = await readStudyThread(tutor.id);
      expect(restored.messages).toEqual(reopened.messages);
      expect((await readStudyTutorSources(restored, DEFAULT_VAULT)).documentImage).toBe(sources.documentImage);
      const restoredCrop = await readStudyThread(cropped.id);
      expect(restoredCrop.imageContext?.anchor).toEqual(cropAnchor);
      expect((await readStudyTutorSources(restoredCrop, DEFAULT_VAULT)).documentImage).toBe(croppedSources.documentImage);
      expect(await readFlashcardDraftPassages([cropOrigin], DEFAULT_VAULT)).toEqual([
        { ...visualPassage, origin: cropOrigin, text: "", image: croppedSources.documentImage },
      ]);
      await deleteSource(book.sourceId);
      expect((await readStudyTutorSources(restored, DEFAULT_VAULT)).documentImage).toBeUndefined();
      expect(await readFlashcardDraftPassages([visualOrigin], DEFAULT_VAULT)).toEqual([]);
    });

    it("indexes reviewed OCR with the original PDF and preserves existing source text and selection", async () => {
      const original = Uint8Array.of(37, 80, 68, 70);
      const book = await addStudyBook({ title: "Mixed scan", format: "pdf", bytes: original,
        mime: "application/pdf", sections: [{ title: "Page 1", text: "" }, { title: "Page 2", text: "Native text." }] });
      const source = await store().getSource(book.sourceId);
      if (!source || !book.fileId) throw new Error("The PDF was not saved");
      await setSourceSelected(book.sourceId, false);
      const first = "Distinct OCR evidence for the review.";
      const scan = { bookId: book.id, fileId: book.fileId, section: 0, languages: ["eng"], previousText: "", text: first };
      await saveStudyOcrText(scan);
      await expect(saveStudyOcrText({ ...scan, text: "Stale replacement" })).rejects.toBeInstanceOf(StudyTextConflict);
      await expect(saveStudyOcrText({ ...scan, section: 1, previousText: "Native text." })).rejects.toBeInstanceOf(StudyTextConflict);
      const updated = `Corrected transcription.\n\n${first}`;
      await saveStudyOcrText({ ...scan, previousText: first, text: updated });
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      const saved = await store().getStudy(book.id);
      expect(saved).toMatchObject({ fileId: book.fileId, sections: [{ text: updated, ocrLanguages: ["eng"] }, { text: "Native text." }] });
      expect(await store().getSource(book.sourceId)).toMatchObject({
        text: `${source.text}\n\n${updated}`, selected: false, studyRevision: 2,
        pdfOcr: { baseLength: source.text.length, pages: { "0": { text: updated, languages: ["eng"] } } },
      });
      expect((await getChunks([book.sourceId])).map(({ text }) => text)).toEqual([source.text, updated]);
      expect((await store().getBlob(book.fileId))?.data).toEqual(original);
      if (saved?.kind !== "book") throw new Error("The book was not restored");
      expect(resolveStudyRange(saved, 0, { offset: 0, length: first.length, revision: 1 }))
        .toEqual({ offset: updated.indexOf(first), length: first.length });
    });

    it("publishes reviewed scan pages together and keeps the source unchanged after a conflict", async () => {
      const book = await addStudyBook({ title: "Scan packet", format: "pdf", bytes: Uint8Array.of(37, 80, 68, 70),
        mime: "application/pdf", sections: [{ title: "Page 1", text: "" }, { title: "Page 2", text: "Native text." }, { title: "Page 3", text: "" }] });
      if (!book.fileId) throw new Error("The original PDF was not saved");
      const write = { bookId: book.id, fileId: book.fileId, pages: [
        { section: 2, previousText: "", text: "Third page reviewed.", languages: ["eng"] },
        { section: 0, previousText: "", text: "First page reviewed.", languages: ["eng"] },
      ] };
      await expect(saveStudyOcrPages({ ...write, pages: [...write.pages,
        { section: 1, previousText: "Native text.", text: "Should never replace native text.", languages: ["eng"] }] }))
        .rejects.toBeInstanceOf(StudyTextConflict);
      expect(await store().getStudy(book.id)).toEqual(book);
      expect((await getChunks([book.sourceId])).map(({ text }) => text)).toEqual(["Page 2\n\nNative text."]);
      await saveStudyOcrPages(write);
      expect(await store().getStudy(book.id)).toMatchObject({ sections: [
        { text: "First page reviewed.", ocrLanguages: ["eng"] },
        { text: "Native text." },
        { text: "Third page reviewed.", ocrLanguages: ["eng"] },
      ] });
      expect((await getChunks([book.sourceId])).map(({ text }) => text))
        .toEqual(["Page 2\n\nNative text.", "First page reviewed.", "Third page reviewed."]);
      expect(await store().getSource(book.sourceId)).toMatchObject({ studyRevision: 2 });
    });

    it("preserves scan review drafts privately and only publishes the approved current version", async () => {
      const book = await addStudyBook({ title: "Scan packet", format: "pdf", bytes: Uint8Array.of(37, 80, 68, 70),
        mime: "application/pdf", sections: [{ title: "Page 1", text: "" }, { title: "Page 2", text: "" }, { title: "Page 3", text: "Native text." }] });
      if (!book.fileId) throw new Error("The original PDF was not saved");
      const id = scanDraftId(book.id);
      const first = { section: 0, previousText: "", text: "Reviewed passage.", languages: ["eng"], reviewed: true };
      const second = { section: 1, previousText: "", text: "Unreviewed evidence.", languages: ["eng"], reviewed: false };
      const draft = { bookId: book.id, fileId: book.fileId, version: "scan-review-v1", pages: [first, second] };
      expect(await writeStudyOcrDraft({ ...draft, pages: [{ ...first, section: 2, previousText: "Native text." }] })).toBe(false);
      expect(await writeStudyOcrDraft(draft)).toBe(true);
      expect(await writeStudyOcrDraft({ ...draft, version: "stale", pages: [] })).toBe(false);
      expect(await store().getStudy(book.id)).toEqual(book);
      expect((await getChunks([book.sourceId])).map(({ text }) => text)).toEqual(["Page 3\n\nNative text."]);

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy(id)).toMatchObject({ pages: [first, second], version: draft.version });
      await expect(saveStudyOcrText({ ...first, bookId: book.id, fileId: book.fileId })).rejects.toBeInstanceOf(StudyTextConflict);
      await expect(saveStudyOcrPages({ ...draft, pages: [first, second], draftVersion: draft.version }))
        .rejects.toBeInstanceOf(StudyTextConflict);
      await expect(saveStudyOcrPages({ ...draft, pages: [first], draftVersion: "stale" })).rejects.toBeInstanceOf(StudyTextConflict);
      await expect(saveStudyOcrPages({ ...draft, pages: [{ ...first, text: "A stale edit." }], draftVersion: draft.version }))
        .rejects.toBeInstanceOf(StudyTextConflict);

      await saveStudyOcrPages({ ...draft, pages: [first], draftVersion: draft.version });
      expect(await store().getStudy(id)).toMatchObject({ pages: [second] });
      expect((await getChunks([book.sourceId])).map(({ text }) => text)).toEqual(["Page 3\n\nNative text.", first.text]);
      expect(await writeStudyOcrDraft({ ...draft, replaces: draft.version, version: "late", pages: [first, second] })).toBe(false);
      expect(await writeStudyOcrDraft({ ...draft, replaces: draft.version, version: "discarded", pages: [] })).toBe(true);
      expect(await writeStudyOcrDraft({ ...draft, replaces: "discarded", version: "restarted", pages: [second] })).toBe(true);
      await store().deleteSource(book.sourceId);
      expect(await store().getStudy(id)).toBeUndefined();
      expect(await writeStudyOcrDraft({ ...draft, pages: [second] })).toBe(false);
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
      const otherNotebook = await createNotebook("Other notebook");
      await saveChat({ id: id("c1"), notebookId }, [userMessage("a", "What is a  cache?")]);
      await saveChat({ id: id("c2"), notebookId }, [userMessage("b", "Summarise the key ideas")]);
      expect((await loadChat(id("c1"))).map((m) => m.id)).toEqual(["a"]);
      expect((await loadNotebookChat(notebookId, id("c1")))?.map(({ id }) => id)).toEqual(["a"]);
      expect(await loadNotebookChat(otherNotebook, id("c1"))).toBeUndefined();
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

    it("preserves a quiz attempt through backup and rejects a second write from the same question", async () => {
      const notebookId = await createNotebook("Quiz notes");
      const id = await createReadyOutput({
        notebookId,
        toolId: "quiz",
        title: "Check understanding",
        options: {},
        sourceIds: [],
        data: {
          questions: [
            {
              question: "What intersects?",
              options: ["Quorums", "None"],
              answer: 0,
              explanation: "A shared replica",
              hint: "Overlap",
            },
          ],
        },
      });

      expect(await saveQuizAttempt(id, 0, { kind: "advance" })).toBeUndefined();
      expect(await saveQuizAttempt(id, 0, { kind: "answer", option: 2 })).toBeUndefined();
      const competing = await Promise.all([
        saveQuizAttempt(id, 0, { kind: "answer", option: 0 }),
        saveQuizAttempt(id, 0, { kind: "answer", option: 1 }),
      ]);
      expect(competing.filter(Boolean)).toHaveLength(1);
      const answered = competing.find(Boolean);
      expect(answered).toMatchObject({ index: 0, revision: 1 });
      const finished = await saveQuizAttempt(id, 1, { kind: "advance" });
      expect(finished).toEqual({ index: 1, revision: 2, answers: answered?.answers });

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect((await store().getOutput(id))?.quizAttempt).toEqual(finished);
      expect(await saveQuizAttempt(id, 1, { kind: "retry" })).toBeUndefined();
      expect(await saveQuizAttempt(id, 2, { kind: "retry" })).toEqual({
        revision: 3,
        index: 0,
        answers: [],
      });
      await deleteOutput(id);
      expect(await saveQuizAttempt(id, 3, { kind: "answer", option: 0 })).toBeUndefined();
    });

    it("restores flashcard practice and sends only the original missed card to Study", async () => {
      const notebookId = await createNotebook("Consensus notes");
      const id = await createReadyOutput({
        notebookId,
        toolId: "flashcards",
        title: "Recall consensus",
        options: {},
        sourceIds: [],
        data: {
          cards: [
            { front: "Known", back: "Answer one" },
            { front: "Skipped", back: "Answer two" },
            { front: "Missed", back: "Answer three" },
          ],
        },
      });
      await saveFlashcardPractice(id, 0, { kind: "grade", grade: "known" });
      expect(await saveFlashcardPractice(id, 0, { kind: "grade", grade: "missed" })).toBeUndefined();
      await saveFlashcardPractice(id, 1, { kind: "move", offset: 1 });
      await saveFlashcardPractice(id, 2, { kind: "flip" });
      expect((await store().getOutput(id))?.flashcardPractice).toMatchObject({
        position: 2,
        flipped: true,
      });
      const results = await saveFlashcardPractice(id, 3, { kind: "grade", grade: "missed" });
      expect(results).toMatchObject({
        position: 3,
        flipped: false,
        grades: { 0: "known", 2: "missed" },
      });

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      const restored = await store().getOutput(id);
      expect(restored?.flashcardPractice).toEqual(results);
      expect(await saveFlashcardPractice(id, 4, { kind: "restart", mode: "missed" })).toMatchObject({
        order: [2],
        position: 0,
        grades: {},
      });

      if (!restored) throw new Error("Expected the restored flashcards");
      const selection = await addStudioFlashcards(restored, [2, 2, 8]);
      expect(selection).toEqual({ added: 1, cardIds: [`studio-${id}-2`] });
      expect((await store().listStudy()).map((row) => row.id)).toEqual(selection.cardIds);
      const cardId = selection.cardIds[0];
      expect(await rateStudyItem(cardId, "easy", 3)).toBe(true);
      const reviewed = await store().getStudy(cardId);
      expect(await addStudioFlashcards(restored, [2])).toEqual({ added: 0, cardIds: [cardId] });
      expect(await store().getStudy(cardId)).toEqual(reviewed);
    });
  });

  describe("study", () => {
    it("keeps a visual flashcard's image and original location through a backup", async () => {
      const image = "data:image/png;base64,cGljdHVyZQ==";
      const book = await addStudyBook({
        title: "Assembly",
        format: "pdf",
        sections: [{ title: "Page 1", text: "Assembly diagram" }],
      });
      const card = await saveStudyCard({
        front: "Which component moves first?",
        back: "The cam follower.",
        backImage: image,
        notebookId: book.notebookId,
        origin: { kind: "book", bookId: book.id, section: 0, visual: { kind: "pdf", top: 2780 } },
        tags: [],
      });
      const backup = await exportBackup();
      await deleteAllData();
      await importBackup(backup);
      const restored = await store().getStudy(card.id);
      expect(restored).toMatchObject({ backImage: image, origin: card.origin });
      if (restored?.kind !== "card" || !restored.origin) throw new Error("Card source was lost.");
      const destination = new URL(originHref(restored.origin), "https://deep-le.test");
      expect(destination.searchParams.get("book")).toBe(book.id);
      expect(destination.searchParams.get("page")).toBe("0");
      expect(destination.searchParams.get("pageTop")).toBe("2780");
      expect(destination.searchParams.get("reference")).toBe("1");
    });

    it("keeps document drafts out of notebook sources and rejects writes after deletion", async () => {
      const vaultId = await createVault({ name: "Physics" });
      const notebookId = await createNotebook("Mechanics", { vaultId });
      const source = await addSource({
        notebookId,
        title: "Kinetic energy",
        kind: "text",
        text: "The energy depends on the square of speed.",
      });
      const book = await studyBookForSource(source.id);
      const draft: StudyDocumentRecovery = {
        id: studyDocumentDraftId({ bookId: book.id, section: 0 }),
        bookId: book.id,
        notebookId,
        vaultId,
        kind: "document-draft",
        updatedAt: 1,
        version: "typed",
        snapshot: {
          kind: "edit",
          original: source.text,
          text: "**Revised** energy explanation.",
          markdown: true,
        },
      };
      const fresh: StudyDocumentRecovery = {
        id: studyDocumentDraftId({ vaultId }),
        vaultId,
        kind: "document-draft",
        updatedAt: 1,
        version: "new",
        snapshot: { kind: "new", title: "Potential energy", text: "# Draft", markdown: true },
      };

      expect(await store().writeStudyDocumentDraft(draft)).toBe(true);
      expect(await store().writeStudyDocumentDraft(fresh)).toBe(true);
      expect(await store().getStudy(book.id)).toEqual(book);
      expect((await store().getSource(source.id))?.text).toBe(source.text);
      expect((await getChunks([source.id])).map(({ text }) => text)).toEqual([source.text]);
      const backup = await exportBackup();
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy(draft.id)).toEqual(draft);
      expect(await store().getStudy(fresh.id)).toEqual(fresh);

      await removeStudyReadingProgress(book);
      expect(await store().getStudy(draft.id)).toEqual(draft);
      await deleteStudyDocument(book);
      expect(await store().getStudy(draft.id)).toBeUndefined();
      expect(await store().writeStudyDocumentDraft({ ...draft, updatedAt: 2 })).toBe(false);
      expect(await store().getSource(source.id)).toBeUndefined();

      await deleteVault(vaultId);
      expect(await store().getStudy(fresh.id)).toBeUndefined();
      expect(await store().writeStudyDocumentDraft({ ...fresh, updatedAt: 2 })).toBe(false);
    });

    it("preserves another tab's newer draft and keeps a discarded draft cleared", async () => {
      const first: StudyDocumentRecovery = {
        id: studyDocumentDraftId({ vaultId: DEFAULT_VAULT }),
        vaultId: DEFAULT_VAULT,
        kind: "document-draft",
        updatedAt: 1,
        version: "first",
        snapshot: { kind: "new", title: "Draft", text: "First version", markdown: false },
      };
      const next: StudyDocumentRecovery = {
        ...first,
        updatedAt: 2,
        version: "next",
        snapshot: { kind: "new", title: "Draft", text: "Next version", markdown: false },
      };
      const discarded = { ...next, version: "discarded", updatedAt: 3, snapshot: null };
      expect(await store().writeStudyDocumentDraft(first)).toBe(true);
      expect(await store().writeStudyDocumentDraft(next)).toBe(true);
      expect(await store().writeStudyDocumentDraft(discarded, first.version)).toBe(false);
      expect(await store().getStudy(first.id)).toEqual(next);
      expect(await store().writeStudyDocumentDraft(discarded, next.version)).toBe(true);
      expect(await store().writeStudyDocumentDraft(next)).toBe(false);
      expect(await store().getStudy(first.id)).toEqual(discarded);
    });

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
      expect(await addQuizMissesToStudy(output, [1, 1, 9])).toEqual({
        added: 1,
        cardIds: ["quiz-quiz-1"],
      });
      expect(await store().getStudy("quiz-quiz-0")).toBeUndefined();
      expect(await rateStudyItem("quiz-quiz-1", "easy", 1)).toBe(true);
      const card = await store().getStudy("quiz-quiz-1");
      expect(card).toMatchObject({
        front: "Second?",
        back: "B\n\nBecause B.",
        quizChoices: ["A", "B"],
        origin: { kind: "studio", notebookId, outputId: "quiz" },
      });
      expect(await addQuizMissesToStudy(output, [1])).toEqual({ added: 0, cardIds: ["quiz-quiz-1"] });
      expect(await store().getStudy("quiz-quiz-1")).toEqual(card);

      if (card?.kind !== "card") throw new Error("Missing quiz review card");
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy(card.id)).toEqual(card);

      await store().addOutput(output);
      const legacy = { ...card, quizChoices: undefined };
      await putStudyRecords(legacy);
      const draft = { id: "quiz-feedback", text: "I chose option A. How should I revise my reasoning?", at: Date.now() };
      const tutor = await startCardTutor([card.id], DEFAULT_VAULT, "Quiz practice", draft);
      if (!tutor) throw new Error("Missing flashcard practice conversation");
      expect(await readStudyThread(tutor.id)).toMatchObject({ draft, messages: [], practiceCardId: card.id });
      const readCard = async () => (await readStudyTutorSources(tutor, DEFAULT_VAULT)).cards?.[0];
      expect(await readCard()).toMatchObject({ quizChoices: ["A", "B"], schedule: card.schedule });
      expect(await store().getStudy(card.id)).toEqual(legacy);

      await putStudyRecords({ ...legacy, front: "Which choice shares a replica?" });
      expect((await readCard())?.quizChoices).toBeUndefined();
      await putStudyRecords({ ...legacy, quizChoices: [] });
      expect((await readCard())?.quizChoices).toEqual([]);
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
      expect(first).toMatchObject({ id: `source-${source.id}`, notebookId, sourceId: source.id });
      expect(first).not.toHaveProperty("attachedToNotebook");
      await updateStudyBook(first.id, { bookmarks: [0] });
      await removeStudyReadingProgress(first);
      expect(await store().getNotebook(notebookId)).toBeDefined();
      expect(await store().getSource(source.id)).toBeDefined();
      expect(await store().getStudy(first.id)).toMatchObject({ bookmarks: [], section: 0, sections: first.sections });
      expect(await store().listStudy()).toHaveLength(1);
    });

    it("keeps one Study book per source", async () => {
      const notebookId = await createNotebook("Notebook");
      const source = await addSource({ notebookId, title: "Source", kind: "text", text: "Read this" });
      const book = await studyBookForSource(source.id);
      const copy = { ...book, id: "copy" };
      await expect(putStudyRecords(copy)).rejects.toThrow();
      expect(await store().insertStudy([copy])).toBe(0);
      expect(await store().attachStudyBook(copy)).toEqual(book);
      expect((await store().listStudy()).map(({ id }) => id)).toEqual([book.id]);
      // The book itself can still be written again.
      await putStudyRecords({ ...book, bookmarks: [0] });
      expect(await store().getStudy(book.id)).toMatchObject({ bookmarks: [0] });
    });

    it("lists every source without its text, telling which ones Study can read", async () => {
      const notebookId = await createNotebook("Library");
      const text = await addSource({ notebookId, title: "Notes", kind: "text", text: "  Words.  " });
      const scan = await addSource({
        notebookId, title: "Scan", kind: "pdf", text: "", original: { data: Uint8Array.of(37, 80, 68, 70), mime: "application/pdf" },
      });
      const summaries = await store().listSourceSummaries();
      expect(summaries.toSorted((a, b) => a.title.localeCompare(b.title))).toEqual([
        { id: text.id, notebookId, title: "Notes", kind: "text", createdAt: text.createdAt, hasText: true, readable: true },
        { id: scan.id, notebookId, title: "Scan", kind: "pdf", createdAt: scan.createdAt, hasText: false, readable: true },
      ]);
      for (const summary of summaries) expect(summary).not.toHaveProperty("text");
    });

    it("renames a notebook with its document only when the notebook is named after its only source", async () => {
      const book = await addStudyBook({ title: "Raft", format: "text", sections: [{ title: "Raft", text: "Leaders log." }] });
      await renameSource(book.sourceId, "Raft consensus");
      expect((await store().getNotebook(book.notebookId))?.title).toBe("Raft consensus");
      expect(await store().getStudy(book.id)).toMatchObject({ title: "Raft consensus" });
      await addSource({ notebookId: book.notebookId, title: "Paxos", kind: "text", text: "Acceptors." });
      await renameStudyBook(book, "Raft paper");
      expect((await store().getNotebook(book.notebookId))?.title).toBe("Raft consensus");
      expect((await store().getSource(book.sourceId))?.title).toBe("Raft paper");
    });

    describe("deleting a Study book", () => {
      const highlight = (book: StudyBook, id: string) => ({
        id, kind: "highlight", bookId: book.id, notebookId: book.notebookId, section: 0, quote: "Quorum",
        offset: 0, color: "yellow", note: "", schedule: freshSchedule(0), updatedAt: 0,
      }) as const;
      const ownerOf = async (id: string) => {
        const rows = await store().listStudy();
        const scope = studyVaultIndex({
          rows, notebooks: await store().listNotebooks(), notes: await store().listNotes(),
          vaults: await listVaults(), defaultVaultId: DEFAULT_VAULT,
        });
        const row = rows.find((entry) => entry.id === id);
        return row && { vault: scope.owner(row), notebookId: row.notebookId };
      };

      it("removes an imported book with its source and notebook and keeps what was learned from it", async () => {
        const work = await createVault({ name: "English" });
        const book = await addStudyBook({
          title: "Quorums", format: "pdf", bytes: Uint8Array.of(37, 80, 68, 70), mime: "application/pdf",
          sections: [{ title: "Page 1", text: "A quorum overlaps." }], vaultId: work,
        });
        const { notebookId, sourceId } = book;
        await putStudyRecords(
          highlight(book, "mark"),
          { id: scanDraftId(book.id), kind: "ocr-draft", bookId: book.id, notebookId, fileId: book.fileId ?? "",
            version: "v1", pages: [], updatedAt: 0 },
        );
        expect(await store().writeStudyDocumentDraft({
          id: studyDocumentDraftId({ bookId: book.id, section: 0 }), kind: "document-draft", bookId: book.id,
          notebookId, version: "v1", updatedAt: 0, snapshot: null,
        })).toBe(true);
        await store().putBlob({ id: studyImageId(book.id, 0, { kind: "pdf", top: 0 }), notebookId, sourceId,
          mime: "image/png", data: Uint8Array.of(1), createdAt: 0 });
        const origin = { kind: "book", bookId: book.id, section: 0 } as const;
        const card = await saveStudyCard({ front: "What overlaps?", back: "A quorum", tags: [], notebookId, origin });
        const word = await saveStudyWord({ term: "quorum", language: "English", translation: "", note: "",
          context: "A quorum overlaps.", notebookId, origin });
        const [wordCard] = await studyVocabularyCards([word.id], work);
        const tutor = await startBookTutor(book, { scope: "book", goal: "book" });
        expect(await rateStudyItem("mark", "good", 5)).toBe(true);
        const review = (await store().listStudy()).find((row) => row.kind === "session" && row.itemId === "mark");

        await deleteStudyDocument(book);
        expect(await store().getNotebook(notebookId)).toBeUndefined();
        expect(await store().getSource(sourceId)).toBeUndefined();
        expect(await store().count("chunks")).toBe(0);
        expect(await store().count("blobs")).toBe(0);
        for (const gone of [book.id, "mark", scanDraftId(book.id), studyDocumentDraftId({ bookId: book.id, section: 0 })])
          expect(await store().getStudy(gone)).toBeUndefined();
        for (const kept of [card.id, word.id, wordCard, tutor.id, review?.id ?? "review"])
          expect(await ownerOf(kept)).toEqual({ vault: work, notebookId: undefined });
        expect(await store().getStudy(card.id)).toMatchObject({ front: "What overlaps?", origin, schedule: card.schedule });
      });

      it("keeps the notebook and everything else in it when it holds more than the book", async () => {
        const book = await addStudyBook({ title: "Raft", format: "text", sections: [{ title: "Raft", text: "Leaders log." }] });
        const { notebookId, sourceId } = book;
        const other = await addSource({ notebookId, title: "Paxos", kind: "text", text: "Acceptors promise." });
        await saveChat({ id: id("kept-chat"), notebookId }, [userMessage("question")]);
        const outputId = await createReadyOutput({ notebookId, toolId: "whiteboard", title: "Board", options: {},
          sourceIds: [other.id], data: {} });
        await putStudyRecords(highlight(book, "mark"));
        const card = await saveStudyCard({ front: "Who logs?", back: "Leaders", tags: [], notebookId,
          origin: { kind: "book", bookId: book.id } });

        await deleteStudyDocument(book);
        expect(await store().getNotebook(notebookId)).toBeDefined();
        expect(await store().getSource(sourceId)).toBeUndefined();
        expect(await getChunks([sourceId])).toEqual([]);
        expect(await store().getSource(other.id)).toBeDefined();
        expect(await getChunks([other.id])).toHaveLength(1);
        expect((await loadChat(id("kept-chat"))).map(({ id }) => id)).toEqual(["question"]);
        expect(await store().getOutput(outputId)).toBeDefined();
        expect(await store().getStudy("mark")).toBeUndefined();
        expect(await ownerOf(card.id)).toEqual({ vault: DEFAULT_VAULT, notebookId });

        const noted = await addStudyBook({ title: "Notes", format: "text", sections: [{ title: "Notes", text: "Terms." }] });
        const note = await createNote({ vaultId: DEFAULT_VAULT, title: "Kept", notebookId: noted.notebookId });
        const neighbour = await addStudyBook({ title: "Shelf", format: "text", sections: [{ title: "Shelf", text: "Words." }] });
        await putStudyRecords({ ...neighbour, id: "neighbour", sourceId: "other-source", notebookId: noted.notebookId });
        await deleteStudyDocument(noted);
        expect(await store().getNotebook(noted.notebookId)).toBeDefined();
        expect(await store().getNote(note.id)).toBeDefined();
        expect(await store().getStudy("neighbour")).toBeDefined();
      });

      it("removes only the reading progress of a document and leaves its source and text", async () => {
        const notebookId = await createNotebook("Course");
        const source = await addSource({ notebookId, title: "Lecture", kind: "text", text: "Terms overlap." });
        const book = await studyBookForSource(source.id);
        await putStudyRecords(highlight(book, "mark"), { ...highlight(book, "loose"), notebookId: undefined });
        const card = await saveStudyCard({ front: "What overlaps?", back: "Terms", tags: [], notebookId,
          origin: { kind: "book", bookId: book.id, section: 0, offset: 0, length: 5 } });
        await saveStudyReadingPlace(book.id, { section: 0, surface: "text", progress: 0.5 }, Date.now());
        await updateStudyBook(book.id, {
          bookmarks: [0],
          bookmarkPlaces: [{ id: "place", section: 0, offset: 0, quote: "Terms" }],
          readingAppearance: { textSize: 20 },
        });

        await removeStudyReadingProgress(book);
        expect(await store().getNotebook(notebookId)).toBeDefined();
        expect(await store().getSource(source.id)).toBeDefined();
        expect(await getChunks([source.id])).toHaveLength(1);
        const reset = await store().getStudy(book.id);
        expect(reset).toMatchObject({ section: 0, bookmarks: [], sections: book.sections, readingAppearance: { textSize: 20 } });
        expect(reset).not.toHaveProperty("readingPlace");
        expect(reset).not.toHaveProperty("bookmarkPlaces");
        expect(reset).not.toHaveProperty("lastReadAt");
        expect(await store().getStudy("mark")).toBeUndefined();
        expect(await store().getStudy("loose")).toBeUndefined();
        expect(await store().getStudy(card.id)).toEqual(card);
        expect(await ownerOf(card.id)).toEqual({ vault: DEFAULT_VAULT, notebookId });
        expect(await store().resetStudyBook("gone", Date.now())).toBe(false);
      });

      it("deletes a document opened from a notebook source like any other, keeping other sources", async () => {
        const notebookId = await createNotebook("Course");
        const source = await addSource({ notebookId, title: "Lecture", kind: "text", text: "Terms overlap." });
        const other = await addSource({ notebookId, title: "Reading", kind: "text", text: "More terms." });
        const book = await studyBookForSource(source.id);
        await putStudyRecords(highlight(book, "mark"));
        const card = await saveStudyCard({ front: "What overlaps?", back: "Terms", tags: [], notebookId,
          origin: { kind: "book", bookId: book.id } });

        await deleteStudyDocument(book);
        expect(await store().getNotebook(notebookId)).toBeDefined();
        expect(await store().getSource(source.id)).toBeUndefined();
        expect(await getChunks([source.id])).toEqual([]);
        expect(await store().getSource(other.id)).toBeDefined();
        expect(await store().getStudy(book.id)).toBeUndefined();
        expect(await store().getStudy("mark")).toBeUndefined();
        expect(await ownerOf(card.id)).toEqual({ vault: DEFAULT_VAULT, notebookId });

        // A source not opened in Study yet is deleted the same way, and its notebook with it once empty.
        const single = await createNotebook("Single");
        const unread = await addSource({ notebookId: single, title: "Unread", kind: "text", text: "Not opened." });
        const word = await saveStudyWord({ term: "opened", language: "English", translation: "", note: "",
          context: "Not opened.", notebookId: single,
          origin: { kind: "source", notebookId: single, sourceId: unread.id, chunkId: `${unread.id}:0` } });
        await deleteStudyDocument({ notebookId: single, sourceId: unread.id });
        expect(await store().getSource(unread.id)).toBeUndefined();
        expect(await store().getNotebook(single)).toBeUndefined();
        expect(await ownerOf(word.id)).toEqual({ vault: DEFAULT_VAULT, notebookId: undefined });
        await deleteStudyDocument({ notebookId: single, sourceId: unread.id });
      });

      it("keeps a book's saved text when its notebook source is deleted, and cleans up when the book goes", async () => {
        const book = await addStudyBook({ title: "Copy", format: "text", sections: [{ title: "Copy", text: "Saved text." }] });
        await putStudyRecords(highlight(book, "mark"));
        await deleteSource(book.sourceId);
        expect(await store().getStudy(book.id)).toEqual(book);
        expect(await store().getStudy("mark")).toBeDefined();
        expect(await store().getNotebook(book.notebookId)).toBeDefined();

        await deleteStudyDocument(book);
        expect(await store().getNotebook(book.notebookId)).toBeUndefined();
        expect(await store().listStudy()).toEqual([]);
      });
    });

    it("reads an uploaded Markdown source with its original formatting and preserves notebook chunks", async () => {
      const notebookId = await createNotebook("Algorithms");
      const markdown = "# Control flow\r\n\r\n~~~python\r\nif ready:\r\n    start()\r\n~~~";
      const source = await ingestFile(notebookId, new File([markdown], "algorithms.markdown"));
      expect(source).toMatchObject({ kind: "markdown", fileName: "algorithms.markdown" });
      const original = await loadBlob(source.originalFileId ?? "");
      expect(original?.type).toBe("text/markdown");
      expect(await original?.text()).toBe(markdown);
      const chunks = await getChunks([source.id]);

      const study = await studyBookForSource(source.id);
      expect(study).toMatchObject({
        sourceId: source.id,
        notebookId,
        fileId: source.originalFileId,
        format: "text",
        sections: [{
          text: "Control flow\nif ready:\n    start()",
          markdown: markdown.replaceAll("\r\n", "\n"),
        }],
      });
      expect(await getChunks([source.id])).toEqual(chunks);
      expect(await store().listNotebooks()).toHaveLength(1);
      expect(await store().listSources(notebookId)).toHaveLength(1);

      // Opened from the notebook, it is edited like a document made in Study:
      // the notebook keeps it as Markdown, with new passages.
      const edited = "# Control flow\n\nRun `start()` when ready.";
      await saveStudyText(study.id, edited, {
        section: 0,
        original: study.sections[0].text,
        originalMarkdown: study.sections[0].markdown,
        markdown: true,
      });
      expect(await store().getStudy(study.id)).toMatchObject({
        sections: [{ text: "Control flow\nRun start() when ready.", markdown: edited }],
        textEdits: [{ section: 0 }],
      });
      expect(await store().getSource(source.id)).toMatchObject({ text: edited, charCount: edited.length, studyRevision: 1 });
      expect((await getChunks([source.id])).map(({ id, text }) => [id, text])).toEqual([[`${source.id}:1:0`, edited]]);
    });

    it("edits the text of a plain source opened from its notebook, with its passages", async () => {
      const notebookId = await createNotebook("Physics");
      const source = await addSource({ notebookId, title: "Lecture", kind: "url", text: "Energy is conserved." });
      const book = await studyBookForSource(source.id);
      await saveStudyText(book.id, "Energy is always conserved.", { section: 0, original: "Energy is conserved." });
      expect(await store().getSource(source.id)).toMatchObject({ text: "Energy is always conserved.", studyRevision: 1 });
      expect((await getChunks([source.id])).map(({ text }) => text)).toEqual(["Energy is always conserved."]);
      expect((await store().getStudy(book.id))?.kind === "book" && (await store().getStudy(book.id))).toMatchObject({
        sections: [{ title: "Lecture", text: "Energy is always conserved." }],
      });
    });

    it("renames the notebook source and Study document together without replacing saved passages", async () => {
      const notebookId = await createNotebook("Mechanics notebook");
      const source = await addSource({
        notebookId,
        title: "Lecture transcript",
        kind: "text",
        text: "Momentum is conserved in a closed system.",
      });
      const book = await studyBookForSource(source.id);
      await updateStudyBook(book.id, { bookmarks: [0] });
      await renameSource(source.id, "Momentum");
      expect(await store().getStudy(book.id)).toMatchObject({
        title: "Momentum",
        sections: [{ title: "Momentum", text: source.text }],
        bookmarks: [0],
      });
      await renameStudyBook(book, "Conservation of momentum");
      expect((await store().getSource(source.id))?.title).toBe("Conservation of momentum");
      expect((await store().getNotebook(notebookId))?.title).toBe("Mechanics notebook");
      expect(await getChunks([source.id])).toMatchObject([
        { id: `${source.id}:0`, text: source.text },
      ]);
      expect((await studyBookForSource(source.id)).id).toBe(book.id);

      const standalone = await addStudyBook({
        title: "Tutorial",
        format: "text",
        sections: [{ title: "Worked example", text: source.text }],
      });
      await renameStudyBook(standalone, "Momentum tutorial");
      expect((await store().getNotebook(standalone.notebookId))?.title).toBe("Momentum tutorial");
      expect((await store().getSource(standalone.sourceId))?.title).toBe("Momentum tutorial");
      expect(await store().getStudy(standalone.id)).toMatchObject({
        title: "Momentum tutorial",
        sections: [{ title: "Worked example", text: source.text }],
      });
    });

    it("adds a Study document to an existing notebook as one more source", async () => {
      const notebookId = await createNotebook("Cell biology");
      const lecture = await addSource({ notebookId, title: "Lecture", kind: "text", text: "Cells divide." });
      const book = await addStudyBook({
        title: "Mitosis",
        format: "text",
        sections: [{ title: "Mitosis", text: "Prophase comes first." }],
        notebookId,
        url: "https://example.com/mitosis",
      });
      expect(book).toMatchObject({ notebookId, title: "Mitosis" });
      expect(book).not.toHaveProperty("attachedToNotebook");
      expect(await store().listNotebooks()).toHaveLength(1);
      const sources = await store().listSources(notebookId);
      expect(sources.map(({ id }) => id).sort()).toEqual([lecture.id, book.sourceId].sort());
      expect(await store().getSource(book.sourceId)).toMatchObject({
        title: "Mitosis",
        text: "Prophase comes first.",
        url: "https://example.com/mitosis",
      });
      expect(await getChunks([book.sourceId])).toMatchObject([{ text: "Prophase comes first." }]);
      expect(await studyBookForSource(book.sourceId)).toMatchObject({ id: book.id });

      await saveStudyText(book.id, "Prophase comes first, then metaphase.", {
        section: 0,
        original: "Prophase comes first.",
      });
      expect((await store().getSource(book.sourceId))?.text).toBe("Prophase comes first, then metaphase.");

      await renameStudyBook(book, "Cell division");
      expect((await store().getNotebook(notebookId))?.title).toBe("Cell biology");
      expect((await store().getSource(book.sourceId))?.title).toBe("Cell division");

      await deleteStudyDocument(book);
      expect(await store().getNotebook(notebookId)).toBeDefined();
      expect(await store().getSource(lecture.id)).toBeDefined();
      expect(await store().getSource(book.sourceId)).toBeUndefined();
      expect(await store().getStudy(book.id)).toBeUndefined();

      await deleteNotebook(notebookId);
      await expect(
        addStudyBook({ title: "Late", format: "text", sections: [{ title: "Late", text: "Text" }], notebookId }),
      ).rejects.toThrow();
      expect(await store().listNotebooks()).toEqual([]);
    });

    it("resolves a removed source's citation from its saved Study text in the notebook's vault", async () => {
      const otherVault = await createVault({ name: "Reference material" });
      const notebookId = await createNotebook("Control theory");
      const quote = "The dominant poles determine response time.";
      const source = await addSource({ notebookId, title: "Poles", kind: "text", text: quote });
      const [chunk] = await getChunks([source.id]);
      const book = await studyBookForSource(source.id);
      const origin = {
        kind: "source",
        notebookId,
        sourceId: source.id,
        chunkId: chunk.id,
        snippet: quote,
      } as const;
      await deleteSource(source.id);
      expect(await store().getSource(source.id)).toBeUndefined();
      expect(await store().attachStudyBook({ ...book, id: "late-open" })).toBeUndefined();
      const unrelatedNotebook = await createNotebook("Unrelated notes");
      expect(
        await readFlashcardDraftPassages(
          [{ ...origin, notebookId: unrelatedNotebook }, origin],
          DEFAULT_VAULT,
        ),
      ).toMatchObject([{ text: quote, origin: { kind: "book", bookId: book.id, section: 0, offset: 0 } }]);
      expect(
        await readFlashcardDraftPassages([{ ...origin, snippet: "A different quote." }], DEFAULT_VAULT),
      ).toEqual([]);

      await updateNotebook(notebookId, { vaultId: otherVault });
      expect(await readFlashcardDraftPassages([origin], DEFAULT_VAULT)).toEqual([]);
      expect(await readFlashcardDraftPassages([origin], otherVault)).toMatchObject([
        { text: quote, origin: { kind: "book", bookId: book.id } },
      ]);
      await deleteStudyDocument(book);
      expect(await readFlashcardDraftPassages([origin], otherVault)).toEqual([]);
    });

    it("adds a Studio set once and commits only one review for a due card", async () => {
      const notebookId = await createNotebook("Notebook");
      const source = await addSource({
        notebookId,
        title: "Lecture",
        kind: "text",
        text: "Evidence for why this works.",
      });
      const [chunk] = await getChunks([source.id]);
      const output = {
        id: "output",
        notebookId,
        title: "Practice",
        toolId: "flashcards",
        status: "ready",
        createdAt: 0,
        updatedAt: 0,
        options: {},
        sourceIds: [source.id],
        data: {
          cards: [
            {
              front: "Why?",
              back: "Because.",
              sources: [
                {
                  n: 1,
                  sourceId: source.id,
                  chunkId: chunk.id,
                  title: source.title,
                  kind: source.kind,
                  snippet: chunk.text,
                },
              ],
            },
          ],
        },
      } satisfies import("./types").StudioOutput;
      const results = await Promise.all([addStudioFlashcards(output), addStudioFlashcards(output)]);
      expect(results.map(({ added }) => added).sort()).toEqual([0, 1]);
      expect(results.map(({ cardIds }) => cardIds)).toEqual([
        ["studio-output-0"],
        ["studio-output-0"],
      ]);
      const card = await store().getStudy("studio-output-0");
      if (card?.kind !== "card") throw new Error("Expected the Studio flashcard");
      const dueAt = card.schedule.dueAt;
      const review = { sessionId: "review-studio-set", dueAt };
      expect(await rateStudyItem(card.id, "easy", 1, { ...review, dueAt: dueAt - 1 })).toBe(false);
      const grades = await Promise.all([
        rateStudyItem(card.id, "easy", 1, review),
        rateStudyItem(card.id, "good", 1, review),
      ]);
      expect(grades.sort()).toEqual([false, true]);
      const reviewed = await store().getStudy("studio-output-0");
      expect(await addStudioFlashcards(output)).toEqual({ added: 0, cardIds: ["studio-output-0"] });
      expect(await store().getStudy("studio-output-0")).toEqual(reviewed);
      expect((await store().listStudy()).filter(({ kind }) => kind === "session")).toMatchObject([
        { reviewSessionId: review.sessionId, itemId: card.id },
      ]);
      const backup = await exportBackup();
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy("studio-output-0")).toMatchObject({
        origin: { kind: "studio", outputId: "output", notebookId },
        citations: [
          {
            index: 1,
            title: "Lecture",
            origin: {
              kind: "source",
              notebookId,
              sourceId: source.id,
              chunkId: chunk.id,
              snippet: chunk.text,
            },
          },
        ],
      });
      expect((await store().listStudy()).filter(({ kind }) => kind === "session")).toMatchObject([
        { reviewSessionId: review.sessionId, itemId: card.id },
      ]);
    });

    it("keeps difficult review answers with the saved grade and in backups", async () => {
      const card = await saveStudyCard({ front: "How do majorities overlap?", back: "They share a replica.", tags: [] });
      const other = await saveStudyCard({ front: "Another question", back: "Another answer", tags: [] });
      const attempt = {
        answer: "A majority can decide alone.", choice: 1, cue: card.front, reference: card.back,
        threadId: "feedback-for-this-attempt",
      };
      const review = { sessionId: "recall", dueAt: card.schedule.dueAt, attempt };
      const outcomes = await Promise.all([
        rateStudyItem(card.id, "again", 5, review),
        rateStudyItem(card.id, "again", 5, review),
      ]);
      expect(outcomes.sort()).toEqual([false, true]);
      expect(await rateStudyItem(other.id, "easy", 5, { ...review, dueAt: other.schedule.dueAt })).toBe(true);

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      const grades = (await store().listStudy()).filter((row) => row.kind === "session");
      expect(grades).toHaveLength(2);
      expect(grades.find(({ itemId }) => itemId === card.id)).toMatchObject({ rating: "again", reviewAttempt: attempt });
      expect(grades.find(({ itemId }) => itemId === other.id)?.reviewAttempt).toBeUndefined();
    });

    it("preserves schedules and source links when saving an edit drafted before a review", async () => {
      const book = await addStudyBook({
        title: "Quorum notes",
        format: "text",
        sections: [{ title: "Proof", text: "Two majorities overlap." }],
      });
      const origin = { kind: "book", bookId: book.id, section: 0, offset: 0 } as const;
      const card = await saveStudyCard({ front: "Question", back: "Answer", tags: [], origin });
      const highlight = {
        id: "highlight-to-edit",
        kind: "highlight" as const,
        notebookId: book.notebookId,
        bookId: book.id,
        section: 0,
        quote: "Two majorities overlap.",
        offset: 0,
        schedule: freshSchedule(0),
        color: "yellow" as const,
        note: "",
        updatedAt: 0,
      };
      await putStudyRecords(highlight);

      expect(await rateStudyItem(card.id, "easy", 5)).toBe(true);
      expect(await rateStudyItem(highlight.id, "easy", 5)).toBe(true);
      const cardAfterReview = await store().getStudy(card.id);
      const highlightAfterReview = await store().getStudy(highlight.id);
      if (cardAfterReview?.kind !== "card" || highlightAfterReview?.kind !== "highlight")
        throw new Error("Expected both graded items");

      const cardEdit = {
        kind: "card" as const,
        id: card.id,
        change: { front: card.front, back: "Revised answer", tags: ["quorums"] },
        updatedAt: Date.now(),
      };
      expect(await updateStudyReviewItem(cardEdit)).toBe(true);
      expect(await updateStudyReviewItem({
        kind: "highlight", id: highlight.id, updatedAt: Date.now(),
        change: { color: "purple", note: "Proof to revisit", cue: "What must intersect?" },
      })).toBe(true);
      expect(await store().getStudy(card.id)).toMatchObject({
        origin, back: "Revised answer", schedule: cardAfterReview.schedule,
      });
      expect(await store().getStudy(highlight.id)).toMatchObject({
        quote: highlight.quote, offset: 0, color: "purple", note: "Proof to revisit",
        schedule: highlightAfterReview.schedule,
      });
      expect((await store().listStudy()).filter(({ kind }) => kind === "session")).toHaveLength(2);

      await removeStudyRecord(card.id);
      expect(await updateStudyReviewItem(cardEdit)).toBe(false);
      expect(await store().getStudy(card.id)).toBeUndefined();
    });

    it("pairs vocabulary with one scheduled card and keeps the sources and card edits", async () => {
      const vaultId = await createVault({ name: "Systems" });
      const otherVault = await createVault({ name: "Languages" });
      const notebookId = await createNotebook("Distributed systems", { vaultId });
      const origin = { kind: "source" as const, notebookId, sourceId: "replicas", chunkId: "replicas:0" };
      const second = { ...origin, chunkId: "replicas:1" };
      const fields = {
        term: "Quorum",
        language: "English",
        translation: "",
        note: "",
        context: "A quorum is needed to elect a leader.",
        notebookId,
        vaultId,
        origin,
      };
      const word = await saveStudyWord(fields);
      const [extra, same] = await Promise.all([
        saveStudyWord({ ...fields, term: " QUORUM ", origin: second, context: "The write quorum must overlap the read quorum." }),
        saveStudyWord(fields),
      ]);
      expect([extra.id, same.id]).toEqual([word.id, word.id]);
      const otherWord = await saveStudyWord({ ...fields, vaultId: otherVault, notebookId: undefined, origin: undefined });
      expect(otherWord.id).not.toBe(word.id);
      await expect(saveStudyWord({ ...fields, vaultId: otherVault })).rejects.toThrow("no longer available");
      const [cardId] = await studyVocabularyCards([word.id, otherWord.id, word.id], vaultId);
      expect(await studyVocabularyCards([otherWord.id], vaultId)).toEqual([]);
      if (!cardId) throw new Error("Expected the vocabulary flashcard");
      const card = await store().getStudy(cardId);
      if (card?.kind !== "card") throw new Error("Expected a scheduled flashcard");
      expect(card).toMatchObject({ front: "A […] is needed to elect a leader.", back: fields.context });
      expect(await rateStudyItem(cardId, "easy", 4)).toBe(true);
      const graded = await store().getStudy(cardId);
      if (graded?.kind !== "card") throw new Error("Expected the reviewed flashcard");

      const saved = await store().getStudy(word.id);
      if (saved?.kind !== "word") throw new Error("Expected the merged word");
      expect(saved.examples).toEqual([{ context: "The write quorum must overlap the read quorum.", origin: second }]);
      await updateStudyWord({ ...saved, note: "Minimum group required for an operation." }, vaultId);
      const synced = await store().getStudy(cardId);
      if (synced?.kind !== "card") throw new Error("Expected the updated flashcard");
      expect(synced.front).toBe(fields.term);
      expect(synced.back).toContain("Minimum group required for an operation.");
      expect(synced.schedule).toEqual(graded.schedule);

      await putStudyRecords({ ...synced, back: "My own explanation" });
      await updateStudyWord({ ...saved, note: "An edited definition" }, vaultId);
      expect(await store().getStudy(cardId)).toMatchObject({ back: "My own explanation", schedule: graded.schedule });
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy(word.id)).toMatchObject({ examples: saved.examples });
      await removeStudyRecord(word.id);
      expect(await store().getStudy(cardId)).toMatchObject({ origin, back: "My own explanation", schedule: graded.schedule });
      expect(await studyVocabularyCards([word.id], vaultId)).toEqual([]);
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
      const draft = { id: "highlight-feedback", text: "I tried explaining why the election succeeds.", at: Date.now() };
      const thread = await startHighlightTutor(["chosen-mark", "private-mark", "chosen-mark"], work, "Discuss highlights", draft);
      if (!thread) throw new Error("Expected a Tutor conversation for the available highlight");
      expect(thread).toMatchObject({ scope: "materials", highlightIds: ["chosen-mark"], draft, messages: [] });
      const selected = await readStudyTutorSources(thread, work);
      expect(selected.highlights).toMatchObject([{ highlight: { id: "chosen-mark" }, book: { id: first.id } }]);
      expect(selected.books).toEqual([]);
      expect((await readStudyTutorSources({ ...thread, highlightIds: ["private-mark"] }, work)).highlights).toEqual([]);

      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await readStudyThread(thread.id)).toMatchObject({ highlightIds: ["chosen-mark"], draft, messages: [] });
      expect(await store().getStudy("chosen-mark")).toMatchObject({ schedule: freshSchedule(0) });
      await updateNotebook(first.notebookId, { vaultId: other });
      expect((await readStudyTutorSources(thread, work)).highlights).toEqual([]);
      await deleteStudyDocument(first);
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

    it("opens one feedback conversation for a review attempt and preserves it on later openings", async () => {
      const card = await saveStudyCard({ front: "What overlaps?", back: "Two majorities.", vaultId: DEFAULT_VAULT, tags: [] });
      const id = "review-feedback:practice-attempt";
      const initial = { id: "initial-answer", text: "I think the majorities overlap.", at: Date.now() };
      const open = (draft = initial) => startCardTutor([card.id], DEFAULT_VAULT, "Flashcard practice", draft, id);
      const [first, second] = await Promise.all([open(), open()]);
      expect(first).toMatchObject({ id, draft: initial, messages: [] });
      expect(second).toEqual(first);

      const edited = { id: "edited-answer", text: "Can you check my reasoning?", at: initial.at + 1 };
      await updateStudyThread(id, {}, [], { kind: "save", draft: edited });
      expect(await open()).toMatchObject({ id, draft: edited });
      await updateStudyThread(id, {}, [
        { role: "user", text: edited.text, practiceCardId: card.id },
        { role: "assistant", text: "Check the size of the union.", practiceCardId: card.id },
      ], { kind: "consume", id: edited.id });
      const reopened = await open();
      expect(reopened?.draft?.text || "").toBe("");
      expect(reopened?.messages.map(({ text }) => text)).toEqual([edited.text, "Check the size of the union."]);
      expect((await store().listStudy()).filter(({ id: rowId }) => rowId === id)).toHaveLength(1);
      expect(await store().getStudy(card.id)).toEqual(card);
    });

    it("replays an interrupted draft save without overwriting or duplicating its cards", async () => {
      const card = await saveStudyCard({ front: "Existing question", back: "Existing answer", tags: [] });
      const second = { ...card, id: card.id + "-new", front: "Second question" };
      expect(await saveStudyDraftCards([{ ...card, front: "Old draft text" }, second])).toBe(1);
      expect(await saveStudyDraftCards([card, second])).toBe(0);
      expect(await store().getStudy(card.id)).toMatchObject({ front: "Existing question" });
      expect(await store().getStudy(second.id)).toMatchObject({ front: "Second question" });
    });

    it("restores note passages in flashcards after edits and backup", async () => {
      const vault = await createVault({ name: "Thermodynamics" });
      const quote = "Entropy increases for a spontaneous process in an isolated system.";
      const prefix = "## Direction of change\n\n";
      const note = await createNote({ title: "Entropy notes", body: prefix + quote, vaultId: vault });
      const origin = { kind: "note" as const, noteId: note.id, passage: { offset: prefix.length, quote } };
      const card = await saveStudyCard({ front: "What increases?", back: "Entropy.", tags: [], origin });
      const editedPrefix = "Earlier material\n\n" + prefix;
      await saveNoteBody(note.id, editedPrefix + quote);
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy(card.id)).toMatchObject({ origin });
      expect(await readFlashcardDraftPassages([origin], vault)).toEqual([
        { origin: { ...origin, passage: { offset: editedPrefix.length, quote } }, title: note.title, text: quote },
      ]);
      expect(await readFlashcardDraftPassages([origin], DEFAULT_VAULT)).toEqual([]);
      await saveNoteBody(note.id, "A different topic.");
      expect(await readFlashcardDraftPassages([origin], vault)).toEqual([]);
    });

    it("grounds flashcard practice in live excerpts and drops stale or cross-vault citations", async () => {
      const work = await createVault({ name: "Engineering" });
      const other = await createVault({ name: "Private" });
      const quote = "A shared replica carries the quorum evidence.";
      const book = await addStudyBook({
        title: "Quorums",
        format: "text",
        vaultId: work,
        sections: [{ title: "Overlap", text: quote }],
      });
      const [chunk] = await getChunks([book.sourceId]);
      const privateNotebook = await createNotebook("Private evidence", { vaultId: other });
      const privateSource = await addSource({
        notebookId: privateNotebook,
        title: "Private proof",
        kind: "text",
        text: "PRIVATE DATA",
      });
      const [privateChunk] = await getChunks([privateSource.id]);
      const card = await saveStudyCard({
        front: "What carries the evidence?",
        back: "A shared replica.",
        vaultId: work,
        tags: [],
        citations: [
          {
            index: 1,
            title: "Quorums",
            origin: {
              kind: "source",
              notebookId: book.notebookId,
              sourceId: book.sourceId,
              chunkId: chunk.id,
              snippet: quote,
            },
          },
          {
            index: 2,
            title: "Private proof",
            origin: {
              kind: "source",
              notebookId: privateNotebook,
              sourceId: privateSource.id,
              chunkId: privateChunk.id,
            },
          },
          {
            index: 3,
            title: "Wrong notebook",
            origin: {
              kind: "source",
              notebookId: book.notebookId,
              sourceId: privateSource.id,
              chunkId: privateChunk.id,
            },
          },
        ],
      });
      const readerCard = await saveStudyCard({
        front: "What crosses the boundary?",
        back: "Replica evidence.",
        vaultId: work,
        tags: [],
        origin: { kind: "book", bookId: book.id, section: 0, offset: 0, length: quote.length },
      });
      const unlinked = await saveStudyCard({
        front: "Remember without the passage",
        back: readerCard.back,
        vaultId: work,
        tags: [],
        origin: readerCard.origin,
        citations: [],
      });
      const draftPassages = await readFlashcardDraftPassages(
        card.citations?.map(studyCitationOrigin) ?? [],
        work,
      );
      expect(draftPassages.map(({ text }) => text)).toEqual([quote]);
      const tutor = await startCardTutor([card.id, readerCard.id, unlinked.id], work, "Quorum practice");
      if (!tutor) throw new Error("Expected a Tutor practice session");
      const read = async (practiceCardId: string) =>
        (await readStudyTutorSources({ ...tutor, practiceCardId }, work)).cardEvidence?.get(
          practiceCardId,
        );
      expect(await read(card.id)).toMatchObject([{ text: quote, origin: { chunkId: chunk.id } }]);
      expect(await read(unlinked.id)).toEqual([]);
      const prefix = "New background outside the saved excerpt.\n\n";
      await saveStudyText(book.id, prefix + quote, { section: 0, original: quote });
      const [moved] = await getChunks([book.sourceId]);
      expect(moved.id).not.toBe(chunk.id);
      expect(await read(card.id)).toMatchObject([{ text: quote, origin: { chunkId: moved.id } }]);
      expect(await read(readerCard.id)).toMatchObject([
        {
          text: quote,
          origin: { kind: "book", offset: prefix.length, length: quote.length, revision: 1 },
        },
      ]);

      await saveStudyText(book.id, "A different proof.", { section: 0, original: prefix + quote });
      expect(await read(card.id)).toEqual([]);
      expect(await read(readerCard.id)).toEqual([]);
    });

    it("follows an earlier flashcard to its exact source when drafting and practicing a correction", async () => {
      const quote = "Any two majorities must have a replica in common.";
      const prefix = "Unrelated network background.\n\n";
      const book = await addStudyBook({ title: "Consensus", format: "text", sections: [{ title: "Proof", text: quote }] });
      const original = await saveStudyCard({
        front: "Which replicas overlap?", back: "A shared replica belongs to both majorities.", tags: [],
        origin: { kind: "book", bookId: book.id, section: 0, offset: 0, length: quote.length },
      });
      const cardOrigin = { kind: "card" as const, cardId: original.id };
      const correction = await saveStudyCard({
        front: "Why do large enough sets overlap?", back: quote, tags: [],
        citations: [{ index: 1, title: original.front, origin: cardOrigin }],
      });
      await saveStudyText(book.id, prefix + quote, { section: 0, original: quote });
      const draftSources = await readFlashcardDraftPassages([cardOrigin, {
        kind: "book", bookId: book.id, section: 0, offset: prefix.length, length: quote.length, revision: 1,
      }], DEFAULT_VAULT);
      expect(draftSources).toMatchObject([
        { origin: cardOrigin, text: `Question: ${original.front}\n\nAnswer: ${original.back}` },
        { origin: { kind: "book", bookId: book.id, offset: prefix.length, revision: 1 }, text: quote },
      ]);
      expect(draftSources).toHaveLength(2);
      const tutor = await startCardTutor([correction.id], DEFAULT_VAULT, "Correction");
      if (!tutor) throw new Error("Expected correction practice");
      expect((await readStudyTutorSources(tutor, DEFAULT_VAULT)).cardEvidence?.get(correction.id))
        .toEqual([draftSources[1]]);

      await putStudyRecords({
        ...original,
        citations: [{ index: 1, title: correction.front, origin: { kind: "card", cardId: correction.id } }],
      });
      expect((await readFlashcardDraftPassages([cardOrigin], DEFAULT_VAULT)).map(({ title }) => title))
        .toEqual([original.front, correction.front]);
      const other = await createVault({ name: "Private" });
      expect(await readFlashcardDraftPassages([cardOrigin], other)).toEqual([]);
    });

    it("preserves visual source captures and can use an older card's picture as card evidence", async () => {
      const book = await addStudyBook({
        title: "Diagrams", format: "pdf", mime: "application/pdf", bytes: Uint8Array.of(37, 80, 68, 70),
        sections: [{ title: "Page 1", text: "" }],
      });
      const original = "data:image/png;base64,cGljdHVyZQ==";
      const replacement = "data:image/png;base64,b3RoZXI=";
      const visual = { kind: "pdf" as const, top: 1000 };
      const saved = await saveStudyVisualCard(book, 0, visual, { front: "Which face?", back: "The inner face.", backImage: original, tags: [] });
      await putStudyRecords({ ...saved, backImage: replacement });
      const draft = async (id: string) => readFlashcardDraftPassages([{ kind: "card", cardId: id }], DEFAULT_VAULT);
      const captured = await draft(saved.id);
      expect(captured[0].image).toBeUndefined();
      expect(captured[1]).toMatchObject({ origin: { kind: "book", bookId: book.id, visual }, image: original });
      const legacy = await saveStudyCard({
        front: "Which side?", back: "The other side.", image: replacement, tags: [],
        origin: { kind: "book", bookId: book.id, section: 0, visual: { kind: "pdf", top: 7000 } },
      });
      expect(await draft(legacy.id)).toMatchObject([{ origin: { kind: "card", cardId: legacy.id }, image: replacement }]);
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

    it("keeps simulation goals, opening prompts, and report context on backup restore", async () => {
      for (const goal of ["technical-interview", "meeting-simulation"] as const) {
        await putStudyRecords({
          id: goal,
          kind: "thread",
          title: goal,
          goal,
          scope: "general",
          updatedAt: 0,
          messages: [
            { role: "user", text: "Start the exercise.", starter: true },
            { role: "assistant", text: "Why should we keep the replicas in sync?" },
            { role: "user", text: "So a replica failure won't lose committed changes." },
          ],
        });
        const thread = await readStudyThread(goal);
        await updateStudyReport(goal, {
          kind: "save",
          report: {
            id: "first-report",
            summary: "Discussed failure recovery.",
            corrections: [],
            nextSteps: [],
            practiceContext: captureReportPracticeContext(thread, {}),
          },
        });
      }
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      for (const goal of ["technical-interview", "meeting-simulation"] as const) {
        const thread = await readStudyThread(goal);
        expect(thread).toMatchObject({ goal, report: { practiceContext: { goal } } });
        expect(thread.messages[0].starter).toBe(true);
        expect(thread.messages[2].starter).toBeUndefined();
      }
    });

    it("resumes one practice conversation per saved step with the original report's context", async () => {
      const vaultId = await createVault({ name: "Distributed systems" });
      const note = await createNote({ vaultId, title: "Quorum proof", body: "Majorities share a replica." });
      const later = await createNote({ vaultId, title: "Later material", body: "Leader epochs are monotonic." });
      const threadId = "report-conversation";
      const step = { threadId, reportId: "first-report", index: 0 };
      const draft = { id: "original-draft", text: "Keep my question about quorum sizes.", at: 1 };
      await putStudyRecords({
        id: threadId,
        kind: "thread",
        title: "Quorums",
        scope: "notes",
        goal: "teach-back",
        noteIds: [note.id],
        vaultId,
        draft,
        messages: [],
        updatedAt: 0,
      });
      const parent = await readStudyThread(threadId);
      const context = captureReportPracticeContext(parent, await readStudyTutorSources(parent, vaultId, "report"));
      await updateStudyReport(threadId, { kind: "save", report: {
        id: step.reportId,
        summary: "Reviewed intersecting quorums.",
        nextSteps: ["State the quorum intersection proof without notes."],
        corrections: [],
        practiceContext: context,
      } });
      expect(await startStudyFollowUp(step, vaultId)).toBeUndefined();
      await updateStudyReport(threadId, { kind: "step", reportId: step.reportId, index: step.index, action: "plan" });
      await updateStudyThread(threadId, { noteIds: [later.id] });
      await updateStudyReport(threadId, { kind: "save", report: { id: "latest", summary: "A newer report.", nextSteps: [], corrections: [] } });
      expect(await startStudyFollowUp(step, DEFAULT_VAULT)).toBeUndefined();
      const [first, second] = await Promise.all([startStudyFollowUp(step, vaultId), startStudyFollowUp(step, vaultId)]);
      if (!first) throw new Error("Expected a follow-up conversation");
      expect(second).toBe(first);
      const practice = await readStudyThread(first);
      expect(practice).toMatchObject({ vaultId, followUp: step, noteIds: [note.id], messages: [] });
      expect(practice.draft).toBeUndefined();
      expect((await readStudyTutorSources(practice, vaultId)).notes).toMatchObject([{ id: note.id }]);
      const attempt = { role: "user" as const, text: "Two disjoint majorities would exceed the whole set." };
      await updateStudyThread(first, {}, [attempt]);
      await updateStudyReport(threadId, { kind: "step", reportId: step.reportId, index: step.index, action: "complete" });
      expect(await startStudyFollowUp(step, vaultId)).toBeUndefined();
      await updateStudyReport(threadId, { kind: "step", reportId: step.reportId, index: step.index, action: "reopen" });
      const saved = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(saved);
      expect(await startStudyFollowUp(step, vaultId)).toBe(first);
      expect((await readStudyThread(first)).messages).toEqual([attempt]);
      expect((await readStudyThread(threadId)).draft).toEqual(draft);
    });

    it("retains newer Tutor drafts and appends a retried delivery once", async () => {
      const id = "draft-conversation";
      await putStudyRecords({ id, kind: "thread", title: "Practice", scope: "general", goal: "book", messages: [], updatedAt: 0 });
      const first = { id: "question-one", text: "How does consensus work?", at: 1 };
      const next = { id: "question-two", text: "Why does this work?", at: 2 };
      await updateStudyThread(id, {}, [], { kind: "save", draft: first });
      const assertNewerKept = async () => expect((await readStudyThread(id)).draft).toMatchObject(next);
      const turns = [
        { role: "user", text: first.text, draftId: first.id },
        { role: "assistant", text: "Quorums provide consensus evidence." },
      ] satisfies import("@/lib/study/records").StudyThread["messages"];
      const consume = { kind: "consume", id: first.id } as const;
      await updateStudyThread(id, {}, turns, consume);
      await updateStudyThread(id, {}, [], { kind: "save", draft: first });
      expect((await readStudyThread(id)).draft?.text).toBe("");
      await updateStudyThread(id, {}, [], { kind: "save", draft: next });
      await updateStudyThread(id, {}, turns, consume);
      await assertNewerKept();
      await updateStudyThread(id, {}, [], { kind: "save", draft: {
        id: "private", text: "A private transcript", at: 3, speech: "spoken",
      } });
      await assertNewerKept();
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      await assertNewerKept();
      expect((await readStudyThread(id)).messages).toEqual(turns);
      await updateStudyThread(id, { keepVoiceTranscripts: true });
      await updateStudyThread(id, {}, [], { kind: "save", draft: {
        id: "allow", text: "A retained transcript", at: 4, speech: "dictated",
      } });
      expect((await readStudyThread(id)).draft?.speech).toBe("dictated");
    });

    it("keeps the latest reading place when older scroll writes arrive after changing sections", async () => {
      const quote = "Quorum intersection";
      const book = await addStudyBook({
        title: "Reader position",
        format: "pdf",
        sections: [{ title: "Introduction", text: "First page" }, { title: "Quorums", text: quote }],
      });
      const openedAt = Date.now();
      const previous = { section: 0, surface: "text" as const, progress: 0.3 };
      const current = { section: 1, surface: "text" as const, progress: 0.2, endRevision: 0, anchor: { offset: 0, quote, revision: 0 } };
      await saveStudyReadingPlace(book.id, previous, openedAt);
      await store().patchStudyBook({ id: book.id, change: { section: 1 }, updatedAt: openedAt + 20 });
      await saveStudyReadingPlace(book.id, current, openedAt + 30);
      await store().patchStudyBook({
        id: book.id,
        change: { preferredReadingSurface: "layout" },
        updatedAt: openedAt + 35,
      });
      await saveStudyReadingPlace(book.id, previous, openedAt + 10);
      await store().patchStudyBook({ id: book.id, change: { section: 0 }, updatedAt: openedAt + 15 });
      await store().patchStudyBook({ id: book.id, change: { bookmarks: [0] }, updatedAt: openedAt + 40 });
      await Promise.all([
        updateStudyBook(book.id, { readingAppearance: { textSize: 24 } }),
        updateStudyBook(book.id, { readingAppearance: { pdfZoom: 150 } }),
      ]);
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy(book.id)).toMatchObject({
        section: 1,
        readingPlace: current,
        lastReadAt: openedAt + 30,
        preferredReadingSurface: "layout",
        readingAppearance: { textSize: 24, pdfZoom: 150 },
        bookmarks: [0],
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

    it("preserves citation ids on Markdown-only edits and relocates passages after text changes", async () => {
      const original = "Two majorities overlap.";
      const book = await addStudyBook({
        title: "Consensus proof",
        format: "text",
        sections: [{ title: "Consensus proof", text: original }],
      });
      const originalChunks = await getChunks([book.sourceId]);
      const draft = { section: 0, original, markdown: true };
      const edits = await Promise.allSettled([
        saveStudyText(book.id, "**Two majorities** overlap.", draft),
        saveStudyText(book.id, "*Two majorities* overlap.", draft),
      ]);
      expect(edits.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
      const stale = edits.find((edit) => edit.status === "rejected");
      expect(stale?.reason).toBeInstanceOf(StudyTextConflict);
      const formatted = await store().getStudy(book.id);
      if (formatted?.kind !== "book") throw new Error("Expected a formatted document");
      expect(formatted.sections[0].text).toBe(original);
      expect(formatted.textEdits ?? []).toEqual([]);
      expect(await getChunks([book.sourceId])).toEqual(originalChunks);

      const originalMarkdown = formatted.sections[0].markdown;
      const after = `## Proof\n\n${originalMarkdown}`;
      await saveStudyText(book.id, after, { ...draft, originalMarkdown });
      const current = await store().getStudy(book.id);
      if (current?.kind !== "book") throw new Error("Expected the revised document");
      expect(current.sections[0]).toMatchObject({ markdown: after, text: `Proof\n${original}` });
      expect(resolveStudyRange(current, 0, { offset: 0, length: original.length, revision: 0 })).toEqual({
        offset: "Proof\n".length, length: original.length,
      });
      expect(await getChunks([book.sourceId])).toMatchObject([{ text: `Proof\n${original}` }]);
      const backup = JSON.parse(JSON.stringify(await exportBackup()));
      await deleteAllData();
      await importBackup(backup);
      expect(await store().getStudy(book.id)).toMatchObject({ sections: current.sections });
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
    it("merges a backup's duplicate Study books and drops attachedToNotebook, as the upgrade does", async () => {
      const fixture = duplicateBooksFixture();
      const backup = {
        app: "better-vault",
        format: 8,
        exportedAt: 1,
        ...fixture,
        messages: [],
        outputs: [],
        blobs: fixture.blobs.map((blob) => ({ ...blob, data: toBase64(blob.data) })),
      };
      const blobIds = async () => (await store().exportAll()).blobs.map(({ id }) => id);
      expect(await importBackup(JSON.parse(JSON.stringify(backup)))).toBe(2);
      expectMergedFixture(await store().listStudy(), await blobIds());
      expect(await store().count("notebooks")).toBe(2);
      expect(await store().count("sources")).toBe(3);
      expect(await store().count("blobs")).toBe(1);

      // Importing it again over the merged data brings the duplicate back only to merge it again.
      await importBackup(JSON.parse(JSON.stringify(backup)));
      expectMergedFixture(await store().listStudy(), await blobIds());

      // A merged-away id still opens its book, and the source shows one document.
      expect(await store().getStudyBookForSource("n1", "s1")).toMatchObject({ id: "imported", mergedIds: ["source-s1"] });
      expect(await studyBookForSource("s1")).toMatchObject({ id: "imported" });

      // A newer backup made before the merge, holding only the source's other book, is merged in the same way.
      await importBackup(JSON.parse(JSON.stringify({ ...backup, study: [fixture.study[1]], blobs: [] })));
      expect((await store().listStudy()).filter((row) => row.kind === "book" && row.sourceId === "s1")).toHaveLength(1);
    });

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

    it("keeps a subscription choice on the same account when its model is gone", () => {
      const account = "dpl-0123456789abcdef0123";
      const other = "dpl-fedcba9876543210fedc";
      const settings = defaultSettings();
      settings.providers.anthropic = {
        ...settings.providers.anthropic,
        enabled: true,
        apiKey: "k",
        models: ["x"],
      };
      settings.providers.cliproxyapi = {
        ...settings.providers.cliproxyapi,
        enabled: true,
        models: [`${other}/a`, `${account}/b`],
      };
      settings.model = { provider: "cliproxyapi", modelId: `${account}/gone` };
      expect(activeModel(settings)).toEqual({
        provider: "cliproxyapi",
        modelId: `${account}/b`,
      });
      settings.model = { provider: "cliproxyapi", modelId: "dpl-00000000000000000000/gone" };
      expect(activeModel(settings)).toBeNull();
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

describe("version 11 upgrade", () => {
  it("merges duplicate Study books in one upgrade and leaves the rest of the data alone", async () => {
    const { default: Dexie } = await import("dexie");
    const name = "better-vault-upgrade-11-test";
    const old = new Dexie(name);
    old.version(10).stores({
      notebooks: "id, updatedAt",
      sources: "id, notebookId, createdAt",
      chunks: "id, notebookId, sourceId, [sourceId+index]",
      messages: "id, notebookId, conversationId, [conversationId+createdAt]",
      conversations: "id, notebookId, [notebookId+updatedAt]",
      outputs: "id, notebookId, status, [notebookId+createdAt]",
      settings: "key",
      folders: "id, parentId",
      blobs: "id, notebookId, outputId, sourceId",
      vaults: "id",
      calendar: "id",
      notes: "id, vaultId, updatedAt",
      skills: "id, vaultId, name",
      bots: "id, order",
      botMessages: "id, botId, [botId+createdAt]",
      study: "id, notebookId",
    });
    await old.open();
    const fixture = duplicateBooksFixture();
    await old.table("notebooks").bulkAdd(fixture.notebooks);
    await old.table("sources").bulkAdd(fixture.sources);
    await old.table("study").bulkAdd(fixture.study);
    await old.table("blobs").bulkAdd(fixture.blobs);
    old.close();

    const { BetterVaultDatabase } = await import("./database");
    const upgraded = new BetterVaultDatabase(name);
    expectMergedFixture(await upgraded.study.toArray(), await upgraded.blobs.toCollection().primaryKeys());
    expect(await upgraded.notebooks.toArray()).toEqual(fixture.notebooks);
    expect(await upgraded.sources.toArray()).toEqual(fixture.sources);
    expect(upgraded.verno).toBe(11);
    upgraded.close();
    await Dexie.delete(name);
  });
});

describe("SQLite migration 9", () => {
  it("merges duplicate Study books, keeps the rest, and runs once", () => {
    const db = new DatabaseSync(":memory:");
    const fresh = createSqliteStore(db);
    const fixture = duplicateBooksFixture();
    // Rows as version 8 left them: written directly, then the version set back.
    for (const notebook of fixture.notebooks) fresh.addNotebook(notebook);
    for (const source of fixture.sources) fresh.addSource(source, [], 1);
    const insert = db.prepare("INSERT INTO study (id, notebook_id, doc) VALUES (?, ?, ?)");
    for (const row of fixture.study) insert.run(row.id, row.notebookId ?? null, JSON.stringify(row));
    for (const blob of fixture.blobs) fresh.putBlob(blob);
    db.exec("PRAGMA user_version = 8");

    const sqlite = createSqliteStore(db);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(schemaVersion);
    expect(schemaVersion).toBe(9);
    const blobs = () => sqlite.exportAll().blobs.map(({ id }) => id);
    expectMergedFixture(sqlite.listStudy(), blobs());
    expect(sqlite.listNotebooks()).toHaveLength(2);
    expect(sqlite.listAllSources()).toEqual(fixture.sources);
    // The kept book is found through its source, and the indexed notebook column follows the rows.
    expect(sqlite.getStudyBookForSource("n1", "s1")?.id).toBe("imported");
    expect(db.prepare("SELECT COUNT(*) AS n FROM study WHERE notebook_id = 'n1'").get()).toEqual({
      n: sqlite.listStudy().filter((row) => row.notebookId === "n1").length,
    });

    const merged = sqlite.listStudy();
    createSqliteStore(db);
    expect(sqlite.listStudy()).toEqual(merged);
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
