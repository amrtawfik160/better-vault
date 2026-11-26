import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { formatRelativeTime } from "@/lib/format";
import {
  flashcardDrafts,
  restoreFlashcardSource,
  subscribeFlashcardDrafts,
  type FlashcardDraftRecovery,
} from "@/lib/study/flashcard-draft-recovery";
import { StudyFlashcardDraftDialog } from "./study-flashcard-generator";

export function StudyFlashcardDrafts({ vaultId }: { vaultId: string }) {
  const { t, i18n } = useTranslation("home");
  const { t: common } = useTranslation();
  const [available, setAvailable] = useState(() => flashcardDrafts(vaultId).length);
  const [list, setList] = useState<FlashcardDraftRecovery[]>();
  const [active, setActive] = useState<FlashcardDraftRecovery>();

  useEffect(() => subscribeFlashcardDrafts(() => {
    setAvailable(flashcardDrafts(vaultId).length);
  }), [vaultId]);

  return (
    <>
      {available ? (
        <Button variant="outline" onClick={() => setList(flashcardDrafts(vaultId))}>
          {t("study.capture.resumeDrafts")}
        </Button>
      ) : null}
      {list ? (
        <Dialog open onOpenChange={(open) => { if (!open) setList(undefined); }}>
          <Dialog.Content closeLabel={common("actions.close")}>
            <Dialog.Header title={t("study.capture.resumeDrafts")} />
            <Dialog.Body>
              <ul className="divide-y rounded-xl border">
                {list.map((draft) => {
                  const count = draft.editor.batches.reduce((total, batch) => total + batch.drafts.length, 0);
                  const title = draft.source?.title || t("study.capture.textDraft");
                  const excerpt = draft.source?.parts?.[draft.editor.part]?.material.text ??
                    draft.source?.text ?? draft.editor.freeText;
                  return (
                    <li key={draft.key} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium" dir="auto">{title}</p>
                        {excerpt.trim() ? (
                          <p className="truncate text-xs text-muted-foreground" dir="auto">
                            {excerpt.trim().slice(0, 120).replace(/\s+/g, " ")}
                          </p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          {t("study.capture.draftCount", { count })} · {formatRelativeTime(draft.updatedAt, i18n.language)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setList(undefined);
                          setActive(draft);
                        }}
                      >
                        {t("study.capture.resumeDraft")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog>
      ) : null}
      {active ? (
        <StudyFlashcardDraftDialog
          source={restoreFlashcardSource(active.source)}
          recoveryKey={active.key}
          vaultId={vaultId}
          onClose={() => setActive(undefined)}
          onSave={(count) => toast.success(t("study.capture.cardsSaved", { count }))}
        />
      ) : null}
    </>
  );
}
