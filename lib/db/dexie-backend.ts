import type { StudyRecord } from "@/lib/study/records";
import { studyBookDeletion, studyBookWithoutProgress } from "@/lib/study/book-deletion";
import { duplicateBookError } from "@/lib/study/book-merge";
import { notebookFollowsDocument } from "@/lib/study/library";
import { canWriteStudyDocumentDraft, studyDocumentDraftId } from "@/lib/study/document-drafts";
import { DEFAULT_VAULT } from "@/lib/study/vault";
import { patchedStudyReviewItem } from "@/lib/study/recall";
import { patchedStudyThread } from "@/lib/study/reports";
import { patchedStudyBook, renamedStudyBook, revisedStudyBook } from "@/lib/study/text-edits";
import { prepareStudyOcrDraft, prepareStudyOcrWrite, remainingStudyOcrDraft, scanDraftId } from "@/lib/study/ocr-write";
import { detachedVocabularyCard, vocabularyCardId, vocabularyChanges } from "@/lib/study/vocabulary";
import { studyImagePrefix } from "@/lib/study/visual-card";
import { updatedStudioPractice } from "@/studio/shared/practice";
import type { Backend } from "./backend";
import { BetterVaultDatabase, mergeStudyBooks } from "./database";
import { sourceHasText, sourceSummary } from "./source-text";
import type { Source, SourceSummary, StudioOutput } from "./types";

/** The web app's backend: the IndexedDB database in `./database`. */
export function createDexieBackend(db = new BetterVaultDatabase()): Backend & {
  db: BetterVaultDatabase;
} {
  const content = [
    db.study,
    db.calendar,
    db.vaults,
    db.notes,
    db.skills,
    db.plugins,
    db.files,
    db.bots,
    db.botMessages,
    db.folders,
    db.notebooks,
    db.sources,
    db.chunks,
    db.conversations,
    db.messages,
    db.outputs,
    db.blobs,
  ];
  const studyBooksForSource = (notebookId: string, sourceId: string) =>
    db.study
      .where("notebookId")
      .equals(notebookId)
      .filter((row) => row.kind === "book" && row.sourceId === sourceId);
  /** The book rows among `rows` that would give a source a second Study book. */
  const duplicateBooks = async (rows: readonly StudyRecord[]) => {
    const duplicates = new Set<string>();
    const claimed = new Map<string, string>();
    for (const row of rows) {
      if (row.kind !== "book") continue;
      const key = JSON.stringify([row.notebookId, row.sourceId]);
      const owner =
        claimed.get(key) ??
        (await studyBooksForSource(row.notebookId, row.sourceId).filter(({ id }) => id !== row.id).first())?.id;
      if (owner && owner !== row.id) duplicates.add(row.id);
      else claimed.set(key, row.id);
    }
    return duplicates;
  };

  return {
    db,

    listNotebooks: () => db.notebooks.orderBy("updatedAt").reverse().toArray(),
    getNotebook: (id) => db.notebooks.get(id),
    addNotebook: async (notebook) => {
      await db.notebooks.add(notebook);
    },
    patchNotebook: async (id, patch) => {
      await db.notebooks.update(id, patch);
    },
    deleteNotebook: (id) =>
      db.transaction("rw", content, async () => {
        await db.sources.where("notebookId").equals(id).delete();
        await db.chunks.where("notebookId").equals(id).delete();
        await db.messages.where("notebookId").equals(id).delete();
        await db.conversations.where("notebookId").equals(id).delete();
        await db.outputs.where("notebookId").equals(id).delete();
        await db.blobs.where("notebookId").equals(id).delete();
        await db.study.where("notebookId").equals(id).delete();
        await db.notebooks.delete(id);
      }),
    countSources: async () => {
      const counts: Record<string, number> = {};
      await db.sources.each((source) => {
        counts[source.notebookId] = (counts[source.notebookId] ?? 0) + 1;
      });
      return counts;
    },

    listCalendar: () => db.calendar.toArray(),
    saveCalendar: (entries) =>
      db.transaction("rw", db.calendar, async () => {
        await db.calendar.clear();
        await db.calendar.bulkPut(entries);
      }),

    listNotes: () => db.notes.toArray(),
    getNote: (id) => db.notes.get(id),
    putNote: async (note) => {
      await db.notes.put(note);
    },
    putNotes: async (notes) => {
      await db.notes.bulkPut(notes);
    },
    deleteNote: (id) => db.notes.delete(id),
    listSkills: () => db.skills.toArray(),
    getSkill: (id) => db.skills.get(id),
    putSkill: async (skill) => {
      await db.skills.put(skill);
    },
    deleteSkill: (id) => db.skills.delete(id),
    listFiles: () => db.files.toArray(),
    getFile: (id) => db.files.get(id),
    putFile: async (file) => {
      await db.files.put(file);
    },
    deleteFile: (id) =>
      db.transaction("rw", [db.files, db.blobs], async () => {
        const file = await db.files.get(id);
        if (!file) return;
        await db.blobs.delete(file.blobId);
        await db.files.delete(id);
      }),
    listPlugins: () => db.plugins.toArray(),
    getPlugin: (id) => db.plugins.get(id),
    putPlugin: async (plugin) => {
      await db.plugins.put(plugin);
    },
    deletePlugin: (id) => db.plugins.delete(id),

    listBots: () => db.bots.orderBy("order").toArray(),
    getBot: (id) => db.bots.get(id),
    putBot: async (bot) => {
      await db.bots.put(bot);
    },
    deleteBot: (id) =>
      db.transaction("rw", [db.bots, db.botMessages], async () => {
        await db.botMessages.where("botId").equals(id).delete();
        await db.bots.delete(id);
      }),
    loadBotThread: (botId) =>
      db.botMessages
        .where("[botId+createdAt]")
        .between([botId, -Infinity], [botId, Infinity])
        .toArray(),
    saveBotThread: (bot, rows) =>
      db.transaction("rw", [db.bots, db.botMessages], async () => {
        await db.botMessages.where("botId").equals(bot.id).delete();
        await db.botMessages.bulkPut(rows);
        await db.bots.put(bot);
      }),

    listVaults: () => db.vaults.toArray(),
    putVault: async (vault) => {
      await db.vaults.put(vault);
    },
    deleteVault: (id) =>
      db.transaction("rw", [db.vaults, db.study], async () => {
        await db.study.delete(studyDocumentDraftId({ vaultId: id }));
        await db.vaults.delete(id);
      }),

    listFolders: () => db.folders.toArray(),
    addFolder: async (folder) => {
      await db.folders.add(folder);
    },
    patchFolder: async (id, patch) => {
      await db.folders.update(id, patch);
    },
    deleteFolder: (id) =>
      db.transaction("rw", [db.folders, db.notebooks, db.files], async () => {
        const folder = await db.folders.get(id);
        if (!folder) return;
        await db.files
          .filter((file) => file.folderId === id)
          .modify((file) => {
            if (folder.parentId) file.folderId = folder.parentId;
            else delete file.folderId;
          });
        await db.folders.where("parentId").equals(id).modify({ parentId: folder.parentId });
        await db.notebooks
          .filter((notebook) => notebook.folderId === id)
          .modify({ folderId: folder.parentId });
        await db.folders.delete(id);
      }),

    addSource: (source, chunks, now, original) =>
      db.transaction("rw", [db.sources, db.chunks, db.notebooks, db.blobs], async () => {
        await db.sources.add(source);
        await db.chunks.bulkAdd(chunks);
        if (original) await db.blobs.add(original);
        await db.notebooks.update(source.notebookId, { updatedAt: now });
      }),
    getSource: (id) => db.sources.get(id),
    getSources: async (ids) =>
      (await db.sources.bulkGet(ids)).filter((source): source is Source => source !== undefined),
    listAllSources: () => db.sources.toArray(),
    listSourceSummaries: async () => {
      const summaries: SourceSummary[] = [];
      await db.sources.each((source) => {
        summaries.push(sourceSummary(source));
      });
      return summaries;
    },
    listSources: (notebookId) =>
      db.sources.where("notebookId").equals(notebookId).sortBy("createdAt"),
    patchSource: async (id, patch) => {
      await db.sources.update(id, patch);
    },
    renameDocument: ({ kind, id, title, updatedAt }) =>
      db.transaction("rw", [db.sources, db.study, db.notebooks], async () => {
        const entry = kind === "book" ? await db.study.get(id) : undefined;
        const linkedBook = entry?.kind === "book" ? entry : undefined;
        if (kind === "book" && !linkedBook) return;
        const sourceId = linkedBook?.sourceId ?? id;
        const found = await db.sources.get(sourceId);
        const notebookId = linkedBook?.notebookId ?? found?.notebookId;
        if (!notebookId) return;
        const source = found?.notebookId === notebookId ? found : undefined;
        const books = (await studyBooksForSource(notebookId, sourceId).toArray()).filter(
          (book) => book.kind === "book",
        );
        const notebook = await db.notebooks.get(notebookId);
        const others = (await db.sources.where("notebookId").equals(notebookId).count()) - (source ? 1 : 0);
        const previous = source?.title ?? books[0]?.title;
        for (const book of books) await db.study.put(renamedStudyBook(book, title, updatedAt));
        if (source) await db.sources.update(source.id, { title });
        if (notebookFollowsDocument(notebook, others, previous))
          await db.notebooks.update(notebookId, { title, updatedAt });
      }),
    patchNotebookSources: async (notebookId, patch) => {
      await db.sources.where("notebookId").equals(notebookId).modify((source) => {
        Object.assign(source, patch);
        if (source.selected && !sourceHasText(source)) source.selected = false;
      });
    },
    deleteSource: (id) =>
      db.transaction("rw", [db.sources, db.chunks, db.blobs, db.study], async () => {
        const source = await db.sources.get(id);
        if (source) {
          const books = await studyBooksForSource(source.notebookId, id).primaryKeys();
          await db.study.bulkDelete(books.map(scanDraftId));
        }
        await db.chunks.where("sourceId").equals(id).delete();
        await db.blobs.where("sourceId").equals(id).delete();
        await db.sources.delete(id);
      }),
    getChunks: (sourceIds) => db.chunks.where("sourceId").anyOf(sourceIds).toArray(),

    getConversation: (id) => db.conversations.get(id),
    listConversations: (notebookId) =>
      db.conversations
        .where("[notebookId+updatedAt]")
        .between([notebookId, -Infinity], [notebookId, Infinity])
        .reverse()
        .toArray(),
    loadMessages: (conversationId) =>
      db.messages
        .where("[conversationId+createdAt]")
        .between([conversationId, -Infinity], [conversationId, Infinity])
        .toArray(),
    saveChat: (conversation, rows) =>
      db.transaction("rw", [db.messages, db.conversations, db.notebooks], async () => {
        await db.messages.where("conversationId").equals(conversation.id).delete();
        await db.messages.bulkPut(rows);
        const saved = await db.conversations.get(conversation.id);
        await db.conversations.put({
          ...conversation,
          title: saved?.title || conversation.title,
          createdAt: saved?.createdAt ?? conversation.createdAt,
        });
        await db.notebooks.update(conversation.notebookId, { updatedAt: conversation.updatedAt });
      }),
    patchConversation: async (id, patch) => {
      await db.conversations.update(id, patch);
    },
    deleteConversation: (id) =>
      db.transaction("rw", [db.messages, db.conversations], async () => {
        await db.messages.where("conversationId").equals(id).delete();
        await db.conversations.delete(id);
      }),

    getOutput: (id) => db.outputs.get(id),
    listAllOutputs: () => db.outputs.toArray(),
    listOutputs: async (notebookId) =>
      (await db.outputs.where("notebookId").equals(notebookId).sortBy("createdAt")).reverse(),
    addOutput: (output) =>
      db.transaction("rw", [db.outputs, db.notebooks], async () => {
        await db.outputs.add(output);
        await db.notebooks.update(output.notebookId, { updatedAt: output.createdAt });
      }),
    patchOutput: async (id, patch) => {
      await db.outputs.update(id, patch);
    },
    patchReadyOutput: async (id, patch) => {
      const changed = await db.outputs
        .where("id")
        .equals(id)
        .and((output) => output.status === "ready")
        .modify(patch);
      return changed > 0;
    },
    saveStudioPractice: (id, change) =>
      db.transaction("rw", db.outputs, async () => {
        const update = updatedStudioPractice(await db.outputs.get(id), change);
        if (!update) return;
        await db.outputs.update(id, update);
        return update;
      }),
    interruptOutputs: async (running, error) => {
      const keep = new Set(running);
      await db.outputs
        .where("status")
        .equals("generating")
        .filter((output) => !keep.has(output.id))
        .modify({ status: "error", error } satisfies Partial<StudioOutput>);
    },
    deleteOutput: (id) =>
      db.transaction("rw", [db.outputs, db.blobs], async () => {
        await db.blobs.where("outputId").equals(id).delete();
        await db.outputs.delete(id);
      }),

    putBlob: async (blob) => {
      await db.blobs.put(blob);
    },
    getBlob: (id) => db.blobs.get(id),

    getSetting: async (key) => (await db.settings.get(key))?.value,
    putSetting: async (key, value) => {
      await db.settings.put({ key, value });
    },
    clearSettings: () => db.settings.clear(),

    listStudy: () => db.study.toArray(),
    getStudy: (id) => db.study.get(id),
    getStudyBookForSource: async (notebookId, sourceId) => {
      const row = await studyBooksForSource(notebookId, sourceId).first();
      return row?.kind === "book" ? row : undefined;
    },
    putStudy: (rows) =>
      db.transaction("rw", db.study, async () => {
        if ((await duplicateBooks(rows)).size) throw new Error(duplicateBookError);
        await db.study.bulkPut(rows);
      }),
    insertStudy: (rows) =>
      db.transaction("rw", db.study, async () => {
        const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
        const existing = await db.study.bulkGet(unique.map(({ id }) => id));
        const fresh = unique.filter((_, index) => !existing[index]);
        const duplicates = await duplicateBooks(fresh);
        const pending = fresh.filter(({ id }) => !duplicates.has(id));
        await db.study.bulkAdd(pending);
        return pending.length;
      }),
    attachStudyBook: (book) =>
      db.transaction("rw", [db.study, db.sources, db.notebooks], async () => {
        const source = await db.sources.get(book.sourceId);
        if (source?.notebookId !== book.notebookId || !(await db.notebooks.get(book.notebookId)))
          return;
        const reading = await studyBooksForSource(book.notebookId, book.sourceId).first();
        if (reading?.kind === "book") return reading;
        const existing = await db.study.get(book.id);
        if (existing) {
          return existing.kind === "book" &&
            existing.sourceId === book.sourceId &&
            existing.notebookId === book.notebookId
            ? existing
            : undefined;
        }
        const next = renamedStudyBook(book, source.title, book.updatedAt);
        await db.study.add(next);
        return next;
      }),
    patchStudyBook: (write) =>
      db.transaction("rw", db.study, async () => {
        const book = await db.study.get(write.id);
        if (book?.kind === "book") await db.study.put(patchedStudyBook(book, write));
      }),
    writeStudyVocabulary: (write) =>
      db.transaction("rw", [db.study, db.notebooks, db.vaults, db.notes], async () => {
        const [rows, notebooks, vaults, notes] = await Promise.all([
          db.study.toArray(), db.notebooks.toArray(), db.vaults.toArray(), db.notes.toArray(),
        ]);
        const { result, updates } = vocabularyChanges({ rows, notebooks, vaults, notes }, write);
        if (updates.length) await db.study.bulkPut(updates);
        return result;
      }),
    patchStudyThread: (write) =>
      db.transaction("rw", db.study, async () => {
        const thread = await db.study.get(write.id);
        if (thread?.kind !== "thread") return false;
        const next = patchedStudyThread(thread, write);
        if (!next) return false;
        await db.study.put(next);
        return true;
      }),
    writeStudyDocumentDraft: (row, replaces) =>
      db.transaction("rw", [db.study, db.vaults], async () => {
        const existing = await db.study.get(row.id);
        if (!canWriteStudyDocumentDraft(existing, row, replaces)) return false;
        const hasTarget = row.bookId
          ? (await db.study.get(row.bookId))?.kind === "book"
          : row.vaultId === DEFAULT_VAULT || Boolean(row.vaultId && (await db.vaults.get(row.vaultId)));
        if (!hasTarget) return false;
        await db.study.put(row);
        return true;
      }),
    writeStudyOcrDraft: (write) =>
      db.transaction("rw", [db.study, db.sources, db.notebooks], async () => {
        const book = await db.study.get(write.bookId);
        if (book?.kind !== "book" || !(await db.notebooks.get(book.notebookId))) return false;
        const next = prepareStudyOcrDraft(book, await db.sources.get(book.sourceId),
          await db.study.get(scanDraftId(book.id)), write);
        if (!next) return false;
        await db.study.put(next);
        return true;
      }),
    patchStudyReviewItem: (write) =>
      db.transaction("rw", db.study, async () => {
        const next = patchedStudyReviewItem(await db.study.get(write.id), write);
        if (!next) return false;
        await db.study.put(next);
        return true;
      }),
    applyStudyReview: ({ id, previousDueAt, schedule, activity }) =>
      db.transaction("rw", db.study, async () => {
        const item = await db.study.get(id);
        if (
          (item?.kind !== "card" && item?.kind !== "highlight") ||
          item.schedule.dueAt !== previousDueAt
        )
          return false;
        const reviewed: StudyRecord = { ...item, schedule, updatedAt: Math.max(item.updatedAt, activity.updatedAt) };
        await db.study.put(reviewed);
        await db.study.add(activity);
        return true;
      }),
    replaceStudyText: (write, sourceText, chunks) =>
      db.transaction("rw", [db.study, db.sources, db.chunks, db.notebooks], async () => {
        const book = revisedStudyBook(await db.study.get(write.id), write);
        const source = await db.sources.get(write.sourceId);
        if (!book || !source || source.notebookId !== book.notebookId || !(await db.notebooks.get(book.notebookId))) return false;
        await db.study.put(book);
        if (write.text !== write.previousText) {
          await db.sources.put({
            ...source,
            text: sourceText,
            charCount: sourceText.length,
            studyRevision: write.revision + 1,
          });
          await db.chunks.where("sourceId").equals(source.id).delete();
          await db.chunks.bulkPut(chunks);
        }
        await db.notebooks.update(book.notebookId, { updatedAt: book.updatedAt });
        return true;
      }),
    saveStudyOcrPages: (write) =>
      db.transaction("rw", [db.study, db.sources, db.chunks, db.notebooks], async () => {
        const book = await db.study.get(write.bookId);
        if (book?.kind !== "book" || !(await db.notebooks.get(book.notebookId))) return "conflict";
        const prepared = prepareStudyOcrWrite(book, await db.sources.get(book.sourceId), write);
        if (prepared.kind !== "ready") return prepared.kind;
        const draft = remainingStudyOcrDraft(await db.study.get(scanDraftId(book.id)), write);
        if (!draft.allowed) return "conflict";
        if (draft.remaining) await db.study.put(draft.remaining);
        await db.study.put(prepared.book);
        await db.sources.put(prepared.source);
        if (prepared.chunks) {
          await db.chunks.where("sourceId").equals(book.sourceId).delete();
          await db.chunks.bulkPut(prepared.chunks);
        }
        await db.notebooks.update(book.notebookId, { updatedAt: prepared.book.updatedAt });
        return "saved";
      }),
    deleteStudy: (id) =>
      db.transaction("rw", db.study, async () => {
        const row = await db.study.get(id);
        if (row?.kind === "book") {
          await db.study.delete(scanDraftId(id));
          await db.study
            .where("notebookId")
            .equals(row.notebookId)
            .filter((item) => (item.kind === "highlight" || item.kind === "document-draft") && item.bookId === id)
            .delete();
        }
        if (row?.kind === "word") {
          const card = detachedVocabularyCard(await db.study.get(vocabularyCardId(id)), row);
          if (card) await db.study.put(card);
        }
        await db.study.delete(id);
      }),

    deleteStudyDocument: (document) =>
      db.transaction(
        "rw",
        [db.study, db.notebooks, db.vaults, db.notes, db.sources, db.chunks, db.conversations, db.outputs, db.blobs],
        async () => {
          const { notebookId, sourceId } = document;
          const ownSource = (await db.sources.get(sourceId))?.notebookId === notebookId;
          const [rows, notebooks, vaults, notes, sources, conversations, outputs] = await Promise.all([
            db.study.toArray(),
            db.notebooks.toArray(),
            db.vaults.toArray(),
            db.notes.toArray(),
            db.sources.where("notebookId").equals(notebookId).primaryKeys(),
            db.conversations.where("notebookId").equals(notebookId).count(),
            db.outputs.where("notebookId").equals(notebookId).count(),
          ]);
          const plan = studyBookDeletion({ rows, notebooks, vaults, notes }, document, {
            otherSources: sources.some((key) => key !== sourceId),
            conversations: conversations > 0,
            outputs: outputs > 0,
          });
          if (!plan.book && !ownSource) return;
          await db.study.bulkDelete(plan.remove);
          await db.study.bulkPut(plan.keep);
          if (plan.book) await db.blobs.where("id").startsWith(studyImagePrefix(plan.book.id)).delete();
          if (ownSource) {
            await db.chunks.where("sourceId").equals(sourceId).delete();
            await db.blobs.where("sourceId").equals(sourceId).delete();
            await db.sources.delete(sourceId);
          }
          if (plan.deleteNotebook) {
            await db.blobs.where("notebookId").equals(notebookId).delete();
            await db.notebooks.delete(notebookId);
          }
        },
      ),
    resetStudyBook: (id, updatedAt) =>
      db.transaction("rw", db.study, async () => {
        const book = await db.study.get(id);
        if (book?.kind !== "book") return false;
        await db.study.filter((row) => row.kind === "highlight" && row.bookId === id).delete();
        await db.study.put(studyBookWithoutProgress(book, updatedAt));
        return true;
      }),
    exportAll: async () => {
      const [
        study,
        calendar,
        vaults,
        notes,
        skills,
        plugins,
        files,
        bots,
        botMessages,
        folders,
        notebooks,
        sources,
        conversations,
        messages,
        outputs,
        blobs,
      ] = await Promise.all([
        db.study.toArray(),
        db.calendar.toArray(),
        db.vaults.toArray(),
        db.notes.toArray(),
        db.skills.toArray(),
        db.plugins.toArray(),
        db.files.toArray(),
        db.bots.toArray(),
        db.botMessages.toArray(),
        db.folders.toArray(),
        db.notebooks.toArray(),
        db.sources.toArray(),
        db.conversations.toArray(),
        db.messages.toArray(),
        db.outputs.toArray(),
        db.blobs.toArray(),
      ]);
      return {
        study,
        calendar,
        vaults,
        notes,
        skills,
        plugins,
        files,
        bots,
        botMessages,
        folders,
        notebooks,
        sources,
        conversations,
        messages,
        outputs,
        blobs,
      };
    },
    importAll: (data, chunks) =>
      db.transaction("rw", content, async () => {
        await db.study.bulkPut(data.study);
        await db.calendar.bulkPut(data.calendar);
        await db.vaults.bulkPut(data.vaults);
        await db.notes.bulkPut(data.notes);
        await db.skills.bulkPut(data.skills);
        await db.plugins.bulkPut(data.plugins);
        await db.files.bulkPut(data.files);
        await db.bots.bulkPut(data.bots);
        await db.botMessages.bulkPut(data.botMessages);
        await db.folders.bulkPut(data.folders);
        await db.notebooks.bulkPut(data.notebooks);
        await db.conversations.bulkPut(data.conversations);
        await db.sources.bulkPut(data.sources);
        await db.chunks
          .where("sourceId")
          .anyOf(data.sources.map((source) => source.id))
          .delete();
        await db.chunks.bulkPut(chunks);
        await db.messages.bulkPut(data.messages);
        await db.outputs.bulkPut(data.outputs);
        await db.blobs.bulkPut(data.blobs);
        await mergeStudyBooks(db.study, db.blobs);
      }),
    clearAll: () =>
      db.transaction("rw", content, async () => {
        await Promise.all(content.map((table) => table.clear()));
      }),
    count: (table) => db.table(table).count(),
  };
}
