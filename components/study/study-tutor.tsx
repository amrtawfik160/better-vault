import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  BulbIcon,
  Cards01Icon,
  Flowchart01Icon,
  MagicWand01Icon,
  Note01Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { StudySessionReport } from "./study-session-report";
import { StudyFollowUpButton } from "./study-follow-ups";
import { StudyCardChoices } from "./study-card-choices";
import { StudyCardImage } from "./study-card-image";
import { StudyOriginLink } from "./study-origin-link";
import { useStudyTutorDraft, type TutorComposeDraft } from "./study-tutor-draft";
import {
  TutorMaterialPicker,
  availableTutorSelection,
  emptyTutorSelection,
  tutorSelectionCount,
  type TutorMaterial,
  type TutorMaterialOptions,
  type TutorMaterialSelection,
} from "./tutor-material-picker";
import { StudyFlashcardDraftDialog, type FlashcardSource } from "./study-flashcard-generator";
import { Visual } from "@/components/chat/visual/visual-part";
import { Icon, type IconSvgElement } from "@/components/icon";
import { visualText } from "@/lib/chat/visual-text";
import { notebookChatHref, originHref, studyCitationOrigin, studyHref, tutorCardsScope } from "@/lib/study/links";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { AIModelPicker } from "@/components/ai/ai-model-picker";
import { modelFor, useSettings, type ModelUse } from "@/lib/db/settings";
import { isPracticeThread } from "@/lib/study/practice";
import type { Note } from "@/lib/db/types";
import {
  saveStudyCard,
  saveStudyWord,
  saveStudyNote,
  recordStudyActivity,
  readStudyThread,
  readStudyTutorSources,
  studyId,
  updateStudyThread,
  updateStudyReport,
  useStudyDocumentImage,
} from "@/lib/db/study";
import { askStudyModel } from "@/lib/study/client";
import { studyConversationMaterial, studyMessageText, studyPracticeImages } from "@/lib/study/ai";
import { passagesFor, tutorBookOrigin } from "@/lib/study/passages";
import { activeStudyCard, selectedStudyCards } from "@/lib/study/recall";
import { returnFromTutorCards, returnToTutor, studyReturnState } from "@/lib/study/return-links";
import {
  captureReportPracticeContext,
  matchesStudyReport,
  reportSuggestionId,
  savedReportSuggestions,
  studyFollowUpId,
  studyReportKey,
  studyReports,
} from "@/lib/study/reports";
import { StudyText } from "./study-text";
import { DirectionalText } from "@/components/common/directional-text";
import { textDirection } from "@/lib/text/direction";
import { prepareSpeech, stopSpeaking } from "@/lib/speech/speak";
import { recordStudyVoice, transcribeStudyVoice } from "@/lib/study/voice";
import {
  speakStudyReply,
  startStudyVoiceSession,
  type StudyVoicePhase,
} from "@/lib/study/voice-session";
import {
  studyCorrections,
  studyScopes,
  type StudyBook,
  type StudyThread,
  type StudyThreadChange,
  type StudyRecordOf,
  type StudyWord,
  type StudyReportChange,
  type StudyOrigin,
} from "@/lib/study/records";
import { SelectableText } from "@/components/selection/selectable-text";

export function simulationGoal(goal: StudyThread["goal"]) {
  if (goal === "technical-interview" || goal === "meeting-simulation") return goal;
}
const scopeLabels = {
  passage: "Selection",
  chapter: "Current section",
  book: "Whole book",
  notes: "Selected notes",
  general: "General",
};
const correctionLabels = { live: "During the conversation", report: "At the end", off: "Off" };
const optionClass = "rounded-lg border bg-background p-2 text-sm";
type VoiceCapture = {
  abort: AbortController;
  stop?: () => void;
  mute?: (muted: boolean) => void;
};

type LiveVoice = ReturnType<typeof startStudyVoiceSession> & { abort: AbortController };
type TutorDelivery = {
  draft?: TutorComposeDraft;
  spoken?: boolean;
  session?: AbortSignal;
  starter?: true;
};
type TutorTurn = { entry: StudyThread["messages"][number]; index: number | undefined };
type TutorFailure =
  | { kind: "answer"; text: string; delivery: Omit<TutorDelivery, "session">; detail?: string }
  | { kind: "visual"; target: TutorTurn; detail?: string }
  | { kind: "report"; detail?: string };
const stoppedTutorRequest = Symbol("stopped-tutor-request");

export function tutorMaterialOptions(
  scope: StudyThread["scope"],
  books: StudyBook[],
  notes: Note[],
  sources: TutorMaterial[],
  highlights: TutorMaterial[],
  cards: StudyRecordOf<"card">[],
  selection: TutorMaterialSelection,
): TutorMaterialOptions {
  if (scope === "cards")
    return {
      bookIds: [],
      sourceIds: [],
      noteIds: [],
      highlightIds: [],
      cardIds: cards
        .filter(({ front, back }) => front.trim() && back.trim())
        .map(({ id, front, tags }) => ({ id, title: front, detail: tags.join(" · ") || undefined })),
    };
  if (scope !== "materials")
    return { bookIds: [], sourceIds: [], noteIds: notes, highlightIds: [], cardIds: [] };
  const bookSources = new Set(books.map(({ sourceId }) => sourceId));
  const savedSources = new Set(selection.sourceIds);
  const sourcesInUse = new Set(sources.filter(({ id }) => savedSources.has(id)).map(({ id }) => id));
  return {
    bookIds: books.filter(({ sourceId }) => !sourcesInUse.has(sourceId)),
    sourceIds: sources.filter(({ id }) => !bookSources.has(id) || savedSources.has(id)),
    noteIds: notes,
    highlightIds: highlights,
    cardIds: [],
  };
}

export function materialChanges(scope: StudyThread["scope"], selection: TutorMaterialSelection) {
  const { bookIds, noteIds, sourceIds, highlightIds, cardIds } = selection;
  if (scope === "cards") return { cardIds };
  if (scope === "notes") return { noteIds };
  return { bookIds, noteIds, sourceIds, highlightIds };
}

export function StudyTutor({
  thread,
  vaultThreads,
  vaultId,
  vaultNotes,
  vaultBooks,
  vaultHighlights,
  notebookSources,
  book,
  openReport,
  requestedReportId,
  focusSuggestion,
  reportCards,
  vaultWords,
  focusMessage: requestedMessage,
  back,
  openBesideReader,
  setup,
}: {
  thread: StudyThread;
  vaultThreads: StudyThread[];
  vaultId: string;
  vaultNotes: Note[];
  vaultBooks: StudyBook[];
  vaultHighlights: TutorMaterial[];
  notebookSources: TutorMaterial[];
  book?: StudyBook;
  openReport?: boolean;
  requestedReportId?: string;
  focusSuggestion?: string;
  reportCards: StudyRecordOf<"card">[];
  vaultWords: StudyWord[];
  focusMessage?: number;
  back?: () => void;
  openBesideReader?: () => void;
  setup: () => void;
}) {
  const { t, i18n } = useTranslation("home");
  const { t: common } = useTranslation();
  const { t: tChat } = useTranslation("chat");
  const location = useLocation();
  const composer = useStudyTutorDraft(thread);
  const input = composer.draft.text;
  const composerField = useRef<HTMLTextAreaElement>(null);
  const fromReviewFeedback = location.state?.studyReviewFeedback === true || location.state?.focusStudyDraft === true;
  const [feedbackReply] = useState(() => fromReviewFeedback && !input.trim()
    ? thread.messages.findLastIndex(({ role }) => role === "assistant")
    : -1);
  const focusMessage = requestedMessage ?? (fromReviewFeedback && feedbackReply >= 0 ? feedbackReply : undefined);
  const focusDraft = fromReviewFeedback && focusMessage === undefined;
  const [operation, setOperation] = useState<"answer" | "visual" | "report" | null>(null);
  const [failed, setFailed] = useState<TutorFailure>();
  const busy = operation !== null;
  const [changingCard, setChangingCard] = useState(false);
  const [answerImageCardId, setAnswerImageCardId] = useState(fromReviewFeedback ? thread.practiceCardId : undefined);
  const revealedImageCardId = useRef(answerImageCardId);
  const answerImageRegion = useId();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [showReport, setShowReport] = useState(openReport ?? false);
  const [selectedReportId, setSelectedReportId] = useState(requestedReportId);
  const navigate = useNavigate();
  const [voiceState, setVoiceState] = useState<"opening" | "recording" | "transcribing" | null>(
    null,
  );
  const [voicePractice, setVoicePractice] = useState(false);
  const [livePhase, setLivePhase] = useState<StudyVoicePhase | null>(null);
  const [finishingVoice, setFinishingVoice] = useState(false);
  const finishingReport = useRef(false);
  const [draftSource, setDraftSource] = useState<FlashcardSource | null>(null);
  const [temporaryTurns, setTemporaryTurns] = useState<StudyThread["messages"]>([]);
  const recentTurns = useRef<StudyThread["messages"]>([]);
  const [micMuted, setMicMuted] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState<boolean>();
  const [readAloud, setReadAloud] = useState(false);
  const [language, setLanguage] = useState(thread.practiceLanguage ?? "");
  const workPending =
    busy || changingCard || voiceState !== null || livePhase !== null || finishingVoice;
  const pendingVoiceTurn =
    livePhase === "recording" || livePhase === "transcribing" || livePhase === "thinking";
  const cardPractice = thread.scope === "cards";
  const curated = thread.scope === "materials" || thread.scope === "notes" || cardPractice;
  const readableBooks = useMemo(
    () =>
      thread.scope === "materials"
        ? vaultBooks.filter(({ sections }) => sections.some(({ text }) => text.trim()))
        : [],
    [thread.scope, vaultBooks],
  );
  const readableNotes = useMemo(() => vaultNotes.filter(({ body }) => body.trim()), [vaultNotes]);
  const selection = {
    ...emptyTutorSelection,
    ...materialChanges(thread.scope, {
      bookIds: thread.bookIds ?? [],
      sourceIds: thread.sourceIds ?? [],
      noteIds: thread.noteIds ?? [],
      highlightIds: thread.highlightIds ?? [],
      cardIds: thread.cardIds ?? [],
    }),
  };
  const materialOptions = tutorMaterialOptions(
    thread.scope,
    readableBooks,
    readableNotes,
    notebookSources,
    vaultHighlights,
    reportCards,
    selection,
  );
  const selected = availableTutorSelection(materialOptions, selection);
  const practiceCards = selectedStudyCards(selected.cardIds, reportCards);
  const practiceCard = activeStudyCard(practiceCards, thread.practiceCardId);
  const practiceImages = studyPracticeImages(practiceCard);
  const documentImage = useStudyDocumentImage(book, thread);
  const imagePractice = thread.scope === "image";
  const answerImageVisible = !!practiceCard && answerImageCardId === practiceCard.id;
  const nextCard = practiceCards[practiceCards.findIndex(({ id }) => id === practiceCard?.id) + 1];
  const contextReady = (!curated || tutorSelectionCount(selected) > 0) && (!imagePractice || !!documentImage);
  const controller = useRef<AbortController | null>(null);
  const voice = useRef<VoiceCapture | null>(null);
  const live = useRef<LiveVoice | null>(null);
  const settings = useSettings();
  // Practice conversations and the reader's Ask AI each remember their own model.
  const modelUse: ModelUse = isPracticeThread(thread) ? "practice" : "ask";
  const model = settings ? (modelFor(settings, modelUse)?.model ?? null) : null;
  const reports = studyReports(thread);
  const followUp = thread.followUp;
  const simulation = !cardPractice && !followUp ? simulationGoal(thread.goal) : undefined;
  const originalThread = followUp && vaultThreads.find(({ id }) => id === followUp.threadId);
  const originalReport =
    followUp && originalThread &&
    studyReports(originalThread).find((report) => studyReportKey(report) === followUp.reportId);
  const followUpAvailable = followUp && originalReport?.nextSteps[followUp.index]?.trim();
  const followUpState = followUp && originalReport?.plannedSteps?.[followUp.index];
  const followUpComplete = followUpState?.completedAt !== undefined;
  const visibleReport = selectedReportId
    ? reports.find((entry) => studyReportKey(entry) === selectedReportId)
    : openReport
      ? (reports.find((entry) => !entry.id) ?? reports[0])
      : reports[0];
  const reportId = visibleReport ? studyReportKey(visibleReport) : undefined;
  const reportCardCount = reportId
    ? reportCards.filter((card) => matchesStudyReport(card.origin, thread.id, reportId)).length
    : 0;
  const reportDate = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  const conversation = [
    ...thread.messages.map((entry, index) => ({ entry, index })),
    ...temporaryTurns.map((entry) => ({ entry, index: undefined })),
  ].sort((a, b) => (a.entry.at ?? 0) - (b.entry.at ?? 0));
  const focusedTurn = focusMessage === undefined ? undefined : thread.messages[focusMessage];
  const currentTurns =
    cardPractice && (!focusedTurn || focusedTurn.practiceCardId === practiceCard?.id)
      ? conversation.filter(({ entry }) => practiceCard && entry.practiceCardId === practiceCard.id)
      : conversation;
  const hasSavedAnswer = thread.messages.some(({ role, text }) => role === "assistant" && text.trim());
  const answersWithCards = new Set(reportCards.flatMap(({ origin }) =>
    origin?.kind === "tutor" && origin.threadId === thread.id && origin.message !== undefined ? [origin.message] : [],
  ));
  const conversationCardCount = reportCards.filter(
    ({ origin }) => origin?.kind === "tutor" && origin.threadId === thread.id,
  ).length;
  const lastTurn = currentTurns.at(-1);
  const quickTurn =
    lastTurn?.entry.role === "assistant" && lastTurn.entry.text.trim() && !workPending
      ? lastTurn
      : undefined;

  useEffect(() => {
    const probe = new AbortController();
    window.speechSynthesis?.getVoices();
    void fetch("/api/study/voice", { signal: probe.signal })
      .then((response) => response.json())
      .then((status) => setVoiceAvailable(status.available === true))
      .catch(() => {
        if (!probe.signal.aborted) setVoiceAvailable(false);
      });
    const leave = () => {
      if (document.hidden) live.current?.abort.abort();
    };
    document.addEventListener("visibilitychange", leave);
    return () => {
      document.removeEventListener("visibilitychange", leave);
      probe.abort();
      controller.current?.abort();
      voice.current?.abort.abort();
      live.current?.abort.abort();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (focusDraft) composerField.current?.focus();
  }, [focusDraft]);

  useEffect(() => {
    if (focusMessage !== undefined) {
      const message = document.getElementById(`study-message-${focusMessage}`);
      message?.scrollIntoView({ block: "center" });
      message?.focus({ preventScroll: true });
    }
    if (showReport) {
      const suggestion =
        focusSuggestion && reportId === requestedReportId
          ? document.getElementById(`study-report-${focusSuggestion}`)
          : null;
      if (suggestion) {
        suggestion.scrollIntoView({ block: "center" });
        suggestion.focus({ preventScroll: true });
      } else {
        const report = document.getElementById("study-session-report");
        report?.scrollIntoView({ block: "start" });
        report?.focus({ preventScroll: true });
      }
    }
  }, [focusMessage, focusSuggestion, reportId, requestedReportId, showReport]);

  async function save(change: StudyThreadChange) {
    await updateStudyThread(thread.id, change);
  }

  function revealAnswerImage(cardId: string | undefined) {
    revealedImageCardId.current = cardId;
    setAnswerImageCardId(cardId);
  }

  function clearMessageLink() {
    if (focusMessage === undefined) return;
    const params = new URLSearchParams(location.search);
    params.delete("message");
    void navigate(
      { pathname: location.pathname, search: params.toString() },
      { replace: true, state: studyReturnState(location.state) },
    );
  }

  async function choosePracticeCard(id: string) {
    setChangingCard(true);
    try {
      await save({ practiceCardId: id });
      revealAnswerImage(undefined);
      clearMessageLink();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setChangingCard(false);
    }
  }

  function saveTemporaryTurns(turns: StudyThread["messages"]) {
    recentTurns.current = turns;
    setTemporaryTurns(turns);
  }

  async function currentConversation(): Promise<StudyThread> {
    const latest = await readStudyThread(thread.id);
    return {
      ...latest,
      practiceLanguage: language.trim() || undefined,
      messages: [...latest.messages, ...recentTurns.current].sort(
        (a, b) => (a.at ?? 0) - (b.at ?? 0),
      ),
    };
  }

  async function send(
    message: string,
    submittedAt: number,
    { spoken = false, session, draft, starter }: TutorDelivery = {},
  ) {
    const text = message.trim();
    if (!text || controller.current || !model) return;
    const revealedCardId = revealedImageCardId.current;
    setOperation("answer");
    setFailed(undefined);
    const abort = new AbortController();
    controller.current = abort;
    const signal = session ? AbortSignal.any([abort.signal, session]) : abort.signal;
    try {
      const current = await currentConversation();
      const keepTurn = !(spoken || draft?.speech) || current.keepVoiceTranscripts;
      if (draft && keepTurn) await composer.persist(draft);
      const consumedId = draft && (keepTurn ? draft.id : draft.replaces);
      const consume = consumedId ? { kind: "consume" as const, id: consumedId } : undefined;
      const sources = await readStudyTutorSources(current, vaultId);
      signal.throwIfAborted();
      if (current.scope === "image" && !sources.documentImage) {
        throw new Error(t("study.reader.imageContextUnavailable"));
      }
      const passages = passagesFor(current, sources, text);
      if (current.scope !== "general" && !passages.length)
        throw new Error(
          current.scope === "cards"
            ? t("study.materials.noCardsSelected")
            : current.scope === "materials"
            ? t("study.materials.noReadableSelection")
            : current.scope === "notes"
              ? "Choose a note with text first."
              : "This scope has no readable text. Choose another context.",
        );
      const cardOrigin = passages[0]?.origin;
      const practiceCardId = cardOrigin?.kind === "card" ? cardOrigin.cardId : undefined;
      const images = studyPracticeImages(sources.cards?.find(({ id }) => id === practiceCardId));
      const answerImage = revealedCardId === practiceCardId ? images.answer : undefined;
      const answer = await askStudyModel({
        use: modelUse,
        action: "chat",
        input: text,
        passages,
        thread: practiceCardId
          ? {
              ...current,
              messages: current.messages.filter((turn) => turn.practiceCardId === practiceCardId),
            }
          : current,
        signal,
        spoken,
        documentImage: sources.documentImage,
        cardImages: images.question || answerImage
          ? { question: images.question, answer: answerImage }
          : undefined,
      });
      signal.throwIfAborted();
      if (!answer.text.trim()) throw new Error(t("study.recovery.emptyAnswer"));
      const citations = [...new Set(answer.citations ?? [])].flatMap((index) => {
        const passage = passages[index - 1];
        return passage ? [{ index, origin: passage.origin, title: passage.title }] : [];
      });
      const turns: StudyThread["messages"] = [
        { role: "user", text, at: submittedAt, practiceCardId, draftId: keepTurn ? draft?.id : undefined, starter },
        { role: "assistant", text: answer.text, citations, at: submittedAt, practiceCardId },
      ];
      if (!keepTurn) {
        if (consume) await updateStudyThread(thread.id, {}, [], consume);
        saveTemporaryTurns([...recentTurns.current, ...turns]);
      } else
        await updateStudyThread(thread.id, {
          practiceLanguage: current.practiceLanguage,
          ...(practiceCardId && practiceCardId !== current.practiceCardId ? { practiceCardId } : {}),
        }, turns, consume);
      if (draft) composer.completed(draft);
      if (answer.imageFallback) toast.info(t("study.visualCard.tutorTextOnly"));
      if (spoken) setVoicePractice(true);
      if (!session) {
        if (spoken || readAloud)
          void speakStudyReply(answer.text, language.trim()).then((played) => {
            if (!played) toast.info(t("study.voice.speechUnavailable"));
          });
      }
      return answer.text;
    } catch (error) {
      if (!signal.aborted || signal.reason === stoppedTutorRequest) {
        const recover = draft ?? (spoken ? composer.recoverSpeech(text) : undefined);
        setFailed({
          kind: "answer",
          text,
          delivery: { draft: recover, spoken, starter },
          detail: signal.aborted ? undefined : error instanceof Error ? error.message : String(error),
        });
      }
      if (session) throw error;
    } finally {
      controller.current = null;
      setOperation(null);
    }
  }

  async function checkVoice(signal: AbortSignal) {
    const response = await fetch("/api/study/voice", { signal });
    const status: { available?: boolean } = await response.json();
    setVoiceAvailable(status.available === true);
    if (!status.available) throw new Error(t("study.voice.localUnavailable"));
  }

  async function dictate(sendTurn: boolean, startedAt: number) {
    if (voice.current || live.current || controller.current) return;
    const capture: VoiceCapture = { abort: new AbortController() };
    voice.current = capture;
    const signal = capture.abort.signal;
    setVoiceState("opening");
    stopSpeaking();
    try {
      await checkVoice(signal);
      const recording = await recordStudyVoice(signal);
      capture.stop = recording.stop;
      capture.mute = recording.mute;
      setVoiceState("recording");
      const turn = await recording.result;
      signal.throwIfAborted();
      if (!turn) return;
      const { audio, seconds } = turn;
      setVoiceState("transcribing");
      const transcript = await transcribeStudyVoice(audio, language, signal);
      signal.throwIfAborted();
      const activity = recordStudyActivity({
        activity: "speaking",
        seconds,
        notebookId: thread.notebookId,
        origin: { kind: "tutor", threadId: thread.id },
      });
      if (sendTurn) {
        await Promise.all([
          activity,
          send(transcript, startedAt + Math.round(seconds * 1000), { spoken: true }),
        ]);
      } else {
        composer.appendSpeech(transcript);
        await activity;
      }
    } catch (error) {
      if (!signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      voice.current = null;
      setVoiceState(null);
      setMicMuted(false);
    }
  }

  async function beginVoiceConversation() {
    if (voice.current || live.current || controller.current || !model || !contextReady) return;
    const abort = new AbortController();
    const { signal } = abort;
    const activitySessionId = studyId();
    let replyFailed = false;
    setLivePhase("opening");
    stopSpeaking();
    prepareSpeech();
    const session = startStudyVoiceSession({
      language: language.trim(),
      signal,
      ready: checkVoice,
      phase: setLivePhase,
      speechUnavailable: () => toast.info(t("study.voice.speechUnavailable")),
      noSpeech: () => toast.info(t("study.voice.noSpeech")),
      respond: async (transcript, seconds) => {
        const activity = recordStudyActivity({
          activity: "speaking",
          seconds,
          notebookId: thread.notebookId,
          origin: { kind: "tutor", threadId: thread.id },
          activitySessionId,
        }).catch((error: Error) => toast.error(error.message));
        try {
          const reply = await send(transcript, Date.now(), { spoken: true, session: signal });
          if (!reply) throw new Error(t("study.voice.replyUnavailable"));
          return reply;
        } catch (error) {
          replyFailed = true;
          throw error;
        } finally {
          await activity;
        }
      },
    });
    live.current = { ...session, abort };
    try {
      if ((await session.result) === "idle") toast.info(t("study.voice.idle"));
    } catch (error) {
      if (!signal.aborted && !replyFailed) {
        const failure = error instanceof DOMException ? error.name : undefined;
        let message = error instanceof Error ? error.message : String(error);
        if (failure === "NotAllowedError") message = t("study.voice.permission");
        if (failure === "NotFoundError" || failure === "NotReadableError")
          message = t("study.voice.microphoneUnavailable");
        toast.error(message);
      }
    } finally {
      live.current = null;
      setLivePhase(null);
      setMicMuted(false);
    }
  }

  async function report(generatedAt: number) {
    if (controller.current) return;
    setFailed(undefined);
    setOperation("report");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const context = await currentConversation();
      if (!context.messages.length) {
        toast.info(t("study.voice.noTurnForReport"));
        return;
      }
      let history = context.messages.filter((entry) => !entry.starter);
      if (!history.some(({ role }) => role === "user")) {
        toast.info(t("study.goals.answerBeforeReport"));
        return;
      }
      const sources = await readStudyTutorSources(context, vaultId, "report");
      abort.signal.throwIfAborted();
      if (context.scope === "cards") {
        const available = new Set(sources.cards?.map(({ id }) => id));
        history = history.filter(({ practiceCardId }) => practiceCardId && available.has(practiceCardId));
        if (!history.length) throw new Error(t("study.recall.tutorReportEmpty"));
      }
      const topic = history
        .filter(({ role }) => role === "user")
        .slice(-3)
        .map(({ text }) => text)
        .join(" ");
      const reportThread = { ...context, messages: history };
      const result = await askStudyModel({
        use: modelUse,
        action: "report",
        input: "Write a report on the study conversation.",
        passages: passagesFor(reportThread, sources, topic, "report"),
        thread: reportThread,
        signal: abort.signal,
      });
      abort.signal.throwIfAborted();
      const generated = result.report;
      if (!generated?.summary.trim()) throw new Error(t("study.recovery.emptyReport"));
      const requested = context.corrections && context.corrections !== "off";
      const hasLanguageEvidence = history.some(
        (entry) => entry.role === "user" && entry.text.trim().split(/\s+/).length >= 5,
      );
      const languageStatus = requested
        ? hasLanguageEvidence
          ? "reviewed"
          : "insufficient"
        : "not-requested";
      const reportId = studyId();
      const saved = await updateStudyReport(thread.id, {
        kind: "save",
        practiceLanguage: context.practiceLanguage ?? null,
        report: {
          ...generated,
          id: reportId,
          generatedAt,
          practiceContext: captureReportPracticeContext(reportThread, sources),
          languageStatus,
          languageFeedback: languageStatus === "reviewed" ? generated.languageFeedback : [],
          vocabulary: languageStatus === "reviewed" ? generated.vocabulary : [],
        },
      });
      if (!saved) throw new Error(t("study.followUps.unavailable"));
      setSelectedReportId(reportId);
      setShowReport(true);
      setVoicePractice(false);
      saveTemporaryTurns([]);
    } catch (error) {
      if (!abort.signal.aborted || abort.signal.reason === stoppedTutorRequest)
        setFailed({ kind: "report", detail: abort.signal.aborted ? undefined : error instanceof Error ? error.message : String(error) });
    } finally {
      controller.current = null;
      setOperation(null);
    }
  }

  async function finishVoiceReport() {
    if (finishingReport.current) return;
    const session = live.current;
    if (!session) {
      await report(Date.now());
      return;
    }
    finishingReport.current = true;
    setFinishingVoice(true);
    try {
      const finished = await session.finishForReport().then(() => true, () => false);
      if (finished && !session.abort.signal.aborted) await report(Date.now());
    } finally {
      finishingReport.current = false;
      setFinishingVoice(false);
    }
  }

  async function explainVisually(target: TutorTurn) {
    if (controller.current || !model) return;
    setOperation("visual");
    setFailed(undefined);
    const abort = new AbortController();
    controller.current = abort;
    const { signal } = abort;
    try {
      const current = await currentConversation();
      const sources = await readStudyTutorSources(current, vaultId);
      signal.throwIfAborted();
      const { practiceCardId } = target.entry;
      const answer = await askStudyModel({
        use: modelUse,
        action: "visual",
        input: studyMessageText(target.entry).slice(0, 20_000),
        passages: passagesFor(current, sources, target.entry.text),
        thread: practiceCardId
          ? { ...current, messages: current.messages.filter((turn) => turn.practiceCardId === practiceCardId) }
          : current,
        signal,
      });
      signal.throwIfAborted();
      if (!answer.visual) throw new Error(t("study.tutorActions.visualEmpty"));
      const at = Date.now();
      const turns: StudyThread["messages"] = [
        { role: "user", text: t("study.tutorActions.visualPrompt"), at, practiceCardId, starter: true },
        { role: "assistant", text: t("study.tutorActions.visualMessage"), visual: answer.visual, at, practiceCardId },
      ];
      if (target.index === undefined) saveTemporaryTurns([...recentTurns.current, ...turns]);
      else await updateStudyThread(thread.id, {}, turns);
    } catch (error) {
      if (!signal.aborted || signal.reason === stoppedTutorRequest)
        setFailed({
          kind: "visual",
          target,
          detail: signal.aborted ? undefined : error instanceof Error ? error.message : String(error),
        });
    } finally {
      controller.current = null;
      setOperation(null);
    }
  }

  function turnOrigin(index: number | undefined): StudyOrigin {
    return { kind: "tutor", threadId: thread.id, message: index };
  }

  function saveTurnNote({ entry, index }: TutorTurn) {
    if (entry.visual)
      saveNote(
        visualText(entry.visual.kind, entry.visual.data),
        turnOrigin(index),
        undefined,
        entry.visual.data.title,
      );
    else saveNote(entry.text, turnOrigin(index), entry.citations?.map(studyCitationOrigin));
  }

  function draftTurnCards({ entry, index }: TutorTurn) {
    draftCards(studyMessageText(entry), turnOrigin(index), [
      ...(entry.citations ?? []).map(studyCitationOrigin),
      ...(entry.practiceCardId ? [{ kind: "card" as const, cardId: entry.practiceCardId }] : []),
    ]);
  }

  function draftConversationCards() {
    const { text, evidence } = studyConversationMaterial(thread.messages, {
      learner: t("study.capture.learner"),
      tutor: t("study.capture.tutor"),
    });
    draftCards(text, { kind: "tutor", threadId: thread.id }, evidence);
  }

  function saveNote(
    text: string,
    origin: StudyOrigin,
    imageReferences?: StudyOrigin[],
    title = thread.title,
  ) {
    void saveStudyNote({
      notebookId: thread.notebookId,
      vaultId,
      title,
      body: text,
      origin,
      imageReferences,
    })
      .then((note) =>
        toast.success("Saved to Notes", {
          action: {
            label: "Open note",
            onClick: () => navigate(originHref({ kind: "note", noteId: note.id })),
          },
        }),
      )
      .catch((error: Error) => toast.error(error.message));
  }

  function draftCards(text: string, origin: StudyOrigin, evidence?: StudyOrigin[]) {
    setDraftSource({
      title: thread.title,
      text,
      origin,
      evidence,
      notebookId: thread.notebookId,
      tags: book && book.title !== thread.title ? [book.title, thread.title] : [thread.title],
    });
  }

  function changeReport(change: StudyReportChange, targetThread = thread.id) {
    void updateStudyReport(targetThread, change)
      .then((saved) => {
        if (!saved) toast.error(t("study.followUps.unavailable"));
      })
      .catch((error: Error) => toast.error(error.message));
  }

  function makeCard(front: string, back: string, origin: StudyOrigin, id: string) {
    return saveStudyCard(
      { front, back, tags: [thread.title], notebookId: thread.notebookId, vaultId, origin },
      id,
    )
      .then((card) =>
        toast.success("Flashcard saved", {
          action: {
            label: "View flashcard",
            onClick: () => navigate(studyHref("cards", { card: card.id })),
          },
        }),
      )
      .catch((error: Error) => toast.error(error.message));
  }

  return (
    <section className="max-w-4xl space-y-4">
      {back ? <Button variant="ghost" size="sm" onClick={back}>← {t("study.practice.title")}</Button> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {renaming ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim())
                void save({ title: title.trim() })
                  .then(() => setRenaming(false))
                  .catch((error: Error) => toast.error(error.message));
            }}
          >
            <Input
              aria-label="Conversation title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        ) : (
          <h2 className="text-xl font-semibold" dir={textDirection(thread.title)}>
            {thread.title}
          </h2>
        )}
        <div className="flex flex-wrap gap-2">
          {book && <StudyOriginLink origin={tutorBookOrigin(thread, book)} tutorFocus={{}} />}
          {openBesideReader ? (
            <Button variant="outline" size="sm" onClick={openBesideReader}>
              {t("study.reader.besideReader")}
            </Button>
          ) : null}
          {book && openBesideReader ? (
            <Link to={notebookChatHref(book.notebookId)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("study.reader.panel.openInNotebook")}
            </Link>
          ) : null}
          {hasSavedAnswer ? (
            <Button
              variant="outline"
              size="sm"
              disabled={workPending || !model}
              onClick={draftConversationCards}
            >
              {t("study.capture.cardsFromConversation")}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRenaming(!renaming)}>
            Rename
          </Button>
          <Button variant="outline" size="sm" onClick={setup} disabled={workPending}>
            AI providers
          </Button>
        </div>
      </div>
      {followUp ? (
        <div className="space-y-2 rounded-xl border p-3 text-sm">
          {thread.title !== followUp.text ? (
            <DirectionalText
              multiline
              text={followUp.text}
              className="wrap-break-word whitespace-pre-wrap"
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {!conversation.length && !input.trim() && !followUpComplete ? (
              <Button
                size="sm"
                disabled={workPending || !model || !contextReady}
                onClick={() => void send(t("study.followUps.practicePrompt"), Date.now())}
              >
                {t("study.followUps.startPractice")}
              </Button>
            ) : null}
            {followUpAvailable ? (
              <>
                <StudyOriginLink
                  origin={{ kind: "report", threadId: followUp.threadId, reportId: followUp.reportId }}
                  tutorFocus={{}}
                />
                {followUpComplete ? <span role="status">{t("study.followUps.done")}</span> : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => changeReport(
                    {
                      kind: "step",
                      reportId: followUp.reportId,
                      index: followUp.index,
                      action: !followUpState ? "plan" : followUpComplete ? "reopen" : "complete",
                    },
                    followUp.threadId,
                  )}
                >
                  {t(!followUpState ? "study.followUps.add" : followUpComplete ? "study.followUps.reopen" : "study.followUps.complete")}
                </Button>
              </>
            ) : (
              <p role="status" className="text-muted-foreground">{t("study.followUps.unavailable")}</p>
            )}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3 rounded-xl border p-3 text-sm">
        <div className="grid gap-1">
          <span aria-hidden>{tChat("model")}</span>
          <AIModelPicker use={modelUse} appearance="outline" side="bottom" />
        </div>
        <label className="grid gap-1">
          {t("study.materials.context")}
          <select
            aria-label={t("study.materials.context")}
            className={optionClass}
            disabled={workPending}
            value={thread.scope}
            onChange={(event) => {
              const scope = studyScopes.find((value) => value === event.target.value);
              if (scope)
                void save({
                  scope,
                  ...(scope === "materials" && thread.bookIds === undefined && book
                    ? { bookIds: [book.id] }
                    : {}),
                });
            }}
          >
            {studyScopes
              .filter(
                (scope) => scope === "image" ? !!thread.imageContext :
                  scope === "general" ||
                  scope === "notes" ||
                  scope === "materials" ||
                  scope === "cards" ||
                  (book && (scope !== "passage" || thread.quote)),
              )
              .map((scope) => (
                <option value={scope} key={scope}>
                  {scope === "materials" ? t("study.materials.scope")
                    : scope === "cards" ? t("study.materials.cards")
                    : scope === "image" ? t("study.reader.imageContext") : scopeLabels[scope]}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1">
          Corrections
          <select
            aria-label="Corrections"
            className={optionClass}
            disabled={workPending}
            value={thread.corrections ?? "off"}
            onChange={(event) =>
              void save({ corrections: event.target.value as StudyThread["corrections"] })
            }
          >
            {studyCorrections.map((value) => (
              <option value={value} key={value}>
                {correctionLabels[value]}
              </option>
            ))}
          </select>
        </label>
        {curated ? (
          <div className="flex basis-full flex-wrap items-center gap-2">
            <TutorMaterialPicker
              options={materialOptions}
              selection={selection}
              flashcards={cardPractice}
              disabled={workPending}
              onApply={async (next) => {
                await save({
                  ...materialChanges(thread.scope, next),
                  ...(cardPractice && !next.cardIds.includes(thread.practiceCardId ?? "")
                    ? { practiceCardId: next.cardIds[0] }
                    : {}),
                });
                if (!next.cardIds.includes(revealedImageCardId.current ?? "")) {
                  revealAnswerImage(undefined);
                }
                if (practiceCard && !next.cardIds.includes(practiceCard.id)) clearMessageLink();
              }}
            />
            {!contextReady ? (
              <p className="text-muted-foreground">
                {t(cardPractice ? "study.materials.noCardsSelected" : "study.materials.noReadableSelection")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {imagePractice ? (
        <div className="space-y-2 rounded-xl border p-3">
          {documentImage ? (
            <>
              <StudyCardImage side="document" image={documentImage} description={thread.imageContext?.description} />
              <p className="text-xs text-muted-foreground">{t("study.reader.imageContextHint")}</p>
              {!conversation.length ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={workPending || !model}
                  onClick={() => void send(t("study.reader.explainImage"), Date.now(), { starter: true })}
                >
                  {t("study.reader.explainImage")}
                </Button>
              ) : null}
            </>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {t(documentImage === null ? "study.reader.imageContextUnavailable" : "study.reader.imageContextLoading")}
            </p>
          )}
        </div>
      ) : null}
      {practiceCard ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border p-3">
          <label className="grid min-w-0 flex-[1_1_15rem] gap-1 text-sm">
            {t("study.recall.tutorCard")}
            <select
              aria-label={t("study.recall.tutorCard")}
              className={`${optionClass} w-full`}
              value={practiceCard.id}
              disabled={workPending}
              onChange={(event) => void choosePracticeCard(event.target.value)}
            >
              {practiceCards.map(({ id, front }) => (
                <option key={id} value={id}>{front}</option>
              ))}
            </select>
          </label>
          {!conversation.some(({ entry }) => entry.practiceCardId === practiceCard.id) ? (
            <Button
              size="sm"
              disabled={workPending || !model}
              onClick={() => void send(t("study.recall.tutorPrompt"), Date.now())}
            >
              {t("study.recall.tutorAsk")}
            </Button>
          ) : null}
          {nextCard ? (
            <Button size="sm" variant="outline" disabled={workPending}
              onClick={() => void choosePracticeCard(nextCard.id)}
            >
              {t("study.recall.tutorNextCard")}
            </Button>
          ) : null}
          <StudyCardChoices choices={practiceCard.quizChoices} className="min-w-0 basis-full" />
          {practiceImages.question || practiceImages.answer ? (
            <div className="min-w-0 basis-full space-y-2">
              {practiceImages.question ? (
                <StudyCardImage side="question" image={practiceImages.question} />
              ) : null}
              {practiceImages.answer ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={answerImageVisible}
                    aria-controls={answerImageRegion}
                    disabled={workPending}
                    onClick={() => revealAnswerImage(answerImageVisible ? undefined : practiceCard.id)}
                  >
                    {t(answerImageVisible ? "study.visualCard.hideAnswer" : "study.visualCard.showAnswer")}
                  </Button>
                  <div id={answerImageRegion} hidden={!answerImageVisible}>
                    {answerImageVisible ? <StudyCardImage side="answer" image={practiceImages.answer} /> : null}
                  </div>
                </>
              ) : null}
              {practiceImages.question || answerImageVisible ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">{t("study.visualCard.tutorUsesImages")}</p>
                  {practiceCard.origin?.kind === "book" && practiceCard.origin.visual ? (
                    <StudyOriginLink origin={practiceCard.origin} tutorFocus={{}} />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {currentTurns.length ? (
        <SelectableText
          className="space-y-3"
          aria-label="Conversation"
          place={{
            title: thread.title,
            notebookId: thread.notebookId,
            bookId: book?.id,
            vaultId,
            tags: book && book.title !== thread.title ? [book.title, thread.title] : [thread.title],
            origin: (block) => {
              const message = Number(block.dataset.tutorMessage);
              return { kind: "tutor", threadId: thread.id, message: Number.isInteger(message) ? message : undefined };
            },
          }}
        >
          {currentTurns.map((turn) => {
            const { entry, index } = turn;
            const quick = quickTurn?.entry === entry;
            return (
            <div
              key={index === undefined ? `temporary-${entry.at}-${entry.role}` : index}
              id={index === undefined ? undefined : `study-message-${index}`}
              data-selection-block=""
              data-tutor-message={index}
              tabIndex={index === focusMessage && index !== undefined ? -1 : undefined}
              className={`max-w-3xl scroll-mt-32 space-y-2 rounded-2xl border p-4 ${entry.role === "user" ? "ms-auto w-fit bg-muted" : "bg-card"}`}
            >
              <p className="text-xs font-semibold text-muted-foreground">
                {t(entry.role === "user" ? "study.practice.speaker.you" : "study.practice.speaker.ai")}
              </p>
              {entry.role === "assistant" ? (
                <StudyText prose text={entry.text} />
              ) : (
                <DirectionalText
                  multiline
                  text={entry.text}
                  className="wrap-break-word whitespace-pre-wrap"
                />
              )}
              {entry.role === "assistant" && entry.visual ? (
                <Visual kind={entry.visual.kind} data={entry.visual.data as never} />
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {entry.citations?.map((citation) => (
                  <StudyOriginLink
                    key={citation.index}
                    origin={studyCitationOrigin(citation)}
                    label={`[${citation.index}] ${citation.title}`}
                    tutorFocus={{ message: index }}
                  />
                ))}
                {entry.role === "assistant" ? (
                  <>
                    {quick ? null : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => saveTurnNote(turn)}>
                          {entry.visual ? t("study.tutorActions.saveVisual") : "Save to Notes"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => draftTurnCards(turn)}>
                          {t("study.capture.cardsFromAnswer")}
                        </Button>
                      </>
                    )}
                    {index !== undefined && answersWithCards.has(index) ? (
                      <Link
                        to={studyHref("cards", { vault: vaultId, thread: thread.id, fromAnswer: index })}
                        state={returnToTutor(location.pathname + location.search, location.state, { message: index })}
                        className="inline-flex rounded-lg px-2 py-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t("study.capture.viewCards")}
                      </Link>
                    ) : null}
                  </>
                ) : null}
              </div>
              {quick ? (
                <div
                  role="group"
                  aria-label={t("study.tutorActions.label")}
                  className="flex flex-wrap gap-1.5 border-t pt-3"
                >
                  {entry.visual ? null : (
                    <QuickAction icon={Flowchart01Icon} disabled={!model} onClick={() => void explainVisually(turn)}>
                      {t("study.tutorActions.visual")}
                    </QuickAction>
                  )}
                  <QuickAction
                    icon={BulbIcon}
                    disabled={!model || !contextReady}
                    onClick={() => void send(t("study.tutorActions.examplePrompt"), Date.now())}
                  >
                    {t("study.tutorActions.example")}
                  </QuickAction>
                  <QuickAction
                    icon={MagicWand01Icon}
                    disabled={!model || !contextReady}
                    onClick={() => void send(t("study.tutorActions.simplerPrompt"), Date.now())}
                  >
                    {t("study.tutorActions.simpler")}
                  </QuickAction>
                  <QuickAction icon={Cards01Icon} onClick={() => draftTurnCards(turn)}>
                    {t("study.tutorActions.flashcards")}
                  </QuickAction>
                  <QuickAction icon={Note01Icon} onClick={() => saveTurnNote(turn)}>
                    {t(entry.visual ? "study.tutorActions.saveVisual" : "study.tutorActions.saveNote")}
                  </QuickAction>
                </div>
              ) : null}
            </div>
            );
          })}
        </SelectableText>
      ) : simulation ? (
        <Button
          disabled={workPending || !model || !contextReady}
          onClick={() => void send(t(`study.goals.simulation.${simulation}.prompt`), Date.now(), { starter: true })}
        >
          {t(`study.goals.simulation.${simulation}.start`)}
        </Button>
      ) : !cardPractice && !followUp ? (
        <div className="flex flex-wrap gap-2">
          {selected.highlightIds.length ? (
            <Button
              disabled={workPending || !model}
              onClick={() => void send(t("study.highlights.summaryPrompt"), Date.now())}
            >
              {t("study.highlights.summarize")}
            </Button>
          ) : null}
          {thread.goal === "teach-back" ? (
            <Button
              disabled={workPending || !model}
              onClick={() => void send(t("study.capture.practicePrompt"), Date.now())}
            >
              {t("study.capture.startPractice")}
            </Button>
          ) : null}
          {(thread.goal === "teach-back"
            ? ["Ask me to explain the main idea.", "Quiz me on the hardest part."]
            : thread.goal === "language"
              ? ["Help me practice a conversation.", "Correct my phrasing."]
              : ["Explain the main idea.", "Give me a practice question."]
          ).map((prompt) => (
            <Button
              variant="outline"
              size="sm"
              key={prompt}
              disabled={workPending}
              onClick={() => composer.edit(prompt, null)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      ) : null}
      {hasSavedAnswer ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-muted/40 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
            <Icon icon={Cards01Icon} size={18} />
          </span>
          <div className="min-w-0 flex-[1_1_14rem]">
            <p className="text-sm font-medium">{t("study.tutorActions.rememberTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("study.tutorActions.rememberHint")}</p>
            {conversationCardCount ? (
              <Link
                to={studyHref("cards", { vault: vaultId, thread: thread.id, fromThread: "1" })}
                state={returnToTutor(location.pathname + location.search, location.state)}
                className="mt-1 inline-flex rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("study.tutorActions.cardsMade", { count: conversationCardCount })}
              </Link>
            ) : null}
          </div>
          <Button size="sm" disabled={workPending || !model} onClick={draftConversationCards}>
            {t("study.tutorActions.flashcards")}
          </Button>
        </div>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (contextReady && !workPending)
            void send(input, Date.now(), { draft: composer.draft, spoken: composer.draft.speech === "spoken" });
        }}
        className="grid gap-2 rounded-2xl border bg-card p-3"
      >
        <textarea
          ref={composerField}
          className="min-h-24 w-full rounded-xl border bg-background p-3"
          aria-label="Study message"
          placeholder="Ask a question or explain what you learned"
          dir={textDirection(input)}
          value={input}
          onChange={(event) => composer.edit(event.target.value)}
          maxLength={12000}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!input.trim() || workPending || !model || !contextReady}>
            {operation === "answer" ? "Working…" : "Send"}
          </Button>
          {busy && !livePhase ? (
            <Button type="button" variant="ghost" onClick={() => controller.current?.abort(stoppedTutorRequest)}>
              Stop
            </Button>
          ) : null}
          {voiceState === "recording" ? (
            <>
              <Button type="button" variant="outline" onClick={() => voice.current?.stop?.()}>
                Stop recording
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={micMuted}
                onClick={() => {
                  voice.current?.mute?.(!micMuted);
                  setMicMuted(!micMuted);
                }}
              >
                {micMuted ? "Unmute microphone" : "Mute microphone"}
              </Button>
            </>
          ) : null}
          {voiceState && !busy ? (
            <Button type="button" variant="ghost" onClick={() => voice.current?.abort.abort()}>
              Cancel recording
            </Button>
          ) : null}
          {!voiceState && !livePhase ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => void dictate(false, Date.now())}
                disabled={workPending}
              >
                Dictate
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void dictate(true, Date.now())}
                disabled={workPending || !model || !contextReady}
              >
                {voicePractice ? "Record next turn" : "Speak your answer"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void beginVoiceConversation()}
                disabled={workPending || !model || !contextReady}
              >
                {t("study.voice.start")}
              </Button>
            </>
          ) : null}
          {livePhase ? (
            <>
              {livePhase === "recording" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={micMuted || finishingVoice}
                  onClick={() => live.current?.finishTurn()}
                >
                  {t("study.voice.sendTurn")}
                </Button>
              ) : null}
              {livePhase === "speaking" ? (
                <Button type="button" variant="outline" onClick={() => live.current?.interrupt()}>
                  {t("study.voice.interrupt")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                aria-pressed={micMuted}
                disabled={finishingVoice}
                onClick={() => {
                  live.current?.mute(!micMuted);
                  setMicMuted(!micMuted);
                }}
              >
                {t(micMuted ? "study.voice.unmute" : "study.voice.mute")}
              </Button>
              <Button type="button" variant="outline" onClick={() => live.current?.abort.abort()}>
                {t("study.voice.end")}
              </Button>
            </>
          ) : null}
          <Input
            className="w-32"
            aria-label="Speech language code"
            placeholder="Auto language"
            value={language}
            maxLength={35}
            disabled={workPending}
            onChange={(event) => setLanguage(event.target.value)}
          />
          {!livePhase ? (
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={readAloud}
                onChange={(event) => {
                  setReadAloud(event.target.checked);
                  if (!event.target.checked) stopSpeaking();
                }}
              />
              Read replies aloud
            </label>
          ) : null}
        </div>
        {!livePhase && operation ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t(
              operation === "answer"
                ? "study.recovery.answerPending"
                : operation === "visual"
                  ? "study.tutorActions.visualPending"
                  : "study.recovery.reportPending",
            )}
          </p>
        ) : null}
        {!operation && failed ? (
          <div className="space-y-2 rounded-xl border bg-muted/25 p-3 text-sm">
            <div role={failed.detail ? "alert" : "status"}>
              <p className="font-medium">
                {failed.kind === "answer"
                  ? t(failed.detail ? "study.recovery.answerFailed" : "study.recovery.answerStopped")
                  : failed.kind === "visual"
                    ? t(failed.detail ? "study.tutorActions.visualFailed" : "study.tutorActions.visualStopped")
                    : t(failed.detail ? "study.recovery.reportFailed" : "study.recovery.reportStopped")}
              </p>
              {failed.detail ? <p className="mt-1 text-muted-foreground">{failed.detail}</p> : null}
              {failed.kind === "answer" && failed.delivery.draft?.id !== composer.draft.id ? (
                <blockquote dir="auto" className="mt-2 line-clamp-3 border-s-2 ps-2 wrap-break-word">
                  {failed.text}
                </blockquote>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={workPending || !model || (failed.kind === "answer" && !contextReady)}
                onClick={() => {
                  if (failed.kind === "answer") void send(failed.text, Date.now(), failed.delivery);
                  else if (failed.kind === "visual") void explainVisually(failed.target);
                  else void report(Date.now());
                }}
              >
                {common("actions.retry")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setFailed(undefined)}>
                {t("study.capture.dismiss")}
              </Button>
            </div>
          </div>
        ) : null}
        {settings && !model ? (
          <p className="text-sm text-muted-foreground">{t("study.capture.chooseModel")}</p>
        ) : null}
        {voiceAvailable ? (
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={thread.keepVoiceTranscripts ?? false}
              disabled={workPending}
              onChange={(event) => void save({ keepVoiceTranscripts: event.target.checked })}
            />
            Keep new voice turns in this conversation
          </label>
        ) : null}
        {temporaryTurns.length ? (
          <p className="text-sm text-muted-foreground">
            Temporary voice turns clear after the report or when you leave this conversation.
          </p>
        ) : null}
        {livePhase ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p role="status">
              {t(
                finishingVoice
                  ? "study.voice.finishingTurn"
                  : micMuted && (livePhase === "listening" || livePhase === "recording")
                    ? "study.voice.muted"
                    : `study.voice.phases.${livePhase}`,
              )}
            </p>
            <p>{t("study.voice.privacy")}</p>
          </div>
        ) : voiceState ? (
          <p role="status" className="text-sm text-muted-foreground">
            {voiceState === "opening"
              ? "Opening microphone…"
              : voiceState === "recording"
                ? micMuted
                  ? "Microphone muted"
                  : "Recording on this device"
                : "Transcribing on this device…"}
          </p>
        ) : voiceAvailable === false ? (
          <p className="text-sm text-muted-foreground">
            Local voice needs whisper-cli and a Whisper model. You can still type a message.
          </p>
        ) : null}
      </form>
      {conversation.length || reports.length || showReport || pendingVoiceTurn ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {reports.length ? (
              <Button
                variant="outline"
                onClick={() => {
                  if (!showReport) setSelectedReportId(studyReportKey(reports[0]));
                  setShowReport(!showReport);
                }}
              >
                {showReport ? "Hide report" : "Show report"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={
                finishingVoice ||
                (!livePhase && workPending) ||
                !model ||
                (!conversation.some(({ entry }) => entry.role === "user" && !entry.starter) && !pendingVoiceTurn)
              }
              onClick={() => void finishVoiceReport()}
            >
              {livePhase
                ? t("study.voice.endAndReport")
                : voicePractice
                  ? "Finish voice practice and generate report"
                  : reports.length
                    ? "Regenerate report"
                    : "Generate session report"}
            </Button>
          </div>
          {showReport && reports.length > 1 ? (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              {t("study.followUps.reportHistory")}
              <select
                className={optionClass}
                value={reportId ?? ""}
                onChange={(event) => setSelectedReportId(event.target.value)}
              >
                {reportId ? null : (
                  <option value="" disabled>
                    {t("study.followUps.unavailable")}
                  </option>
                )}
                {reports.map((entry, index) => (
                  <option value={studyReportKey(entry)} key={studyReportKey(entry)}>
                    {index === 0
                      ? t("study.followUps.latest")
                      : entry.generatedAt === undefined
                        ? t("study.followUps.earlier")
                        : reportDate.format(entry.generatedAt)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {showReport && !visibleReport ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("study.followUps.unavailable")}
            </p>
          ) : null}
          {showReport && visibleReport && reportId ? (
            <StudySessionReport
              key={reportId}
              report={visibleReport}
              savedSuggestions={savedReportSuggestions({
                threadId: thread.id,
                report: visibleReport,
                cards: reportCards,
                words: vaultWords,
              })}
              actions={
                reportCardCount ? (
                  <div className="flex flex-wrap gap-2">
                    <Link
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      to={studyHref("cards", { thread: thread.id, fromReport: reportId })}
                      state={returnToTutor(location.pathname + location.search, location.state, { report: { id: reportId } })}
                    >
                      {t("study.followUps.viewCards", { count: reportCardCount })}
                    </Link>
                    <Link
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      to={studyHref("review", { thread: thread.id, fromReport: reportId })}
                      state={returnToTutor(location.pathname + location.search, location.state, { report: { id: reportId } })}
                    >
                      {t("study.followUps.reviewCards")}
                    </Link>
                  </div>
                ) : null
              }
              onDraftCard={(text) =>
                draftCards(text, { kind: "report", threadId: thread.id, reportId })
              }
              onFeedback={(key, helpful) =>
                changeReport({ kind: "feedback", reportId, key, helpful })
              }
              onPlanStep={(index, action) =>
                changeReport({ kind: "step", reportId, index, action })
              }
              practiceStep={(index, description) => {
                const target = { threadId: thread.id, reportId, index };
                return (
                  <StudyFollowUpButton
                    target={target}
                    vaultId={vaultId}
                    resume={vaultThreads.some(({ id }) => id === studyFollowUpId(target))}
                    description={description}
                    disabled={workPending}
                  />
                );
              }}
              onSaveCard={(front, back, key) =>
                makeCard(
                  front,
                  back,
                  { kind: "report", threadId: thread.id, reportId, suggestion: key },
                  reportSuggestionId("card", thread.id, visibleReport, key),
                )
              }
              onSaveWord={(word, key) => {
                return saveStudyWord(
                  {
                    term: word.term,
                    language: word.language,
                    translation: word.translation,
                    context: word.example,
                    note: word.definition,
                    notebookId: thread.notebookId,
                    vaultId,
                    origin: { kind: "report", threadId: thread.id, reportId, suggestion: key },
                  },
                  reportSuggestionId("word", thread.id, visibleReport, key),
                )
                  .then((saved) =>
                    toast.success("Saved to vocabulary", {
                      action: {
                        label: "View word",
                        onClick: () => navigate(originHref({ kind: "word", wordId: saved.id })),
                      },
                    }),
                  )
                  .catch((error: Error) => toast.error(error.message));
              }}
              onSaveNote={() => {
                const report = visibleReport;
                saveNote(
                  [
                    report.summary,
                    ...report.corrections,
                    ...(report.technicalFeedback ?? []).map(({ text }) => text),
                    ...(report.languageFeedback ?? []).map(
                      ({ original, suggestion, reason }) =>
                        `${original} → ${suggestion}. ${reason}`,
                    ),
                    ...(report.vocabulary ?? []).map(({ term, definition, translation }) =>
                      [term, definition, translation].filter(Boolean).join(" · "),
                    ),
                    ...report.nextSteps,
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                  { kind: "report", threadId: thread.id, reportId },
                );
              }}
            />
          ) : null}
        </div>
      ) : null}
      {draftSource ? (
        <StudyFlashcardDraftDialog
          source={draftSource}
          vaultId={vaultId}
          onClose={() => setDraftSource(null)}
          onSave={(count) =>
            toast.success(t("study.capture.cardsSaved", { count }), {
              action: {
                label: t("study.capture.viewCards"),
                onClick: () =>
                  navigate(
                    studyHref(
                      "cards",
                      { vault: vaultId, ...(tutorCardsScope(draftSource.origin) ?? { notebook: thread.notebookId }) },
                    ),
                    { state: returnFromTutorCards(location.pathname + location.search, location.state, draftSource.origin) },
                  ),
              },
            })
          }
        />
      ) : null}
    </section>
  );
}

function QuickAction({
  icon,
  children,
  ...props
}: { icon: IconSvgElement; children: ReactNode } & Omit<ComponentProps<typeof Button>, "children">) {
  return (
    <Button variant="outline" size="sm" shape="pill" {...props}>
      <Icon icon={icon} size={15} />
      {children}
    </Button>
  );
}

const outputChip =
  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** What a conversation produced: its flashcards, report and visuals, each a link. */
export function TutorOutputs({
  thread,
  cardCount,
  vaultId,
  returnState,
}: {
  thread: StudyThread;
  cardCount: number;
  vaultId: string;
  returnState: ReturnType<typeof studyReturnState>;
}) {
  const { t } = useTranslation("home");
  const visuals = thread.messages.flatMap(({ visual }, index) => (visual ? [index] : []));
  if (!cardCount && !thread.report && !visuals.length) return null;
  return (
    <ul aria-label={t("study.tutorActions.outputs")} className="flex flex-wrap gap-1.5">
      {cardCount ? (
        <li>
          <Link
            className={outputChip}
            to={studyHref("cards", { vault: vaultId, thread: thread.id, fromThread: "1" })}
            state={returnState}
          >
            <Icon icon={Cards01Icon} size={13} />
            {t("study.tutorActions.cards", { count: cardCount })}
          </Link>
        </li>
      ) : null}
      {thread.report ? (
        <li>
          <Link
            className={outputChip}
            to={originHref({ kind: "report", threadId: thread.id, reportId: studyReportKey(thread.report) })}
            state={returnState}
          >
            <Icon icon={Note01Icon} size={13} />
            {t("study.tutorActions.report")}
          </Link>
        </li>
      ) : null}
      {visuals.length ? (
        <li>
          <Link
            className={outputChip}
            to={originHref({ kind: "tutor", threadId: thread.id, message: visuals[0] })}
            state={returnState}
          >
            <Icon icon={Flowchart01Icon} size={13} />
            {t("study.tutorActions.visuals", { count: visuals.length })}
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
