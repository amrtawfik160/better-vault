import { useVaultName } from "@/components/home/vault-name";
import { useCurrentVault, useVaults } from "@/lib/db/vaults";
import { cn } from "@/lib/utils";

/**
 * The one header of a Notes or Tools page: the page's name, a muted line about
 * its scope, then the page's own actions, with at most one filled button.
 * It is 52px tall, like the other top bars, so their hairlines meet.
 */
export function ToolHeader({
  title,
  detail,
  children,
  className,
}: {
  title: string;
  detail?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-h-13 shrink-0 items-center gap-x-3 gap-y-2 border-b ps-5 pe-2 max-md:ps-4",
        className,
      )}
    >
      <h1 className="truncate text-[0.8125rem] leading-5 font-medium">{title}</h1>
      {detail ? (
        <span className="hidden truncate text-xs text-muted-foreground tabular-nums sm:inline">
          {detail}
        </span>
      ) : null}
      <span className="flex-1" />
      {children}
    </header>
  );
}

/** A thin divider between a header's quiet buttons and its one filled button. */
export function ToolHeaderDivider() {
  return <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-border sm:block" />;
}

/** The name of the vault a page reads, for the header's scope line. */
export function useScopeName(): string {
  const name = useVaultName();
  const vaults = useVaults();
  const id = useCurrentVault(vaults);
  const vault = vaults?.find((each) => each.id === id);
  return vault ? name(vault) : "";
}
