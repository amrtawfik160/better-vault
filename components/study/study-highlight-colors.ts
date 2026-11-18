import type { StudyHighlightColor } from "@/lib/study/records";

export const highlightColors = {
  yellow: "bg-yellow-200 text-yellow-950 dark:bg-yellow-900 dark:text-yellow-100",
  green: "bg-green-200 text-green-950 dark:bg-green-900 dark:text-green-100",
  blue: "bg-blue-200 text-blue-950 dark:bg-blue-900 dark:text-blue-100",
  pink: "bg-pink-200 text-pink-950 dark:bg-pink-900 dark:text-pink-100",
  purple: "bg-purple-200 text-purple-950 dark:bg-purple-900 dark:text-purple-100",
} satisfies Record<StudyHighlightColor, string>;
