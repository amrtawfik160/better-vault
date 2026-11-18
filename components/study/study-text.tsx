import { lazy, Suspense } from "react";
import { Markdown } from "@/components/chat/markdown";
import { DirectionalText } from "@/components/common/directional-text";
import { cn } from "@/lib/utils";

const StudyMathMarkdown = lazy(() => import("./study-math-markdown"));
const math = /(?:\$\$|(?:^|[^\\$])\$[^\n$]+\$|^ {0,3}(?:`{3,}|~{3,})[ \t]*math\b)/m;
const code = /^ {0,3}(?:`{3,}|~{3,})|`[^`\n]+`/m;

export function StudyText({
  text,
  className,
  prose = false,
}: {
  text: string;
  className?: string;
  prose?: boolean;
}) {
  const usesMath = math.test(text);
  if (!usesMath && !prose && !code.test(text)) {
    return (
      <DirectionalText multiline text={text} className={cn("whitespace-pre-wrap", className)} />
    );
  }

  const props = {
    text,
    className: cn("max-w-full min-w-0", !prose && "[&_p]:whitespace-pre-line", className),
    staticContent: !prose,
  };
  const fallback = <Markdown {...props} />;
  return usesMath ? (
    <Suspense fallback={fallback}>
      <StudyMathMarkdown {...props} />
    </Suspense>
  ) : (
    fallback
  );
}
