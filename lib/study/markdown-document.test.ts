import { expect, it } from "vitest";
import {
  legacyStudyFormulaText,
  studyDocumentFormulaMode,
  studyMarkdownContent,
} from "./markdown-document";

it("keeps the visible words, link labels, and code whitespace used by passage anchors", () => {
  const source = `# Agreement

Any **two** majorities intersect &amp; carry state.

[Proof](https://example.test/proof) and ![Replica diagram](https://example.test/image.png)

| Term | Meaning |
| --- | --- |
| Quorum | Majority |

~~~ts
function accepted() {
  return true;
}
~~~`;
  const { text, markdown } = studyMarkdownContent(source.replaceAll("\n", "\r\n"));
  expect(markdown).toBe(source);
  expect(text).toContain("Agreement\nAny two majorities intersect & carry state.");
  expect(text).toContain("Proof and Replica diagram");
  expect(text).toMatch(/Term\s+Meaning\s+Quorum\s+Majority/);
  expect(text).toContain("function accepted() {\n  return true;\n}");
  expect(text).not.toContain("https://");
});

it("saves authored formulas and supports the older visible text coordinates", () => {
  const inline = "$\\frac{a_i}{b_i}$";
  const block = "$$\n\\left\\{x_1, x_2\\right\\}\n$$";
  const fenced = "~~~math\nE=mc^2\n~~~";
  const source = `It costs $5 to $10. Compare ${inline}.\n\n${block}\n\n${fenced}`;
  const { text } = studyMarkdownContent(source);
  expect(text).toContain(`It costs $5 to $10. Compare ${inline}.`);
  expect(text).toContain(block);
  expect(text).toContain(fenced);
  expect(studyDocumentFormulaMode(source, text)).toBe("source");
  expect(studyDocumentFormulaMode(source, legacyStudyFormulaText(source))).toBe("legacy");
  expect(studyDocumentFormulaMode(source, "Unrelated stored passage")).toBeUndefined();
});
