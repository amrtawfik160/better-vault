import { VolumeHighIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { canSpeak, speak } from "@/lib/speech/speak";
import { cn } from "@/lib/utils";

/** Reads a word aloud: English with the on-device voice, other languages with the system's. */
export function speakStudyText(text: string) {
  if (!canSpeak() || !text.trim()) return false;
  void speak(text);
  return true;
}

export function StudyListenButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation("home");
  if (!canSpeak()) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      shape="pill"
      className={cn("text-muted-foreground", className)}
      aria-label={t("study.collection.listen", { term: text })}
      title={t("study.collection.listen", { term: text })}
      onClick={() => speakStudyText(text)}
    >
      <Icon icon={VolumeHighIcon} size={16} />
    </Button>
  );
}
