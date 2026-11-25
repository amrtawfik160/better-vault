import { ArrowRight01Icon, MeetingRoomIcon, QuillWrite01Icon, TeachingIcon } from "@hugeicons/core-free-icons";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Icon, type IconSvgElement } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Menu } from "@/components/panelui/menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { modelFor, useSettings } from "@/lib/db/settings";
import { usePracticeSessions } from "@/lib/db/writing-practice";
import { studyHref } from "@/lib/study/links";
import {
  practiceEntryQuery,
  readerDefaultExercise,
  readerExercises,
  readerPracticeResults,
  type ReaderExercise,
  type ReaderPart,
} from "@/lib/study/reader-companion";
import type { StudyBook, StudyPractice } from "@/lib/study/records";
import { studyReturnState } from "@/lib/study/return-links";
import { cn } from "@/lib/utils";
import { sessionMode, usePracticeSessionSummary, writingPracticeParam } from "./practice/study-writing-practice";

const exerciseIcons: Record<ReaderExercise, IconSvgElement> = {
  teach: TeachingIcon,
  questions: QuillWrite01Icon,
  roleplay: MeetingRoomIcon,
};

/** What the reader's part is called, as a title ("Chapter 7") or in a sentence ("chapter 7"). */
export function usePartName(part: ReaderPart) {
  const { t } = useTranslation("home");
  return {
    title: part.kind === "document"
      ? t("study.readerCompanion.part.title.document")
      : t(`study.readerCompanion.part.title.${part.kind}`, { number: part.number }),
    inline: part.kind === "document"
      ? t("study.readerCompanion.part.inline.document")
      : t(`study.readerCompanion.part.inline.${part.kind}`, { number: part.number }),
  };
}

/** The exercise Practise this suggests for the part on screen, with its reason for the header button. */
export function useReaderPractice(book: StudyBook, index: number, vaultId: string) {
  const sessions = usePracticeSessions(vaultId);
  const section = book.sections.length > 1 ? index : undefined;
  return useMemo(
    () => ({ sessions, exercise: readerDefaultExercise(sessions ?? [], book.id, section) }),
    [book.id, section, sessions],
  );
}

function ResultRow({ session, now, open }: { session: StudyPractice; now: number; open: () => void }) {
  const { t, i18n } = useTranslation("home");
  const summary = usePracticeSessionSummary();
  const name = t(`study.practicePage.exercises.${sessionMode(session)}.name`);
  const day = (time: number) => new Date(time).toDateString();
  const date = day(session.updatedAt) === day(now)
    ? t("study.readerCompanion.practise.today")
    : day(session.updatedAt) === day(now - 86_400_000)
      ? t("study.readerCompanion.practise.yesterday")
      : new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" }).format(session.updatedAt);
  return (
    <li className="flex min-h-11 items-center gap-2 border-b py-1 ps-1 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="tabular-nums">{summary(session)}</span>
        <span className="text-muted-foreground"> · {date}</span>
      </span>
      <Button size="sm" variant="ghost" aria-label={t("study.readerCompanion.practise.openLabel", { name: `${name} · ${date}` })} onClick={open}>
        {t("study.readerCompanion.practise.open")}
      </Button>
    </li>
  );
}

/**
 * The companion's Practise tab: the material already chosen (this part, or
 * the whole document), the three exercises with the default picked, this
 * document's recent results, and Start, which opens the Practice page and
 * starts the written session there.
 */
export function StudyReaderPractise({
  book,
  index,
  part,
  vaultId,
  setupModel,
}: {
  book: StudyBook;
  /** The section on screen, from 0. */
  index: number;
  part: ReaderPart;
  vaultId: string;
  /** Opens Settings → AI providers. */
  setupModel?: () => void;
}) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useSettings();
  const name = usePartName(part);
  const reasonId = useId();
  const chaptered = book.sections.length > 1;
  const [whole, setWhole] = useState(!chaptered);
  const section = whole ? undefined : index;
  const sessions = usePracticeSessions(vaultId);
  const suggested = readerDefaultExercise(sessions ?? [], book.id, section);
  const [choice, setChoice] = useState<ReaderExercise>();
  const exercise = choice ?? suggested;
  const results = useMemo(() => readerPracticeResults(sessions ?? [], book.id), [sessions, book.id]);
  const [now] = useState(Date.now);
  const noModel = settings !== undefined && !modelFor(settings, "writing");
  const blocked = noModel && exercise !== "roleplay";
  const sectionTitle = book.sections[index]?.title;
  const returnState = studyReturnState(location.state);

  function start() {
    if (blocked) return;
    navigate(
      studyHref("practice", {
        vault: vaultId,
        ...practiceEntryQuery({ exercise, bookId: book.id, section }),
      }),
      { state: returnState },
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-4">
          <section aria-labelledby={`${reasonId}-material`} className="space-y-2">
            <h3 id={`${reasonId}-material`} className="text-xs font-medium text-muted-foreground">
              {t("study.readerCompanion.practise.material")}
            </h3>
            <div className="flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2">
              <span aria-hidden className="h-6 w-0.5 shrink-0 rounded-full bg-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" dir="auto">
                  {whole ? book.title : `${name.title}${sectionTitle && sectionTitle !== name.title ? ` · ${sectionTitle}` : ""}`}
                </span>
                {whole ? null : (
                  <span className="block truncate text-xs text-muted-foreground" dir="auto">{book.title}</span>
                )}
              </span>
              {chaptered ? (
                <Menu>
                  <Menu.Trigger
                    render={
                      <Button size="sm" variant="ghost" aria-label={t("study.readerCompanion.practise.changeLabel")} />
                    }
                  >
                    {t("study.readerCompanion.practise.change")}
                  </Menu.Trigger>
                  <Menu.Content align="end" className="w-64">
                    <Menu.RadioGroup
                      value={whole ? "document" : "part"}
                      onValueChange={(value) => {
                        setWhole(value === "document");
                        setChoice(undefined);
                      }}
                    >
                      <Menu.RadioItem value="part" closeOnClick>
                        <span className="min-w-0 truncate" dir="auto">
                          {sectionTitle && sectionTitle !== name.title ? `${name.title} · ${sectionTitle}` : name.title}
                        </span>
                      </Menu.RadioItem>
                      <Menu.RadioItem value="document" closeOnClick>
                        {t("study.readerCompanion.practise.wholeDocument")}
                      </Menu.RadioItem>
                    </Menu.RadioGroup>
                  </Menu.Content>
                </Menu>
              ) : null}
            </div>
          </section>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">
              {t("study.readerCompanion.practise.exercise")}
            </legend>
            {readerExercises.map((value) => {
              const on = value === exercise;
              return (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
                    on ? "border-input bg-muted" : "border-transparent hover:bg-foreground/[0.03]",
                  )}
                >
                  <input
                    type="radio"
                    name={`${reasonId}-exercise`}
                    value={value}
                    checked={on}
                    onChange={() => setChoice(value)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Icon icon={exerciseIcons[value]} size={15} className="text-muted-foreground" />
                      {t(`study.practicePage.exercises.${value}.name`)}
                    </span>
                    <span className="mt-0.5 block text-[0.8125rem] text-pretty text-muted-foreground">
                      {t(`study.readerCompanion.practise.exercises.${value}`)}
                    </span>
                    {value === suggested ? (
                      <span className="mt-1.5 flex items-center gap-1.5 text-xs text-foreground">
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
                        {t(`study.readerCompanion.practise.why.${suggested}`)}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </fieldset>

          <section aria-labelledby={`${reasonId}-recent`} className="space-y-2">
            <h3 id={`${reasonId}-recent`} className="text-xs font-medium text-muted-foreground">
              {t("study.readerCompanion.practise.recent")}
            </h3>
            {results.length ? (
              <ul className="rounded-xl border px-2">
                {results.map((session) => (
                  <ResultRow
                    key={session.id}
                    session={session}
                    now={now}
                    open={() =>
                      navigate(studyHref("practice", { vault: vaultId, [writingPracticeParam]: session.id }), {
                        state: returnState,
                      })
                    }
                  />
                ))}
              </ul>
            ) : sessions ? (
              <p className="text-[0.8125rem] text-muted-foreground">{t("study.readerCompanion.practise.noResults")}</p>
            ) : null}
          </section>
        </div>
      </ScrollArea>
      <div className="shrink-0 space-y-2 border-t p-4">
        <Button
          size="lg"
          variant={blocked ? "outline" : "default"}
          className={cn("w-full", blocked && "cursor-not-allowed text-muted-foreground hover:bg-background")}
          aria-disabled={blocked || undefined}
          aria-describedby={reasonId}
          onClick={start}
        >
          {t("study.readerCompanion.practise.start")}
          <Icon icon={ArrowRight01Icon} size={16} className="rtl:rotate-180" />
        </Button>
        <p id={reasonId} className={cn("text-center text-xs", blocked ? "text-foreground" : "text-muted-foreground")}>
          {t(
            blocked
              ? "study.readerCompanion.practise.startReason.noModel"
              : exercise === "roleplay"
                ? "study.readerCompanion.practise.startReason.roleplay"
                : "study.readerCompanion.practise.startReason.written",
          )}
        </p>
        {blocked && setupModel ? (
          <div className="flex justify-center">
            <Button size="sm" variant="ghost" onClick={setupModel}>
              {t("study.readerCompanion.practise.addKey")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
