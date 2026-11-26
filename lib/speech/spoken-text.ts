/**
 * Text as it should be heard: Markdown's marks, links' addresses, citation
 * numbers and code fences are left out, so the voice doesn't read them.
 */
export function spokenText(text: string) {
  return (
    text
      // Code blocks are not read aloud.
      .replace(/```[\s\S]*?```/g, " ")
      // Images, then links: keep their words.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Citation marks such as [1] or [2, 3].
      .replace(/[ \t]*\[\d+(?:\s*,\s*\d+)*\]/g, "")
      // Headings, quotes and list marks at the start of a line.
      .replace(/^[ \t]{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
      // Emphasis and inline code.
      .replace(/(\*\*|__|\*|_|`|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
      // Table rules and pipes.
      .replace(/^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$/gm, "")
      .replace(/[ \t]*\|[ \t]*/g, ", ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
