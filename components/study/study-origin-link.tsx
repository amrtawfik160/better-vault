import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { originHref, originLabel } from "@/lib/study/links";
import { reviewReturnState } from "@/lib/study/review-session";
import type { StudyOrigin } from "@/lib/study/records";

export function StudyOriginLink({
  origin,
  label,
  state,
  onClick,
}: {
  origin: StudyOrigin;
  label?: string;
  state?: ReturnType<typeof reviewReturnState>;
  onClick?: () => void;
}) {
  const { t } = useTranslation("home");
  const location = useLocation();
  const current = reviewReturnState(location.state);
  const params = new URLSearchParams(location.search);
  const readerTutor = params.get("readerTutor");
  const href = originHref(origin);
  const destination =
    readerTutor && origin.kind === "book" && origin.bookId === params.get("book")
      ? `${href}&${new URLSearchParams({ readerTutor, readerView: "book" })}`
      : href;
  const returnState = state ?? current;
  return (
    <Link
      to={destination}
      state={
        origin.kind === "source" && origin.snippet
          ? { ...returnState, studySourceSnippet: origin.snippet }
          : returnState
      }
      onClick={onClick}
      className="inline-flex rounded-lg px-2 py-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label ??
        (origin.kind === "book" && origin.visual
          ? t("study.visualCard.openSource")
          : originLabel(origin))}
    </Link>
  );
}
