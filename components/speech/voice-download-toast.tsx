import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { subscribeVoiceDownload } from "@/lib/speech/speak";

const id = "voice-download";

/** Shows the on-device voice's first download, which takes a moment. */
export function VoiceDownloadToast() {
  const { t } = useTranslation("common");

  useEffect(() => {
    let shown = false;
    return subscribeVoiceDownload((download) => {
      if (typeof download === "string") {
        if (shown && download === "ready") toast.success(t("speech.ready"), { id, duration: 5000 });
        else if (shown) toast.dismiss(id);
        shown = false;
        return;
      }
      shown = true;
      const percent = download.total > 0 ? Math.floor((download.loaded / download.total) * 100) : 0;
      toast.loading(percent > 0 ? t("speech.downloading", { percent }) : t("speech.downloadingFirst"), {
        id,
        duration: Infinity,
      });
    });
  }, [t]);

  return null;
}
