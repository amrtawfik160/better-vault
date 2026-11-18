import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { newStudyCard, putStudyRecords } from "@/lib/db/study";
import { askStudyModel } from "@/lib/study/client";

type Draft = { front: string; back: string };

export function StudyFlashcardGenerator({ close }: { close: () => void }) {
  const [input, setInput] = useState("");
  const [count, setCount] = useState(5);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function generate() {
    const request = new AbortController();
    controller.current = request;
    setWorking(true);
    try {
      const answer = await askStudyModel({
        action: "cards",
        input: input.trim(),
        cardCount: count,
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        const cards = (answer.cards ?? []).filter(({ front, back }) => front.trim() && back.trim());
        if (!cards.length) toast.error("The model returned no flashcards.");
        else setDrafts(cards);
      }
    } catch (error) {
      if (!request.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setWorking(false);
      }
    }
  }

  async function save() {
    const cards = drafts
      .filter(({ front, back }) => front.trim() && back.trim())
      .map(({ front, back }) => newStudyCard({ front: front.trim(), back: back.trim(), tags: [] }));
    if (!cards.length) return;
    setSaving(true);
    try {
      await putStudyRecords(...cards);
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="space-y-4 rounded-2xl border bg-card p-4"
      aria-labelledby="study-draft-cards"
    >
      <h3 id="study-draft-cards" className="text-base font-semibold">
        Generate from text
      </h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim() && !working) void generate();
        }}
        className="space-y-2"
      >
        <textarea
          aria-label="Text for flashcards"
          placeholder="Paste the material you want to study"
          dir="auto"
          className="min-h-28 w-full rounded-lg border bg-background p-3 text-sm"
          value={input}
          disabled={working || saving}
          onChange={(event) => setInput(event.target.value)}
          maxLength={12000}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            Cards
            <Input
              type="number"
              min={1}
              max={20}
              value={count}
              disabled={working || saving}
              onChange={(event) => setCount(event.target.valueAsNumber || 1)}
              className="w-20"
            />
          </label>
          <Button type="submit" size="sm" disabled={!input.trim() || working || saving}>
            {working ? "Generating…" : drafts.length ? "Generate again" : "Generate cards"}
          </Button>
          {working ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => controller.current?.abort()}
            >
              Stop
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={close}>
            Close
          </Button>
        </div>
      </form>
      {drafts.length ? (
        <div className="space-y-2">
          <ul className="divide-y rounded-xl border">
            {drafts.map((draft, position) => (
              <li key={position} className="grid gap-2 p-3">
                <Input
                  aria-label={`Card ${position + 1} question`}
                  value={draft.front}
                  dir="auto"
                  disabled={working || saving}
                  onChange={(event) =>
                    setDrafts((items) =>
                      items.map((item, index) =>
                        index === position ? { ...item, front: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Card ${position + 1} answer`}
                  value={draft.back}
                  dir="auto"
                  disabled={working || saving}
                  onChange={(event) =>
                    setDrafts((items) =>
                      items.map((item, index) =>
                        index === position ? { ...item, back: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="justify-self-start"
                  disabled={working || saving}
                  onClick={() =>
                    setDrafts((items) => items.filter((_, index) => index !== position))
                  }
                >
                  Remove draft
                </Button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            disabled={
              working || saving || !drafts.some(({ front, back }) => front.trim() && back.trim())
            }
            onClick={() => void save()}
          >
            Save drafts to flashcards
          </Button>
        </div>
      ) : null}
    </section>
  );
}
