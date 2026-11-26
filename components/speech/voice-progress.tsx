import { useTranslation } from "react-i18next";
import type { ReadingVoice } from "@/lib/speech/reading-voice";
import { cn } from "@/lib/utils";

/** A size in megabytes, in the interface's language. */
export function useMegabytes() {
  const { i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.language, {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: 0,
  });
  return (bytes: number) => format.format(bytes / 1_000_000);
}

/** "120 MB of 326 MB · about 2 min left" */
export function useDownloadCaption(voice: ReadingVoice) {
  const { t } = useTranslation("common");
  const megabytes = useMegabytes();
  const amount =
    voice.total > 0
      ? t("speech.amount", { loaded: megabytes(voice.loaded), total: megabytes(voice.total) })
      : t("speech.starting");
  if (voice.secondsLeft === undefined) return amount;
  const left =
    voice.secondsLeft < 60
      ? t("speech.lessThanAMinute")
      : t("speech.minutesLeft", { count: Math.ceil(voice.secondsLeft / 60) });
  return `${amount} · ${left}`;
}

/** The download's progress bar. */
export function VoiceProgress({ voice, className }: { voice: ReadingVoice; className?: string }) {
  const { t } = useTranslation("common");
  const percent = voice.total > 0 ? Math.min(100, Math.floor((voice.loaded / voice.total) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={t("speech.downloadingTitle")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(percent, 2)}%` }}
      />
    </div>
  );
}
