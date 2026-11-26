import {
  AiVoiceIcon,
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import {
  cancelVoiceDownload,
  downloadReadingVoice,
  getReadingVoice,
  subscribeReadingVoice,
  takeWaitingText,
} from "@/lib/speech/reading-voice";
import { speak } from "@/lib/speech/speak";
import { cn } from "@/lib/utils";
import { useDownloadCaption, VoiceProgress } from "./voice-progress";

const id = "reading-voice";

type Waiting = ReturnType<typeof takeWaitingText>;

/**
 * The reading voice's download, as a card among the toasts: its progress
 * while it runs, then that it is ready (offering the text the user wanted to
 * hear) or failed (offering to try again).
 */
function VoiceCard({ waiting }: { waiting?: Waiting }) {
  const { t } = useTranslation("common");
  const voice = useSyncExternalStore(subscribeReadingVoice, getReadingVoice, getReadingVoice);
  const caption = useDownloadCaption(voice);
  const close = () => toast.dismiss(id);

  const view =
    voice.status === "downloading"
      ? {
          icon: AiVoiceIcon,
          tone: "bg-muted",
          title: t("speech.downloadingTitle"),
          detail: caption,
          note: t("speech.meanwhile"),
          action: (
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={cancelVoiceDownload}>
              {t("speech.cancel")}
            </Button>
          ),
        }
      : voice.status === "installed"
        ? {
            icon: CheckmarkCircle02Icon,
            tone: "bg-success/15 text-success",
            title: t("speech.ready"),
            detail: t("speech.readyHint"),
            action: waiting ? (
              <Button
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  close();
                  void speak(waiting.text, { language: waiting.language });
                }}
              >
                <Icon icon={VolumeHighIcon} size={14} />
                {t("speech.listenNow")}
              </Button>
            ) : undefined,
          }
        : {
            icon: Alert02Icon,
            tone: "bg-destructive/15 text-destructive",
            title: t("speech.failed"),
            detail: t("speech.failedHint"),
            action: (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                onClick={() => void downloadReadingVoice()}
              >
                {t("speech.retry")}
              </Button>
            ),
          };

  return (
    <div
      role="status"
      className="flex w-(--width) gap-3 rounded-2xl border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", view.tone)}>
        <Icon icon={view.icon} size={18} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{view.title}</p>
            <p className="text-xs text-muted-foreground tabular-nums">{view.detail}</p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            className="-me-2 -mt-2 size-7 text-muted-foreground"
            aria-label={t("speech.hide")}
            title={t("speech.hide")}
            onClick={close}
          >
            <Icon icon={Cancel01Icon} size={14} />
          </Button>
        </div>
        {voice.status === "downloading" ? <VoiceProgress voice={voice} /> : null}
        {view.note || view.action ? (
          <div className="flex items-end justify-between gap-3">
            <p className="text-xs text-muted-foreground">{view.note}</p>
            <div className="shrink-0">{view.action}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Shows the reading voice's download as it starts, and how it ends. */
export function ReadingVoiceToasts() {
  useEffect(
    () =>
      subscribeReadingVoice((next, previous) => {
        if (next.status === previous.status) return;
        if (next.status === "downloading") {
          toast.custom(() => <VoiceCard />, { id, duration: Infinity, unstyled: true });
          return;
        }
        if (previous.status !== "downloading") return;
        if (next.status === "installed") {
          const waiting = takeWaitingText();
          toast.custom(() => <VoiceCard waiting={waiting} />, { id, duration: 12_000, unstyled: true });
        } else if (next.status === "failed") {
          toast.custom(() => <VoiceCard />, { id, duration: 20_000, unstyled: true });
        } else {
          // Cancelled.
          toast.dismiss(id);
        }
      }),
    [],
  );

  return null;
}
