import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/panelui/button";
import { addStudyBook, saveStudyText, StudyTextConflict } from "@/lib/db/study";
import { studyDocumentDraftId } from "@/lib/study/document-drafts";
import { studyHref } from "@/lib/study/links";
import { studyDocumentContent } from "@/lib/study/markdown-document";
import type { StudyBook, StudyDocumentRecovery, StudyDocumentSnapshot } from "@/lib/study/records";
import { StudyDocumentEditor, type StudyDocumentDraft } from "./study-document-editor";
import { useStudyDocumentRecovery } from "./study-document-recovery";

type Edit = Extract<StudyDocumentSnapshot, { kind: "edit" }>;

export function StudyDocumentEdits({
  book,
  section,
  vaultId,
  open,
  onOpenChange,
  onSave,
}: {
  book: StudyBook;
  section: number;
  vaultId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(["home", "common"]);
  const navigate = useNavigate();
  const recovery = useStudyDocumentRecovery({
    id: studyDocumentDraftId({ bookId: book.id, section }),
    bookId: book.id,
    notebookId: book.notebookId,
    vaultId,
  });
  const current = book.sections[section];
  const savedDraft = recovery.latest?.snapshot;
  const resumable =
    savedDraft?.kind === "edit" &&
    (savedDraft.text !== (current.markdown ?? current.text) ||
      savedDraft.markdown !== (current.markdown !== undefined));
  const [editor, setEditor] = useState<{ edit: Edit; row?: StudyDocumentRecovery }>();
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const edit = open ? editor?.edit : undefined;
  const conflict =
    edit && (edit.original !== current.text || edit.originalMarkdown !== current.markdown);
  const row = open ? editor?.row : undefined;

  function change(value: StudyDocumentDraft) {
    if (!editor) return;
    const next = { ...editor.edit, ...value };
    setEditor({ edit: next, row: recovery.stage(next) });
  }

  async function save(copy = false) {
    if (!edit?.text.trim() || saving || (conflict && !copy)) return;
    setSaving(true);
    try {
      if (copy) {
        const title = t("study.documentEditor.draftCopyTitle", { title: book.title });
        const created = await addStudyBook({
          title,
          format: "text",
          sections: [{ title, ...studyDocumentContent(edit.text, edit.markdown) }],
          vaultId,
        });
        if (row) await recovery.clear(row).catch(console.error);
        onOpenChange(false);
        void navigate(studyHref("library", { book: created.id, vault: vaultId }));
        return;
      }
      await saveStudyText(book.id, edit.text, {
        section,
        original: edit.original,
        originalMarkdown: edit.originalMarkdown,
        markdown: edit.markdown,
      });
      if (row) await recovery.clear(row).catch(console.error);
      onSave();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof StudyTextConflict
          ? t("study.reader.editConflict")
          : error instanceof Error
            ? error.message
            : String(error),
      );
    } finally {
      setSaving(false);
    }
  }

  return edit ? (
    <>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <StudyDocumentEditor
          label={t("study.documentEditor.editLabel")}
          value={edit}
          disabled={saving}
          onChange={change}
        />
        {conflict ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("study.documentEditor.staleDraft")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {conflict ? (
            <Button
              type="button"
              disabled={!edit.text.trim() || saving}
              onClick={() => void save(true)}
            >
              {t("study.documentEditor.saveDraftCopy")}
            </Button>
          ) : (
            <Button type="submit" disabled={!edit.text.trim() || saving}>
              {t("study.documentEditor.publish")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t(row ? "study.documentEditor.closeEditor" : "common:actions.cancel")}
          </Button>
          {row ? (
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setDiscard(true)}
            >
              {t("study.documentEditor.discardDraft")}
            </Button>
          ) : null}
        </div>
      </form>
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title={t("study.documentEditor.discardTitle")}
        body={t("study.documentEditor.discardDescription")}
        confirmLabel={t("study.documentEditor.discardDraft")}
        onConfirm={async () => {
          if (row) await recovery.clear(row);
          onOpenChange(false);
        }}
      />
    </>
  ) : (
    <Button
      variant="outline"
      size="sm"
      disabled={!recovery.ready}
      onClick={() => {
        setEditor(
          resumable
            ? { edit: savedDraft, row: recovery.latest }
            : {
                edit: {
                  kind: "edit",
                  original: current.text,
                  originalMarkdown: current.markdown,
                  text: current.markdown ?? current.text,
                  markdown: current.markdown !== undefined,
                },
              },
        );
        onOpenChange(true);
      }}
    >
      {t(resumable ? "study.documentEditor.resumeEditing" : "study.documentEditor.edit")}
    </Button>
  );
}
