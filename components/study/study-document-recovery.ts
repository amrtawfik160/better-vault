import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStoreQuery } from "@/lib/db/live";
import { store } from "@/lib/db/store";
import { studyId } from "@/lib/db/study";
import {
  clearDocumentRecovery,
  journalDocumentRecovery,
  readDocumentRecovery,
} from "@/lib/study/document-drafts";
import type { StudyDocumentRecovery, StudyDocumentSnapshot } from "@/lib/study/records";

type Target = Pick<StudyDocumentRecovery, "id" | "bookId" | "notebookId" | "vaultId">;

function mostRecent(id: string, ...options: (StudyDocumentRecovery | undefined)[]) {
  return options.reduce<StudyDocumentRecovery | undefined>(
    (latest, entry) =>
      entry?.id === id && (!latest || entry.updatedAt >= latest.updatedAt) ? entry : latest,
    undefined,
  );
}

async function persist(row: StudyDocumentRecovery) {
  if (await store().writeStudyDocumentDraft(row)) clearDocumentRecovery(row.id, row.version);
}

export function useStudyDocumentRecovery(target: Target) {
  const { id } = target;
  const disk = useStoreQuery(
    async () => {
      const row = await store().getStudy(id);
      return { id, row: row?.kind === "document-draft" ? row : undefined };
    },
    [id],
    ["study"],
  );
  const journal = useMemo(() => readDocumentRecovery(id), [id]);
  const [local, setLocal] = useState<StudyDocumentRecovery>();
  const latest = mostRecent(id, journal, local, disk?.row);
  const pending = useRef<StudyDocumentRecovery | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const row = pending.current;
    pending.current = undefined;
    if (row) void persist(row).catch(console.error);
  }, []);

  useEffect(() => {
    if (!journal || disk?.id !== id) return;
    if (journal.updatedAt > (disk.row?.updatedAt ?? -Infinity)) {
      void persist(journal).catch(console.error);
    } else {
      clearDocumentRecovery(journal.id, journal.version);
    }
  }, [disk, id, journal]);

  useEffect(() => {
    function hide() {
      if (document.hidden) flush();
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hide);
      flush();
    };
  }, [flush, id]);

  function stage(snapshot: StudyDocumentSnapshot) {
    const previous = mostRecent(id, pending.current, latest, readDocumentRecovery(id));
    const row: StudyDocumentRecovery = {
      ...target,
      kind: "document-draft",
      updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1),
      version: studyId(),
      snapshot,
    };
    setLocal(row);
    pending.current = row;
    if (journalDocumentRecovery(row)) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 250);
    } else {
      flush();
    }
    return row;
  }

  async function clear(used: StudyDocumentRecovery) {
    if (pending.current?.version === used.version) {
      window.clearTimeout(timer.current);
      pending.current = undefined;
    }
    const cached = readDocumentRecovery(used.id);
    if (cached && cached.updatedAt > used.updatedAt) return;
    await persist(used);
    const closed: StudyDocumentRecovery = {
      ...used,
      version: studyId(),
      updatedAt: Math.max(Date.now(), used.updatedAt + 1),
      snapshot: null,
    };
    if (await store().writeStudyDocumentDraft(closed, used.version)) setLocal(closed);
  }

  return { latest, ready: disk?.id === id || journal !== undefined, stage, clear };
}
