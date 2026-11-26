import {
  Add01Icon,
  ArrowLeft01Icon,
  Delete02Icon,
  Download04Icon,
  FileImportIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Field } from "@/components/common/field";
import { Icon } from "@/components/icon";
import { NoteEditor } from "@/components/notes/editor/note-editor";
import { ToolHeader, useScopeName } from "@/components/common/tool-header";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { Textarea } from "@/components/panelui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createSkill, deleteSkill, saveSkill, useSkills } from "@/lib/db/skills";
import type { Skill } from "@/lib/db/types";
import { useCurrentVault, useVaults } from "@/lib/db/vaults";
import { downloadText, formatRelativeTime } from "@/lib/format";
import { parseSkillFile, skillSlug, toSkillFile } from "@/lib/skills/format";
import { cn } from "@/lib/utils";

const noCompletion = () => ({ notes: [], notebooks: [], sources: [], tags: [] });

/**
 * The vault's skills: SKILL.md files of instructions that chats can use and
 * AI agents read and edit through the desktop app's MCP server. Each has a
 * name, a description saying when to use it, and its instructions.
 */
export default function SkillsWorkspace() {
  const { t, i18n } = useTranslation("notes");
  const vaults = useVaults();
  const vaultId = useCurrentVault(vaults);
  const skills = useSkills();
  const scope = useScopeName();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  const mine = useMemo(
    () => (skills ?? []).filter((skill) => skill.vaultId === vaultId),
    [skills, vaultId],
  );
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return mine.filter((skill) => {
      const text = `${skill.name} ${skill.description} ${skill.body}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [mine, query]);
  const active = mine.find((skill) => skill.id === activeId) ?? null;

  const create = async () => {
    const skill = await createSkill(vaultId, { name: "new-skill", description: "", body: "" });
    setActiveId(skill.id);
  };

  const importFiles = async (files: File[]) => {
    let first: string | null = null;
    for (const file of files) {
      const fallback = skillSlug(
        file.name.replace(/\.(md|markdown)$/i, "").replace(/^SKILL$/i, "skill"),
      );
      const skill = await createSkill(vaultId, parseSkillFile(await file.text(), fallback));
      first ??= skill.id;
    }
    toast.success(t("actions.imported", { count: files.length }));
    if (first) setActiveId(first);
  };

  if (!skills) return null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card md:rounded-xl md:border">
      <ToolHeader title={t("skillsTitle")} detail={t("skills.scope", { vault: scope })}>
        {/* Import stays even in a vault with no skills yet: it is how existing SKILL.md files come in. */}
        {skills ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => importInput.current?.click()}
            className="text-muted-foreground"
          >
            <Icon icon={FileImportIcon} size={16} />
            <span className="max-sm:sr-only">{t("skills.import")}</span>
          </Button>
        ) : null}
        {/* In a vault with no skills, the empty state's New skill is the one filled button. */}
        {mine.length ? (
          <Button type="button" size="sm" onClick={() => void create()}>
            <Icon icon={Add01Icon} size={16} />
            <span className="max-sm:sr-only">{t("skills.new")}</span>
          </Button>
        ) : null}
      </ToolHeader>
      <div className="flex min-h-0 flex-1">
        {/* The vault's skills, and the one open. */}
        {/* On phones the list and the open skill take turns; wider, they sit side by side. */}
        <div
          className={cn(
            "w-full shrink-0 flex-col overflow-hidden md:flex md:w-72 md:border-e",
            active || !mine.length ? "hidden" : "flex",
          )}
        >
          <div className="px-3 pt-3 pb-2">
            <Input.Group size="sm">
              <Input.Addon>
                <Icon icon={Search01Icon} size={14} />
              </Input.Addon>
              <Input
                size="sm"
                type="search"
                aria-label={t("skills.search")}
                placeholder={t("skills.search")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </Input.Group>
            <input
              ref={importInput}
              type="file"
              multiple
              accept=".md,.markdown,text/markdown"
              className="hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                if (files.length) void importFiles(files);
              }}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <nav aria-label={t("skillsTitle")} className="flex flex-col gap-0.5 px-2 py-3">
              {shown.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  aria-current={skill.id === activeId ? "page" : undefined}
                  onClick={() => setActiveId(skill.id)}
                  className={cn(
                    "flex w-full min-w-0 cursor-pointer flex-col rounded-md px-2 py-1.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    skill.id === activeId
                      ? "bg-muted shadow-[inset_0_0_0_1px_var(--color-border)]"
                      : "hover:bg-accent/60",
                  )}
                >
                  <span className="truncate font-mono text-[0.8125rem]">{skill.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {skill.description ||
                      t("skills.updatedBy", {
                        who: skill.updatedBy === "you" ? t("skills.you") : skill.updatedBy,
                        time: formatRelativeTime(skill.updatedAt, i18n.language),
                      })}
                  </span>
                </button>
              ))}
            </nav>
          </ScrollArea>
        </div>

        <div
          className={cn(
            "min-w-0 flex-1 flex-col overflow-hidden md:flex",
            active || !mine.length ? "flex" : "hidden",
          )}
        >
          {active ? (
            <SkillEditor
              key={active.id}
              skill={active}
              onBack={() => setActiveId(null)}
              onDeleted={() => setActiveId(null)}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-5 py-12">
              <section aria-labelledby="skills-empty" className="w-full max-w-[27.5rem]">
                <h2 id="skills-empty" className="text-sm leading-5 font-medium">
                  {mine.length ? t("skills.choose") : t("skills.empty")}
                </h2>
                <p className="mt-1 text-[0.8125rem] leading-5 text-pretty text-muted-foreground">
                  {mine.length ? t("skills.chooseBody") : t("skills.emptyBody")}
                </p>
                {mine.length ? null : (
                  <Button type="button" className="mt-5" size="sm" onClick={() => void create()}>
                    <Icon icon={Add01Icon} size={16} />
                    {t("skills.new")}
                  </Button>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillEditor({
  skill,
  onBack,
  onDeleted,
}: {
  skill: Skill;
  /** Back to the list, on phones where the two take turns. */
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { t, i18n } = useTranslation("notes");
  const nameId = useId();
  const descriptionId = useId();
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [deleting, setDeleting] = useState(false);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) void saveSkill(skill.id, { body: pending.current });
    pending.current = null;
  }, [skill.id]);
  useEffect(() => flush, [flush]);

  const commitName = async () => {
    const wanted = skillSlug(name);
    if (wanted === skill.name) return setName(skill.name);
    setName((await saveSkill(skill.id, { name: wanted })) ?? skill.name);
  };

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex max-w-[46rem] flex-col gap-4 px-6 pt-6 pb-24 max-md:px-4 max-md:pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ms-2 self-start text-muted-foreground max-md:h-11 md:hidden"
        >
          <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
          {t("skillsTitle")}
        </Button>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Field label={t("skills.name")} htmlFor={nameId} hint={t("skills.nameHint")}>
              <Input
                id={nameId}
                value={name}
                className="font-mono"
                onChange={(event) => setName(event.target.value)}
                onBlur={() => void commitName()}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              />
            </Field>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              downloadText(
                toSkillFile({ ...skill, name, description }),
                "SKILL.md",
                "text/markdown",
              )
            }
            aria-label={t("skills.export")}
            title={t("skills.export")}
            className="mt-7 text-muted-foreground"
          >
            <Icon icon={Download04Icon} size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleting(true)}
            aria-label={t("skills.delete.confirm")}
            title={t("skills.delete.confirm")}
            className="mt-7 text-muted-foreground hover:not-disabled:text-destructive"
          >
            <Icon icon={Delete02Icon} size={16} />
          </Button>
        </div>
        <Field
          label={t("skills.description")}
          htmlFor={descriptionId}
          hint={t("skills.descriptionHint")}
        >
          <Textarea
            id={descriptionId}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() =>
              description !== skill.description && void saveSkill(skill.id, { description })
            }
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("skills.body")}</span>
          <div className="min-h-80 rounded-xl border">
            <NoteEditor
              docId={skill.id}
              value={skill.body}
              label={t("skills.body")}
              world={noCompletion}
              resolves={() => false}
              onOpenLink={() => {}}
              onChange={(text) => {
                pending.current = text;
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(flush, 400);
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("skills.updatedBy", {
              who: skill.updatedBy === "you" ? t("skills.you") : skill.updatedBy,
              time: formatRelativeTime(skill.updatedAt, i18n.language),
            })}
          </p>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("skills.delete.title", { name: skill.name })}
        body={t("skills.delete.body")}
        confirmLabel={t("skills.delete.confirm")}
        onConfirm={async () => {
          await deleteSkill(skill.id);
          onDeleted();
        }}
      />
    </ScrollArea>
  );
}
