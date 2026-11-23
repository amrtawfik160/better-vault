import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { deleteStudyDocument, removeStudyReadingProgress } from "@/lib/db/study";
import type { StudyDocument } from "@/lib/study/book-deletion";
import type { StudyBook } from "@/lib/study/records";

/** The two ways to remove a document from Study, asked the same way in the Library and the reader. */
export type StudyDocumentRemoval =
  | { kind: "delete"; document: StudyDocument }
  | { kind: "progress"; book: StudyBook };

/**
 * Asks before "Delete document" (the source leaves its notebook with its
 * book) or "Remove reading progress" (only the reading place, bookmarks and
 * highlights go). `notebook` is the notebook's title, when it is known.
 */
export function StudyDocumentRemovalDialog({
  removal,
  notebook,
  onClose,
  onDone,
}: {
  removal: StudyDocumentRemoval | null;
  notebook?: string;
  onClose: () => void;
  onDone?: (removal: StudyDocumentRemoval) => void;
}) {
  const { t } = useTranslation("home");
  const deleting = removal?.kind === "delete";
  const body = deleting
    ? notebook === undefined
      ? t("study.library.deleteBodyUnnamed")
      : t("study.library.deleteBody", { notebook })
    : notebook === undefined
      ? t("study.library.removeProgressBodyUnnamed")
      : t("study.library.removeProgressBody", { notebook });
  return (
    <ConfirmDialog
      open={removal !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t(deleting ? "study.library.deleteTitle" : "study.library.removeProgressTitle")}
      body={body}
      confirmLabel={t(deleting ? "study.library.delete" : "study.library.removeProgress")}
      onConfirm={async () => {
        if (!removal) return;
        try {
          if (removal.kind === "delete") await deleteStudyDocument(removal.document);
          else await removeStudyReadingProgress(removal.book);
          toast.success(t(removal.kind === "delete" ? "study.library.deleted" : "study.library.progressRemoved"));
          onClose();
          onDone?.(removal);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      }}
    />
  );
}
