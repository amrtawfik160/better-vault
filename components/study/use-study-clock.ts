import { useEffect, useState } from "react";
import type { StudyRecordOf } from "@/lib/study/records";

type ScheduledItem = Pick<StudyRecordOf<"card" | "highlight">, "schedule">;

export function useStudyClock(items: ScheduledItem[], cadence = 30_000) {
  const [now, setNow] = useState(Date.now);
  let nextDueAt = Infinity;
  for (const { schedule } of items) {
    if (schedule.dueAt > now) nextDueAt = Math.min(nextDueAt, schedule.dueAt);
  }

  useEffect(() => {
    const delay = Math.max(1, Math.min(cadence, nextDueAt - Date.now()));
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [cadence, nextDueAt, now]);

  useEffect(() => {
    const sync = () => setNow(Date.now());
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return now;
}
