import { useTranslation } from "react-i18next";
import { Citation } from "@/components/chat/citation";
import type { PassageRef } from "@/lib/chat/types";

export function StudioStudySources({
  sources,
  open,
}: {
  sources?: PassageRef[];
  open: (passage: PassageRef) => void;
}) {
  const { t } = useTranslation("studio");
  if (!sources?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span>{t("viewer.answerSources")}</span>
      {sources.map((passage) => (
        <Citation
          key={passage.n}
          passage={passage}
          numbers={[passage.n]}
          onOpen={open}
          className="static h-6 min-w-6 text-xs"
        />
      ))}
    </div>
  );
}
