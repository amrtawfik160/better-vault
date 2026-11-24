import {
  AiChat02Icon,
  ArrowLeft01Icon,
  BookmarkAdd01Icon,
  Cancel01Icon,
  Cards01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  NoteEditIcon,
  TranslateIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon, type IconSvgElement } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { Menu } from "@/components/panelui/menu";
import { Textarea } from "@/components/panelui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { saveStudyCard, saveStudyWord } from "@/lib/db/study";
import { askStudyModel } from "@/lib/study/client";
import { AIModelPicker } from "@/components/ai/ai-model-picker";
import {
  studyHighlightColor,
  type StudyBook,
  type StudyHighlightColor,
  type StudyOrigin,
  type StudyRecordOf,
} from "@/lib/study/records";
import { speechLanguage, translationLanguageLabel } from "@/lib/study/translation-language";
import { speakStudyReply } from "@/lib/study/voice-session";
import { textDirection } from "@/lib/text/direction";
import { cn } from "@/lib/utils";
import { highlightColors } from "./study-highlight-colors";
import { ReaderTip } from "./study-reader-tip";
import { StudyText } from "./study-text";
import { StudyTranslationLanguages, useTranslationLanguageName } from "./study-translation-language";

export type StudySelection = { text: string; offset: number; revision: number };
export type SelectionMenuHandle = {
  /** Runs a shortcut: open a view, or save the word. */
  run: (action: "translate" | "word" | "note") => void;
  /** Moves focus to the first control. */
  focus: () => void;
  contains: (node: Node | null) => boolean;
};

type View = "actions" | "translate" | "card" | "note" | "explain";
type Answer = { language: string; text: string } | { error: string };

const wordLimit = 80;

/** Where the menu goes: centred on the passage, above it unless there is no room. */
function placeMenu(
  menu: HTMLElement,
  frame: HTMLElement,
  anchor: DOMRect | null,
  preferBelow: boolean,
) {
  if (!anchor) {
    menu.style.visibility = "hidden";
    return;
  }
  const margin = 8;
  const gap = 10;
  const bounds = frame.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = menu;
  const centre = anchor.left + anchor.width / 2 - bounds.left;
  const left = Math.min(Math.max(margin, centre - width / 2), Math.max(margin, bounds.width - width - margin));
  const above = anchor.top - bounds.top - gap - height;
  const below = anchor.bottom - bounds.top + gap;
  const fitsAbove = above >= margin;
  const fitsBelow = below + height <= bounds.height - margin;
  const preferred = preferBelow
    ? fitsBelow || !fitsAbove ? below : above
    : fitsAbove || !fitsBelow ? above : below;
  const top = Math.min(Math.max(margin, preferred), Math.max(margin, bounds.height - height - margin));
  // Placed in the frame's physical coordinates, so `left` stays left in right-to-left pages.
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.visibility = "";
  menu.dataset.side = preferred === below ? "bottom" : "top";
}

function ActionButton({
  icon,
  label,
  keys,
  strong,
  onClick,
  disabled,
}: {
  icon: IconSvgElement;
  label: string;
  keys?: string[];
  strong?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <ReaderTip label={label} keys={keys}>
      <Button
        size="sm"
        variant={strong ? "secondary" : "ghost"}
        className="h-9 gap-1.5 px-2.5"
        disabled={disabled}
        onClick={onClick}
      >
        <Icon icon={icon} size={16} />
        <span className="sr-only sm:not-sr-only">{label}</span>
      </Button>
    </ReaderTip>
  );
}

function ViewHeader({ title, hint, back, close }: { title: string; hint?: string; back: () => void; close: () => void }) {
  const { t } = useTranslation("home");
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" className="h-9 min-w-0 gap-1.5 px-2" onClick={back} aria-label={t("study.selection.back", { title })}>
        <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
        <span className="truncate" aria-hidden>{title}</span>
      </Button>
      {hint ? <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">{hint}</span> : <span className="flex-1" />}
      <Button size="icon-sm" variant="ghost" aria-label={t("study.selection.close")} onClick={close}>
        <Icon icon={Cancel01Icon} size={16} />
      </Button>
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 space-y-3 border-t px-2 pt-3 pb-1.5">{children}</div>;
}

/** The menu floating at a selected passage: highlight, translate, save a word, make a card, write a note, ask. */
export function StudySelectionMenu({
  handle,
  selection,
  frame,
  viewport,
  anchor,
  preferBelow,
  book,
  sectionTitle,
  sectionText,
  origin,
  vaultId,
  translateTo,
  chooseTranslateTo,
  highlight,
  color,
  openingTutor,
  onHighlight,
  onRemoveHighlight,
  onSaveNote,
  onAsk,
  onTeachBack,
  onDraftCards,
  onBookmark,
  onSaveToNotes,
  onContinueExplain,
  onShowWords,
  onViewCards,
  onClose,
}: {
  handle: Ref<SelectionMenuHandle>;
  selection: StudySelection;
  frame: HTMLElement;
  viewport: HTMLElement | null;
  anchor: () => DOMRect | null;
  preferBelow: boolean;
  book: StudyBook;
  sectionTitle: string;
  sectionText: string;
  origin: StudyOrigin;
  vaultId: string;
  translateTo?: string;
  chooseTranslateTo: (code: string) => void;
  highlight?: StudyRecordOf<"highlight">;
  color: StudyHighlightColor;
  openingTutor: boolean;
  onHighlight: (color: StudyHighlightColor) => void;
  onRemoveHighlight: () => void;
  onSaveNote: (note: string) => Promise<void>;
  onAsk: () => void;
  onTeachBack: () => void;
  onDraftCards: (text: string) => void;
  onBookmark: () => void;
  onSaveToNotes: (body?: string) => void;
  onContinueExplain: (answer: string) => void;
  onShowWords: () => void;
  onViewCards: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(["home", "common"]);
  const languageName = useTranslationLanguageName();
  const menu = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [view, setView] = useState<View>("actions");
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const [afterLanguage, setAfterLanguage] = useState<"translate" | "save">();
  const [translation, setTranslation] = useState<Answer>();
  const [explanation, setExplanation] = useState<Answer>();
  const [busy, setBusy] = useState(false);
  const [savedWord, setSavedWord] = useState(false);
  const [savingWord, setSavingWord] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState(selection.text);
  const [cardSaving, setCardSaving] = useState(false);
  const [note, setNote] = useState(highlight?.note ?? "");
  const [noteSaving, setNoteSaving] = useState(false);
  const short = selection.text.length <= wordLimit;

  const place = useEffectEvent(() => {
    if (menu.current) placeMenu(menu.current, frame, anchor(), preferBelow);
  });

  useLayoutEffect(() => {
    place();
    let next = 0;
    const schedule = () => {
      cancelAnimationFrame(next);
      next = requestAnimationFrame(() => place());
    };
    viewport?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    if (menu.current) observer.observe(menu.current);
    observer.observe(frame);
    return () => {
      cancelAnimationFrame(next);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, [frame, viewport]);

  useEffect(() => () => pending.current?.abort(), []);

  useEffect(() => {
    if (view === "actions") return;
    body.current?.querySelector<HTMLElement>("[data-autofocus], textarea, input, button")?.focus({ preventScroll: true });
  }, [view, choosingLanguage]);

  useImperativeHandle(handle, () => ({
    run(action) {
      if (action === "translate") void translate();
      else if (action === "word") void saveWord();
      else setView("note");
    },
    focus() {
      menu.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    },
    contains: (node) => Boolean(node && menu.current?.contains(node)),
  }));

  async function request(action: "translate" | "explain", language?: string): Promise<Answer | undefined> {
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setBusy(true);
    try {
      const response = await askStudyModel({
        use: action === "translate" ? "translate" : "ask",
        action,
        input: language
          ? `Language: ${translationLanguageLabel(language)}\nText: ${selection.text}`
          : selection.text,
        passages: [{ title: sectionTitle, text: selection.text }],
        signal: controller.signal,
      });
      return controller.signal.aborted ? undefined : { language: language ?? "", text: response.text.trim() };
    } catch (error) {
      if (controller.signal.aborted) return;
      return { error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  async function translate(language = translateTo) {
    setView("translate");
    if (!language) {
      setAfterLanguage("translate");
      setChoosingLanguage(true);
      return;
    }
    if (translation && "text" in translation && translation.language === language) return translation;
    const answer = await request("translate", language);
    if (answer) setTranslation(answer);
    return answer;
  }

  async function saveWord(language = translateTo) {
    if (savingWord || savedWord) {
      setView("translate");
      return;
    }
    if (!language) {
      setView("translate");
      setAfterLanguage("save");
      setChoosingLanguage(true);
      return;
    }
    setSavingWord(true);
    try {
      const answer = await translate(language);
      const translated = answer && "text" in answer ? answer.text : "";
      const context = sectionText.slice(
        Math.max(0, selection.offset - 100),
        selection.offset + selection.text.length + 100,
      );
      await saveStudyWord({
        origin,
        term: selection.text,
        translation: translated,
        context,
        language: translationLanguageLabel(language),
        note: "",
        notebookId: book.notebookId,
        bookId: book.id,
        vaultId,
      });
      setSavedWord(true);
      toast.success(t("study.selection.wordSaved"), {
        description: translated ? undefined : t("study.selection.savedWithoutTranslation"),
        action: { label: t("study.selection.view"), onClick: onShowWords },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingWord(false);
    }
  }

  function pickLanguage(code: string) {
    chooseTranslateTo(code);
    setChoosingLanguage(false);
    const next = afterLanguage;
    setAfterLanguage(undefined);
    if (next === "save") void saveWord(code);
    else void translate(code);
  }

  async function explain() {
    setView("explain");
    if (explanation && "text" in explanation) return;
    const answer = await request("explain");
    if (answer) setExplanation(answer);
  }

  async function saveCard() {
    if (cardSaving || !front.trim() || !back.trim()) return;
    setCardSaving(true);
    try {
      await saveStudyCard({
        front: front.trim(),
        back: back.trim(),
        tags: [book.title],
        notebookId: book.notebookId,
        origin,
      });
      toast.success(t("study.selection.cardSaved"), {
        action: { label: t("study.selection.view"), onClick: onViewCards },
      });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCardSaving(false);
    }
  }

  async function saveNote() {
    if (noteSaving) return;
    setNoteSaving(true);
    try {
      await onSaveNote(note.trim());
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setNoteSaving(false);
    }
  }

  function speak(text = selection.text, language = speechLanguage(text)) {
    void speakStudyReply(text, language).then((spoken) => {
      if (!spoken) toast.info(t("study.selection.noVoice"));
    });
  }

  const backToActions = () => setView("actions");
  const translated = translation && "text" in translation ? translation : undefined;

  return (
    <div
      ref={menu}
      role="dialog"
      aria-label={t("study.selection.label")}
      data-study-selection-menu=""
      style={{ visibility: "hidden" }}
      className={cn(
        "absolute top-0 left-0 z-30 w-max max-w-[min(46rem,calc(100%-1rem))] rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-lg",
        "animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none",
        view !== "actions" && "w-[min(30rem,calc(100%-1rem))]",
      )}
      onMouseDown={(event) => {
        // Keep the passage selected while a button is pressed.
        if (event.target instanceof Element && !event.target.closest("input, textarea")) event.preventDefault();
      }}
    >
      {view === "actions" ? (
        <div role="group" aria-label={t("study.selection.actions")} className="flex flex-wrap items-center gap-0.5">
          {studyHighlightColor.options.map((name) => {
            const active = highlight?.color === name;
            const label = t(active ? "study.selection.highlighted" : "study.selection.highlightIn", {
              color: t(`study.highlights.colors.${name}`),
            });
            return (
              <ReaderTip key={name} label={label} keys={name === color && !highlight ? ["H"] : undefined}>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  className="grid size-9 cursor-pointer place-items-center rounded-full outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onHighlight(name)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-4.5 rounded-full ring-1 ring-foreground/15",
                      highlightColors[name],
                      active && "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
                    )}
                  />
                </button>
              </ReaderTip>
            );
          })}
          <span aria-hidden className="mx-1 h-6 w-px bg-border" />
          <ActionButton icon={TranslateIcon} label={t("study.selection.translate")} keys={["T"]} onClick={() => void translate()} />
          <ActionButton
            icon={savedWord ? CheckmarkCircle02Icon : BookmarkAdd01Icon}
            label={t(savedWord ? "study.selection.wordSavedShort" : short ? "study.selection.saveWord" : "study.selection.savePhrase")}
            keys={["W"]}
            disabled={savingWord}
            onClick={() => void saveWord()}
          />
          <ActionButton
            icon={Cards01Icon}
            label={t("study.selection.flashcard")}
            onClick={() => {
              setBack(selection.text);
              setView("card");
            }}
          />
          <ActionButton icon={NoteEditIcon} label={t("study.selection.note")} keys={["N"]} onClick={() => setView("note")} />
          <ActionButton
            icon={AiChat02Icon}
            label={t("study.selection.ask")}
            keys={["A"]}
            strong
            disabled={openingTutor}
            onClick={onAsk}
          />
          {highlight ? (
            <ReaderTip label={t("study.selection.removeHighlight")}>
              <Button size="icon-sm" variant="ghost" aria-label={t("study.selection.removeHighlight")} onClick={onRemoveHighlight}>
                <Icon icon={Delete02Icon} size={16} />
              </Button>
            </ReaderTip>
          ) : null}
          <Menu>
            <Menu.Trigger
              render={<Button size="icon-sm" variant="ghost" aria-label={t("study.selection.more")} title={t("study.selection.more")} />}
            >
              <Icon icon={MoreHorizontalIcon} size={16} />
            </Menu.Trigger>
            <Menu.Content align="end">
              <Menu.Item onClick={() => void explain()}>{t("study.selection.explain")}</Menu.Item>
              <Menu.Item disabled={openingTutor} onClick={onTeachBack}>{t("study.capture.practice")}</Menu.Item>
              <Menu.Item onClick={() => onDraftCards(selection.text)}>{t("study.capture.cardsFromSelection")}</Menu.Item>
              <Menu.Separator />
              <Menu.Item onClick={onBookmark}>{t("study.selection.bookmark")}</Menu.Item>
              <Menu.Item onClick={() => onSaveToNotes()}>{t("study.selection.saveToNotes")}</Menu.Item>
            </Menu.Content>
          </Menu>
        </div>
      ) : null}

      {view === "translate" ? (
        <>
          <ViewHeader
            title={translateTo ? t("study.selection.translateTo", { language: languageName(translateTo) }) : t("study.selection.translate")}
            back={backToActions}
            close={onClose}
          />
          <div ref={body}>
            <Body>
              {choosingLanguage || !translateTo ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t("study.selection.chooseLanguage")}</p>
                  <StudyTranslationLanguages value={translateTo} onChange={pickLanguage} />
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    {short ? (
                      <DirectionalText text={selection.text} className="min-w-0 font-serif text-xl wrap-break-word" />
                    ) : (
                      <DirectionalText text={selection.text} className="min-w-0 line-clamp-2 text-sm text-muted-foreground wrap-break-word" />
                    )}
                    <ReaderTip label={t("study.selection.listen")}>
                      <Button size="icon-sm" variant="ghost" aria-label={t("study.selection.listen")} onClick={() => speak()}>
                        <Icon icon={VolumeHighIcon} size={16} />
                      </Button>
                    </ReaderTip>
                  </div>
                  <div aria-live="polite">
                    {busy ? (
                      <p role="status" className="text-sm text-muted-foreground">{t("study.selection.translating")}</p>
                    ) : translated ? (
                      <div className="flex items-start justify-between gap-2">
                        <DirectionalText
                          multiline
                          text={translated.text}
                          lang={translated.language}
                          className="min-w-0 text-lg leading-relaxed wrap-break-word"
                        />
                        <ReaderTip label={t("study.selection.listenTranslation")}>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("study.selection.listenTranslation")}
                            onClick={() => speak(translated.text, translated.language || speechLanguage(translated.text))}
                          >
                            <Icon icon={VolumeHighIcon} size={16} />
                          </Button>
                        </ReaderTip>
                      </div>
                    ) : translation && "error" in translation ? (
                      <div className="space-y-2">
                        <p role="alert" className="text-sm text-destructive">{translation.error}</p>
                        <Button size="sm" variant="outline" onClick={() => {
                          setTranslation(undefined);
                          void request("translate", translateTo).then((answer) => answer && setTranslation(answer));
                        }}>
                          {t("study.selection.retry")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {savedWord ? (
                      <span role="status" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-muted px-3 text-[0.8125rem] font-medium">
                        <Icon icon={CheckmarkCircle02Icon} size={15} />
                        {t("study.selection.inVocabulary")}
                      </span>
                    ) : (
                      <Button size="sm" disabled={busy || savingWord} onClick={() => void saveWord()}>
                        <Icon icon={BookmarkAdd01Icon} size={15} />
                        {t("study.selection.addToVocabulary")}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={openingTutor} onClick={onAsk}>
                      {t("study.selection.askToExplain")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setChoosingLanguage(true)}>
                      {t("study.reader.changeLanguage")}
                    </Button>
                    <AIModelPicker
                      use="translate"
                      className="ms-auto"
                      onModelChange={() => {
                        setTranslation(undefined);
                        void request("translate", translateTo).then((answer) => answer && setTranslation(answer));
                      }}
                    />
                  </div>
                </>
              )}
            </Body>
          </div>
        </>
      ) : null}

      {view === "card" ? (
        <>
          <ViewHeader title={t("study.selection.newCard")} hint={t("study.selection.cardHint")} back={backToActions} close={onClose} />
          <div ref={body}>
            <Body>
              <form
                className="space-y-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveCard();
                }}
              >
                <Input
                  data-autofocus=""
                  value={front}
                  dir={textDirection(front)}
                  onChange={(event) => setFront(event.target.value)}
                  aria-label={t("study.selection.question")}
                  placeholder={t("study.selection.questionPlaceholder")}
                />
                <Textarea
                  value={back}
                  dir={textDirection(back)}
                  onChange={(event) => setBack(event.target.value)}
                  aria-label={t("study.capture.flashcardAnswer")}
                  minRows={2}
                  maxRows={6}
                />
                <div className="flex flex-wrap gap-1.5">
                  <Button type="submit" size="sm" disabled={cardSaving || !front.trim() || !back.trim()}>
                    {t("study.selection.saveCard")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onDraftCards(selection.text)}>
                    {t("study.selection.draftWithAi")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={backToActions}>
                    {t("common:actions.cancel")}
                  </Button>
                </div>
              </form>
            </Body>
          </div>
        </>
      ) : null}

      {view === "note" ? (
        <>
          <ViewHeader title={t("study.selection.noteTitle")} hint={t("study.selection.noteHint")} back={backToActions} close={onClose} />
          <div ref={body}>
            <Body>
              <form
                className="space-y-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveNote();
                }}
              >
                <Textarea
                  value={note}
                  dir={textDirection(note)}
                  onChange={(event) => setNote(event.target.value)}
                  aria-label={t("study.selection.noteLabel")}
                  placeholder={t("study.selection.notePlaceholder")}
                  minRows={3}
                  maxRows={8}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void saveNote();
                    }
                  }}
                />
                <div className="flex flex-wrap gap-1.5">
                  <Button type="submit" size="sm" disabled={noteSaving || (!note.trim() && !highlight?.note)}>
                    {t("study.selection.saveNote")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={backToActions}>
                    {t("common:actions.cancel")}
                  </Button>
                </div>
              </form>
            </Body>
          </div>
        </>
      ) : null}

      {view === "explain" ? (
        <>
          <ViewHeader title={t("study.selection.explain")} back={backToActions} close={onClose} />
          <div ref={body}>
            <Body>
              <AIModelPicker
                use="ask"
                onModelChange={() => {
                  setExplanation(undefined);
                  void request("explain").then((answer) => answer && setExplanation(answer));
                }}
              />
              <div aria-live="polite">
                {busy ? (
                  <p role="status" className="text-sm text-muted-foreground">{t("study.capture.working")}</p>
                ) : explanation && "error" in explanation ? (
                  <p role="alert" className="text-sm text-destructive">{explanation.error}</p>
                ) : null}
              </div>
              {explanation && "text" in explanation ? (
                <>
                  <ScrollArea className="max-h-[min(18rem,40dvh)]" viewportClassName="max-h-[min(18rem,40dvh)]">
                    <StudyText prose text={explanation.text} />
                  </ScrollArea>
                  <div className="flex flex-wrap gap-1.5">
                    {explanation.text ? (
                      <Button size="sm" variant="outline" disabled={openingTutor} onClick={() => onContinueExplain(explanation.text)}>
                        {t("study.reader.continueWithTutor")}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => onSaveToNotes(explanation.text)}>
                      {t("study.capture.saveAnswer")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDraftCards(explanation.text)}>
                      {t("study.capture.cardsFromAnswer")}
                    </Button>
                    <ReaderTip label={t("study.selection.listen")}>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="ms-auto"
                        aria-label={t("study.selection.listen")}
                        onClick={() => speak(explanation.text)}
                      >
                        <Icon icon={VolumeHighIcon} size={16} />
                      </Button>
                    </ReaderTip>
                  </div>
                </>
              ) : null}
            </Body>
          </div>
        </>
      ) : null}
    </div>
  );
}
