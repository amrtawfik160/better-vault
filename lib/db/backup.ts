import { pdfOcrSourceSchema, studyRecordSchema, type StudyRecord } from "@/lib/study/records";
import { clearAllReviewCheckpoints } from "@/lib/study/review-session";
import { clearAllTutorDraftRecovery } from "@/lib/study/tutor-draft-recovery";
import { clearDocumentRecoveries } from "@/lib/study/document-drafts";
import { clearFlashcardDrafts } from "@/lib/study/flashcard-draft-recovery";
import { clearAllPracticeDrafts } from "@/lib/study/writing-practice-drafts";
import { z } from "zod";
import { conversationTitle } from "@/lib/chat/title";
import { parsePluginBundle } from "@/lib/plugins/manifest";
import { fromBase64, toBase64 } from "@/lib/base64";
import { store } from "./store";
import { chunksForSource } from "./sources";
import type {
  Conversation,
  Folder,
  Notebook,
  Source,
  StoredBlob,
  StoredMessage,
  StudioOutput,
  Vault,
  CalendarEntry,
  Note,
  Skill,
  Bot,
  BotMessage,
  Plugin,
  VaultFile,
} from "./types";

/** A stored file in a backup: its bytes as base64, since backups are JSON. */
export type BackupBlob = Omit<StoredBlob, "data"> & { data: string };

/**
 * A backup holds folders, notebooks, sources, chats, Studio outputs and their
 * files. It never holds settings, so API keys are not written into a file
 * that might be shared.
 */
export interface Backup {
  app: "better-vault";
  /**
   * 10 adds Study's data; 9 added loose files in vaults; 8 added plugins; 7 added bots and their threads; 6 added notes and skills; 5 added calendar entries; 4 added vaults; 3 added folders and files; 2
   * added conversations. Older backups still import: format 1 (one chat per
   * notebook), format 2 (no folders), format 3 (no vaults: everything is in
   * the default vault), format 4 (no calendar), format 5 (no notes or skills), format 6 (no bots),
   * format 7 (no plugins), format 8 (no files) and format 9 (no Study). Plugins in a backup are
   * checked again and come back turned off.
   */
  format: 10;
  study: StudyRecord[];
  exportedAt: number;
  calendar: CalendarEntry[];
  vaults: Vault[];
  notes: Note[];
  skills: Skill[];
  plugins: Plugin[];
  files: VaultFile[];
  bots: Bot[];
  botMessages: BotMessage[];
  folders: Folder[];
  notebooks: Notebook[];
  sources: Source[];
  conversations: Conversation[];
  messages: StoredMessage[];
  outputs: StudioOutput[];
  blobs: BackupBlob[];
}

const backupSchema = z.object({
  app: z.literal("better-vault"),
  format: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
    z.literal(9),
    z.literal(10),
  ]),
  plugins: z.array(z.object({ id: z.string() }).loose()).optional(),
  files: z
    .array(
      z
        .object({
          id: z.string(),
          vaultId: z.string(),
          name: z.string(),
          blobId: z.string(),
        })
        .loose(),
    )
    .optional(),
  // Study's own builds wrote their data as format 8, before it reached main.
  study: z.array(studyRecordSchema).optional(),
  bots: z.array(z.object({ id: z.string(), name: z.string() }).loose()).optional(),
  botMessages: z
    .array(z.object({ id: z.string(), botId: z.string(), createdAt: z.number() }).loose())
    .optional(),
  notes: z
    .array(z.object({ id: z.string(), vaultId: z.string(), body: z.string() }).loose())
    .optional(),
  skills: z
    .array(z.object({ id: z.string(), vaultId: z.string(), name: z.string() }).loose())
    .optional(),
  calendar: z
    .array(
      z.object({ id: z.string(), title: z.string(), start: z.string(), end: z.string() }).loose(),
    )
    .optional(),
  exportedAt: z.number(),
  vaults: z.array(z.object({ id: z.string(), name: z.string() }).loose()).optional(),
  folders: z.array(z.object({ id: z.string(), name: z.string() }).loose()).optional(),
  notebooks: z.array(z.object({ id: z.string(), title: z.string() }).loose()),
  sources: z.array(
    z
      .object({
        id: z.string(),
        notebookId: z.string(),
        text: z.string(),
        studyRevision: z.number().int().nonnegative().optional(),
        pdfOcr: pdfOcrSourceSchema.optional(),
      })
      .loose(),
  ),
  conversations: z.array(z.object({ id: z.string(), notebookId: z.string() }).loose()).optional(),
  messages: z.array(z.object({ id: z.string(), notebookId: z.string() }).loose()),
  outputs: z.array(z.object({ id: z.string(), notebookId: z.string() }).loose()),
  blobs: z
    .array(
      z
        .object({ id: z.string(), notebookId: z.string(), mime: z.string(), data: z.string() })
        .loose(),
    )
    .optional(),
});

export async function exportBackup(): Promise<Backup> {
  const { blobs, ...content } = await store().exportAll();
  return {
    app: "better-vault",
    format: 10,
    exportedAt: Date.now(),
    ...content,
    blobs: blobs.map((blob) => ({ ...blob, data: toBase64(blob.data) })),
  };
}

/** Adds the backup's content, replacing items with the same id. Returns how many notebooks it held. */
export async function importBackup(raw: unknown): Promise<number> {
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) throw new Error("invalid-backup");
  const backup = upgradeBackup(parsed.data as unknown as OldBackup);
  const chunks = backup.sources.flatMap(chunksForSource);
  await store().importAll(
    {
      study: backup.study,
      calendar: backup.calendar,
      vaults: backup.vaults,
      notes: backup.notes,
      skills: backup.skills,
      plugins: backup.plugins,
      files: backup.files,
      bots: backup.bots,
      botMessages: backup.botMessages,
      folders: backup.folders,
      notebooks: backup.notebooks,
      sources: backup.sources,
      conversations: backup.conversations,
      messages: backup.messages,
      outputs: backup.outputs,
      blobs: backup.blobs.map((blob) => ({ ...blob, data: fromBase64(blob.data) })),
    },
    chunks,
  );
  return backup.notebooks.length;
}

type OldBackup = Omit<
  Backup,
  | "format"
  | "study"
  | "conversations"
  | "folders"
  | "blobs"
  | "vaults"
  | "calendar"
  | "notes"
  | "skills"
  | "plugins"
  | "files"
  | "bots"
  | "botMessages"
> & {
  format: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  plugins?: unknown[];
  files?: VaultFile[];
  study?: StudyRecord[];
  bots?: Bot[];
  botMessages?: BotMessage[];
  notes?: Note[];
  skills?: Skill[];
  calendar?: CalendarEntry[];
  vaults?: Vault[];
  conversations?: Conversation[];
  folders?: Folder[];
  blobs?: BackupBlob[];
};

/**
 * Brings an older backup up to date: in format 1 each notebook's single chat
 * becomes a conversation with the notebook's id, as the database upgrade
 * does; before format 3 there are no folders or files, before 4 no vaults.
 */
function upgradeBackup(backup: OldBackup): Backup {
  const messages = backup.messages.map((row) => ({
    ...row,
    conversationId: row.conversationId ?? row.notebookId,
  }));
  const conversations = [...(backup.conversations ?? [])];
  const known = new Set(conversations.map((conversation) => conversation.id));
  const orphans = new Map<string, StoredMessage[]>();
  for (const row of messages) {
    if (!known.has(row.conversationId))
      orphans.set(row.conversationId, [...(orphans.get(row.conversationId) ?? []), row]);
  }
  for (const [id, rows] of orphans) {
    const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt);
    conversations.push({
      id,
      notebookId: sorted[0].notebookId,
      title: conversationTitle(sorted.map((row) => row.message)),
      createdAt: sorted[0].createdAt,
      updatedAt: sorted[sorted.length - 1].createdAt,
    });
  }
  return {
    ...backup,
    format: 10,
    study: backup.study ?? [],
    calendar: backup.calendar ?? [],
    files: backup.files ?? [],
    plugins: (backup.plugins ?? []).flatMap(restorePlugin),
    bots: backup.bots ?? [],
    botMessages: backup.botMessages ?? [],
    notes: backup.notes ?? [],
    skills: backup.skills ?? [],
    vaults: backup.vaults ?? [],
    conversations,
    messages,
    folders: backup.folders ?? [],
    blobs: backup.blobs ?? [],
  };
}

/**
 * A plugin from a backup, checked like any plugin from outside and turned
 * off, since a backup file may come from someone else.
 */
function restorePlugin(raw: unknown): Plugin[] {
  const row = raw as Partial<Plugin>;
  const parsed = parsePluginBundle({ manifest: row.manifest, files: row.files });
  if (!parsed.ok) return [];
  const now = Date.now();
  return [
    {
      id: parsed.bundle.manifest.id,
      manifest: parsed.bundle.manifest,
      files: parsed.bundle.files,
      enabled: false,
      granted: [],
      updatedBy: typeof row.updatedBy === "string" ? row.updatedBy : "you",
      createdAt: typeof row.createdAt === "number" ? row.createdAt : now,
      updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : now,
    },
  ];
}

/** Deletes every notebook, note, skill, plugin, bot, source, chat and output. Settings and keys are kept. */
export async function deleteAllData() {
  await store().clearAll();
  clearAllTutorDraftRecovery();
  clearDocumentRecoveries();
  clearFlashcardDrafts();
  clearAllReviewCheckpoints();
  clearAllPracticeDrafts();
}
