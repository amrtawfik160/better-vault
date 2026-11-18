import type { Source } from "./types";

export function sourceHasText({ text }: Pick<Source, "text">) {
  return Boolean(text.trim());
}

export function selectedTextSource(source: Pick<Source, "text" | "selected">) {
  return source.selected && sourceHasText(source);
}
