import { z } from "zod";
import { routes } from "@/lib/routes";
import { reviewReturnState } from "./review-session";

const tutorReturnSchema = z.object({ studyTutorReturn: z.string() });

function tutorSearch(path: string) {
  const [pathname, search] = path.split("?", 2);
  if (pathname !== routes.home) return;
  const params = new URLSearchParams(search);
  if (params.get("view") !== "study") return;
  const tab = params.get("tab");
  if (
    (tab === "tutor" && params.get("thread")) ||
    (tab === "library" && params.get("book") && params.get("readerTutor"))
  ) {
    return params;
  }
}

export function tutorReturnState(state: unknown) {
  const parsed = tutorReturnSchema.safeParse(state);
  if (parsed.success && tutorSearch(parsed.data.studyTutorReturn)) return parsed.data;
}

export function studyReturnState(state: unknown) {
  const review = reviewReturnState(state);
  const tutor = tutorReturnState(state);
  if (tutor) return { ...review, ...tutor };
  return review;
}

export type TutorReturnFocus = { message?: number; report?: { id: string; suggestion?: string } };

export function returnToTutor(path: string, state: unknown, focus: TutorReturnFocus = {}) {
  const params = tutorSearch(path);
  if (!params) return studyReturnState(state);
  params.delete("readerView");
  if (focus.message !== undefined) {
    params.set("message", String(focus.message));
    params.delete("report");
    params.delete("reportId");
    params.delete("suggestion");
  }
  if (focus.report) {
    params.delete("message");
    params.set("report", "1");
    params.set("reportId", focus.report.id);
    if (focus.report.suggestion) params.set("suggestion", focus.report.suggestion);
    else params.delete("suggestion");
  }
  return { ...reviewReturnState(state), studyTutorReturn: `${routes.home}?${params}` };
}
