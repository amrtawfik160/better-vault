import type { Root, RootContent } from "hast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import {
  containsStudyMath,
  restoreStudyCurrency,
  studyFormulaAttribute,
  wrapStudyFormulas,
} from "./markdown-math";

function readerText(node: Root | RootContent, project?: (raw: string) => string): string {
  if (node.type === "text" || node.type === "raw") return node.value;
  if (node.type === "element") {
    const formula = node.properties[studyFormulaAttribute];
    if (typeof formula === "string") return project ? project(formula) : formula;
    if (node.tagName === "img") return String(node.properties.alt ?? "");
  }
  if (node.type === "element" || node.type === "root")
    return node.children.map((child) => readerText(child, project)).join("");
  return "";
}

function readerTree(markdown: string, formulas: boolean) {
  const document = fromMarkdown(markdown, {
    extensions: formulas ? [gfm(), math()] : [gfm()],
    mdastExtensions: formulas ? [gfmFromMarkdown(), mathFromMarkdown()] : [gfmFromMarkdown()],
  });
  if (formulas) restoreStudyCurrency(document, markdown);
  const tree = toHast(document, { allowDangerousHtml: true });
  if (tree.type !== "root") throw new Error("Expected a Markdown document.");
  return tree;
}

export function legacyStudyFormulaText(raw: string) {
  return readerText(readerTree(raw, false));
}

/** Study anchors and notebook sources retain the LaTeX behind each rendered formula. */
export function studyMarkdownContent(markdown: string) {
  const body = markdown.replace(/\r\n?/g, "\n");
  const formulas = containsStudyMath(body);
  const tree = readerTree(body, formulas);
  if (formulas) wrapStudyFormulas(tree, body);
  return { markdown: body, text: readerText(tree).trim() };
}

export type StudyFormulaMode = "source" | "legacy";

/** A renderer can use old coordinates only when its text matches the stored projection. */
export function studyDocumentFormulaMode(
  markdown: string,
  canonical: string,
): StudyFormulaMode | undefined {
  if (!containsStudyMath(markdown)) return;
  const tree = readerTree(markdown, true);
  wrapStudyFormulas(tree, markdown);
  const compact = (text: string) => text.replace(/\s/gu, "");
  const expected = compact(canonical);
  if (compact(readerText(tree)) === expected) return "source";
  if (compact(readerText(tree, legacyStudyFormulaText)) === expected) return "legacy";
}
