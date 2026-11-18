import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/panelui/button";
import { Menu } from "@/components/panelui/menu";
import { Textarea } from "@/components/panelui/textarea";
import { textDirection } from "@/lib/text/direction";

const styles = {
  headline: ["line", "# "],
  heading: ["line", "## "],
  subheading: ["line", "### "],
  bold: ["wrap", "**", "**"],
  italic: ["wrap", "*", "*"],
  strike: ["wrap", "~~", "~~"],
  bullet: ["line", "- "],
  numbered: ["numbered"],
  checklist: ["line", "- [ ] "],
  quote: ["line", "> "],
  inlineCode: ["wrap", "`", "`"],
  code: ["wrap", "\n\n```\n", "\n```\n\n"],
  link: ["wrap", "[", "](https://)"],
} as const;

export type StudyDocumentDraft = { text: string; markdown: boolean };

export function StudyDocumentEditor({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: StudyDocumentDraft;
  onChange: (value: StudyDocumentDraft) => void;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation("home");
  const input = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  function format(command: keyof typeof styles) {
    const field = input.current;
    if (!field) return;
    const [kind, before, after] = styles[command];
    const text = value.text;
    let from = field.selectionStart;
    let to = field.selectionEnd;
    let insert: string;
    let start = from;
    let end: number;
    if (kind === "wrap") {
      insert = text.slice(from, to);
      if (
        from >= before.length &&
        text.slice(from - before.length, from) === before &&
        text.startsWith(after, to)
      ) {
        from -= before.length;
        to += after.length;
        start = from;
      } else {
        start += before.length;
        insert = `${before}${insert}${after}`;
      }
      end = start + (field.selectionEnd - field.selectionStart);
    } else {
      from = from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1;
      const lineEnd = text.indexOf("\n", to);
      to = lineEnd === -1 ? text.length : lineEnd;
      insert = text
        .slice(from, to)
        .split("\n")
        .map((line, index) => `${kind === "numbered" ? `${index + 1}. ` : before}${line}`)
        .join("\n");
      start = from + insert.length;
      end = start;
    }
    onChange({ text: text.slice(0, from) + insert + text.slice(to), markdown: true });
    requestAnimationFrame(() => {
      if (input.current !== field) return;
      field.focus();
      field.setSelectionRange(start, end);
    });
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={value.markdown ? "secondary" : "outline"}
          aria-pressed={value.markdown}
          disabled={disabled}
          onClick={() => onChange({ ...value, markdown: !value.markdown })}
        >
          {t("study.documentEditor.markdown")}
        </Button>
        {value.markdown ? (
          <>
            <Menu>
              <Menu.Trigger
                render={<Button type="button" size="sm" variant="ghost" disabled={disabled} />}
              >
                {t("study.documentEditor.format")}
              </Menu.Trigger>
              <Menu.Content align="start">
                {(Object.keys(styles) as (keyof typeof styles)[]).map((name) => (
                  <Menu.Item key={name} onClick={() => format(name)}>
                    {t(`study.documentEditor.commands.${name}`)}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={showPreview}
              onClick={() => setShowPreview(!showPreview)}
            >
              {t("study.documentEditor.preview")}
            </Button>
          </>
        ) : null}
      </div>
      <Textarea
        ref={input}
        aria-label={label}
        dir={textDirection(value.text)}
        required
        minRows={5}
        maxRows={12}
        disabled={disabled}
        value={value.text}
        onChange={(event) => onChange({ ...value, text: event.target.value })}
        onKeyDown={(event) => {
          const key = event.key.toLowerCase();
          if (
            value.markdown &&
            (event.metaKey || event.ctrlKey) &&
            !event.altKey &&
            !event.shiftKey &&
            (key === "b" || key === "i")
          ) {
            event.preventDefault();
            format(key === "b" ? "bold" : "italic");
          }
        }}
      />
      {value.markdown && showPreview && value.text.trim() ? (
        <div
          role="region"
          aria-label={t("study.documentEditor.preview")}
          className="max-h-64 overflow-auto rounded-xl border p-3"
        >
          <Markdown text={value.text} staticContent />
        </div>
      ) : null}
    </div>
  );
}
