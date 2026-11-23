import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/common/field";
import { Select } from "@/components/panelui/select";
import { useNotebooks } from "@/lib/db/notebooks";
import { vaultOf } from "@/lib/db/vaults";

/** "" stands for a new notebook named after the document. */
export type StudyNotebookChoice = string;

/** The notebook a choice names, or `undefined` for a new one: what `addStudyBook` takes. */
export const chosenNotebook = (choice: StudyNotebookChoice) => choice || undefined;

/**
 * "Which notebook?": where a document added to Study goes. A new notebook,
 * named after the document, or one of the vault's notebooks, where it becomes
 * one more source.
 */
export function StudyNotebookField({
  vaultId,
  value,
  onChange,
  disabled,
  several = false,
}: {
  vaultId: string;
  value: StudyNotebookChoice;
  onChange: (value: StudyNotebookChoice) => void;
  disabled?: boolean;
  /** Several files at once: each new notebook is named after its own file. */
  several?: boolean;
}) {
  const { t } = useTranslation("home");
  const id = useId();
  const all = useNotebooks();
  const notebooks = useMemo(
    () => (all ?? []).filter((notebook) => vaultOf(notebook) === vaultId),
    [all, vaultId],
  );
  // A notebook removed while the dialog is open falls back to a new one.
  const shown = value && notebooks.some((notebook) => notebook.id === value) ? value : "";
  const chosen = notebooks.find((notebook) => notebook.id === shown);
  const items = [
    { value: "", label: t("study.library.notebook.new") },
    ...notebooks.map(({ id, title }) => ({ value: id, label: title })),
  ];
  return (
    <Field
      label={t("study.library.notebook.label")}
      htmlFor={id}
      hint={
        chosen
          ? t("study.library.notebook.existingHint", { notebook: chosen.title })
          : t(several ? "study.library.notebook.newHintSeveral" : "study.library.notebook.newHint")
      }
    >
      <Select
        items={items}
        value={shown}
        disabled={disabled}
        onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
      >
        <Select.Trigger id={id}>
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          {items.map((item) => (
            <Select.Item key={item.value} value={item.value}>
              <span dir="auto">{item.label}</span>
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
    </Field>
  );
}
