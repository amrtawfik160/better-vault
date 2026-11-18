import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAllData } from "@/lib/db/backup";
import { createDexieBackend } from "@/lib/db/dexie-backend";
import { createNotebook } from "@/lib/db/notebooks";
import { addSource, deleteSource } from "@/lib/db/sources";
import { setStoreForTests } from "@/lib/db/store";
import {
  addStudyBook,
  freshSchedule,
  putStudyRecords,
  removeStudyRecord,
  saveStudyText,
} from "@/lib/db/study";
import { createVault } from "@/lib/db/vaults";
import { originHref } from "@/lib/study/links";
import type { StudyOrigin, StudyRecordOf } from "@/lib/study/records";
import { readCatalogue, searchIndex } from "./index";

describe("search index", () => {
  beforeEach(async () => {
    setStoreForTests(createDexieBackend());
    await deleteAllData();
  });

  it("finds words inside sources, by prefix, and forgets deleted sources", async () => {
    const notebookId = await createNotebook("Biology");
    const source = await addSource({
      notebookId,
      title: "Plants",
      kind: "pdf",
      text: "Chlorophyll absorbs light. Photosynthesis converts light into chemical energy.",
    });
    await searchIndex.sync(await readCatalogue());

    const hits = searchIndex.search("photosynth");
    const passage = hits.find((hit) => hit.kind === "passage");
    expect(passage?.sourceId).toBe(source.id);
    expect(passage?.chunkId).toBe(`${source.id}:0`);
    expect(passage?.snippet).toContain("Photosynthesis");
    expect(searchIndex.search("biology").some((hit) => hit.kind === "notebook")).toBe(true);

    await deleteSource(source.id);
    await searchIndex.sync(await readCatalogue());
    expect(searchIndex.search("photosynth").some((hit) => hit.kind === "passage")).toBe(false);
  });

  it("finds saved Study material with exact links and inherited vault ownership", async () => {
    const vaultId = await createVault({ name: "Physics" });
    const book = await addStudyBook({
      title: "Relativity reading",
      format: "text",
      sections: [{ title: "Chapter 1", text: "Light follows null geodesics." }],
      vaultId,
    });
    const bookOrigin = { kind: "book" as const, bookId: book.id, section: 0 };
    const highlight: StudyRecordOf<"highlight"> = {
      ...bookOrigin,
      kind: "highlight",
      id: "study-highlight",
      offset: 0,
      color: "yellow",
      quote: "Light follows null geodesics.",
      note: "Compare this with Fermat's principle.",
      schedule: freshSchedule(),
      updatedAt: 1,
    };
    const card: StudyRecordOf<"card"> = {
      kind: "card",
      id: "study-card",
      front: "What describes parallel transport?",
      back: "The Levi-Civita connection.",
      tags: ["geometry"],
      origin: bookOrigin,
      schedule: freshSchedule(),
      updatedAt: 1,
    };
    const word: StudyRecordOf<"word"> = {
      kind: "word",
      id: "study-word",
      term: "courbure",
      translation: "curvature",
      context: "La courbure de l’espace-temps",
      note: "",
      language: "French",
      origin: bookOrigin,
      updatedAt: 1,
    };
    const thread: StudyRecordOf<"thread"> = {
      kind: "thread",
      id: "study-thread",
      title: "Spacetime practice",
      bookId: book.id,
      updatedAt: 1,
      goal: "book",
      scope: "chapter",
      messages: [
        { role: "user", text: "How do I compare frames?" },
        { role: "assistant", text: "Apply a Lorentz transformation." },
      ],
      draft: { id: "private-draft", text: "Unsent zebrafish draft", at: 2 },
      report: { id: "new", summary: "Reviewed time dilation.", corrections: [], nextSteps: [] },
      pastReports: [
        { summary: "Older report", corrections: [], nextSteps: ["Diagram simultaneity."] },
      ],
    };
    await putStudyRecords(highlight, card, word, thread);
    await searchIndex.sync(await readCatalogue());

    const cases: [string, StudyOrigin][] = [
      ["relativity", { kind: "book", bookId: book.id }],
      ["fermat", { ...bookOrigin, highlightId: highlight.id }],
      ["levi civita", { kind: "card", cardId: card.id }],
      ["curvature", { kind: "word", wordId: word.id }],
      ["spacetime practice", { kind: "tutor", threadId: thread.id }],
      ["lorentz", { kind: "tutor", threadId: thread.id, message: 1 }],
      ["simultaneity", { kind: "report", threadId: thread.id, reportId: "legacy" }],
      ["dilation", { kind: "report", threadId: thread.id, reportId: "new" }],
    ];
    for (const [query, origin] of cases) {
      const hit = searchIndex.search(query).find(({ kind }) => kind === "study");
      expect(hit?.study?.href, query).toBe(originHref(origin));
      expect(hit?.vaultId, query).toBe(vaultId);
    }
    expect(searchIndex.search("zebrafish")).toHaveLength(0);

    await putStudyRecords({ ...card, back: "A torsion-free connection.", updatedAt: 3 });
    await removeStudyRecord(highlight.id);
    await searchIndex.sync(await readCatalogue());
    expect(searchIndex.search("torsion").map(({ id }) => id)).toHaveLength(1);
    expect(searchIndex.search("fermat")).toHaveLength(0);
    expect(searchIndex.search("levi civita")).toHaveLength(0);
  });

  it("opens the exact edited Study text and restores notebook results when a book is unlinked", async () => {
    const book = await addStudyBook({
      title: "Wave theory",
      format: "text",
      sections: [{ title: "Wave theory", text: "Reflection follows the law of specular angles." }],
    });
    await searchIndex.sync(await readCatalogue());
    expect(searchIndex.search("specular")[0]?.study?.href).toBe(originHref({
      kind: "book", bookId: book.id, section: 0, offset: 30, length: 8, revision: 0,
    }));

    await saveStudyText(book.id, "Diffraction bends waves around an obstacle.");
    await searchIndex.sync(await readCatalogue());
    expect(searchIndex.search("specular")).toHaveLength(0);
    expect(searchIndex.search("diffraction")[0]).toMatchObject({
      kind: "study-passage",
      sourceId: book.sourceId,
      snippet: "Diffraction bends waves around an obstacle.",
      study: { href: originHref({ kind: "book", bookId: book.id, section: 0, offset: 0, length: 11, revision: 1 }) },
    });
    await removeStudyRecord(book.id);
    await searchIndex.sync(await readCatalogue());
    expect(searchIndex.search("diffraction")[0]).toMatchObject({ kind: "passage", sourceId: book.sourceId });
  });

  it("distinguishes pages with repeated phrases and finds Study copies without their source", async () => {
    const vaultId = await createVault({ name: "Networks" });
    const phrase = "overlapping majorities";
    const sections = [
      { title: "Page 1", text: `🧪 ${"Background material. ".repeat(110)}${phrase} preserve evidence.` },
      { title: "Page 2", text: `The earlier proof about ${phrase} is applied here.` },
    ];
    const book = await addStudyBook({ title: "Quorum proof", format: "pdf", sections, vaultId });
    await searchIndex.sync(await readCatalogue());

    const hits = searchIndex.search(phrase).filter(({ kind }) => kind === "study-passage");
    expect(hits).toHaveLength(2);
    for (const [section, { title, text }] of sections.entries()) {
      expect(hits.find((hit) => hit.title === `Quorum proof · ${title}`)).toMatchObject({
        vaultId,
        study: { href: originHref({ kind: "book", bookId: book.id, section, offset: text.indexOf(phrase), length: phrase.length, revision: 0 }) },
      });
    }
    expect(searchIndex.search(phrase).some(({ kind }) => kind === "passage")).toBe(false);
    expect(searchIndex.search("Quorum").some(({ kind }) => kind === "study-passage")).toBe(false);

    await deleteSource(book.sourceId);
    await searchIndex.sync(await readCatalogue());
    expect(searchIndex.search("overlapping majorites").filter(({ kind }) => kind === "study-passage")).toHaveLength(2);
  });
});
