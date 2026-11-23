import type { ReactElement } from "react";
import { Tooltip } from "@/components/panelui/tooltip";

/** A reader control's name, with its keyboard shortcut when it has one. */
export function ReaderTip({
  label,
  keys,
  side,
  children,
}: {
  label: string;
  keys?: string[];
  side?: "top" | "bottom";
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <Tooltip.Trigger render={children} />
      <Tooltip.Content variant={keys ? "shortcut" : "solid"} side={side}>
        {label}
        {keys ? <Tooltip.Shortcut keys={keys} /> : null}
      </Tooltip.Content>
    </Tooltip>
  );
}
