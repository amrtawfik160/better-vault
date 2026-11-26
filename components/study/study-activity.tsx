import { useTranslation } from "react-i18next";
import { DirectionalText } from "@/components/common/directional-text";
import { studyActivityGroups } from "@/lib/study/activity";
import { studyHighlightOrigin } from "@/lib/study/links";
import { studyHighlightPreview } from "@/lib/study/recall";
import type { StudyOrigin, StudyRecord, StudyRecordOf } from "@/lib/study/records";
import { StudyOriginLink } from "./study-origin-link";

type StudySession = StudyRecordOf<"session">;

function activityTarget(
  session: StudySession,
  records: ReadonlyMap<string, StudyRecord>,
): { title: string; origin: StudyOrigin } | undefined {
  const source = session.origin;
  if (session.activity === "reading" && source?.kind === "book") {
    const book = records.get(source.bookId);
    if (book?.kind === "book")
      return { title: book.title, origin: { kind: "book", bookId: book.id } };
  }
  if (session.activity === "speaking" && source?.kind === "tutor") {
    const thread = records.get(source.threadId);
    if (thread?.kind === "thread") return { title: thread.title, origin: source };
  }
  if (session.activity === "review" && session.itemId) {
    const item = records.get(session.itemId);
    if (item?.kind === "card")
      return { title: item.front, origin: { kind: "card", cardId: item.id } };
    if (item?.kind === "highlight" && records.get(item.bookId)?.kind === "book")
      return { title: item.cue || item.quote, origin: studyHighlightOrigin(item) };
  }
}

export function StudyActivity({
  rows,
  sessions,
}: {
  rows: StudyRecord[];
  sessions: StudySession[];
}) {
  const { t, i18n } = useTranslation("home");
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  const recent = studyActivityGroups(sessions).slice(0, 10);
  const records = new Map(rows.map((record) => [record.id, record]));
  return (
    <section className="space-y-2" aria-label={t("study.today.activityTitle")}>
      <h3 className="font-semibold">{t("study.today.activityTitle")}</h3>
      {recent.length ? (
        <ul className="divide-y rounded-2xl border">
          {recent.map(({ key, latest, count, seconds }) => {
            const target = activityTarget(latest, records);
            const duration =
              seconds > 0 && seconds < 60
                ? t("study.today.underMinute")
                : t("study.today.minutes", { count: Math.floor(seconds / 60) });
            const timestamp = new Date(latest.updatedAt);
            return (
              <li key={key} className="space-y-1 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-medium">{t(`study.today.activity.${latest.activity}`)}</p>
                  <time
                    dateTime={timestamp.toISOString()}
                    className="text-xs text-muted-foreground"
                  >
                    {dates.format(timestamp)}
                  </time>
                </div>
                <p className="text-muted-foreground">
                  {latest.activity === "review"
                    ? t("study.today.reviewCount", { count }) + " · "
                    : ""}
                  {duration}
                </p>
                {target ? (
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <DirectionalText
                      as="span"
                      text={studyHighlightPreview(target.title)}
                      className="min-w-0 wrap-break-word"
                    />
                    <StudyOriginLink
                      origin={target.origin}
                      label={
                        latest.activity === "reading" ? t("study.today.resumeReading") : undefined
                      }
                    />
                  </div>
                ) : null}
                {latest.rating ? (
                  <p className="text-xs text-muted-foreground">
                    {t("study.today.lastRating", {
                      rating: t(`study.recall.rating.${latest.rating}`),
                    })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("study.today.activityEmpty")}</p>
      )}
    </section>
  );
}
