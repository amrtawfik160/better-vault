import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import { leftToRightRuns, textDirection, type TextDirection } from "./direction";

const blocks = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "blockquote",
  "table",
  "th",
  "td",
]);
const fixedLtr = new Set(["code", "pre", "kbd", "samp"]);

function prose(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || fixedLtr.has(node.tagName)) return " ";
  const text = node.children.map(prose).join("");
  return blocks.has(node.tagName) || node.tagName === "li" ? ` ${text} ` : text;
}

function directionChildren<T extends RootContent>(nodes: T[], inherited: TextDirection) {
  const children: (T | Text | Element)[] = [];
  for (const child of nodes) {
    if (child.type === "element") {
      if (fixedLtr.has(child.tagName)) {
        child.properties.dir = "ltr";
      } else {
        const block = blocks.has(child.tagName);
        const direction = block ? textDirection(prose(child)) : inherited;
        if (block) child.properties.dir = direction;
        child.children = directionChildren(
          child.children,
          direction === "auto" ? inherited : direction,
        );
      }
    } else if (child.type === "text" && inherited === "rtl") {
      for (const run of leftToRightRuns(child.value)) {
        const text: Text = { type: "text", value: run.text };
        children.push(
          run.ltr
            ? { type: "element", tagName: "bdi", properties: { dir: "ltr" }, children: [text] }
            : text,
        );
      }
      continue;
    }
    children.push(child);
  }
  return children;
}

export function rehypeDirection() {
  return (tree: Root) => {
    tree.children = directionChildren(tree.children, "ltr");
  };
}
