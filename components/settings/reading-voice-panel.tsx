import { AiVoiceIcon, PlayIcon, StopIcon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Sheet } from "@/components/panelui/sheet";
import { useDownloadCaption, useMegabytes, VoiceProgress } from "@/components/speech/voice-progress";
import {
  cancelVoiceDownload,
  downloadReadingVoice,
  removeReadingVoice,
  useReadingVoice,
  type ReadingVoice,
} from "@/lib/speech/reading-voice";
import { cpuSetup, gpuSetup } from "@/lib/speech/kokoro-files";
import { speak, stopSpeaking } from "@/lib/speech/speak";
import { SettingsRow } from "./settings-row";

function hintFor(voice: ReadingVoice, t: TFunction<"settings">) {
  if (voice.status === "installed") return t("rows.voiceReady");
  if (voice.status === "downloading")
    return t("rows.voiceDownloading", {
      percent: voice.total > 0 ? Math.floor((voice.loaded / voice.total) * 100) : 0,
    });
  if (voice.status === "failed")
    return voice.error === "unsupported" ? t("rows.voiceUnsupported") : t("rows.voiceFailed");
  if (voice.status === "missing") return t("rows.voiceMissing");
  return t("rows.voiceHint");
}

/** The voice's row in the Settings sheet, saying what state it is in. */
export function ReadingVoiceRow() {
  const { t } = useTranslation("settings");
  const voice = useReadingVoice();
  return <SettingsRow to="voice" icon={AiVoiceIcon} label={t("rows.voice")} hint={hintFor(voice, t)} />;
}

function sizeOf(voice: ReadingVoice) {
  return voice.size ?? (voice.device === "wasm" ? cpuSetup.size : gpuSetup.size);
}

/**
 * Settings → Reading voice: the natural voice that reads English on this
 * device. Download it, follow or cancel the download, try it, or remove it.
 */
export function ReadingVoicePanel() {
  const { t } = useTranslation("settings");
  const voice = useReadingVoice();
  const megabytes = useMegabytes();
  const caption = useDownloadCaption(voice);
  const [playing, setPlaying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const size = megabytes(sizeOf(voice));

  function sample() {
    if (playing) return stopSpeaking();
    setPlaying(true);
    void speak(t("voice.sampleText"), { language: "en" }).finally(() => setPlaying(false));
  }

  async function remove() {
    setRemoving(true);
    try {
      await removeReadingVoice();
      toast.success(t("voice.removed", { size }));
    } finally {
      setRemoving(false);
    }
  }

  const unsupported = voice.status === "failed" && voice.error === "unsupported";

  return (
    <>
      <Sheet.Header title={t("voice.title")} description={t("voice.description")} />
      <Sheet.Body>
        <div className="space-y-4">
          <section className="space-y-3 rounded-2xl bg-muted/50 p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background">
                <Icon icon={AiVoiceIcon} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("voice.name")}</p>
                <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                  {voice.status === "installed"
                    ? t("voice.installed", { size })
                    : voice.status === "downloading"
                      ? caption
                      : voice.status === "missing"
                        ? t("voice.missing", { size })
                        : unsupported
                          ? t("voice.unsupported")
                          : voice.status === "failed"
                            ? t("voice.failed")
                            : t("voice.checking")}
                </p>
              </div>
            </div>

            {voice.status === "downloading" ? <VoiceProgress voice={voice} /> : null}

            <div className="flex flex-wrap gap-2">
              {voice.status === "missing" || (voice.status === "failed" && !unsupported) ? (
                <Button size="sm" onClick={() => void downloadReadingVoice()}>
                  {voice.status === "failed" ? t("voice.retry") : t("voice.download", { size })}
                </Button>
              ) : null}
              {voice.status === "downloading" ? (
                <Button size="sm" variant="outline" onClick={cancelVoiceDownload}>
                  {t("voice.cancel")}
                </Button>
              ) : null}
              {voice.status === "installed" ? (
                <>
                  <Button size="sm" variant="outline" onClick={sample}>
                    <Icon icon={playing ? StopIcon : PlayIcon} size={15} />
                    {playing ? t("voice.stopSample") : t("voice.sample")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={removing} onClick={() => void remove()}>
                    {t("voice.remove")}
                  </Button>
                </>
              ) : null}
            </div>
          </section>

          <div className="space-y-2 px-1 text-xs leading-relaxed text-muted-foreground">
            {voice.device ? (
              <p>{voice.device === "webgpu" ? t("voice.gpu") : t("voice.cpu")}</p>
            ) : null}
            {voice.status !== "installed" && !unsupported ? <p>{t("voice.meanwhile")}</p> : null}
            <p>{t("voice.privacy")}</p>
            <p>{t("voice.otherLanguages")}</p>
          </div>
        </div>
      </Sheet.Body>
    </>
  );
}
