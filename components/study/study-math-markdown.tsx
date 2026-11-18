import "katex/dist/katex.min.css";
import type { ComponentProps } from "react";
import type { Text } from "mdast";
import type { Node, Parent } from "unist";
import type { VFile } from "vfile";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { Markdown } from "@/components/chat/markdown";
import { cn } from "@/lib/utils";

function hasChildren(node: Node): node is Parent {
  return "children" in node && Array.isArray(node.children);
}

function remarkLiteralAmounts() {
  return (tree: Parent, file: VFile) => {
    const source = String(file);
    function restore(parent: Parent) {
      for (const [index, node] of parent.children.entries()) {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (node.type === "inlineMath" && start !== undefined && end !== undefined) {
          const original = source.slice(start, end);
          if (/^\$\d[^$]*\$$/.test(original) && /\d/.test(source[end] ?? "")) {
            const literal: Text = { type: "text", value: original };
            parent.children[index] = literal;
          }
        } else if (hasChildren(node)) restore(node);
      }
    }
    restore(tree);
  };
}

const plugins: ComponentProps<typeof Markdown>["plugins"] = {
  remarkPlugins: [remarkMath, remarkLiteralAmounts],
  rehypePlugins: [[rehypeKatex, { trust: false, maxSize: 20, maxExpand: 250, strict: "ignore" }]],
};

export default function StudyMathMarkdown(props: ComponentProps<typeof Markdown>) {
  return <Markdown {...props} plugins={plugins} className={cn("study-math", props.className)} />;
}
