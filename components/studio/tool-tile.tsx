import { useTranslation } from "react-i18next";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { cn } from "@/lib/utils";
import type { StudioToolMeta } from "@/studio/tools";

/** One Studio tool in the sheet's grid: a tinted icon and its name, and a key mark when it needs one. */
export function ToolTile({
  tool,
  onSelect,
  badge,
  className,
}: {
  tool: StudioToolMeta;
  onSelect: () => void;
  badge?: string;
  className?: string;
}) {
  const { t } = useTranslation("studio");
  const { t: tCommon } = useTranslation();
  return (
    // Panel's button, drawn as a tile: a 56px muted block with the tool's tinted icon.
    <Button
      variant="secondary"
      onClick={onSelect}
      disabled={!tool.available}
      title={t(`tools.${tool.id}.description`)}
      className={cn(
        "h-14 justify-start gap-2.5 rounded-2xl bg-muted/70 px-3 text-start hover:not-disabled:bg-muted",
        "active:not-disabled:scale-[0.98] disabled:opacity-55",
        className,
      )}
    >
      <Icon icon={tool.icon} size={20} className={cn("shrink-0", tool.tint)} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {t(`tools.${tool.id}.name`)}
      </span>
      {badge ? (
        <span
          title={badge}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground"
        >
          <Icon icon={Key01Icon} size={13} />
          <span className="sr-only">{badge}</span>
        </span>
      ) : !tool.available ? (
        <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
          {tCommon("badges.soon")}
        </span>
      ) : tool.isNew ? (
        <span className="shrink-0 rounded-full bg-info/15 px-1.5 py-0.5 text-[0.6875rem] font-medium text-info">
          {tCommon("badges.new")}
        </span>
      ) : null}
    </Button>
  );
}
