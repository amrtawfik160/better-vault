import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { studyId, updateStudyThread } from "@/lib/db/study";
import type { StudyThread, StudyTutorDraft } from "@/lib/study/records";
import {
  clearTutorDraftRecovery,
  readTutorDraftRecovery,
  recordTutorDraftRecovery,
} from "@/lib/study/tutor-draft-recovery";

export type TutorComposeDraft = StudyTutorDraft & { replaces?: string };
const emptyDraft: TutorComposeDraft = { id: "", text: "", at: 0 };

export function useStudyTutorDraft(thread: StudyThread) {
  const threadId = thread.id;
  const [local, setLocal] = useState<TutorComposeDraft>();
  const [recovered] = useState(() => readTutorDraftRecovery(threadId));
  const uncommitted = recovered && (!recovered.speech || thread.keepVoiceTranscripts) &&
    recovered.at > (thread.draft?.at ?? -Infinity) ? recovered : undefined;
  const draft: TutorComposeDraft = local ?? uncommitted ?? thread.draft ?? emptyDraft;
  const latest = useRef<TutorComposeDraft>(draft);
  const pending = useRef<StudyTutorDraft | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    latest.current = draft;
  }, [draft]);

  const persist = useCallback(async (value: StudyTutorDraft) => {
    const { id, text, at, speech } = value;
    await updateStudyThread(threadId, {}, [], { kind: "save", draft: { id, text, at, speech } });
    clearTutorDraftRecovery(threadId, id);
  }, [threadId]);

  useEffect(() => {
    if (uncommitted) void persist(uncommitted).catch(console.error);
    else if (recovered) clearTutorDraftRecovery(threadId, recovered.id);
  }, [persist, recovered, threadId, uncommitted]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const value = pending.current;
    pending.current = undefined;
    if (value) void persist(value).catch(console.error);
  }, [persist]);

  useEffect(() => {
    function hide() {
      if (document.hidden) flush();
    }
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  function edit(text: string, source?: StudyTutorDraft["speech"] | null) {
    const previous = latest.current;
    const speech = text ? (source === null ? undefined : source ?? previous.speech) : undefined;
    const privateSpeech = speech !== undefined && !thread.keepVoiceTranscripts;
    const replaces = privateSpeech
      ? previous.replaces ?? (!previous.speech || thread.draft?.id === previous.id ? previous.id : undefined)
      : undefined;
    const next = {
      text: text.slice(0, 12_000),
      id: studyId(),
      at: Math.max(Date.now(), previous.at + 1, (thread.draft?.at ?? 0) + 1),
      speech,
      replaces,
    } satisfies TutorComposeDraft;
    latest.current = next;
    setLocal(next);
    if (privateSpeech) {
      flush();
      return next;
    }
    recordTutorDraftRecovery(threadId, next);
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 250);
    return next;
  }

  function appendSpeech(text: string) {
    const previous = latest.current;
    edit([previous.text, text].filter(Boolean).join(" "), previous.speech ?? "dictated");
  }

  function recoverSpeech(text: string) {
    if (!latest.current.text.trim()) return edit(text, "spoken");
  }

  function completed(used: TutorComposeDraft) {
    clearTutorDraftRecovery(threadId, used.replaces ?? used.id);
    if (pending.current?.id === used.id) pending.current = undefined;
    if (latest.current.id !== used.id) return;
    const cleared = { id: used.id, text: "", at: Math.max(Date.now(), used.at) };
    latest.current = cleared;
    setLocal(cleared);
  }

  return { draft, edit, appendSpeech, recoverSpeech, persist, completed };
}
