import type { ReactNode } from "react";
import { directionalInline } from "@/components/common/directional-text";
import { timestampMarker } from "@/lib/sources/transcript";
import type { TextDirection } from "@/lib/text/direction";

/** Where a line's `[mm:ss]` marker ends, as an offset in the line (0 when it has none). */
export const timestampEnd = (line: string) => timestampMarker.exec(line)?.[0].length ?? 0;

/**
 * Part of a reader line, `text.slice(from, to)`, with a transcript's `[mm:ss]`
 * marker (ending at `markerEnd`) drawn as a small chip. Only the look changes:
 * the brackets stay in the page for screen readers and copying, so every
 * character still maps to the same offset in the stored text.
 */
export function withTimestampChip(
  text: string,
  from: number,
  to: number,
  markerStart: number,
  markerEnd: number,
  direction: TextDirection,
): ReactNode {
  if (from >= markerEnd || to <= markerStart) return directionalInline(text.slice(from, to), direction);
  const end = Math.min(to, markerEnd);
  const chip = text.slice(from, end);
  const open = from === markerStart && chip.startsWith("[");
  const close = end === markerEnd && chip.endsWith("]");
  const inner = chip.slice(open ? 1 : 0, close ? chip.length - 1 : chip.length);
  const rest = end < to ? directionalInline(text.slice(end, to), direction) : null;
  // Only a bracket of the marker (a highlight starts or ends next to it): no chip of its own.
  if (!inner)
    return [
      <span key={`timestamp-${from}`} className="sr-only">
        {chip}
      </span>,
      rest,
    ];
  return [
    <span
      key={`timestamp-${from}`}
      dir="ltr"
      data-study-timestamp=""
      className="me-0.5 inline-block rounded-md bg-muted px-1.5 align-[0.1em] font-sans text-[0.72em] leading-[1.6] font-medium tabular-nums text-muted-foreground"
    >
      {open ? <span className="sr-only">[</span> : null}
      {inner}
      {close ? <span className="sr-only">]</span> : null}
    </span>,
    rest,
  ];
}
