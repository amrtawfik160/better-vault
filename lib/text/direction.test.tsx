import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { leftToRightRuns, textDirection, textLines } from "./direction";
import { rehypeDirection } from "./rehype-direction";

describe("mixed-language study text", () => {
  it.each([
    ["Kafka هو نظام لبث الأحداث.", "rtl"],
    ["ما هو Apache Kafka؟", "rtl"],
    ["The word كتاب means book.", "ltr"],
    ["Kubernetes מנהל קבוצות יישומים", "rtl"],
    ["123 :) 42", "auto"],
  ])("assigns the reading direction for %s", (text, direction) => {
    expect(textDirection(text)).toBe(direction);
  });

  it("keeps technical terms together and preserves the original characters", () => {
    const text = "شغّل kubectl get pods ثم نفّذ foo(bar).\nاكتب C++ بعد ذلك.";
    const runs = leftToRightRuns(text);
    expect(runs.filter(({ ltr }) => ltr).map(({ text }) => text)).toEqual([
      "kubectl get pods",
      "foo(bar)",
      "C++",
    ]);
    expect(runs.map(({ text }) => text).join("")).toBe(text);
    const source = `\n${text}\r\n\r\nEnglish follows.\n`;
    expect(textLines(source).join("")).toBe(source);
  });

  it("aligns mixed Markdown blocks and keeps code and links intact", () => {
    const markdown = [
      "## Kafka هو نظام لبث الأحداث",
      "",
      "The word كتاب means book.",
      "",
      "> استخدم [Apache Kafka](/kafka) ثم نفّذ `foo(bar)`.",
      "",
      "~~~js",
      "const answer = 42;",
      "~~~",
    ].join("\n");
    const markup = renderToStaticMarkup(
      <ReactMarkdown rehypePlugins={[rehypeDirection]}>{markdown}</ReactMarkdown>,
    );
    expect(markup).toContain('<h2 dir="rtl"><bdi dir="ltr">Kafka</bdi> هو نظام لبث الأحداث</h2>');
    expect(markup).toContain('<p dir="ltr">The word كتاب means book.</p>');
    expect(markup).toContain('<blockquote dir="rtl">');
    expect(markup).toContain('<a href="/kafka"><bdi dir="ltr">Apache Kafka</bdi></a>');
    expect(markup).toContain('<code dir="ltr">foo(bar)</code>');
    expect(markup).toContain('<pre dir="ltr"><code class="language-js">const answer = 42;');
  });
});
