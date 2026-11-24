import { StopIcon, VolumeHighIcon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Spinner } from "@/components/panelui/spinner";
import { speak, warmUpSpeech } from "@/lib/speech/speak";

/** Nothing playing, the voice preparing the audio, or the audio playing. */
export type ListenState = "idle" | "preparing" | "speaking";

/**
 * Reads text aloud from one Listen button: what it is doing, and a toggle
 * that starts reading or stops it. Leaving stops a reading this button began.
 */
export function useListen() {
  const [state, setState] = useState<ListenState>("idle");
  const current = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => current.current?.abort(), []);

  /** Reads `text`, or stops this button's reading: false when no voice could read it. */
  const toggle = useCallback(async (text: string, language?: string) => {
    if (current.current) {
      current.current.abort();
      return true;
    }
    const controller = new AbortController();
    current.current = controller;
    setState("preparing");
    try {
      return await speak(text, {
        language,
        signal: controller.signal,
        onStart: () => {
          if (current.current === controller) setState("speaking");
        },
      });
    } finally {
      if (current.current === controller) {
        current.current = undefined;
        setState("idle");
      }
    }
  }, []);

  return { state, toggle };
}

/** The label for a Listen button in each state. */
export function useListenLabel(state: ListenState, idle: string) {
  const { t } = useTranslation("common");
  return state === "preparing" ? t("speech.preparing") : state === "speaking" ? t("speech.stop") : idle;
}

/** The speaker, a spinner while the audio is prepared, then Stop while it plays. */
export function ListenIcon({ state, size = 16 }: { state: ListenState; size?: number }) {
  if (state === "preparing") return <Spinner aria-hidden style={{ width: size, height: size }} />;
  return <Icon icon={state === "speaking" ? StopIcon : VolumeHighIcon} size={size} />;
}

type ListenButtonProps = Omit<ComponentProps<typeof Button>, "onClick" | "children"> & {
  state: ListenState;
  label: string;
  onClick: () => void;
  iconSize?: number;
};

/** An icon button that reads aloud, showing what it is doing. */
export function ListenButton({ state, label, iconSize, title, onPointerEnter, onFocus, ...props }: ListenButtonProps) {
  const shown = useListenLabel(state, label);
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={shown}
      aria-busy={state === "preparing" || undefined}
      // A title, when wanted, follows the state like the label.
      title={title === undefined ? undefined : shown}
      {...props}
      onPointerEnter={(event) => {
        warmUpSpeech();
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        warmUpSpeech();
        onFocus?.(event);
      }}
    >
      <ListenIcon state={state} size={iconSize} />
    </Button>
  );
}
