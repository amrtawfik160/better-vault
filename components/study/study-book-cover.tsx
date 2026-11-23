import { cn } from "@/lib/utils";
import type { StudyBook } from "@/lib/study/records";

/** Each cover takes one chart colour, chosen from its title, as a tint and a spine. */
const tints = [
  { cover: "border-chart-1/25 bg-chart-1/10", spine: "bg-chart-1" },
  { cover: "border-chart-2/30 bg-chart-2/15", spine: "bg-chart-2" },
  { cover: "border-chart-3/30 bg-chart-3/15", spine: "bg-chart-3" },
  { cover: "border-chart-4/30 bg-chart-4/15", spine: "bg-chart-4" },
  { cover: "border-chart-5/30 bg-chart-5/15", spine: "bg-chart-5" },
] as const;

export function studyCoverTint(title: string) {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return tints[hash % tints.length];
}

/** A thin bar for how far through a book the reader is, from 0 to 1. */
export function StudyProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const shown = Math.max(0, Math.min(1, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${shown * 100}%` }} />
    </div>
  );
}

/** A book cover drawn with the theme's tokens: the title in a reading serif, over a coloured spine. */
export function StudyBookCover({
  book,
  byline,
  className,
}: {
  book: Pick<StudyBook, "title" | "format">;
  byline?: string;
  className?: string;
}) {
  const tint = studyCoverTint(book.title);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex aspect-[2/3] shrink-0 flex-col justify-between gap-2 overflow-hidden rounded-s-sm rounded-e-xl border p-3 ps-5 text-start text-foreground shadow-sm",
        tint.cover,
        className,
      )}
    >
      <span className={cn("absolute inset-y-0 start-0 w-1.5", tint.spine)} />
      <span className="truncate text-[0.625rem] font-medium tracking-widest text-muted-foreground uppercase" dir="auto">
        {byline || book.format}
      </span>
      <span className="line-clamp-5 font-serif text-base leading-snug font-medium wrap-break-word" dir="auto">
        {book.title}
      </span>
      <span className="h-px w-8 bg-foreground/25" />
    </span>
  );
}
