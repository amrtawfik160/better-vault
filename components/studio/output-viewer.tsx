import {
  Alert02Icon,
  ArrowLeft01Icon,
  Delete02Icon,
  Loading03Icon,
  MoreVerticalIcon,
  PencilEdit01Icon,
  RepeatIcon,
  WhiteboardIcon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Menu } from "@/components/panelui/menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { addQuizMissesToStudy, addStudioFlashcards } from "@/lib/db/study";
import { vaultOf } from "@/lib/db/vaults";
import { studyHref } from "@/lib/study/links";
import {
  saveFlashcardPractice,
  saveQuizAttempt,
  updateOutputData,
  useOutput,
} from "@/lib/db/outputs";
import { formatRelativeTime } from "@/lib/format";
import { storageIds, storages } from "@/lib/storage/catalog";
import { isStorageReady, useStorageSettings } from "@/lib/storage/settings";
import { cn } from "@/lib/utils";
import { toolClients } from "@/studio/client";
import { toolDefinitions } from "@/studio/definitions";
import { isStudioToolId, studioTools } from "@/studio/tools";
import { isFileExport } from "@/studio/types";
import type { OutputChrome } from "@/studio/shared/form";
import { DownloadMenu } from "./download-menu";
import { useStudioRunner } from "./studio-runner";
import { useExporter } from "./use-exporter";

/** Tools whose own viewer holds the primary button (Play, Start quiz, Review). */
const ownPrimary = new Set<string>(["audio-overview", "quiz", "flashcards"]);

/** One Studio output, full size in the Studio tab. */
export function OutputViewer({ id }: { id: string }) {
  const { t, i18n } = useTranslation("studio");
  const { t: tCommon } = useTranslation();
  const { notebook, closeOutput, openOutput, readSource, requestOutputAction } = useWorkspace();
  const runner = useStudioRunner();
  const navigate = useNavigate();
  const [addingCards, setAddingCards] = useState(false);
  const output = useOutput(id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveData = useCallback(
    async (data: unknown) => {
      await updateOutputData(id, data);
    },
    [id],
  );
  const [annotating, setAnnotating] = useState(false);
  const exporter = useExporter();
  const storage = useStorageSettings();
  const connected = storage ? storageIds.filter((id) => isStorageReady(storage, id)) : [];
  const gone =
    output === null ||
    (output !== undefined && (output.notebookId !== notebook.id || !isStudioToolId(output.toolId)));

  // A deleted output, here or in another tab, goes back to the list.
  useEffect(() => {
    if (gone) closeOutput();
  }, [gone, closeOutput]);

  if (!output || output.notebookId !== notebook.id || !isStudioToolId(output.toolId)) return null;

  const tool = studioTools[output.toolId];
  const client = toolClients[output.toolId];
  const definition = toolDefinitions[output.toolId];
  const parsed = output.status === "ready" ? definition?.data.safeParse(output.data) : undefined;
  const local = definition?.local !== undefined;
  const png = local
    ? undefined
    : definition?.exports?.filter(isFileExport).find((option) => option.format === "png");

  function openStudyReview(outputId: string, cardIds: string[]) {
    if (!cardIds.length) {
      toast.error(t("viewer.noStudyCards"));
      return;
    }
    const vault = vaultOf(notebook);
    void navigate(studyHref("review", { output: outputId, vault }), {
      state: { studyReviewIds: cardIds, studyReviewVault: vault },
    });
  }

  const reviewMissed =
    output.toolId === "quiz" || output.toolId === "flashcards"
      ? async (positions: readonly number[]) => {
          try {
            const quiz = output.toolId === "quiz";
            const { added, cardIds } = await (quiz
              ? addQuizMissesToStudy(output, positions)
              : addStudioFlashcards(output, positions));
            if (cardIds.length) {
              toast.success(
                added
                  ? t(quiz ? "quiz.viewer.savedMissed" : "viewer.studyCardsAdded", { count: added })
                  : t(
                      quiz
                        ? "quiz.viewer.missedAlreadySaved"
                        : "flashcards.viewer.missedAlreadySaved",
                    ),
              );
            }
            openStudyReview(output.id, cardIds);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          }
        }
      : undefined;

  // Annotate: the output's picture, locked on a new whiteboard, to draw over it.
  const annotate =
    png && parsed?.success
      ? async () => {
          if (annotating) return;
          setAnnotating(true);
          const toastId = toast.loading(t("whiteboard.annotating"));
          try {
            const [{ prepareImage, boardFromImage }, blob] = await Promise.all([
              import("@/studio/tools/whiteboard/images"),
              png.build(output.title, parsed.data, {
                question: t("export.question"),
                answer: t("export.answer"),
                answerKey: t("export.answerKey"),
                sources: t("export.sources"),
              }),
            ]);
            const data = boardFromImage(await prepareImage(blob), {
              outputId: output.id,
              toolId: output.toolId,
            });
            const id = await runner.createLocal("whiteboard", {
              title: t("whiteboard.annotateTitle", { title: output.title }),
              data,
              sourceIds: output.sourceIds,
            });
            toast.dismiss(toastId);
            openOutput(id);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error), { id: toastId });
          } finally {
            setAnnotating(false);
          }
        }
      : undefined;

  const meta = output.model
    ? t("viewer.meta", {
        sources: tCommon("sourceCount", { count: output.sourceIds.length }),
        model: output.model.modelId,
        time: formatRelativeTime(output.createdAt, i18n.language),
      })
    : t("viewer.metaLocal", { time: formatRelativeTime(output.updatedAt, i18n.language) });
  // Shown only when the viewer is: a board that can't be read keeps the header, to delete it.
  const immersive = client?.immersive === true && parsed?.success === true;

  // An immersive viewer shows the title and actions itself.
  const chrome: OutputChrome | undefined = immersive
    ? {
        icon: tool.icon,
        tint: tool.tint,
        title: output.title,
        meta,
        busy: exporter.busy,
        downloads:
          parsed?.success && definition?.exports
            ? definition.exports.map((option) => ({
                format: option.format,
                label: t(`viewer.formats.${option.format}`),
                onSelect: () => void exporter.save(output.title, parsed.data, option),
              }))
            : [],
        cloud:
          parsed?.success && definition?.exports
            ? connected.map((service) => ({
                service,
                name: storages[service].name,
                formats: definition.exports!.filter(isFileExport).map((option) => ({
                  format: option.format,
                  label: t(`viewer.formats.${option.format}`),
                  onSelect: () => void exporter.saveTo(service, output.title, parsed.data, option),
                })),
              }))
            : [],
        onRename: () => requestOutputAction({ kind: "rename", output }),
        onDelete: () => requestOutputAction({ kind: "delete", output }),
        onClose: closeOutput,
        onAnnotate: annotate && !annotating ? () => void annotate() : undefined,
      }
    : undefined;

  return (
    <ScrollArea className="h-full" viewportRef={scrollRef}>
      <div
        className={cn(
          "flex min-h-full flex-col",
          client?.bleed ? "px-3 pb-3" : "px-4 pb-6 sm:px-6",
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full flex-1 flex-col pt-2",
            client?.bleed
              ? "max-w-none"
              : client?.wideViewer
                ? "max-w-7xl"
                : client?.fill
                  ? "max-w-6xl"
                  : "max-w-4xl",
          )}
        >
          {immersive ? null : (
            <header className="mb-6 flex flex-col gap-3 border-b pb-4">
              <nav aria-label={t("frame.breadcrumb")} className="-ms-2 flex items-center">
                <Button variant="ghost" size="sm" onClick={closeOutput}>
                  <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
                  {t("viewer.back")}
                </Button>
              </nav>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
                  <Icon icon={tool.icon} size={20} className={tool.tint} />
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <h1
                    className="truncate text-xl font-semibold tracking-tight"
                    title={output.title}
                  >
                    {output.title}
                  </h1>
                  <p className="truncate text-xs text-muted-foreground">
                    {t(`tools.${output.toolId}.name`)} · {meta}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {parsed?.success && output.toolId === "flashcards" ? (
                    <Button
                      shape="pill"
                      size="sm"
                      disabled={addingCards}
                      onClick={() => {
                        setAddingCards(true);
                        void addStudioFlashcards(output)
                          .then(({ added, cardIds }) => {
                            if (added > 0)
                              toast.success(t("viewer.studyCardsAdded", { count: added }));
                            openStudyReview(output.id, cardIds);
                          })
                          .catch((error: Error) => toast.error(error.message))
                          .finally(() => setAddingCards(false));
                      }}
                    >
                      {t("viewer.addToStudy")}
                    </Button>
                  ) : null}
                  {parsed?.success && definition?.exports?.length ? (
                    <DownloadMenu
                      title={output.title}
                      data={parsed.data}
                      options={definition.exports}
                      primary={!ownPrimary.has(output.toolId)}
                    />
                  ) : null}
                  <Menu>
                    <Menu.Trigger
                      aria-label={t("viewer.actions")}
                      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon icon={MoreVerticalIcon} size={16} />
                    </Menu.Trigger>
                    <Menu.Content align="end">
                      {annotate ? (
                        <Menu.Item disabled={annotating} onClick={() => void annotate()}>
                          <Icon icon={WhiteboardIcon} />
                          {t("viewer.annotate")}
                        </Menu.Item>
                      ) : null}
                      <Menu.Item onClick={() => requestOutputAction({ kind: "rename", output })}>
                        <Icon icon={PencilEdit01Icon} />
                        {tCommon("actions.rename")}
                      </Menu.Item>
                      <Menu.Item
                        variant="destructive"
                        onClick={() => requestOutputAction({ kind: "delete", output })}
                      >
                        <Icon icon={Delete02Icon} />
                        {tCommon("actions.delete")}
                      </Menu.Item>
                    </Menu.Content>
                  </Menu>
                </div>
              </div>
            </header>
          )}

          {output.status === "generating" ? (
            <section
              aria-busy="true"
              aria-labelledby="output-generating"
              className="rounded-2xl border bg-card p-5"
            >
              <h2 id="output-generating" className="text-sm font-medium">
                {t("frame.generatingTitle", { tool: t(`tools.${output.toolId}.name`) })}
              </h2>
              <p
                role="status"
                className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Icon icon={Loading03Icon} size={16} className="shrink-0 animate-spin" />
                {t("view.generatingBody")}
              </p>
            </section>
          ) : output.status === "error" ? (
            <section role="alert" className="flex gap-3 rounded-2xl border bg-card p-4">
              <Icon icon={Alert02Icon} size={20} className="mt-0.5 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium">
                  {t("frame.failedTitle", { tool: t(`tools.${output.toolId}.name`) })}
                </h2>
                {output.error ? (
                  <p className="mt-1 text-sm text-muted-foreground">{output.error}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">{t("frame.choicesKept")}</p>
                {local ? null : (
                  <Button
                    variant="outline"
                    shape="pill"
                    size="sm"
                    className="mt-3"
                    onClick={() => void runner.retry(output)}
                  >
                    <Icon icon={RepeatIcon} size={16} />
                    {t("view.retry")}
                  </Button>
                )}
              </div>
            </section>
          ) : !parsed?.success || !client ? (
            <section role="alert" className="flex gap-3 rounded-2xl border bg-card p-4">
              <Icon icon={Alert02Icon} size={20} className="mt-0.5 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium">{t("frame.brokenTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("frame.brokenBody")}</p>
                {local ? null : (
                  <Button
                    variant="outline"
                    shape="pill"
                    size="sm"
                    className="mt-3"
                    onClick={() => void runner.retry(output)}
                  >
                    <Icon icon={RepeatIcon} size={16} />
                    {t("frame.makeAgain")}
                  </Button>
                )}
              </div>
            </section>
          ) : (
            <client.Viewer
              key={output.id}
              outputId={output.id}
              onDataChange={saveData}
              onAnnotate={annotate ? () => void annotate() : undefined}
              onReviewMissed={reviewMissed}
              quizAttempt={output.quizAttempt}
              onQuizAction={
                output.toolId === "quiz"
                  ? (revision, action) => saveQuizAttempt(output.id, revision, action)
                  : undefined
              }
              flashcardPractice={output.flashcardPractice}
              onFlashcardAction={
                output.toolId === "flashcards"
                  ? (revision, action) => saveFlashcardPractice(output.id, revision, action)
                  : undefined
              }
              chrome={chrome}
              title={output.title}
              data={parsed.data}
              scrollRef={scrollRef}
              onOpenPassage={(passage) =>
                readSource(passage.sourceId, passage.chunkId, passage.snippet)
              }
            />
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
