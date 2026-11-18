import { useId } from "react";
import { useTranslation } from "react-i18next";
import { StudyText } from "./study-text";

export function StudyCardChoices({
  choices,
  className,
  showLabel = true,
  selection,
}: {
  choices?: readonly string[];
  className?: string;
  showLabel?: boolean;
  selection?: { index?: number; choose: (index: number) => void };
}) {
  const { t } = useTranslation("home");
  const group = useId();
  if (!choices?.length) return null;

  return (
    <div className={className}>
      {showLabel ? (
        <p className="mb-2 text-sm font-medium">{t("study.recall.answerChoices")}</p>
      ) : null}
      <ol
        dir="auto"
        className="list-[upper-alpha] space-y-2 ps-6 text-sm"
        aria-label={t("study.recall.answerChoices")}
      >
        {choices.map((choice, index) => {
          const id = `${group}-${index}`;
          return selection ? (
            <li key={index} className="min-w-0 ps-1">
              <div data-selected={selection.index === index}
                className="relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-xl border px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring data-[selected=true]:border-foreground">
                <input id={id} type="radio" name={group} checked={selection.index === index} aria-labelledby={`${id}-choice`}
                  className="relative z-10 mt-1 size-4 accent-current" onChange={() => selection.choose(index)} />
                <div id={`${id}-choice`} className="min-w-0 wrap-break-word [&_.katex-display]:relative [&_.katex-display]:z-10 [&_pre]:relative [&_pre]:z-10">
                  <StudyText text={choice} />
                </div>
                <label htmlFor={id} aria-hidden="true" className="absolute inset-0 cursor-pointer rounded-xl" />
              </div>
            </li>
          ) : (
            <li key={index} className="min-w-0 ps-1 wrap-break-word">
              <StudyText text={choice} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
