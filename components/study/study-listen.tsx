import { VolumeHighIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { cn } from "@/lib/utils";

function speech() {
  if (typeof window === "undefined" || typeof window.SpeechSynthesisUtterance !== "function") return;
  return window.speechSynthesis;
}

/** Reads a word aloud with the system's voice, where the browser or desktop app has one. */
export function speakStudyText(text: string) {
  const synthesis = speech();
  if (!synthesis || !text.trim()) return false;
  try {
    synthesis.cancel();
    synthesis.speak(new window.SpeechSynthesisUtterance(text));
    return true;
  } catch {
    return false;
  }
}

export function StudyListenButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation("home");
  if (!speech()) return null;
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
