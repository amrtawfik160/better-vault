import { Add01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { OutputList } from "@/components/studio/output-list";
import { OutputViewer } from "@/components/studio/output-viewer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOutputs } from "@/lib/db/outputs";
import { useWorkspace } from "./workspace-context";

/** The Studio tab: the open output, or every output when none is open. */
export function StudioView() {
  const { t } = useTranslation("studio");
  const { notebook, openOutput, openOutputId, setStudioOpen, setCompanion } = useWorkspace();
  const outputs = useOutputs(notebook.id);

  if (openOutputId) return <OutputViewer id={openOutputId} />;

  if (outputs && outputs.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-sm text-center">
          <h2 className="text-sm font-medium">{t("view.emptyTitle")}</h2>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{t("view.emptyBody")}</p>
          {/* Tonal: the header's Practise this is the page's one filled button. */}
          <Button className="mt-5 border border-input" variant="secondary" onClick={() => {
              // The Studio sheet lives in the companion's Make tab.
              setCompanion("make");
              setStudioOpen(true);
            }}>
            <Icon icon={Add01Icon} />
            {t("view.openStudio")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-2xl px-4 pt-4 pb-10 sm:px-6">
        <h2 className="mb-3 px-1 text-sm font-medium text-muted-foreground">{t("view.all")}</h2>
        <OutputList notebookId={notebook.id} onOpen={(output) => openOutput(output.id)} />
      </div>
    </ScrollArea>
  );
}
