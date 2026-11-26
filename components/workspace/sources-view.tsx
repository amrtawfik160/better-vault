import { Add01Icon, Book02Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { readingLink } from "@/components/sources/source-reader";
import { SourceRow } from "@/components/sources/source-row";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { setAllSourcesSelected, useSources } from "@/lib/db/sources";
import { sourceHasText } from "@/lib/db/source-text";
import type { Source } from "@/lib/db/types";
import { studyBookForSource } from "@/lib/db/study";
import { studyReturnState } from "@/lib/study/return-links";
import { useWorkspace } from "./workspace-context";

/** The Sources tab: everything in the notebook, and which of it is used. */
export function SourcesView() {
  const { t } = useTranslation("sources");
  const { notebook, setAddSourceOpen, readSource } = useWorkspace();
  const sources = useSources(notebook.id);
  const navigate = useNavigate();
  const { state } = useLocation();
  const [opening, setOpening] = useState(false);
  if (!sources) return null;

  /** Opens a source in the Study reader, making it a Study document the first time. */
  async function readInStudy(source: Source) {
    if (opening) return;
    setOpening(true);
    try {
      navigate(readingLink(await studyBookForSource(source.id), undefined), {
        state: studyReturnState(state),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setOpening(false);
    }
  }

  const readable = sources.filter(sourceHasText);
  const selected = readable.filter((source) => source.selected).length;
  const all = readable.length > 0 && selected === readable.length;

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-2xl px-4 pt-4 pb-10 sm:px-6">
        <div className="flex items-end justify-between gap-4 px-1">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("description")}</p>
          </div>
          {/* Outline: the header's Practise this is the page's one filled button. */}
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setAddSourceOpen(true)}>
            <Icon icon={Add01Icon} />
            {t("add")}
          </Button>
        </div>

        {sources.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Icon icon={Book02Icon} size={22} />
            </span>
            <h3 className="text-sm font-medium">{t("empty.title")}</h3>
            <p className="max-w-sm text-[0.8125rem] text-muted-foreground">{t("empty.body")}</p>
            <Button variant="secondary" className="mt-1 border border-input" onClick={() => setAddSourceOpen(true)}>
              <Icon icon={Add01Icon} />
              {t("add")}
            </Button>
          </div>
        ) : (
          <>
            {readable.length > 0 ? (
              <label className="mt-6 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <Checkbox
                  checked={all}
                  indeterminate={selected > 0 && !all}
                  onCheckedChange={(checked) => void setAllSourcesSelected(notebook.id, checked)}
                />
                <span className="font-medium">{t("selectAll")}</span>
                <span className="ms-auto text-xs text-muted-foreground">
                  {t("selected", { selected, total: readable.length })}
                </span>
              </label>
            ) : null}
            <ul className={readable.length ? "flex flex-col gap-0.5" : "mt-6 flex flex-col gap-0.5"}>
              {sources.map((source) => (
                <li key={source.id}>
                  <SourceRow
                    source={source}
                    onRead={() => readSource(source.id)}
                    onReadInStudy={
                      studyReadable(source) ? () => void readInStudy(source) : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </ScrollArea>
  );
}

/** Whether the Study reader has something to show: text, or the pages of a PDF or EPUB. */
function studyReadable(source: Source) {
  return (
    sourceHasText(source) ||
    (Boolean(source.originalFileId) && (source.kind === "pdf" || source.kind === "epub"))
  );
}
