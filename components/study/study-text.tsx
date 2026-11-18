import { lazy, Suspense, type ComponentProps } from "react";
import { Markdown } from "@/components/chat/markdown";
import { DirectionalText } from "@/components/common/directional-text";
import type { StudyFormulaMode } from "@/lib/study/markdown-document";
import { containsStudyMath } from "@/lib/study/markdown-math";
import { cn } from "@/lib/utils";

const StudyMathMarkdown = lazy(() => import("./study-math-markdown"));
const code = /^ {0,3}(?:`{3,}|~{3,})|`[^`\n]+`/m;

export function StudyMarkdown({
  math = false,
  onMathReady,
  ...props
}: ComponentProps<typeof Markdown> & {
  math?: boolean | StudyFormulaMode;
  onMathReady?: () => void;
}) {
  const fallback = <Markdown {...props} />;
  return math ? (
    <Suspense fallback={fallback}>
      <StudyMathMarkdown
        {...props}
        formulaMode={typeof math === "string" ? math : undefined}
        onReady={onMathReady}
      />
    </Suspense>
  ) : (
    fallback
  );
}

export function StudyText({
  text,
  className,
  prose = false,
}: {
  text: string;
  className?: string;
  prose?: boolean;
}) {
  const usesMath = containsStudyMath(text);
  if (!usesMath && !prose && !code.test(text)) {
    return (
      <DirectionalText
        multiline
        text={text.replace(/(?<!\\)\\\$/g, "$")}
        className={cn("whitespace-pre-wrap", className)}
      />
    );
  }

  const props = {
    text,
    className: cn("max-w-full min-w-0", !prose && "[&_p]:whitespace-pre-line", className),
    staticContent: !prose,
  };
  return <StudyMarkdown {...props} math={usesMath} />;
}
