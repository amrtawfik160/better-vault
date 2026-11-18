import "katex/dist/katex.min.css";
import type { Root } from "hast";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import type { Parent } from "unist";
import type { VFile } from "vfile";
import { restoreStudyCurrency, wrapStudyFormulas } from "@/lib/study/markdown-math";

function remarkLiteralAmounts() {
  return (tree: Parent, file: VFile) => restoreStudyCurrency(tree, String(file));
}

function rehypeFormulaSource() {
  return (tree: Root, file: VFile) => wrapStudyFormulas(tree, String(file));
}

export default function NoteMathMarkdown({ remarkPlugins, rehypePlugins, ...props }: Options) {
  return (
    <ReactMarkdown
      {...props}
      remarkPlugins={[...(remarkPlugins ?? []), remarkMath, remarkLiteralAmounts]}
      rehypePlugins={[
        rehypeFormulaSource,
        ...(rehypePlugins ?? []),
        [rehypeKatex, { trust: false, maxSize: 20, maxExpand: 250, strict: "ignore" }],
      ]}
    />
  );
}
