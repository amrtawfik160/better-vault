import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  StudySelectionMenu,
  type SelectionMenuHandle,
  type StudySelection,
} from "@/components/study/study-selection-menu";
import { updateSettings, useSettings } from "@/lib/db/settings";
import { studyHref } from "@/lib/study/links";
import type { StudyOrigin } from "@/lib/study/records";
import { defaultTranslationLanguage } from "@/lib/study/translation-language";

/** What the text in a selectable area is, and what a selection in it can do. */
export type SelectionPlace = {
  /** What the text is, for the model: a book's title, a note's. */
  title: string;
  notebookId?: string;
  bookId?: string;
  vaultId?: string;
  /** Tags for a card made here. */
  tags: string[];
  /** Where a word or card made here comes from, given the block it was selected in. */
  origin?: (block: HTMLElement) => StudyOrigin | undefined;
  /** Asks the chat beside the text about the selection; without it, the menu explains it. */
  onAsk?: (text: string) => void;
};

/**
 * Marks a part of a selectable area, such as one answer: a selection's
 * context (for a saved word) and origin come from the part it is in.
 */
export const selectionBlock = "data-selection-block";

/** Where a selection never opens the menu: fields, and the menu itself. */
const ignored = "input, textarea, select, [contenteditable]:not([contenteditable=false]), [data-study-selection-menu]";
/** Pressing in these keeps the menu: it, and what it opens (menus, lists, the model picker, toasts). */
const keeps =
  "[data-study-selection-menu], [role=menu], [role=listbox], [role=dialog], [data-slot=model-picker-content], [data-sonner-toaster]";
/** Longer selections are for copying, not studying. */
const longest = 4000;

type Active = {
  selection: StudySelection;
  /** The block's text, which `selection.offset` counts into. */
  context: string;
  range: Range;
  origin?: StudyOrigin;
  byTouch: boolean;
};

let revision = 0;

/**
 * Text that opens the selection menu, as the reader's text does, when part
 * of it is selected: translate, listen, save the words, make a card, ask.
 */
export function SelectableText({
  place,
  className,
  "aria-label": label,
  children,
}: {
  place: SelectionPlace;
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<SelectionMenuHandle>(null);
  const pointer = useRef("mouse");
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const navigate = useNavigate();
  const settings = useSettings();
  const translateTo = settings?.study?.translateTo ?? defaultTranslationLanguage(navigator.language);

  function capture() {
    const native = window.getSelection();
    const area = root.current;
    if (!area || !native || native.isCollapsed || native.rangeCount === 0) return;
    const range = native.getRangeAt(0);
    if (!area.contains(range.commonAncestorContainer)) return;
    const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement);
    if (elementOf(range.startContainer)?.closest(ignored)) return;
    const raw = native.toString();
    const text = raw.trim();
    if (!text || text.length > longest) return;
    const found = elementOf(range.commonAncestorContainer)?.closest<HTMLElement>(`[${selectionBlock}]`);
    const block = found && area.contains(found) ? found : area;
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    setActive({
      selection: { text, offset: before.toString().length + raw.length - raw.trimStart().length, revision: ++revision },
      context: block.textContent ?? "",
      range: range.cloneRange(),
      origin: place.origin?.(block),
      byTouch: pointer.current === "touch",
    });
  }

  function close(clear: boolean) {
    setActive(null);
    const native = window.getSelection();
    if (clear && native?.anchorNode && root.current?.contains(native.anchorNode)) native.removeAllRanges();
  }

  // A touch selection ends with the handles, not a mouseup: read it once it settles.
  const settled = useEffectEvent(capture);
  useEffect(() => {
    let timer = 0;
    function changed() {
      if (pointer.current !== "touch") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(settled, 450);
    }
    document.addEventListener("selectionchange", changed);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", changed);
    };
  }, []);

  // Pressing anywhere else closes the menu; a new selection opens it again.
  const pressed = useEffectEvent((event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest(keeps)) return;
    setActive(null);
  });

  // The menu's keys, as in the reader: T translates, W saves, A asks, Tab
  // reaches the menu, Escape closes it. Taken before the page's own keys.
  const key = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    const take = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "Escape") {
      if (target?.closest("[role=menu], [role=listbox]")) return;
      take();
      close(true);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Only while nothing else has focus: never while typing.
    if (target && target !== document.body && !root.current?.contains(target)) return;
    if (event.key === "Tab" && !event.shiftKey) {
      take();
      menu.current?.focus();
      return;
    }
    const letter = event.key.toLowerCase();
    if (letter === "t") menu.current?.run("translate");
    else if (letter === "w") menu.current?.run("word");
    else if (letter === "a") menu.current?.run("ask");
    else return;
    take();
  });

  useEffect(() => {
    if (!active) return;
    document.addEventListener("pointerdown", pressed, true);
    document.addEventListener("keydown", key, true);
    // Keeps the passage marked while focus is in the menu.
    const marks = globalThis.CSS?.highlights;
    marks?.set("text-selection", new Highlight(active.range));
    return () => {
      document.removeEventListener("pointerdown", pressed, true);
      document.removeEventListener("keydown", key, true);
      marks?.delete("text-selection");
    };
  }, [active]);

  function chooseTranslateTo(code: string) {
    void updateSettings((saved) => {
      saved.study = { ...saved.study, translateTo: code };
    }).catch((error: Error) => toast.error(error.message));
  }

  return (
    <div
      ref={root}
      className={className}
      aria-label={label}
      onPointerDown={(event) => {
        pointer.current = event.pointerType;
      }}
      // The selection is final once the button is up.
      onMouseUp={() => window.setTimeout(capture)}
    >
      {children}
      {active
        ? createPortal(
            <div ref={setLayer} className="pointer-events-none fixed inset-0 z-50">
              {layer ? (
                <StudySelectionMenu
                  key={active.selection.revision}
                  handle={menu}
                  selection={active.selection}
                  frame={layer}
                  viewport={null}
                  anchor={() => {
                    const rect = active.range.getBoundingClientRect();
                    return rect.width || rect.height ? rect : null;
                  }}
                  preferBelow={active.byTouch}
                  notebookId={place.notebookId}
                  bookId={place.bookId}
                  vaultId={place.vaultId}
                  tags={place.tags}
                  sectionTitle={place.title}
                  sectionText={active.context}
                  origin={active.origin}
                  translateTo={translateTo}
                  chooseTranslateTo={chooseTranslateTo}
                  onAsk={
                    place.onAsk
                      ? () => {
                          place.onAsk?.(active.selection.text);
                          close(true);
                        }
                      : undefined
                  }
                  onShowWords={() => navigate(studyHref("vocabulary"))}
                  onViewCards={() => navigate(studyHref("cards"))}
                  onClose={() => close(true)}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
