import { Note01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { saveStudyNote } from "@/lib/db/study";
import { useSource } from "@/lib/db/sources";
import { originHref } from "@/lib/study/links";
import type { StudyBook } from "@/lib/study/records";
import { studyReturnState } from "@/lib/study/return-links";
import { textDirection } from "@/lib/text/direction";
import { cn } from "@/lib/utils";
import { studioMakeHref } from "@/studio/make-link";
import { studioTools, type StudioToolId } from "@/studio/tools";
import { useBookNotes } from "./use-book-notes";

const makeTools: StudioToolId[] = ["mind-map", "flashcards", "quiz", "report"];

/**
 * Connects a Study book to the rest of the app: Studio tools made from it,
 * and the notes about it, with a way to start one.
 */
export function StudyMakeFromBook({
  book,
  className,
  compact = false,
}: {
  book: StudyBook;
  className?: string;
  /** Tighter layout for side panels. */
  compact?: boolean;
}) {
  const { t } = useTranslation("home");
  const { t: tStudio } = useTranslation("studio");
  const navigate = useNavigate();
  const location = useLocation();
  const returnState = studyReturnState(location.state);
  const notes = useBookNotes(book);
  const source = useSource(book.sourceId);

  function newNote() {
    void saveStudyNote({
      title: t("study.make.noteTitle", { title: book.title }),
      body: "",
      origin: { kind: "book", bookId: book.id },
      notebookId: book.notebookId,
    })
      .then((note) => {
        toast.success(t("study.make.noteCreated"), {
          action: {
            label: t("study.make.openNote"),
            onClick: () => navigate(originHref({ kind: "note", noteId: note.id }), { state: returnState }),
          },
        });
      })
      .catch((error: Error) => toast.error(error.message));
  }

  return (
    <section className={cn("flex min-w-0 flex-col gap-4", className)} aria-label={t("study.make.title", { title: book.title })}>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold" dir="auto">
          {t("study.make.title", { title: book.title })}
        </h3>
        <p className="text-xs text-muted-foreground">{t("study.make.hint")}</p>
      </div>
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
        {makeTools.map((id) => (
          <Link
            key={id}
            to={studioMakeHref(book.notebookId, id, book.sourceId)}
            state={returnState}
            className="flex min-h-16 flex-col items-start justify-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon icon={studioTools[id].icon} size={18} className={studioTools[id].tint} />
            {tStudio(`tools.${id}.name`)}
          </Link>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">{t("study.make.notesTitle")}</h4>
        {notes?.length ? (
          <ul className="flex flex-col gap-1">
            {notes.slice(0, compact ? 5 : 3).map((note) => (
              <li key={note.id}>
                <Link
                  to={originHref({ kind: "note", noteId: note.id })}
                  state={returnState}
                  className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon icon={Note01Icon} size={16} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate" dir={textDirection(note.title)}>{note.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : notes ? (
          <p className="text-xs text-muted-foreground">
            {t("study.make.noNotes", { source: source?.title ?? book.title })}
          </p>
        ) : null}
        <Button size="sm" variant="outline" className="self-start" onClick={newNote}>
          <Icon icon={PlusSignIcon} size={16} />
          {t("study.make.newNote")}
        </Button>
      </div>
    </section>
  );
}
