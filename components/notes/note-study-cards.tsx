import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Menu } from "@/components/panelui/menu";
import {
  StudyFlashcardDraftDialog,
  type FlashcardSource,
} from "@/components/study/study-flashcard-generator";
import type { Note } from "@/lib/db/types";
import { readFrontmatter } from "@/lib/notes/syntax";
import { studyHref } from "@/lib/study/links";
import { noteFlashcardMaterial, type NoteStudySnapshot } from "@/lib/study/note-flashcards";

export function NoteStudyCards({
  note,
  vaultId,
  snapshot,
}: {
  note: Note;
  vaultId: string;
  snapshot: () => NoteStudySnapshot;
}) {
  const { t } = useTranslation("notes");
  const { t: study } = useTranslation("home");
  const navigate = useNavigate();
  const pointerSnapshot = useRef<NoteStudySnapshot | null>(null);
  const [captured, setCaptured] = useState<NoteStudySnapshot>();
  const [draft, setDraft] = useState<{ source: FlashcardSource; manual: boolean }>();
  const hasBody = Boolean(captured && readFrontmatter(captured.body).content.trim());
  const viewCards = () => navigate(studyHref("cards", { note: note.id, vault: vaultId }));

  function prepare(action: "note" | "selection" | "manual") {
    if (!captured) return;
    const selection = action === "note" ? undefined : captured.selection;
    if (action !== "note" && !selection) return;
    const material = noteFlashcardMaterial(note, { body: captured.body, selection });
    if (!material.text) return;
    const manual = action === "manual";
    setDraft({
      source: {
        ...material,
        cards: manual && selection ? [{ front: "", back: selection.text }] : undefined,
      },
      manual,
    });
  }

  return (
    <>
      <Menu
        onOpenChange={(open) => {
          if (open) setCaptured(pointerSnapshot.current ?? snapshot());
          pointerSnapshot.current = null;
        }}
      >
        <Menu.Trigger
          render={<Button size="sm" variant="ghost" />}
          onPointerDown={() => { pointerSnapshot.current = snapshot(); }}
          onPointerCancel={() => { pointerSnapshot.current = null; }}
        >
          {study("study.tabs.cards")}
        </Menu.Trigger>
        <Menu.Content align="start">
          <Menu.Item onClick={() => prepare("note")} disabled={!hasBody}>
            {t("flashcards.fromNote")}
          </Menu.Item>
          {captured?.selection ? (
            <>
              <Menu.Item onClick={() => prepare("selection")}>{study("study.capture.cardsFromSelection")}</Menu.Item>
              <Menu.Item onClick={() => prepare("manual")}>{t("flashcards.make")}</Menu.Item>
            </>
          ) : null}
          <Menu.Separator />
          <Menu.Item onClick={viewCards}>{study("study.capture.viewCards")}</Menu.Item>
        </Menu.Content>
      </Menu>
      {draft ? (
        <StudyFlashcardDraftDialog
          source={draft.source}
          vaultId={vaultId}
          title={draft.manual ? t("flashcards.make") : undefined}
          onClose={() => setDraft(undefined)}
          onSave={(count) =>
            toast.success(study("study.capture.cardsSaved", { count }), {
              action: {
                label: study("study.capture.viewCards"),
                onClick: viewCards,
              },
            })
          }
        />
      ) : null}
    </>
  );
}
