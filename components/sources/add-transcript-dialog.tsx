import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import {
  TranscriptFields,
  emptyTranscriptDraft,
  transcriptDraftDocument,
  transcriptDraftLink,
  transcriptDraftReady,
} from "./transcript-fields";

/** A transcript ready to save: its title, text (with `[mm:ss]` marks) and link. */
export interface SavedTranscript {
  title: string;
  text: string;
  link?: string;
}

/**
 * "Add a video or podcast": a pasted transcript, subtitles or a transcribed
 * recording, saved by `onSave` (the Study library makes a text document).
 * Closing it while a recording is transcribing stops the transcription.
 */
export function AddTranscriptDialog({
  onClose,
  onSave,
  fields,
}: {
  onClose: () => void;
  onSave: (transcript: SavedTranscript) => Promise<void>;
  /** More fields under the transcript's, e.g. the notebook it goes to; given whether it is saving. */
  fields?: (saving: boolean) => ReactNode;
}) {
  const { t } = useTranslation("sources");
  const { t: tCommon } = useTranslation();
  const formId = useId();
  const [draft, setDraft] = useState(emptyTranscriptDraft);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving || busy || !transcriptDraftReady(draft)) return;
    setSaving(true);
    try {
      await onSave({
        title: draft.title.trim(),
        text: transcriptDraftDocument(draft),
        link: transcriptDraftLink(draft),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <Dialog.Content size="lg" closeLabel={tCommon("actions.close")}>
        <Dialog.Header title={t("transcript.title")} description={t("transcript.description")} />
        <Dialog.Body>
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <TranscriptFields
              draft={draft}
              onChange={setDraft}
              disabled={saving}
              onBusyChange={setBusy}
            />
            {fields ? <div className="mt-4">{fields(saving)}</div> : null}
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="secondary" disabled={saving} />}>
            {tCommon("actions.cancel")}
          </Dialog.Close>
          <Button
            type="submit"
            form={formId}
            loading={saving}
            disabled={busy || !transcriptDraftReady(draft)}
          >
            {t("transcript.save")}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
