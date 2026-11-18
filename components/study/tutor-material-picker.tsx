import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";

const groups = [
  ["bookIds", "study.materials.documents"],
  ["sourceIds", "study.materials.sources"],
  ["noteIds", "study.materials.notes"],
  ["cardIds", "study.materials.cards"],
] as const;
type Group = (typeof groups)[number][0];
export type TutorMaterial = { id: string; title: string; detail?: string };
export type TutorMaterialOptions = Record<Group, readonly TutorMaterial[]>;
export type TutorMaterialSelection = Record<Group, string[]>;
export const emptyTutorSelection: TutorMaterialSelection = {
  bookIds: [],
  sourceIds: [],
  noteIds: [],
  cardIds: [],
};

type Props = {
  options: TutorMaterialOptions;
  selection: TutorMaterialSelection;
  disabled?: boolean;
  flashcards?: boolean;
  onApply: (selection: TutorMaterialSelection) => void | Promise<void>;
};

export function availableTutorSelection(
  options: TutorMaterialOptions,
  selection: TutorMaterialSelection,
) {
  const available = (key: Group) => {
    const visible = new Set(options[key].map(({ id }) => id));
    return [...new Set(selection[key])].filter((id) => visible.has(id));
  };
  return {
    bookIds: available("bookIds"),
    sourceIds: available("sourceIds"),
    noteIds: available("noteIds"),
    cardIds: available("cardIds"),
  };
}

export function tutorSelectionCount(selection: TutorMaterialSelection) {
  return groups.reduce((count, [key]) => count + selection[key].length, 0);
}

export function TutorMaterialPicker({ options, selection, disabled, flashcards, onApply }: Props) {
  const { t } = useTranslation("home");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = availableTutorSelection(options, selection);
  const count = tutorSelectionCount(current);

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
        {count
          ? t("study.materials.selected", { count })
          : t(flashcards ? "study.materials.chooseCards" : "study.materials.choose")}
      </Dialog.Trigger>
      {open ? (
        <MaterialDialog
          options={options}
          initial={current}
          missing={tutorSelectionCount(selection) - count}
          flashcards={flashcards}
          saving={saving}
          save={async (draft) => {
            setSaving(true);
            try {
              await onApply(availableTutorSelection(options, draft));
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
  options,
  initial,
  missing,
  flashcards,
  saving,
  save,
}: {
  options: TutorMaterialOptions;
  initial: TutorMaterialSelection;
  missing: number;
  flashcards?: boolean;
  saving: boolean;
  save: (selection: TutorMaterialSelection) => Promise<void>;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(initial);
  const search = query.trim().toLowerCase();
  const matches = groups.map(([key, label]) => ({
    key,
    label,
    items: options[key].filter(({ title, detail }) =>
      `${title} ${detail ?? ""}`.toLowerCase().includes(search),
    ),
  }));

  function choices(items: readonly TutorMaterial[], list: Group, label: string) {
    if (!items.length) return null;
    return (
      <fieldset key={list} className="mt-4 space-y-0.5">
        <legend className="mb-1 text-sm font-medium text-muted-foreground">{label}</legend>
        {items.map(({ id, title, detail }) => (
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
              {detail ? (
                <span dir="auto" className="block text-xs text-muted-foreground">
                  {detail}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <Dialog.Content closeLabel={common("actions.close")}>
      <Dialog.Header
        title={t(flashcards ? "study.materials.chooseCards" : "study.materials.choose")}
        description={t(flashcards ? "study.materials.cardDescription" : "study.materials.description")}
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
        {matches.map(({ key, label, items }) => choices(items, key, t(label)))}
        {matches.every(({ items }) => !items.length) ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t(search ? "study.materials.noMatches" : flashcards ? "study.materials.noCards" : "study.materials.empty")}
          </p>
        ) : null}
      </Dialog.Body>
      <Dialog.Footer>
        <Dialog.Close render={<Button type="button" variant="secondary" disabled={saving} />}>
          {common("actions.cancel")}
        </Dialog.Close>
        <Button type="button" disabled={saving} onClick={() => void save(draft)}>
          {t("study.materials.apply", { count: tutorSelectionCount(draft) })}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
