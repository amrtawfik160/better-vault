import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { tutorReturnState } from "@/lib/study/return-links";
import { reviewReturnState } from "@/lib/study/review-session";
import { cn } from "@/lib/utils";

export function StudyReturnLinks({ className }: { className?: string }) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const { pathname, search, state } = useLocation();
  const review = reviewReturnState(state);
  const tutor = tutorReturnState(state)?.studyTutorReturn;
  const backToTutor = tutor && tutor !== pathname + search ? tutor : undefined;
  if (!backToTutor && !review) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {backToTutor ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void navigate(backToTutor, { state: review, replace: true })}
        >
          <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
          {t("study.reader.backToTutor")}
        </Button>
      ) : null}
      {review ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            void navigate(review.studyReturn.path, {
              state: review.studyReturn.state,
              replace: true,
            })
          }
        >
          <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
          {t("study.recall.backToReview")}
        </Button>
      ) : null}
    </div>
  );
}
