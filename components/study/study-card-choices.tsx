import { useTranslation } from "react-i18next";
import { StudyText } from "./study-text";

export function StudyCardChoices({
  choices,
  className,
  showLabel = true,
}: {
  choices?: readonly string[];
  className?: string;
  showLabel?: boolean;
}) {
  const { t } = useTranslation("home");
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
        {choices.map((choice, index) => (
          <li key={index} className="min-w-0 ps-1 wrap-break-word">
            <StudyText text={choice} />
          </li>
        ))}
      </ol>
    </div>
  );
}
