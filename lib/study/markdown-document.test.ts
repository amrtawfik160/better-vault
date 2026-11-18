import { expect, it } from "vitest";
import { studyMarkdownContent } from "./markdown-document";

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
