import { Loading03Icon, Video01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { credentialsFor, useSettings } from "@/lib/db/settings";
import { IngestError, ingestYouTubeWithGemini, type VideoInfo } from "@/lib/sources/ingest";
import { formatTimestamp } from "@/lib/sources/transcript";
import { GEMINI_MAX_SECONDS, geminiVideoTokens } from "@/lib/sources/youtube";

interface YouTubeGeminiCardProps {
  notebookId: string;
  video: VideoInfo;
  /** Called once the transcript is saved. */
  onAdded: () => void;
  onBusyChange?: (busy: boolean) => void;
}

/**
 * Shown when a YouTube video has no captions: what Gemini would cost to
 * transcribe it with the user's Google key, and the button that does it.
 */
export function YouTubeGeminiCard({
  notebookId,
  video,
  onAdded,
  onBusyChange,
}: YouTubeGeminiCardProps) {
  const { t, i18n } = useTranslation("sources");
  const settings = useSettings();
  const google = settings?.providers.google;
  const ready = Boolean(google?.enabled && google.apiKey.trim());
  const tooLong = video.seconds > GEMINI_MAX_SECONDS;
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController>(null);

  useEffect(() => onBusyChange?.(working), [working, onBusyChange]);
  useEffect(() => () => request.current?.abort(), []);

  async function transcribe() {
    if (!settings || !ready || tooLong || working) return;
    const controller = new AbortController();
    request.current = controller;
    setWorking(true);
    setError(undefined);
    try {
      await ingestYouTubeWithGemini(
        notebookId,
        video,
        credentialsFor(settings, "google"),
        controller.signal,
      );
      onAdded();
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(
        failure instanceof IngestError
          ? failure.detail
          : failure instanceof Error
            ? failure.message
            : String(failure),
      );
    } finally {
      if (request.current === controller) request.current = null;
      setWorking(false);
    }
  }

  const length = video.seconds > 0 ? formatTimestamp(video.seconds) : "";
  const tokens = new Intl.NumberFormat(i18n.language).format(geminiVideoTokens(video.seconds));
  const reason = tooLong
    ? t("youtube.tooLong")
    : !ready
      ? t("youtube.noKey")
      : video.seconds > 0
        ? t("youtube.cost", { tokens })
        : t("youtube.costUnknown");

  return (
    <section
      aria-labelledby="youtube-no-captions"
      aria-busy={working}
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon icon={Video01Icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="youtube-no-captions" className="text-sm font-medium">
            {t("youtube.noCaptions")}
          </h3>
          <p className="truncate text-sm text-muted-foreground">
            {length ? t("youtube.video", { title: video.title, length }) : video.title}
          </p>
        </div>
      </div>
      <p id="youtube-gemini-why" className="text-sm text-pretty text-muted-foreground">
        {t("youtube.offer")} {reason}
      </p>
      {working ? (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Icon icon={Loading03Icon} size={16} className="animate-spin text-muted-foreground" />
          <p className="flex-1 text-sm">{t("youtube.working")}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => request.current?.abort()}
          >
            {t("youtube.stop")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!ready || tooLong}
            aria-describedby="youtube-gemini-why"
            onClick={() => void transcribe()}
          >
            {t("youtube.transcribe")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("youtube.otherWay")}</p>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("youtube.failed", { error })}
        </p>
      ) : null}
    </section>
  );
}
