import "katex/dist/katex.min.css";
import { useLayoutEffect, useMemo, type ComponentProps } from "react";
import type { Root } from "hast";
import type { Parent } from "unist";
import type { VFile } from "vfile";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { Markdown } from "@/components/chat/markdown";
import { legacyStudyFormulaText, type StudyFormulaMode } from "@/lib/study/markdown-document";
import { restoreStudyCurrency, wrapStudyFormulas } from "@/lib/study/markdown-math";
import { cn } from "@/lib/utils";

function remarkLiteralAmounts() {
  return (tree: Parent, file: VFile) => restoreStudyCurrency(tree, String(file));
}

function rehypeStudyFormulaSource(mode: StudyFormulaMode) {
  return (tree: Root, file: VFile) => {
    wrapStudyFormulas(tree, String(file), mode === "legacy" ? legacyStudyFormulaText : undefined);
  };
}

export default function StudyMathMarkdown({
  formulaMode,
  onReady,
  ...props
}: ComponentProps<typeof Markdown> & { formulaMode?: StudyFormulaMode; onReady?: () => void }) {
  const plugins = useMemo<ComponentProps<typeof Markdown>["plugins"]>(
    () => ({
      remarkPlugins: [remarkMath, remarkLiteralAmounts],
      rehypePlugins: [
        ...(formulaMode
          ? [
              [rehypeStudyFormulaSource, formulaMode] satisfies [
                typeof rehypeStudyFormulaSource,
                StudyFormulaMode,
              ],
            ]
          : []),
        [rehypeKatex, { trust: false, maxSize: 20, maxExpand: 250, strict: "ignore" }],
      ],
    }),
    [formulaMode],
  );
  useLayoutEffect(() => onReady?.(), [onReady]);
  return <Markdown {...props} plugins={plugins} className={cn("study-math", props.className)} />;
}
