import { Alert02Icon, Loading03Icon, Tick02Icon, Undo02Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { useStudioRunner } from "@/components/studio/studio-runner";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  ADD_CARDS,
  chatMakeTools,
  type ChatActionOutput,
  type ChatActionPart,
  type ChatMakeTool,
} from "@/lib/chat/actions";
import { useOutput } from "@/lib/db/outputs";
import { useSettings } from "@/lib/db/settings";
import { useSources } from "@/lib/db/sources";
import { selectedTextSource } from "@/lib/db/source-text";
import { providers } from "@/lib/ai/catalog";
import { studyHref } from "@/lib/study/links";
import { studioTools } from "@/studio/tools";
import { getToolName } from "ai";
import { pickImageModel } from "./chat-actions";
import { useChatSession } from "./chat-provider";

const isMakeTool = (tool: unknown): tool is ChatMakeTool =>
  (chatMakeTools as readonly unknown[]).includes(tool);

/**
 * What one of the chat's actions made, in the thread: a result row with Open
 * and Undo, a confirm card for slow or paid work, or what went wrong.
 */
export function ActionRow({ part, live }: { part: ChatActionPart; live: boolean }) {
  const chat = useChatSession();
  const name = getToolName(part);
  const running = chat.runningActions.has(part.toolCallId);
  const output = part.state === "output-available" ? (part.output as ChatActionOutput) : undefined;
  const input = part.input as { tool?: unknown } | undefined;
  const tool = name === ADD_CARDS ? null : isMakeTool(input?.tool) ? input.tool : null;

  if (name !== ADD_CARDS && !tool) return null;
  if (part.state === "input-streaming" || running) return <Working tool={tool} />;
  if (!output) {
    if (tool === "infographic" || tool === "audio-overview")
      return <ConfirmCard tool={tool} toolCallId={part.toolCallId} />;
    // A call the page is about to run, or one left behind when the page closed.
    if (live && chat.status === "streaming") return <Working tool={tool} />;
    return <Stopped toolCallId={part.toolCallId} />;
  }
  if ("error" in output)
    return <Failed toolCallId={part.toolCallId} error={output.error} live={live} />;
  if ("cancelled" in output) return <ClosedNote kind="cancelled" tool={tool} />;
  if ("dialog" in output) return <ClosedNote kind="opened" tool={tool} />;
  if ("cardIds" in output)
    return (
      <CardsRow
        toolCallId={part.toolCallId}
        added={output.added}
        undone={output.undone}
        live={live}
      />
    );
  return (
    <OutputRow
      toolCallId={part.toolCallId}
      outputId={output.outputId}
      tool={output.tool}
      undone={output.undone}
      live={live}
    />
  );
}

function ClosedNote({ kind, tool }: { kind: "cancelled" | "opened"; tool: ChatMakeTool | null }) {
  const { t } = useTranslation("chat");
  const toolName = tool ? t(`make.commands.${tool}.name`) : "";
  return <Note>{t(`make.confirm.${kind}`, { tool: toolName })}</Note>;
}

/** The row's frame: 44px, a hairline, the mark at the start and the actions at the end. */
function Row({
  mark,
  children,
  actions,
  live,
  tone = "default",
}: {
  mark: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  live?: boolean;
  tone?: "default" | "destructive";
}) {
  return (
    <div
      role={live ? (tone === "destructive" ? "alert" : "status") : undefined}
      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-foreground/[0.02] py-1.5 ps-3 pe-1.5 text-[0.8125rem] leading-5"
    >
      {mark}
      <p className="line-clamp-2 min-w-0 flex-1 text-muted-foreground">{children}</p>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

const Done = () => (
  <span
    aria-hidden
    className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
  >
    <Icon icon={Tick02Icon} size={12} strokeWidth={2.5} />
  </span>
);

const Spinner = () => (
  <Icon icon={Loading03Icon} size={16} className="shrink-0 animate-spin text-muted-foreground" />
);

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[0.8125rem] leading-5 text-muted-foreground">{children}</p>;
}

function Working({ tool }: { tool: ChatMakeTool | null }) {
  const { t } = useTranslation("chat");
  return (
    <Row mark={<Spinner />}>
      {tool
        ? t("make.output.starting", { tool: t(`make.commands.${tool}.name`) })
        : t("make.cards.writing")}
    </Row>
  );
}

function UndoButton({ toolCallId }: { toolCallId: string }) {
  const { t } = useTranslation("chat");
  const chat = useChatSession();
  return (
    <Button variant="ghost" size="sm" onClick={() => chat.undoAction(toolCallId)}>
      <Icon icon={Undo02Icon} size={14} />
      {t("make.undo")}
    </Button>
  );
}

function CardsRow({
  toolCallId,
  added,
  undone,
  live,
}: {
  toolCallId: string;
  added: number;
  undone?: boolean;
  live: boolean;
}) {
  const { t } = useTranslation("chat");
  const navigate = useNavigate();
  const { notebook } = useWorkspace();
  if (undone) return <Note>{t("make.cards.removed", { count: added })}</Note>;
  return (
    <Row
      live={live}
      mark={<Done />}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigate(studyHref("cards", { notebook: notebook.id }))}
          >
            {t("make.open")}
          </Button>
          <UndoButton toolCallId={toolCallId} />
        </>
      }
    >
      <strong className="font-medium text-foreground">
        {t("make.cards.count", { count: added })}
      </strong>{" "}
      {t("make.cards.addedTo", { notebook: notebook.title })}
    </Row>
  );
}

function OutputRow({
  toolCallId,
  outputId,
  tool,
  undone,
  live,
}: {
  toolCallId: string;
  outputId: string;
  tool: ChatMakeTool;
  undone?: boolean;
  live: boolean;
}) {
  const { t } = useTranslation("chat");
  const { openOutput } = useWorkspace();
  const runner = useStudioRunner();
  const output = useOutput(undone ? null : outputId);
  const toolName = t(`make.commands.${tool}.name`);
  if (undone) return <Note>{t("make.output.removed", { tool: toolName })}</Note>;
  if (output === undefined)
    return <Row mark={<Spinner />}>{t("make.output.starting", { tool: toolName })}</Row>;
  if (output === null) return <Note>{t("make.output.gone", { tool: toolName })}</Note>;
  const icon = studioTools[tool].icon;
  if (output.status === "error")
    return (
      <Row
        live={live}
        tone="destructive"
        mark={<Icon icon={Alert02Icon} size={16} className="shrink-0 text-destructive" />}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void runner.retry(output)}>
              {t("make.retry")}
            </Button>
            <UndoButton toolCallId={toolCallId} />
          </>
        }
      >
        <strong className="font-medium text-foreground">{toolName}</strong>{" "}
        {t("make.output.failed", { error: output.error ?? "" })}
      </Row>
    );
  const ready = output.status === "ready";
  return (
    <Row
      live={live}
      mark={ready ? <Done /> : <Spinner />}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => openOutput(outputId)}>
            <Icon icon={icon} size={14} />
            {t("make.open")}
          </Button>
          <UndoButton toolCallId={toolCallId} />
        </>
      }
    >
      <strong className="font-medium text-foreground">{ready ? output.title : toolName}</strong>{" "}
      {t(ready ? "make.output.ready" : "make.output.making")}
    </Row>
  );
}

function Failed({ toolCallId, error, live }: { toolCallId: string; error: string; live: boolean }) {
  const { t } = useTranslation("chat");
  const chat = useChatSession();
  return (
    <Row
      live={live}
      tone="destructive"
      mark={<Icon icon={Alert02Icon} size={16} className="shrink-0 text-destructive" />}
      actions={
        <Button variant="ghost" size="sm" onClick={() => chat.runAction(toolCallId)}>
          {t("make.retry")}
        </Button>
      }
    >
      {error}
    </Row>
  );
}

/** A call left without a result: the page closed while it ran. */
function Stopped({ toolCallId }: { toolCallId: string }) {
  const { t } = useTranslation("chat");
  const chat = useChatSession();
  return (
    <Row
      mark={<Icon icon={Alert02Icon} size={16} className="shrink-0 text-muted-foreground" />}
      actions={
        <Button variant="ghost" size="sm" onClick={() => chat.runAction(toolCallId)}>
          {t("make.retry")}
        </Button>
      }
    >
      {t("make.stopped")}
    </Row>
  );
}

/** Slow or paid work states what it will use before anything runs. */
function ConfirmCard({
  tool,
  toolCallId,
}: {
  tool: "infographic" | "audio-overview";
  toolCallId: string;
}) {
  const { t } = useTranslation("chat");
  const chat = useChatSession();
  const { notebook } = useWorkspace();
  const settings = useSettings();
  const sources = useSources(notebook.id)?.filter(selectedTextSource).length ?? 0;
  const toolName = t(`make.commands.${tool}.name`);
  const imageModel = settings ? pickImageModel(settings) : undefined;
  const cost =
    tool === "audio-overview"
      ? t("make.confirm.audioCost")
      : imageModel
        ? t("make.confirm.imageCost", { provider: providers[imageModel.provider].name })
        : t("make.errors.noImageModel");
  return (
    <section
      aria-labelledby={`${toolCallId}-title`}
      className="flex flex-col gap-3 rounded-xl border bg-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${toolCallId}-title`} className="text-sm font-medium">
          {t("make.confirm.title", { tool: toolName })}
        </h3>
        <p className="text-[0.8125rem] leading-5 text-muted-foreground tabular-nums">
          {t("make.confirm.from", { count: sources })} · {cost}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={sources === 0 || (tool === "infographic" && !imageModel)}
          onClick={() => chat.runAction(toolCallId)}
        >
          {t(tool === "audio-overview" ? "make.confirm.chooseVoices" : "make.confirm.make")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => chat.cancelAction(toolCallId)}>
          {t("make.confirm.cancel")}
        </Button>
      </div>
    </section>
  );
}
