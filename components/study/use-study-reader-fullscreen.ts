import { useEffect, useEffectEvent, useRef } from "react";

function exitFullscreen(waitForWindow: boolean) {
  const root = document.documentElement;
  const exit = () => {
    if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
  };
  if (!waitForWindow || !root.hasAttribute("data-window-controls")) {
    exit();
    return;
  }

  // On macOS the desktop shell removes the window controls after the native transition.
  const observer = new MutationObserver(() => {
    if (!root.hasAttribute("data-window-controls")) finish();
  });
  const timeout = window.setTimeout(finish, 2000);
  observer.observe(root, { attributes: true, attributeFilter: ["data-window-controls"] });
  function finish() {
    observer.disconnect();
    window.clearTimeout(timeout);
    exit();
  }
}

export function useStudyReaderFullscreen(focused: boolean, onExit: () => void) {
  const owner = useRef<AbortController | null>(null);
  const exitFocus = useEffectEvent(onExit);

  useEffect(() => {
    if (focused) return;
    owner.current?.abort();
  }, [focused]);

  useEffect(() => {
    function onChange() {
      if (!owner.current || document.fullscreenElement) return;
      owner.current = null;
      exitFocus();
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      owner.current?.abort();
    };
  }, []);

  return () => {
    if (!document.fullscreenEnabled || document.fullscreenElement || owner.current) return;
    const root = document.documentElement;
    const request = new AbortController();
    const waitForWindow = root.hasAttribute("data-window-controls");
    let exiting = false;
    const leave = () => {
      if (exiting || document.fullscreenElement !== root) return;
      exiting = true;
      exitFullscreen(waitForWindow);
    };
    owner.current = request;
    request.signal.addEventListener("abort", () => {
      if (owner.current === request) owner.current = null;
      leave();
    }, { once: true });
    // Use the document root so the reader's dialogs and menus can still open above it.
    void root.requestFullscreen().then(() => {
      if (request.signal.aborted && !owner.current) leave();
    }).catch(() => {
      if (owner.current === request) owner.current = null;
    });
  };
}
