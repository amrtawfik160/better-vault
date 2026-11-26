import type { KeyboardEvent } from "react";

/**
 * Arrow keys, Home and End for a `role="radiogroup"` of buttons, so the group
 * is one tab stop: give the checked button `tabIndex={0}` and the others -1,
 * and pass each button's key handler here. Left and Right follow the
 * reading direction; the newly checked button takes focus.
 */
export function onRadioKeys<Value>(
  event: KeyboardEvent<HTMLElement>,
  values: readonly Value[],
  current: Value,
  choose: (value: Value) => void,
) {
  const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
  const at = Math.max(0, values.indexOf(current));
  const step =
    event.key === "ArrowDown" || event.key === (rtl ? "ArrowLeft" : "ArrowRight")
      ? 1
      : event.key === "ArrowUp" || event.key === (rtl ? "ArrowRight" : "ArrowLeft")
        ? -1
        : 0;
  let next: number | null = null;
  if (step) next = (at + step + values.length) % values.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = values.length - 1;
  if (next === null) return;
  event.preventDefault();
  choose(values[next]);
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const buttons = group?.querySelectorAll<HTMLElement>('[role="radio"]');
  buttons?.[next]?.focus();
}
