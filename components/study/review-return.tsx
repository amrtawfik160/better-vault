import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { reviewReturnState } from "@/lib/study/review-session";

export function ReviewReturn({ className }: { className?: string }) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const back = reviewReturnState(useLocation().state)?.studyReturn;
  if (!back) return null;

  return (
    <div className={className}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void navigate(back.path, { state: back.state, replace: true })}
      >
        <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
        {t("study.recall.backToReview")}
      </Button>
    </div>
  );
}
