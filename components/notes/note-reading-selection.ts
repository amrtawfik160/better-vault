import type { Element, Root } from "hast";
import type { VFile } from "vfile";
import { noteMarkdown } from "@/lib/notes/markdown";
import { noteCaptureLimit } from "@/lib/notes/search-match";
import { readFrontmatter } from "@/lib/notes/syntax";
import { studyFormulaAttribute } from "@/lib/study/markdown-math";
import type { NoteStudySelection } from "@/lib/study/note-flashcards";
import { renderedStudySelectionText } from "@/components/study/study-rendered-text";

export function rehypeNotePositions() {
  return (tree: Root, file: VFile) => {
    const source = String(file);
    function annotate(parent: Root | Element) {
      parent.children.forEach((node, index) => {
        const from = node.position?.start.offset;
        const to = node.position?.end.offset;
        const positioned = from !== undefined && to !== undefined && from < to;
        if (node.type === "element") {
          if (positioned && (node.tagName === "code" || node.tagName === "pre" || studyFormulaAttribute in node.properties)) {
            node.properties["data-note-from"] = from;
            node.properties["data-note-to"] = to;
          } else annotate(node);
          return;
        }
        if (node.type !== "text" || !node.value.trim() || !positioned) return;
        const span: Element = {
          type: "element",
          tagName: "span",
          properties: {
            "data-note-from": from,
            "data-note-to": to,
            ...(node.value === source.slice(from, to) ? { "data-note-linear": "" } : {}),
          },
          children: [node],
        };
        parent.children[index] = span;
      });
    }
    annotate(tree);
  };
}

function selectedFragment(element: HTMLElement, selection: Range) {
  const from = Number(element.dataset.noteFrom);
  const to = Number(element.dataset.noteTo);
  const portion = document.createRange();
  portion.selectNodeContents(element);
  const prefix = portion.cloneRange();
  if (element.contains(selection.startContainer)) {
    portion.setStart(selection.startContainer, selection.startOffset);
    prefix.setEnd(selection.startContainer, selection.startOffset);
  } else prefix.collapse(true);
  if (element.contains(selection.endContainer)) portion.setEnd(selection.endContainer, selection.endOffset);
  if (portion.collapsed) return;
  if (element.dataset.noteLinear === undefined) return { from, to };
  const start = from + prefix.toString().length;
  return { from: start, to: start + portion.toString().length };
}

export function readNoteSelection(root: HTMLElement, body: string): NoteStudySelection | undefined {
  const selected = window.getSelection();
  if (!selected?.rangeCount || selected.isCollapsed) return;
  const range = selected.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  const fragments = [...root.querySelectorAll<HTMLElement>("[data-note-from]")].flatMap((element) => {
    if (!range.intersectsNode(element)) return [];
    const fragment = selectedFragment(element, range);
    return fragment && fragment.from < fragment.to ? [fragment] : [];
  });
  const first = fragments[0];
  const last = fragments.at(-1);
  const math = [...root.querySelectorAll(`[${studyFormulaAttribute}]`)].some((node) =>
    range.intersectsNode(node),
  );
  const text = (math ? renderedStudySelectionText(root, range) : selected.toString()).trim().slice(0, noteCaptureLimit);
  if (!text) return;
  if (!first || !last) return { text };
  const { content, length } = readFrontmatter(body);
  const { from, to } = noteMarkdown(content, length).sourceRange(first.from, last.to);
  const quote = body.slice(from, Math.min(to, from + noteCaptureLimit));
  return { text, match: quote ? { offset: from, quote } : undefined };
}
