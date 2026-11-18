import type { StudyRecord } from "@/lib/study/records";
import { canWriteStudyDocumentDraft, studyDocumentDraftId } from "@/lib/study/document-drafts";
import { DEFAULT_VAULT } from "@/lib/study/vault";
import { patchedStudyReviewItem } from "@/lib/study/recall";
import { patchedStudyThread } from "@/lib/study/reports";
import { patchedStudyBook, revisedStudyBook } from "@/lib/study/text-edits";
import { detachedVocabularyCard, vocabularyCardId, vocabularyChanges } from "@/lib/study/vocabulary";
import { updatedStudioPractice } from "@/studio/shared/practice";
import type { Backend } from "./backend";
import { BetterVaultDatabase } from "./database";
import type { Source, StudioOutput } from "./types";

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
      db.transaction("rw", [db.folders, db.notebooks], async () => {
        const folder = await db.folders.get(id);
        if (!folder) return;
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
    listSources: (notebookId) =>
      db.sources.where("notebookId").equals(notebookId).sortBy("createdAt"),
    patchSource: async (id, patch) => {
      await db.sources.update(id, patch);
    },
    patchNotebookSources: async (notebookId, patch) => {
      await db.sources.where("notebookId").equals(notebookId).modify(patch);
    },
    deleteSource: (id) =>
      db.transaction("rw", [db.sources, db.chunks, db.blobs], async () => {
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
    putStudy: async (rows) => {
      await db.study.bulkPut(rows);
    },
    insertStudy: (rows) =>
      db.transaction("rw", db.study, async () => {
        const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
        const existing = await db.study.bulkGet(unique.map(({ id }) => id));
        const pending = unique.filter((_, index) => !existing[index]);
        await db.study.bulkAdd(pending);
        return pending.length;
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
        if (!book || !source || !(await db.notebooks.get(book.notebookId))) return false;
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
    deleteStudy: (id) =>
      db.transaction("rw", db.study, async () => {
        const row = await db.study.get(id);
        if (row?.kind === "book") {
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

    exportAll: async () => {
      const [
        study,
        calendar,
        vaults,
        notes,
        skills,
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
      }),
    clearAll: () =>
      db.transaction("rw", content, async () => {
        await Promise.all(content.map((table) => table.clear()));
      }),
    count: (table) => db.table(table).count(),
  };
}
