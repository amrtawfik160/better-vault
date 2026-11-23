import { BookOpen01Icon } from "@hugeicons/core-free-icons";
import { getToolName, isToolUIPart } from "ai";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import type { ChatMessage } from "@/lib/chat/types";
import { isReaderTool, type ReaderContext } from "@/lib/study/reader-chat";
import { SearchStatus } from "./answer-references";

export interface BookLinks {
  /** What the book calls its parts. */
  noun: ReaderContext["noun"];
  open: (section: number) => void;
}

type Part = ChatMessage["parts"][number];

function inputOf(part: Part): { section?: unknown; query?: unknown } {
  return isToolUIPart(part) && part.input && typeof part.input === "object"
    ? (part.input as { section?: unknown; query?: unknown })
    : {};
}

/** Whether the answer is still reading the book. */
export function readingBook(parts: ChatMessage["parts"]) {
  return parts.some(
    (part) =>
      isToolUIPart(part) && isReaderTool(getToolName(part)) && part.state !== "output-available",
  );
}

/**
 * What an Ask AI answer did with the book: while it reads, the part it is
 * reading; once done, the sections it read, each opening in the reader.
 */
export function BookActivity({
  parts,
  streaming,
  book,
}: {
  parts: ChatMessage["parts"];
  streaming: boolean;
  book: BookLinks;
}) {
  const { t } = useTranslation("chat");
  const noun = t(`book.nouns.${book.noun}`);
  const calls = parts.filter((part) => isToolUIPart(part) && isReaderTool(getToolName(part)));
  if (calls.length === 0) return null;

  const pending = calls.find((part) => isToolUIPart(part) && part.state !== "output-available");
  if (streaming && pending) {
    const name = getToolName(pending as Extract<Part, { toolCallId: string }>);
    const { section, query } = inputOf(pending);
    const label =
      name === "read_section" && typeof section === "number"
        ? t("book.reading", { noun, section })
        : name === "search_book" && typeof query === "string"
          ? t("book.searching", { query })
          : t("book.contents");
    return <SearchStatus label={label} />;
  }

  const read = [
    ...new Set(
      calls.flatMap((part) => {
        const { section } = inputOf(part);
        return isToolUIPart(part) &&
          getToolName(part) === "read_section" &&
          typeof section === "number"
          ? [section]
          : [];
      }),
    ),
  ].sort((a, b) => a - b);
  if (read.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Icon icon={BookOpen01Icon} size={14} />
      <span>{t("book.read")}</span>
      {read.map((section) => (
        <button
          key={section}
          type="button"
          onClick={() => book.open(section)}
          aria-label={t("book.open", { noun, section })}
          className="cursor-pointer rounded-full border px-2 py-0.5 tabular-nums transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {noun} {section}
        </button>
      ))}
    </div>
  );
}
