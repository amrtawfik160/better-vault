import {
  FileAudioIcon,
  Loading03Icon,
  SubtitleIcon,
  TextAlignLeftIcon,
} from "@hugeicons/core-free-icons";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/common/field";
import { Segmented } from "@/components/common/segmented";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { Textarea } from "@/components/panelui/textarea";
import { ProviderIcon } from "@/components/provider-icon";
import { providers } from "@/lib/ai/catalog";
import { useSettings } from "@/lib/db/settings";
import {
  ACCEPTED_SUBTITLES,
  MAX_SUBTITLE_BYTES,
  SUBTITLE_EXTENSIONS,
  parseSubtitles,
} from "@/lib/sources/subtitles";
import {
  TranscriptionError,
  transcribeRecording,
  transcriptionCredentials,
  type TranscriptionPhase,
} from "@/lib/sources/transcribe-recording";
import { cleanPastedTranscript, transcriptDocument, transcriptText } from "@/lib/sources/transcript";
import {
  acceptedRecordings,
  extensionOf,
  recordingProblem,
  transcriptionLimits,
  transcriptionProviderIds,
  type TranscriptionProviderId,
} from "@/lib/sources/transcription";
import { cn } from "@/lib/utils";

export type TranscriptMethod = "paste" | "subtitles" | "recording";

/** What the user has entered so far: a title, an optional link and the transcript. */
export interface TranscriptDraft {
  method: TranscriptMethod;
  title: string;
  link: string;
  /** Each way in keeps its own transcript, so switching between them loses nothing. */
  texts: Record<TranscriptMethod, string>;
}

export const emptyTranscriptDraft: TranscriptDraft = {
  method: "paste",
  title: "",
  link: "",
  texts: { paste: "", subtitles: "", recording: "" },
};

/** The transcript of the way in that is chosen. */
const draftText = (draft: TranscriptDraft) => draft.texts[draft.method];

const isLink = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/** The draft can be saved: it has a title, some text and, if any, a valid link. */
export function transcriptDraftReady(draft: TranscriptDraft) {
  return (
    draft.title.trim() !== "" &&
    draftText(draft).trim() !== "" &&
    (draft.link.trim() === "" || isLink(draft.link))
  );
}

/** The document's text: a pasted YouTube transcript cleaned, with the link first. */
export function transcriptDraftDocument(draft: TranscriptDraft) {
  const text = draftText(draft);
  return transcriptDocument(
    draft.method === "paste" ? cleanPastedTranscript(text) : text,
    draft.link,
  );
}

/** The link to keep with the source, when one was given. */
export const transcriptDraftLink = (draft: TranscriptDraft) =>
  isLink(draft.link) ? draft.link.trim() : undefined;

const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, "").trim() || name;
const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));
const formatList = (provider: TranscriptionProviderId) =>
  transcriptionLimits[provider].extensions.map((extension) => extension.toUpperCase()).join(", ");

/**
 * The fields for adding a video, podcast or course as text: a pasted
 * transcript, subtitles read in the browser, or a recording transcribed with
 * the user's OpenAI or ElevenLabs key. Used by the Study library and the
 * notebook's Add source dialog, which save the result their own way.
 */
export function TranscriptFields({
  draft,
  onChange,
  disabled = false,
  nested = false,
  onBusyChange,
}: {
  draft: TranscriptDraft;
  onChange: Dispatch<SetStateAction<TranscriptDraft>>;
  disabled?: boolean;
  /** Inside another set of tabs: the ways in are drawn smaller. */
  nested?: boolean;
  /** True while a recording is being uploaded or transcribed. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation("sources");
  const titleId = useId();
  const linkId = useId();
  const textId = useId();
  const settings = useSettings();
  const ready = settings ? transcriptionCredentials(settings) : {};
  const readyIds = transcriptionProviderIds.filter((id) => ready[id]);
  const [chosen, setChosen] = useState<TranscriptionProviderId>();
  const provider = chosen && ready[chosen] ? chosen : readyIds[0];
  const [phase, setPhase] = useState<TranscriptionPhase>();
  const [working, setWorking] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const request = useRef<AbortController>(null);
  const subtitleInput = useRef<HTMLInputElement>(null);
  const recordingInput = useRef<HTMLInputElement>(null);
  const busy = phase !== undefined;
  const text = draftText(draft);

  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  useEffect(() => () => request.current?.abort(), []);

  const update = (change: Partial<Omit<TranscriptDraft, "texts">>) =>
    onChange((current) => ({ ...current, ...change }));
  const setText = (method: TranscriptMethod, value: string) =>
    onChange((current) => ({ ...current, texts: { ...current.texts, [method]: value } }));
  // A file's transcript; its name becomes the title unless one was typed.
  const fill = (method: TranscriptMethod, name: string, value: string) =>
    onChange((current) => ({
      ...current,
      texts: { ...current.texts, [method]: value },
      title: current.title.trim() ? current.title : titleFromFile(name),
    }));

  async function readSubtitles(file: File) {
    setError(undefined);
    if (!SUBTITLE_EXTENSIONS.includes(extensionOf(file.name))) {
      setError(t("transcript.errors.subtitlesType", { name: file.name }));
      return;
    }
    if (file.size > MAX_SUBTITLE_BYTES) {
      setError(t("transcript.errors.subtitlesTooLarge", { name: file.name }));
      return;
    }
    const parsed = transcriptText(parseSubtitles(await file.text()));
    if (!parsed) setError(t("transcript.errors.subtitles", { name: file.name }));
    else fill("subtitles", file.name, parsed);
  }

  async function transcribe(file: File) {
    setError(undefined);
    setNotice(undefined);
    if (!provider || busy) return;
    const credentials = ready[provider];
    if (!credentials) return;
    const name = providers[provider].name;
    const size = megabytes(transcriptionLimits[provider].maxBytes);
    const problem = recordingProblem(provider, file);
    if (problem) {
      setError(
        t(`transcript.errors.${problem}`, {
          name: file.name,
          provider: name,
          size,
          formats: formatList(provider),
        }),
      );
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setWorking(file.name);
    setPhase("uploading");
    try {
      const transcript = await transcribeRecording({
        file,
        provider,
        credentials,
        signal: controller.signal,
        onPhase: (next) => !controller.signal.aborted && setPhase(next),
      });
      if (!controller.signal.aborted) fill("recording", file.name, transcript);
    } catch (caught) {
      if (controller.signal.aborted) return;
      const reason = caught instanceof TranscriptionError ? caught.reason : "failed";
      const detail =
        caught instanceof TranscriptionError
          ? caught.detail
          : caught instanceof Error
            ? caught.message
            : String(caught);
      setError(t(`transcript.errors.${reason}`, { name: file.name, error: detail }));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPhase(undefined);
        setWorking(undefined);
      }
    }
  }

  function stop() {
    request.current?.abort();
    request.current = null;
    setPhase(undefined);
    setWorking(undefined);
    setNotice(t("transcript.stopped"));
  }

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (draft.method === "subtitles") void readSubtitles(file);
    else void transcribe(file);
  };

  const dropProps = {
    onDragOver: (event: DragEvent) => {
      if (disabled || busy || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (disabled || busy || !event.dataTransfer.files.length) return;
      event.preventDefault();
      setDragging(false);
      choose(event.dataTransfer.files[0]);
    },
  };

  const transcriptField = (
    <Field
      label={t("transcript.textLabel")}
      htmlFor={textId}
      hint={draft.method === "paste" ? t("transcript.pasteTip") : undefined}
    >
      <Textarea
        id={textId}
        minRows={draft.method === "paste" ? 8 : 6}
        maxRows={14}
        disabled={disabled}
        placeholder={t("transcript.pastePlaceholder")}
        value={text}
        onChange={(event) => setText(draft.method, event.target.value)}
      />
    </Field>
  );

  let body: ReactNode;
  if (draft.method === "paste") body = transcriptField;
  else if (draft.method === "subtitles")
    body = text ? (
      <>
        {transcriptField}
        <ChooseAnother onClick={() => subtitleInput.current?.click()} disabled={disabled} />
      </>
    ) : (
      <DropZone
        {...dropProps}
        dragging={dragging}
        icon={SubtitleIcon}
        title={t("transcript.subtitlesDrop")}
        hint={t("transcript.subtitlesHint")}
        action={t("transcript.chooseFile")}
        disabled={disabled}
        onChoose={() => subtitleInput.current?.click()}
      />
    );
  else if (!settings) body = null;
  else if (!provider)
    body = (
      <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        {t("transcript.noProvider")}
      </p>
    );
  else if (busy)
    body = (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-3xl border border-dashed px-6 py-10 text-center"
      >
        <Icon icon={Loading03Icon} size={22} className="animate-spin" />
        <p className="text-sm font-medium" dir="auto">
          {t(phase === "uploading" ? "transcript.uploading" : "transcript.transcribing", {
            name: working,
          })}
        </p>
        <p className="text-xs text-muted-foreground">{t("transcript.takesAWhile")}</p>
        <Button type="button" variant="outline" shape="pill" size="sm" onClick={stop}>
          {t("transcript.stop")}
        </Button>
      </div>
    );
  else
    body = (
      <>
        {readyIds.length > 1 ? (
          <Field label={t("transcript.providerLabel")}>
            <Segmented<TranscriptionProviderId>
              aria-label={t("transcript.providerLabel")}
              size="sm"
              value={provider}
              onValueChange={setChosen}
              className="self-start"
              options={readyIds.map((id) => ({
                value: id,
                label: providers[id].name,
                icon: <ProviderIcon provider={id} size={14} />,
              }))}
            />
          </Field>
        ) : null}
        {text ? (
          <>
            {transcriptField}
            <ChooseAnother onClick={() => recordingInput.current?.click()} disabled={disabled} />
          </>
        ) : (
          <DropZone
            {...dropProps}
            dragging={dragging}
            icon={FileAudioIcon}
            title={t("transcript.recordingDrop")}
            hint={t("transcript.limit", {
              provider: providers[provider].name,
              size: megabytes(transcriptionLimits[provider].maxBytes),
              formats: formatList(provider),
            })}
            action={t("transcript.chooseFile")}
            disabled={disabled}
            onChoose={() => recordingInput.current?.click()}
          />
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          {t("transcript.longer")} {t("transcript.sentTo", { provider: providers[provider].name })}
        </p>
      </>
    );

  return (
    <div className="flex flex-col gap-4">
      <Segmented<TranscriptMethod>
        aria-label={t("transcript.methodsLabel")}
        size={nested ? "sm" : "md"}
        value={draft.method}
        onValueChange={(method) => {
          if (busy) return;
          setError(undefined);
          setNotice(undefined);
          update({ method });
        }}
        className={nested ? "self-start" : "w-full *:flex-1"}
        options={[
          {
            value: "paste",
            label: t("transcript.methods.paste"),
            icon: <Icon icon={TextAlignLeftIcon} size={16} />,
          },
          {
            value: "subtitles",
            label: t("transcript.methods.subtitles"),
            icon: <Icon icon={SubtitleIcon} size={16} />,
          },
          {
            value: "recording",
            label: t("transcript.methods.recording"),
            icon: <Icon icon={FileAudioIcon} size={16} />,
            disabled: busy,
          },
        ]}
      />
      <Field label={t("transcript.titleLabel")} htmlFor={titleId}>
        <Input
          id={titleId}
          required
          disabled={disabled}
          placeholder={t("transcript.titlePlaceholder")}
          value={draft.title}
          onChange={(event) => update({ title: event.target.value })}
        />
      </Field>
      <Field
        label={t("transcript.linkLabel")}
        htmlFor={linkId}
        hint={
          draft.link.trim() && !isLink(draft.link) ? (
            <span className="text-destructive">{t("transcript.linkInvalid")}</span>
          ) : (
            t("transcript.linkHint")
          )
        }
      >
        <Input
          id={linkId}
          type="url"
          inputMode="url"
          dir="ltr"
          disabled={disabled}
          placeholder={t("transcript.linkPlaceholder")}
          value={draft.link}
          onChange={(event) => update({ link: event.target.value })}
        />
      </Field>
      {body}
      {error ? (
        <p role="alert" className="text-sm text-destructive" dir="auto">
          {error}
        </p>
      ) : notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <input
        ref={subtitleInput}
        type="file"
        accept={ACCEPTED_SUBTITLES}
        className="hidden"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={recordingInput}
        type="file"
        accept={acceptedRecordings(provider)}
        className="hidden"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function DropZone({
  dragging,
  icon,
  title,
  hint,
  action,
  disabled,
  onChoose,
  ...drop
}: {
  dragging: boolean;
  icon: typeof FileAudioIcon;
  title: string;
  hint: string;
  action: string;
  disabled: boolean;
  onChoose: () => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}) {
  return (
    <div
      {...drop}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed px-6 py-8 text-center transition-colors",
        dragging && "border-info bg-info/5",
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon icon={icon} size={22} />
      </span>
      <p className="text-sm font-medium">{title}</p>
      <Button type="button" variant="outline" shape="pill" size="sm" disabled={disabled} onClick={onChoose}>
        {action}
      </Button>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
  );
}

function ChooseAnother({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const { t } = useTranslation("sources");
  return (
    <Button
      type="button"
      variant="ghost"
      shape="pill"
      size="sm"
      className="self-start"
      disabled={disabled}
      onClick={onClick}
    >
      {t("transcript.chooseAnother")}
    </Button>
  );
}
