import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StudyMathMarkdown from "./study-math-markdown";

describe("study math Markdown", () => {
  it("renders formulas and leaves paired dollar prices as text", () => {
    const content = renderToStaticMarkup(
      <StudyMathMarkdown text={"Prices rose from $5 to $10.\n\nThe ratio is $\\frac{a}{b}$."} />,
    );
    expect(content).toContain("Prices rose from $5 to $10.");
    expect(content.match(/<math\b/g)).toHaveLength(1);
    expect(content).toContain("<mfrac>");
  });

  it("keeps math accessible in Arabic prose and leaves code literal", () => {
    const content = renderToStaticMarkup(
      <StudyMathMarkdown
        text={"قانون نيوتن هو $F = ma$.\n\n```ts\n  const example = '$x$';\n```"}
      />,
    );
    expect(content).toContain('<p dir="rtl">');
    expect(content.match(/<math\b/g)).toHaveLength(1);
    expect(content).toContain('<pre dir="ltr">');
    expect(content).toContain("  const example = &#x27;$x$&#x27;;");
  });

  it("keeps the authored equation on the element enclosing the rendered glyphs", () => {
    const inline = "$\\frac{a_i}{b_i}$";
    const block = "$$\n\\sum_{i=1}^n x_i\n$$";
    const content = renderToStaticMarkup(
      <StudyMathMarkdown text={`Ratio ${inline}.\n\n${block}`} formulaMode="source" />,
    );
    expect(content).toContain(`<span data-study-formula="${inline}"><span class="katex">`);
    expect(content).toContain(`<div data-study-formula="${block}"><span class="katex-display">`);
    expect(content.match(/<math\b/g)).toHaveLength(2);
  });
});
