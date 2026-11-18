import { Link } from "react-router";
import { originHref, originLabel } from "@/lib/study/links";
import type { StudyOrigin } from "@/lib/study/records";

export function StudyOriginLink({ origin, label }: { origin: StudyOrigin; label?: string }) {
  return (
    <Link
      to={originHref(origin)}
      className="inline-flex rounded-lg px-2 py-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label ?? originLabel(origin)}
    </Link>
  );
}
