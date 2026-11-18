import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";

export type TutorMaterialSelection = { bookIds: string[]; noteIds: string[] };
type Material = { id: string; title: string };
type Props = {
  books: Material[];
  notes: Material[];
  selection: TutorMaterialSelection;
  disabled?: boolean;
  onApply: (selection: TutorMaterialSelection) => void | Promise<void>;
};

export function availableTutorSelection(
  books: Material[],
  notes: Material[],
  selection: TutorMaterialSelection,
) {
  return {
    bookIds: books.filter(({ id }) => selection.bookIds.includes(id)).map(({ id }) => id),
    noteIds: notes.filter(({ id }) => selection.noteIds.includes(id)).map(({ id }) => id),
  };
}

export function TutorMaterialPicker({ books, notes, selection, disabled, onApply }: Props) {
  const { t } = useTranslation("home");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = availableTutorSelection(books, notes, selection);
  const count = current.bookIds.length + current.noteIds.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(changed) => {
        if (!saving) setOpen(changed);
      }}
    >
      <Dialog.Trigger
        render={<Button variant="outline" size="sm" type="button" disabled={disabled || saving} />}
      >
        {count ? t("study.materials.selected", { count }) : t("study.materials.choose")}
      </Dialog.Trigger>
      {open ? (
        <MaterialDialog
          books={books}
          notes={notes}
          initial={current}
          missing={selection.bookIds.length + selection.noteIds.length - count}
          saving={saving}
          save={async (draft) => {
            setSaving(true);
            try {
              await onApply(availableTutorSelection(books, notes, draft));
              setOpen(false);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : String(error));
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}
    </Dialog>
  );
}

function MaterialDialog({
  books,
  notes,
  initial,
  missing,
  saving,
  save,
}: {
  books: Material[];
  notes: Material[];
  initial: TutorMaterialSelection;
  missing: number;
  saving: boolean;
  save: (selection: TutorMaterialSelection) => Promise<void>;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(initial);
  const search = query.trim().toLowerCase();
  const matchingBooks = books.filter(({ title }) => title.toLowerCase().includes(search));
  const matchingNotes = notes.filter(({ title }) => title.toLowerCase().includes(search));

  function choices(items: Material[], list: keyof TutorMaterialSelection, label: string) {
    if (!items.length) return null;
    return (
      <fieldset className="mt-4 space-y-0.5">
        <legend className="mb-1 text-sm font-medium text-muted-foreground">{label}</legend>
        {items.map(({ id, title }) => (
          <label
            key={id}
            className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent"
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-primary"
              disabled={saving}
              checked={draft[list].includes(id)}
              onChange={(event) => {
                const checked = event.target.checked;
                setDraft((value) => ({
                  ...value,
                  [list]: checked
                    ? [...value[list], id]
                    : value[list].filter((item) => item !== id),
                }));
              }}
            />
            <span dir="auto" className="min-w-0 wrap-break-word">
              {title}
            </span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <Dialog.Content closeLabel={common("actions.close")}>
      <Dialog.Header
        title={t("study.materials.choose")}
        description={t("study.materials.description")}
      />
      <Dialog.Body>
        <Input
          type="search"
          value={query}
          placeholder={t("study.materials.search")}
          aria-label={t("study.materials.search")}
          onChange={(event) => setQuery(event.target.value)}
        />
        {missing > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("study.materials.unavailable", { count: missing })}
          </p>
        ) : null}
        {choices(matchingBooks, "bookIds", t("study.materials.documents"))}
        {choices(matchingNotes, "noteIds", t("study.materials.notes"))}
        {!matchingBooks.length && !matchingNotes.length ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t(search ? "study.materials.noMatches" : "study.materials.empty")}
          </p>
        ) : null}
      </Dialog.Body>
      <Dialog.Footer>
        <Dialog.Close render={<Button type="button" variant="secondary" disabled={saving} />}>
          {common("actions.cancel")}
        </Dialog.Close>
        <Button type="button" disabled={saving} onClick={() => void save(draft)}>
          {t("study.materials.apply", { count: draft.bookIds.length + draft.noteIds.length })}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
