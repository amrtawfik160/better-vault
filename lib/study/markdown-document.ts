import type { Root, RootContent } from "hast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";

function readerText(node: Root | RootContent): string {
  if (node.type === "text" || node.type === "raw") return node.value;
  if (node.type === "element" && node.tagName === "img") return String(node.properties.alt ?? "");
  if (node.type === "element" || node.type === "root")
    return node.children.map(readerText).join("");
  return "";
}

/** Study anchors and notebook sources use the same words the Markdown reader displays. */
export function studyMarkdownContent(markdown: string) {
  const body = markdown.replace(/\r\n?/g, "\n");
  const document = fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  return {
    markdown: body,
    text: readerText(toHast(document, { allowDangerousHtml: true })).trim(),
  };
}
