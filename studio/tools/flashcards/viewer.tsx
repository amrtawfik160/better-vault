import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  RotateLeft01Icon,
  ShuffleIcon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { StudyText } from "@/components/study/study-text";
import { Button } from "@/components/panelui/button";
import { cn } from "@/lib/utils";
import type { ToolViewerProps } from "@/studio/shared/form";
import { StudioStudySources } from "@/studio/shared/study-sources";
import type { FlashcardsData } from "./definition";
import {
  nextFlashcardPractice,
  readFlashcardPractice,
  type FlashcardAction,
  type FlashcardPractice,
} from "./practice";

const cardText =
  "w-full min-w-0 max-w-full wrap-break-word [&_pre]:pointer-events-auto [&_pre]:text-start [&_table]:pointer-events-auto [&_.katex-display]:pointer-events-auto";

/** Cards one at a time: flip to see the answer, then mark whether you knew it. */
export function FlashcardsViewer({
  data,
  flashcardPractice,
  onFlashcardAction,
  onOpenPassage,
  onReviewMissed,
}: ToolViewerProps<FlashcardsData>) {
  const { t, i18n } = useTranslation("studio");
  const size = data.cards.length;
  const saved = readFlashcardPractice(size, flashcardPractice);
  const [localPractice, setLocalPractice] = useState<FlashcardPractice>();
  const practice = localPractice && localPractice.revision > saved.revision ? localPractice : saved;
  const { order, position, flipped, grades } = practice;
  const [committing, setCommitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const finished = position >= order.length;
  const card = data.cards[order[position]];
  const known = order.filter((index) => grades[index] === "known").length;
  const missed = order.filter((index) => grades[index] === "missed");
  const unrated = order.length - known - missed.length;
  const sideId = useId();
  const flipButton = useRef<HTMLButtonElement>(null);
  const results = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);

  const apply = useCallback(
    async (action: FlashcardAction) => {
      if (committing || saving) return;
      setCommitting(true);
      try {
        const next = onFlashcardAction
          ? await onFlashcardAction(practice.revision, action)
          : nextFlashcardPractice(size, practice, action);
        if (!next) {
          toast.info(t("flashcards.viewer.practiceChanged"));
          return;
        }
        moveFocus.current = action.kind === "grade" || action.kind === "restart";
        setLocalPractice(next);
      } catch {
        toast.error(t("flashcards.viewer.savePracticeFailed"));
      } finally {
        setCommitting(false);
      }
    },
    [committing, onFlashcardAction, practice, saving, size, t],
  );

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (finished ? results.current : flipButton.current)?.focus({ preventScroll: true });
  }, [finished, localPractice]);

  const rtl = i18n.dir() === "rtl";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
          target.closest(
            "input, textarea, select, pre, .katex-display, [contenteditable], [role=dialog], [role=alertdialog], [role=menu], [role=tablist]",
          )
      )
        return;
      if (event.key === " ") {
        if (finished || (target instanceof HTMLElement && target.closest("button, a"))) return;
        event.preventDefault();
        void apply({ kind: "flip" });
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const offset = (event.key === "ArrowRight") !== rtl ? 1 : -1;
        if (position + offset < 0 || position + offset > order.length) return;
        event.preventDefault();
        void apply({ kind: "move", offset });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply, finished, order.length, position, rtl]);

  if (finished) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-16 text-center">
        <h3 ref={results} tabIndex={-1} className="text-xl font-semibold outline-none">
          {t("flashcards.viewer.finished", { known, total: order.length })}
        </h3>
        <div className="flex flex-wrap justify-center gap-2">
          {onReviewMissed && missed.length ? (
            <Button
              shape="pill"
              disabled={committing}
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onReviewMissed(missed);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {t("flashcards.viewer.reviewMissed", { count: missed.length })}
            </Button>
          ) : null}
          {missed.length ? (
            <Button
              shape="pill"
              variant={onReviewMissed ? "outline" : "default"}
              disabled={committing || saving}
              onClick={() => void apply({ kind: "restart", mode: "missed" })}
            >
              {t("flashcards.viewer.practiceMissed", { count: missed.length })}
            </Button>
          ) : null}
          {unrated ? (
            <Button
              shape="pill"
              variant="outline"
              disabled={committing || saving}
              onClick={() => void apply({ kind: "restart", mode: "unrated" })}
            >
              {t("flashcards.viewer.practiceUnrated", { count: unrated })}
            </Button>
          ) : null}
          <Button
            shape="pill"
            variant="secondary"
            disabled={!size || committing || saving}
            onClick={() => void apply({ kind: "restart", mode: "all" })}
          >
            <Icon icon={RotateLeft01Icon} size={16} />
            {t("flashcards.viewer.restart")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-5 pb-10">
      <div className="flex w-full items-center justify-between text-sm text-muted-foreground">
        <span className="tabular-nums">
          {t("flashcards.viewer.progress", { current: position + 1, total: order.length })}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={committing}
            onClick={() => void apply({ kind: "restart", mode: "shuffle" })}
          >
            <Icon icon={ShuffleIcon} size={16} />
            {t("flashcards.viewer.shuffle")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={committing}
            onClick={() => void apply({ kind: "restart", mode: "all" })}
          >
            <Icon icon={RotateLeft01Icon} size={16} />
            {t("flashcards.viewer.restart")}
          </Button>
        </div>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-chart-4 transition-[width]"
          style={{ width: `${(position / order.length) * 100}%` }}
        />
      </div>

      <div className="relative w-full [perspective:1600px]">
        <button
          ref={flipButton}
          type="button"
          onClick={() => void apply({ kind: "flip" })}
          aria-disabled={committing}
          aria-label={flipped ? t("flashcards.viewer.flipBack") : t("flashcards.viewer.flip")}
          aria-describedby={`${sideId}-${flipped ? "back" : "front"}`}
          className="absolute inset-0 cursor-pointer rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <div
          className={cn(
            "pointer-events-none relative grid aspect-[16/10] w-full transition-transform duration-500 ease-[cubic-bezier(0.3,0.7,0.1,1)] transform-3d motion-reduce:transition-none",
            flipped && "rotate-y-180",
          )}
        >
          <div
            id={`${sideId}-front`}
            inert={flipped}
            className="col-start-1 row-start-1 flex min-w-0 items-center justify-center rounded-3xl bg-card p-5 text-center text-card-foreground shadow-sm ring-1 ring-border backface-hidden sm:p-8"
          >
            <StudyText
              text={card.front}
              className={cn(cardText, "text-xl leading-snug font-semibold sm:text-2xl")}
            />
          </div>
          <div
            id={`${sideId}-back`}
            inert={!flipped}
            className="col-start-1 row-start-1 flex min-w-0 rotate-y-180 items-center justify-center rounded-3xl bg-muted p-5 text-center backface-hidden sm:p-8"
          >
            <StudyText
              text={card.back}
              className={cn(cardText, "text-lg leading-relaxed")}
            />
          </div>
        </div>
      </div>
      {flipped ? <StudioStudySources sources={card.sources} open={onOpenPassage} /> : null}

      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <Button
          variant="outline"
          shape="pill"
          size="icon"
          aria-label={t("flashcards.viewer.previous")}
          disabled={position === 0 || committing}
          onClick={() => void apply({ kind: "move", offset: -1 })}
        >
          <Icon icon={ArrowLeft01Icon} className="rtl:rotate-180" />
        </Button>
        <div className="order-last flex w-full flex-wrap justify-center gap-2 sm:order-none sm:w-auto">
          <Button
            variant="outline"
            shape="pill"
            disabled={committing}
            onClick={() => void apply({ kind: "grade", grade: "missed" })}
          >
            <Icon icon={CancelCircleIcon} size={16} className="text-destructive" />
            {t("flashcards.viewer.missed")}
            <span className="text-muted-foreground tabular-nums">{missed.length}</span>
          </Button>
          <Button
            variant="outline"
            shape="pill"
            disabled={committing}
            onClick={() => void apply({ kind: "grade", grade: "known" })}
          >
            <Icon icon={CheckmarkCircle02Icon} size={16} className="text-success" />
            {t("flashcards.viewer.knew")}
            <span className="text-muted-foreground tabular-nums">{known}</span>
          </Button>
        </div>
        <Button
          variant="outline"
          shape="pill"
          size="icon"
          aria-label={t("flashcards.viewer.next")}
          disabled={committing}
          onClick={() => void apply({ kind: "move", offset: 1 })}
        >
          <Icon icon={ArrowRight01Icon} className="rtl:rotate-180" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("flashcards.viewer.hint")}</p>
    </div>
  );
}
