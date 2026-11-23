import type { TFunction } from "i18next";

const day = 24 * 60 * 60_000;

function startOfDay(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** When something comes back for review, in words: "Due now", "Later today", "tomorrow", "in 5 days". */
export function studyDueLabel(t: TFunction<"home">, locale: string, dueAt: number, now: number) {
  if (dueAt <= now) return t("study.collection.dueNow");
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / day);
  if (days === 0) return t("study.collection.dueToday");
  if (days > 60) {
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(dueAt);
    return t("study.collection.dueOn", { date });
  }
  const when = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
  return t("study.collection.dueIn", { when });
}
