import {
  Add01Icon,
  Book02Icon,
  PencilEdit02Icon,
  FileAddIcon,
  Cancel01Icon,
  Cards01Icon,
  MagicWand01Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Segmented } from "@/components/common/segmented";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Menu } from "@/components/panelui/menu";
import { AIModelPicker } from "@/components/ai/ai-model-picker";
import { Prompt, type PromptState } from "@/components/panelui/prompt";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { providers } from "@/lib/ai/catalog";
import { parseSlash, slashCommands } from "@/lib/chat/actions";
import { useStudioSettings } from "@/lib/studio/settings";
import { studioTools } from "@/studio/tools";
import type { ChatMode } from "@/lib/chat/types";
import { availableModels, modelFor, useSettings } from "@/lib/db/settings";
import { useSources } from "@/lib/db/sources";
import { selectedTextSource } from "@/lib/db/source-text";
import { useSkills } from "@/lib/db/skills";
import { useNavigate } from "react-router";
import { useChatSession } from "./chat-provider";
import { PromptQuote } from "./quote";
import { UsageRing } from "./usage-ring";

/** The prompt at the bottom of the notebook: question, mode, model and send. */
export function PromptBar() {
  const { t } = useTranslation("chat");
  const { t: tCommon } = useTranslation();
  const { notebook, setTab, openModelSetup, setAddSourceOpen } = useWorkspace();
  const chat = useChatSession();
  const navigate = useNavigate();
  const allSkills = useSkills();
  const vaultSkills = (allSkills ?? []).filter(
    (skill) => skill.vaultId === (notebook.vaultId ?? "default"),
  );
  const attachedSkills = chat.skills.filter((id) =>
    vaultSkills.some((skill) => skill.id === id),
  ).length;
  const settings = useSettings();
  const studio = useStudioSettings();
  const sources = useSources(notebook.id);
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLDivElement>(null);

  // A passage chosen to ask about is asked about next.
  useEffect(() => {
    if (chat.quote) field.current?.querySelector("textarea")?.focus();
  }, [chat.quote]);
  // Set while a send is refused, so the prompt does not clear what was written.
  const keepDraft = useRef(false);

  const models = settings ? availableModels(settings) : [];
  const model = settings ? (modelFor(settings, "chat")?.model ?? null) : null;
  const webAvailable = model ? providers[model.provider].webSearch : false;
  const mode: ChatMode = chat.mode === "web" && webAvailable ? "web" : "sources";
  const selected = sources?.filter(selectedTextSource).length ?? 0;
  const needsSource = mode === "sources" && selected === 0;
  const status: PromptState = chat.status === "ready" ? "idle" : chat.status;
  const busy = chat.status === "submitted" || chat.status === "streaming";

  // "/" lists what the chat can make; tools turned off in Settings → Studio are left out.
  const commands = slashCommands
    .filter((command) => command.action === "add_cards" || !studio?.hidden.includes(command.tool))
    .map((command) => ({
      value: command.id,
      description: `${t(`make.commands.${command.id}.name`)} · ${t(`make.commands.${command.id}.detail`)}`,
      icon: (
        <Icon
          icon={command.action === "add_cards" ? Cards01Icon : studioTools[command.tool].icon}
          size={16}
          className={command.action === "add_cards" ? "text-chart-4" : studioTools[command.tool].tint}
        />
      ),
    }));

  /** Runs a "/" command; false when the text is a question. */
  function runCommand(text: string): boolean {
    if (!parseSlash(text)) return false;
    if (needsSource) {
      keepDraft.current = true;
      toast(t(webAvailable ? "noSources" : "noSourcesLocal"));
      return true;
    }
    setTab("chat");
    chat.runCommand(text);
    return true;
  }

  return (
    // Below the conversation in the companion, not over it, so the last answer is never hidden.
    <div className="pointer-events-none shrink-0 px-3 pt-1 pb-3">
      <div ref={field} className="pointer-events-auto mx-auto w-full max-w-3xl">
        <Prompt
          value={draft}
          onValueChange={(next) => {
            if (keepDraft.current) {
              keepDraft.current = false;
              return;
            }
            setDraft(next);
          }}
          status={status}
          disabled={!model}
          onStop={chat.stop}
          onSubmit={({ text }) => {
            if (runCommand(text)) return;
            if (needsSource) {
              keepDraft.current = true;
              toast(t(webAvailable ? "noSources" : "noSourcesLocal"));
              return;
            }
            setTab("chat");
            chat.send(text).catch((error: unknown) => {
              toast.error(
                t("error", { error: error instanceof Error ? error.message : String(error) }),
              );
            });
          }}
        >
          <Prompt.Commands
            items={commands}
            label={t("make.menu.label")}
            onSelect={(item) => {
              if (busy) {
                toast(t("make.menu.busy"));
                return;
              }
              runCommand(`/${item.value}`);
            }}
          />
          <Prompt.Banner open={settings !== undefined && !model}>
            {t(models.length > 0 ? "setup.choose" : "setup.banner")}
            <Prompt.BannerAction onClick={openModelSetup}>{t("setup.action")}</Prompt.BannerAction>
          </Prompt.Banner>
          <Prompt.Field>
            {chat.quote ? <PromptQuote quote={chat.quote} clear={() => chat.setQuote(undefined)} /> : null}
            <Prompt.Textarea
              placeholder={chat.quote ? t("placeholderQuote") : t(`placeholder.${mode}`)}
              aria-label={t(`placeholder.${mode}`)}
            />
            <Prompt.Footer>
              <Prompt.Tools>
                <Prompt.Menu label={t("menu")} icon={<Icon icon={Add01Icon} />}>
                  <Menu.Item onClick={() => setAddSourceOpen(true)}>
                    <Icon icon={FileAddIcon} />
                    {t("addSource")}
                  </Menu.Item>
                  <Menu.Item disabled={chat.messages.length === 0} onClick={() => chat.startNew()}>
                    <Icon icon={PencilEdit02Icon} />
                    {t("newChat")}
                  </Menu.Item>
                  <Menu.Sub>
                    <Menu.SubTrigger>
                      <Icon icon={MagicWand01Icon} />
                      {t("skills.menu")}
                    </Menu.SubTrigger>
                    <Menu.SubContent>
                      {vaultSkills.length === 0 ? (
                        <Menu.Item disabled>{t("skills.none")}</Menu.Item>
                      ) : (
                        vaultSkills.map((skill) => (
                          <Menu.CheckboxItem
                            key={skill.id}
                            checked={chat.skills.includes(skill.id)}
                            onCheckedChange={(on) =>
                              chat.setSkills(
                                on
                                  ? [...chat.skills, skill.id]
                                  : chat.skills.filter((id) => id !== skill.id),
                              )
                            }
                          >
                            <span className="font-mono text-xs">{skill.name}</span>
                          </Menu.CheckboxItem>
                        ))
                      )}
                      <Menu.Separator />
                      <Menu.Item onClick={() => navigate("/?view=skills")}>
                        {t("skills.manage")}
                      </Menu.Item>
                    </Menu.SubContent>
                  </Menu.Sub>
                </Prompt.Menu>
                {attachedSkills > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    shape="pill"
                    onClick={() => chat.setSkills([])}
                    title={t("skills.clear")}
                    aria-label={`${t("skills.attached", { count: attachedSkills })}. ${t("skills.clear")}`}
                    className="h-7 gap-1 bg-primary/10 px-2 text-xs text-primary hover:not-disabled:bg-primary/20 hover:not-disabled:text-primary"
                  >
                    <Icon icon={MagicWand01Icon} size={12} />
                    {t("skills.attached", { count: attachedSkills })}
                    <Icon icon={Cancel01Icon} size={11} />
                  </Button>
                ) : null}
                {/* Labels without icons, so More, the mode and the model share one row in the companion. */}
                <Segmented<ChatMode>
                  size="sm"
                  aria-label={t("mode.label")}
                  value={mode}
                  onValueChange={chat.setMode}
                  options={[
                    {
                      value: "sources",
                      label: t("mode.sources"),
                      title: t("mode.sourcesHint"),
                    },
                    {
                      value: "web",
                      label: t("mode.web"),
                      disabled: !webAvailable,
                      title:
                        !webAvailable && model
                          ? t("mode.webUnavailable", { name: providers[model.provider].name })
                          : t("mode.webHint"),
                    },
                  ]}
                />
                <AIModelPicker use="chat" className="max-w-36" />
              </Prompt.Tools>
              <Prompt.Submit sendLabel={t("send")} stopLabel={t("stop")} />
            </Prompt.Footer>
          </Prompt.Field>
          <Prompt.Context
            open={
              (sources !== undefined && sources.length > 0 && mode === "sources") || model !== null
            }
          >
            {mode === "sources" && sources && sources.length > 0 ? (
              <Prompt.ContextItem onSelect={() => setTab("sources")}>
                <Icon icon={Book02Icon} size={14} />
                {tCommon("sourceCount", { count: selected })}
              </Prompt.ContextItem>
            ) : null}
            {model && settings ? (
              <span className="ms-auto flex items-center gap-3">
                <UsageRing
                  messages={chat.messages}
                  settings={settings}
                  model={model}
                  busy={chat.status === "streaming" || chat.status === "submitted"}
                />
              </span>
            ) : null}
          </Prompt.Context>
        </Prompt>
      </div>
    </div>
  );
}
