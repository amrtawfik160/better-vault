import type { StudyRating, StudySchedule } from "./records";

const minute = 60_000;
const day = 24 * 60 * minute;
const matureAfter = 21;

export function freshSchedule(now = Date.now()): StudySchedule {
  return {
    dueAt: now,
    intervalDays: 0,
    repetitions: 0,
    ease: 2.5,
    state: "new",
    step: 0,
    lapses: 0,
  };
}

export function scheduleState(schedule: StudySchedule) {
  return (
    schedule.state ??
    (schedule.intervalDays >= matureAfter
      ? "mature"
      : schedule.intervalDays > 0
        ? "reviewing"
        : "new")
  );
}

export function nextStudySchedule(
  current: StudySchedule,
  rating: StudyRating,
  now = Date.now(),
): StudySchedule {
  const state = scheduleState(current);
  const isLearning = state === "new" || state === "learning";
  const lapses = current.lapses ?? 0;
  const learning = (
    minutes: number,
    step: 0 | 1,
    change: Partial<StudySchedule> = {},
  ): StudySchedule => ({
    ...current,
    state: "learning",
    step,
    lapses,
    dueAt: now + minutes * minute,
    ...change,
  });
  const graduate = (days: number, ease: number): StudySchedule => ({
    dueAt: now + days * day,
    intervalDays: days,
    repetitions: current.repetitions + 1,
    ease: Math.max(1.3, ease),
    state: days >= matureAfter ? "mature" : "reviewing",
    step: 0,
    lapses,
  });

  if (isLearning) {
    const step = current.step ?? 0;
    const interval = Math.max(1, current.intervalDays);
    switch (rating) {
      case "again":
        return learning(1, 0);
      case "hard":
        return learning(step === 0 ? 5 : 10, step);
      case "good":
        return step === 0 ? learning(10, 1) : graduate(interval, current.ease);
      case "easy":
        return graduate(Math.max(4, interval + 1), current.ease);
    }
  }

  const hard = Math.max(1, Math.round(current.intervalDays * 1.2));
  const good = Math.max(hard + 1, Math.round(current.intervalDays * current.ease));
  const easy = Math.max(good + 1, Math.round(current.intervalDays * current.ease * 1.3));
  switch (rating) {
    case "again":
      return learning(10, 0, {
        intervalDays: Math.max(1, Math.round(current.intervalDays / 2)),
        ease: Math.max(1.3, current.ease - 0.2),
        lapses: lapses + 1,
      });
    case "hard":
      return graduate(hard, current.ease - 0.15);
    case "good":
      return graduate(good, current.ease);
    case "easy":
      return graduate(easy, current.ease + 0.15);
  }
}

export function studyIntervalLabel(schedule: StudySchedule, rating: StudyRating) {
  const wait = nextStudySchedule(schedule, rating, 0).dueAt;
  return wait < day ? `${Math.round(wait / minute)} min` : `${Math.round(wait / day)}d`;
}
