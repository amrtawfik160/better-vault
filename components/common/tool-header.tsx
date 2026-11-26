import { useVaultName } from "@/components/home/vault-name";
import { SidebarMenuButton } from "@/components/shell/sidebar-state";
import { useCurrentVault, useVaults } from "@/lib/db/vaults";
import { cn } from "@/lib/utils";

/**
 * The one header of a Notes or Tools page: the page's name, a muted line about
 * its scope, then the page's own actions, with at most one filled button.
 * It is 52px tall, like the other top bars, so their hairlines meet. On
 * phones it starts with the button that opens the sidebar's drawer, so the
 * page needs no second bar above it.
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
    // On macOS desktop the header is also the window's title strip, like the sidebar's top.
    <header
      data-window-bar
      className={cn(
        "flex min-h-13 shrink-0 items-center gap-x-3 gap-y-2 border-b ps-5 pe-2 max-md:gap-x-2 max-md:ps-1",
        // Every button in it is a 44px target on phones.
        "max-md:[&>[data-slot=button]]:h-11 max-md:[&>[data-slot=button]]:min-w-11",
        className,
      )}
    >
      <SidebarMenuButton />
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
