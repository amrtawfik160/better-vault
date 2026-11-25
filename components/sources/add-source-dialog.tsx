import {
  Add01Icon,
  AlertCircleIcon,
  CloudServerIcon,
  CloudUploadIcon,
  Link01Icon,
  Loading03Icon,
  PodcastIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import {
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { Textarea } from "@/components/panelui/textarea";
import { createNotebook, useNotebooks } from "@/lib/db/notebooks";
import { vaultOf } from "@/lib/db/vaults";
import {
  ACCEPTED_FILES,
  IngestError,
  SOURCE_EXTENSIONS,
  ingestFile,
  ingestText,
  ingestUrl,
  type VideoInfo,
} from "@/lib/sources/ingest";
import { youtubeVideoId } from "@/lib/sources/youtube";
import { CloudBrowser } from "@/components/storage/cloud-browser";
import { storageIds } from "@/lib/storage/catalog";
import { storageClient } from "@/lib/storage/clients";
import { googlePicker } from "@/lib/storage/clients/google-drive";
import { isStorageReady, useStorageSettings } from "@/lib/storage/settings";
import { cn } from "@/lib/utils";
import {
  TranscriptFields,
  emptyTranscriptDraft,
  transcriptDraftDocument,
  transcriptDraftLink,
  transcriptDraftReady,
} from "./transcript-fields";
import { YouTubeGeminiCard } from "./youtube-gemini-card";

type Mode = "main" | "cloud" | "media";

/** Notebooks offered as chips: the open one first, then the most recent. */
const MAX_CHIPS = 5;
const WEB_ADDRESS = /^https?:\/\/\S+$/i;

interface AddSourceDialogProps {
  notebookId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** One box for a link, files or pasted text, and the notebook it goes to. */
export function AddSourceDialog({ notebookId, open, onOpenChange }: AddSourceDialogProps) {
  const { t } = useTranslation("sources");
  const { t: tCommon } = useTranslation();
  // Google's Picker opens over the dialog, outside it: a press or Escape there must not close it.
  const picking = useSyncExternalStore(googlePicker.subscribe, googlePicker.isOpen, () => false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next || !googlePicker.isOpen() ? onOpenChange(next) : undefined)}
      dismissible={!picking}
      modal={!picking}
    >
      <Dialog.Content size="lg" closeLabel={tCommon("actions.close")}>
        <Dialog.Header title={t("addDialog.title")} description={t("addDialog.description")} />
        <AddSourceForm notebookId={notebookId} onDone={() => onOpenChange(false)} />
      </Dialog.Content>
    </Dialog>
  );
}

function AddSourceForm({ notebookId, onDone }: { notebookId: string; onDone: () => void }) {
  const { t } = useTranslation("sources");
  const { t: tCommon } = useTranslation();
  const formId = useId();
  const sourceId = useId();
  const whereId = useId();
  const whyId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<Mode>("main");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState(notebookId);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // A link that could not be read: why, and what to do instead.
  const [linkFailure, setLinkFailure] = useState<{ host: string; reason: string }>();
  const [transcript, setTranscript] = useState(emptyTranscriptDraft);
  const [transcribing, setTranscribing] = useState(false);
  // A YouTube video without captions: Gemini can write its transcript instead.
  const [uncaptioned, setUncaptioned] = useState<VideoInfo>();
  const [geminiBusy, setGeminiBusy] = useState(false);
  const notebooks = useNotebooks();
  // "From storage" appears once a storage service is connected (Settings → Storage).
  const storage = useStorageSettings();
  const hasStorage = storage ? storageIds.some((id) => isStorageReady(storage, id)) : false;

  const trimmed = source.trim();
  const kind =
    trimmed === ""
      ? "empty"
      : WEB_ADDRESS.test(trimmed)
        ? youtubeVideoId(trimmed)
          ? "video"
          : "link"
        : "text";
  const choices = useMemo(() => {
    const current = notebooks?.find((notebook) => notebook.id === notebookId);
    const sameVault = (notebooks ?? []).filter(
      (notebook) => !current || vaultOf(notebook) === vaultOf(current),
    );
    const others = sameVault.filter((notebook) => notebook.id !== notebookId);
    const picked = others.find((notebook) => notebook.id === target);
    const rest = others.filter((notebook) => notebook.id !== target);
    return [...(current ? [current] : []), ...(picked ? [picked] : []), ...rest].slice(
      0,
      MAX_CHIPS,
    );
  }, [notebooks, notebookId, target]);
  const targetTitle = choices.find((notebook) => notebook.id === target)?.title ?? "";
  const changed = target !== notebookId;
  const locked = busy || geminiBusy;

  function describe(error: unknown): string {
    if (error instanceof IngestError) {
      if (error.reason === "read")
        return t("errors.read", { name: error.subject, error: error.detail });
      return t(`errors.${error.reason}`, { name: error.subject });
    }
    return error instanceof Error ? error.message : String(error);
  }

  /** Runs the adds, reports what happened and closes when everything worked. */
  async function run(tasks: (() => Promise<unknown>)[]) {
    setBusy(true);
    setErrors([]);
    const results = await Promise.allSettled(tasks.map((task) => task()));
    setBusy(false);
    const added = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.flatMap((result) =>
      result.status === "rejected" ? [describe(result.reason)] : [],
    );
    if (added > 0) toast.success(t("added", { count: added }));
    if (failed.length > 0) setErrors(failed);
    else onDone();
  }

  /** A link: a page's text, or a video's captions; a video without them offers Gemini. */
  async function addLink(address: string) {
    setBusy(true);
    setErrors([]);
    setLinkFailure(undefined);
    setUncaptioned(undefined);
    try {
      await ingestUrl(target, address);
      toast.success(t("added", { count: 1 }));
      onDone();
    } catch (error) {
      if (error instanceof IngestError && error.reason === "noCaptions" && error.video)
        setUncaptioned(error.video);
      else {
        let host = address;
        try {
          host = new URL(address).host;
        } catch {
          // keep the address as typed
        }
        setLinkFailure({ host, reason: describe(error) });
      }
    } finally {
      setBusy(false);
    }
  }

  function addFiles(files: FileList | File[]) {
    const list = [...files];
    if (list.length > 0) void run(list.map((file) => () => ingestFile(target, file)));
  }

  async function makeNotebook() {
    const title = newTitle.trim();
    if (!title) return;
    const current = notebooks?.find((notebook) => notebook.id === notebookId);
    const id = await createNotebook(title, current ? { vaultId: current.vaultId } : {});
    setTarget(id);
    setCreating(false);
    setNewTitle("");
  }

  const canSubmit =
    !locked &&
    (mode === "media"
      ? !transcribing && transcriptDraftReady(transcript)
      : kind !== "empty" && !uncaptioned);

  function submit() {
    if (!canSubmit) return;
    if (mode === "media") {
      void run([
        () =>
          ingestText(
            target,
            transcript.title.trim(),
            transcriptDraftDocument(transcript),
            transcriptDraftLink(transcript),
          ),
      ]);
    } else if (kind === "text") {
      const firstLine = trimmed.split("\n", 1)[0]?.slice(0, 60).trim();
      void run([
        () => ingestText(target, firstLine || t("addDialog.textTitlePlaceholder"), source),
      ]);
    } else {
      void addLink(trimmed);
    }
  }

  function onSourceKey(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function onChipKey(event: KeyboardEvent) {
    const at = choices.findIndex((notebook) => notebook.id === target);
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const last = choices.length - 1;
    let next = -1;
    if (event.key === "ArrowDown" || event.key === (rtl ? "ArrowLeft" : "ArrowRight"))
      next = at >= last ? 0 : at + 1;
    else if (event.key === "ArrowUp" || event.key === (rtl ? "ArrowRight" : "ArrowLeft"))
      next = at <= 0 ? last : at - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next < 0) return;
    event.preventDefault();
    const pick = choices[next];
    if (!pick) return;
    setTarget(pick.id);
    document.getElementById(`${whereId}-${pick.id}`)?.focus();
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (mode === "main" && !locked) addFiles(event.dataTransfer.files);
  };

  const why = busy
    ? t("addDialog.why.busy")
    : mode === "media"
      ? t("addDialog.why.media")
      : uncaptioned
        ? t("addDialog.why.captions")
        : kind === "empty"
          ? t("addDialog.why.empty")
          : t("addDialog.why.ready");

  return (
    <>
      <Dialog.Body
        onDragOver={(event: DragEvent) => {
          event.preventDefault();
          if (mode === "main") setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn("transition-colors", dragging && "bg-info/5 ring-1 ring-info")}
      >
        {mode === "cloud" && storage ? (
          <CloudBrowser
            mode="sources"
            accept={SOURCE_EXTENSIONS}
            busy={busy}
            onChoose={(service, files) => {
              const client = storageClient(service, storage[service]);
              return run(
                files.map((file) => async () => ingestFile(target, await client.download(file))),
              );
            }}
          />
        ) : (
          <form
            id={formId}
            className="flex flex-col gap-4"
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {mode === "media" ? (
              <TranscriptFields
                nested
                draft={transcript}
                onChange={setTranscript}
                disabled={busy}
                onBusyChange={setTranscribing}
              />
            ) : (
              <>
                <div className="flex items-start gap-2 rounded-xl border bg-background px-3 py-2 shadow-xs focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
                  <Icon icon={Link01Icon} size={16} className="mt-2 text-muted-foreground" />
                  <label htmlFor={sourceId} className="sr-only">
                    {t("addDialog.inputLabel")}
                  </label>
                  <Textarea
                    ref={field}
                    id={sourceId}
                    variant="ghost"
                    autoFocus
                    minRows={1}
                    maxRows={8}
                    disabled={locked}
                    placeholder={t("addDialog.placeholder")}
                    value={source}
                    onKeyDown={onSourceKey}
                    onChange={(event) => {
                      setSource(event.target.value);
                      setUncaptioned(undefined);
                      setLinkFailure(undefined);
                      setErrors([]);
                    }}
                    className="min-w-0 flex-1 px-0"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={locked}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon icon={CloudUploadIcon} size={16} />
                    {t("addDialog.choose")}
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept={ACCEPTED_FILES}
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files) addFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </div>

                {kind === "empty" && !busy ? (
                  <p className="text-sm text-muted-foreground">
                    {t("addDialog.takes")} · {t("addDialog.fileTypes")}
                  </p>
                ) : null}

                {kind !== "empty" && !busy && !linkFailure && !uncaptioned ? (
                  <p className="text-sm text-muted-foreground">{t(`addDialog.kind.${kind}`)}</p>
                ) : null}

                {busy ? (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Icon icon={Loading03Icon} size={16} className="animate-spin" />
                    {t("addDialog.reading", { name: targetTitle })}
                  </p>
                ) : null}

                {uncaptioned ? (
                  <YouTubeGeminiCard
                    notebookId={target}
                    video={uncaptioned}
                    onBusyChange={setGeminiBusy}
                    onAdded={() => {
                      toast.success(t("added", { count: 1 }));
                      onDone();
                    }}
                  />
                ) : null}

                {linkFailure ? (
                  <div
                    role="alert"
                    className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3"
                  >
                    <Icon icon={AlertCircleIcon} size={16} className="mt-0.5 text-destructive" />
                    <div className="flex min-w-0 flex-col gap-2">
                      <p className="text-sm font-medium">{t("addDialog.failed.title")}</p>
                      <p className="text-sm text-muted-foreground">
                        {t("addDialog.failed.body", {
                          host: linkFailure.host,
                          reason: linkFailure.reason,
                        })}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSource("");
                            setLinkFailure(undefined);
                            field.current?.focus();
                          }}
                        >
                          {t("addDialog.failed.paste")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void addLink(trimmed)}
                        >
                          {t("addDialog.failed.retry")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {errors.length > 0 ? (
              <ul role="alert" className="flex flex-col gap-1 text-sm text-destructive">
                {errors.map((error, at) => (
                  <li key={at}>{error}</li>
                ))}
              </ul>
            ) : null}
          </form>
        )}

        <div className="flex flex-col gap-2 pt-4">
          <p id={whereId} className="text-sm">
            {t("addDialog.goesTo")} <span className="font-medium">{targetTitle}</span>
            <span className="text-muted-foreground">
              {" "}
              · {changed ? t("addDialog.changed") : t("addDialog.current")}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="radiogroup"
              aria-label={t("addDialog.notebook")}
              aria-describedby={whereId}
              onKeyDown={onChipKey}
              className="flex flex-wrap gap-2"
            >
              {choices.map((notebook) => {
                const on = notebook.id === target;
                return (
                  <button
                    key={notebook.id}
                    id={`${whereId}-${notebook.id}`}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    disabled={locked}
                    onClick={() => setTarget(notebook.id)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                      on
                        ? "border-ring bg-accent ps-2.5 font-medium text-foreground"
                        : "text-muted-foreground hover:border-ring hover:text-foreground",
                    )}
                  >
                    {on ? <Icon icon={Tick02Icon} size={14} /> : null}
                    {notebook.title}
                  </button>
                );
              })}
            </div>
            {creating ? (
              <Input
                autoFocus
                value={newTitle}
                aria-label={t("addDialog.newNotebookLabel")}
                placeholder={t("addDialog.newNotebookPlaceholder")}
                onChange={(event) => setNewTitle(event.target.value)}
                onBlur={() => {
                  if (!newTitle.trim()) setCreating(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    void makeNotebook();
                  } else if (event.key === "Escape") {
                    event.stopPropagation();
                    setCreating(false);
                  }
                }}
                className="h-8 w-44"
              />
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={() => setCreating(true)}
              >
                <Icon icon={Add01Icon} size={14} />
                {t("addDialog.newNotebook")}
              </Button>
            )}
          </div>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <div className="me-auto flex gap-1">
          {mode === "main" ? (
            <>
              {hasStorage ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode("cloud")}>
                  <Icon icon={CloudServerIcon} size={16} />
                  {t("addDialog.tabs.cloud")}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode("media")}>
                <Icon icon={PodcastIcon} size={16} />
                {t("addDialog.tabs.media")}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={transcribing || geminiBusy}
              onClick={() => {
                setMode("main");
                setErrors([]);
              }}
            >
              {t("addDialog.back")}
            </Button>
          )}
        </div>
        <Dialog.Close render={<Button variant="secondary" />}>
          {tCommon("actions.cancel")}
        </Dialog.Close>
        {mode !== "cloud" ? (
          <div className="flex flex-col items-end gap-1">
            <Button
              type="submit"
              form={formId}
              disabled={!canSubmit}
              loading={busy}
              aria-describedby={whyId}
            >
              {t("addDialog.submit", { name: targetTitle })}
            </Button>
            <span id={whyId} className="text-xs text-muted-foreground">
              {why}
            </span>
          </div>
        ) : null}
      </Dialog.Footer>
    </>
  );
}
