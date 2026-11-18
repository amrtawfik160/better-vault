import type { Element, Root } from "hast";
import type { Text } from "mdast";
import type { Node, Parent } from "unist";

export const studyFormulaAttribute = "data-study-formula";

export function containsStudyMath(text: string) {
  return /(?:\$\$|(?:^|[^\\$])\$[^$]+\$|^ {0,3}(?:`{3,}|~{3,})[ \t]*math\b)/m.test(text);
}

function hasChildren(node: Node): node is Parent {
  return "children" in node && Array.isArray(node.children);
}

export function restoreStudyCurrency(tree: Parent, source: string) {
  for (const [index, node] of tree.children.entries()) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === "inlineMath" && start !== undefined && end !== undefined) {
      const original = source.slice(start, end);
      if (/^\$\d[^$]*\$$/.test(original) && /\d/.test(source[end] ?? "")) {
        const literal: Text = { type: "text", value: original };
        tree.children[index] = literal;
      }
    } else if (hasChildren(node)) restoreStudyCurrency(node, source);
  }
}

function isMathCode(node: Root["children"][number], kind: string) {
  return (
    node.type === "element" &&
    node.tagName === "code" &&
    Array.isArray(node.properties.className) &&
    node.properties.className.includes(kind)
  );
}

/** Keep a formula's source attached to the element that survives KaTeX rendering. */
export function wrapStudyFormulas(
  tree: Root,
  source: string,
  project: (raw: string) => string = (raw) => raw,
) {
  function wrap(parent: Element | Root) {
    parent.children.forEach((node, index) => {
      if (node.type !== "element") return;
      const block =
        node.tagName === "pre" && node.children.some((child) => isMathCode(child, "language-math"));
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if ((block || isMathCode(node, "math-inline")) && start !== undefined && end !== undefined) {
        parent.children[index] = {
          type: "element",
          tagName: block ? "div" : "span",
          properties: { [studyFormulaAttribute]: project(source.slice(start, end)) },
          children: [node],
        };
      } else wrap(node);
    });
  }
  wrap(tree);
}
