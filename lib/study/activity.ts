import type { StudyRecordOf } from "./records";

type StudySession = StudyRecordOf<"session">;

export function studyActivityGroups(sessions: readonly StudySession[]) {
  const groups = new Map<
    string,
    { key: string; latest: StudySession; seconds: number; count: number }
  >();
  for (const session of sessions) {
    const id = session.activity === "review" ? session.reviewSessionId : session.activitySessionId;
    const key = id ? `${session.activity}:${id}` : `entry:${session.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { key, latest: session, seconds: session.seconds, count: session.count });
      continue;
    }
    if (session.updatedAt > existing.latest.updatedAt) existing.latest = session;
    existing.seconds += session.seconds;
    existing.count += session.count;
  }
  return [...groups.values()].sort((a, b) => b.latest.updatedAt - a.latest.updatedAt);
}
