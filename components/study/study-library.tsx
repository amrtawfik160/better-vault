import { useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { deleteNotebook } from "@/lib/db/notebooks";
import { addStudyBook, renameStudyBook } from "@/lib/db/study";
import { readStudyFile } from "@/lib/study/read-file";
import type { StudyBook } from "@/lib/study/records";

export function StudyLibrary({
  books,
  openBook,
}: {
  books: StudyBook[];
  openBook: (book: StudyBook) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<StudyBook | null>(null);
  const [editing, setEditing] = useState<StudyBook | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);

  async function importBooks(files: File[]) {
    setLoading(true);
    try {
      for (const file of files) {
        try {
          openBook(await addStudyBook(await readStudyFile(file)));
        } catch (error) {
          toast.error(`${file.name} — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-5" aria-labelledby="study-library">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="study-library" className="text-xl font-semibold">
          Library
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => input.current?.click()} disabled={loading}>
            {loading ? "Importing…" : "Import documents"}
          </Button>
          <Button variant="outline" onClick={() => setDrafting(!drafting)}>
            New text document
          </Button>
          <Link
            to="/?view=notes"
            className="self-center text-sm underline-offset-4 hover:underline"
          >
            Notes workspace
          </Link>
        </div>
        <input
          ref={input}
          type="file"
          accept=".pdf,.epub,.txt,.md"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            if (files.length) void importBooks(files);
          }}
        />
      </div>
      {drafting ? (
        <form
          className="grid gap-2 rounded-2xl border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void addStudyBook({ title, format: "text", sections: [{ title, text }] })
              .then((book) => {
                setDrafting(false);
                setTitle("");
                setText("");
                openBook(book);
              })
              .catch((error: Error) => toast.error(error.message));
          }}
        >
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Document title"
            aria-label="Document title"
            required
          />
          <textarea
            dir="auto"
            aria-label="Document text"
            placeholder="Document text"
            className="min-h-28 rounded-xl border bg-background p-3"
            required
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            type="submit"
            className="justify-self-start"
            disabled={!title.trim() || !text.trim()}
          >
            Save document
          </Button>
        </form>
      ) : null}
      {books.length ? (
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a document"
          aria-label="Find a document"
        />
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {books
          .filter((book) => book.title.toLowerCase().includes(search.toLowerCase()))
          .map((book) => (
            <li key={book.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border p-4">
              {editing?.id === book.id ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void renameStudyBook(book, title)
                      .then(() => {
                        setEditing(null);
                        setTitle("");
                      })
                      .catch((error: Error) => toast.error(error.message));
                  }}
                >
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    aria-label="New document title"
                  />
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                </form>
              ) : (
                <button
                  type="button"
                  className="cursor-pointer text-start font-semibold hover:underline"
                  onClick={() => openBook(book)}
                  dir="auto"
                >
                  {book.title}
                </button>
              )}
              <p className="text-sm text-muted-foreground">
                {book.format.toUpperCase()} · {book.section + 1} of {book.sections.length}
              </p>
              <progress
                className="h-1 w-full accent-primary"
                max={book.sections.length}
                value={book.section + 1}
                aria-label="Reading progress"
              />
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDrafting(false);
                    setEditing(book);
                    setTitle(book.title);
                  }}
                >
                  Rename
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(book)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
      </ul>
      {!books.length ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Import a PDF or EPUB, or add a text document.
        </p>
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete document?"
        body="This also deletes its notebook, reading position, and associated study items."
        confirmLabel="Delete document"
        onConfirm={async () => {
          if (deleting) await deleteNotebook(deleting.notebookId);
          setDeleting(null);
        }}
      />
    </section>
  );
}
