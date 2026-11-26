import { useTranslation } from "react-i18next";
import { ListenButton, useListen } from "@/components/speech/listen";
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
  const { state, toggle } = useListen();
  if (!canSpeak()) return null;
  const label = t("study.collection.listen", { term: text });
  return (
    <ListenButton
      state={state}
      label={label}
      title={label}
      shape="pill"
      className={cn("text-muted-foreground", className)}
      onClick={() => void toggle(text)}
    />
  );
}
