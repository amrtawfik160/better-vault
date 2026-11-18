import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { useId, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { directionalInline } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { searchStudyDocument, type StudySearchMatch } from "@/lib/study/locators";
import type { StudyBook } from "@/lib/study/records";
import { textDirection } from "@/lib/text/direction";

const matchesPerPage = 15;

export function StudyDocumentSearch({
  input,
  sections,
  active,
  open,
  study,
}: {
  input: RefObject<HTMLInputElement | null>;
  sections: StudyBook["sections"];
  active?: StudySearchMatch;
  open: (match: StudySearchMatch) => void;
  study: (match: StudySearchMatch) => void;
}) {
  const { t } = useTranslation("home");
  const resultsId = useId();
  const resultsButton = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(matchesPerPage);
  const query = search.trim();
  const matches = useMemo(() => searchStudyDocument(sections, query), [sections, query]);
  const index = active
    ? matches.findIndex(({ section, offset, length }) =>
        section === active.section && offset === active.offset && length === active.length,
      )
    : -1;
  const match = matches[index];
  const canMove = Boolean(matches.length && (index < 0 || matches.length > 1));

  function openMatch(match: StudySearchMatch) {
    setExpanded(false);
    open(match);
  }

  function step(direction: -1 | 1) {
    if (!canMove) return;
    const next = index < 0 ? (direction === 1 ? 0 : matches.length - 1) : index + direction;
    openMatch(matches[(next + matches.length) % matches.length]);
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          ref={input}
          type="search"
          value={search}
          dir={textDirection(search)}
          className="min-w-0 flex-[1_1_11rem]"
          onChange={(event) => {
            setSearch(event.target.value);
            setExpanded(true);
            setVisibleCount(matchesPerPage);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && matches.length) {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape" && expanded && matches.length) {
              event.preventDefault();
              setExpanded(false);
            }
          }}
          placeholder={t("study.reader.search")}
          aria-label={t("study.reader.search")}
        />
        {query ? (
          <span role="status" className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {match
              ? t("study.reader.currentMatch", { current: index + 1, count: matches.length })
              : matches.length
                ? t("study.reader.matchCount", { count: matches.length })
                : t("study.capture.noMatches")}
          </span>
        ) : null}
        {matches.length ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button size="icon-sm" variant="ghost" disabled={!canMove} aria-label={t("study.reader.previousMatch")} onClick={() => step(-1)}>
              <Icon icon={ArrowUp01Icon} size={16} />
            </Button>
            <Button size="icon-sm" variant="ghost" disabled={!canMove} aria-label={t("study.reader.nextMatch")} onClick={() => step(1)}>
              <Icon icon={ArrowDown01Icon} size={16} />
            </Button>
            <Button
              ref={resultsButton}
              size="sm"
              variant="ghost"
              aria-expanded={expanded}
              aria-controls={expanded ? resultsId : undefined}
              onClick={() => setExpanded(!expanded)}
            >
              {t("study.reader.searchResults")}
            </Button>
            {match ? (
              <Button size="sm" variant="outline" onClick={() => {
                setExpanded(false);
                study(match);
              }}>
                {t("study.reader.studyMatch")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {expanded && matches.length ? (
        <ul id={resultsId} className="absolute inset-x-0 top-full mt-1 max-h-[min(12rem,30dvh)] space-y-1 overflow-auto rounded-xl border bg-popover p-1 text-sm shadow-md">
          {matches.slice(0, visibleCount).map((result) => {
            const { section, offset, length } = result;
            const { text, title } = sections[section];
            const before = text.slice(Math.max(0, offset - 42), offset).trimStart();
            const quote = text.slice(offset, offset + length);
            const after = text.slice(offset + length, offset + length + 66).trimEnd();
            const direction = textDirection(before + quote + after);
            return (
              <li key={`${section}:${offset}`}>
                <button
                  type="button"
                  aria-current={result === match ? "true" : undefined}
                  className="w-full cursor-pointer rounded-lg p-2 text-start outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-muted"
                  onClick={(event) => {
                    if (!event.detail) resultsButton.current?.focus({ preventScroll: true });
                    openMatch(result);
                  }}
                >
                  <span className="block font-medium" dir="auto">{title}</span>
                  <span className="line-clamp-2 wrap-break-word text-muted-foreground" dir={direction}>
                    {directionalInline(before, direction)}
                    <mark className="bg-transparent font-semibold text-foreground">{directionalInline(quote, direction)}</mark>
                    {directionalInline(after, direction)}
                  </span>
                </button>
              </li>
            );
          })}
          {visibleCount < matches.length ? (
            <li>
              <Button size="sm" variant="ghost" onClick={() => setVisibleCount(visibleCount + matchesPerPage)}>
                {t("study.reader.moreMatches")}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
