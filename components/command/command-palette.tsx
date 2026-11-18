import {
  BotIcon,
  AiBrain02Icon,
  Book02Icon,
  BubbleChatIcon,
  Cards01Icon,
  Calendar03Icon,
  CloudIcon,
  ComputerIcon,
  Database01Icon,
  DashboardSquare01Icon,
  FileAddIcon,
  Folder01Icon,
  Home01Icon,
  InformationCircleIcon,
  LanguageSkillIcon,
  Moon02Icon,
  Notebook01Icon,
  PaintBoardIcon,
  QuoteDownIcon,
  SparklesIcon,
  Sun03Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMatch, useNavigate } from "react-router";
import { Icon } from "@/components/icon";
import { Command } from "@/components/panelui/command";
import { useTheme, type Theme } from "@/components/providers/theme-provider";
import { SettingsSheet, type SettingsPage } from "@/components/settings/settings-sheet";
import { onOpenCommandPalette } from "@/lib/command";
import { useStoreQuery } from "@/lib/db/live";
import { createNotebook } from "@/lib/db/notebooks";
import { DEFAULT_VAULT, setCurrentVault, vaultOf } from "@/lib/db/vaults";
import { notebookIcon } from "@/lib/notebooks/icons";
import { shortcutKeys } from "@/lib/platform";
import { routes } from "@/lib/routes";
import { readCatalogue, searchIndex, type Catalogue, type Hit } from "@/lib/search/index";

interface Action {
  id: string;
  label: string;
  icon: Parameters<typeof Icon>[0]["icon"];
  keywords?: string[];
  kind?: string;
  run: () => void;
}

/** Every word typed appears in the label or keywords, in any order. */
function matches(query: string, action: Action) {
  const haystack = [action.label, ...(action.keywords ?? [])].join(" ").toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** The snippet with the matched words marked. */
function Marked({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return text;
  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/**
 * The command palette (⌘K, or Ctrl K on Windows and Linux): search every
 * notebook, source, Studio output, and saved Study item, and run
 * actions or open a settings page. Mounted once, around every page.
 */
export function CommandPalette() {
  const { t } = useTranslation();
  const { t: tHome } = useTranslation("home");
  const { t: tSettings } = useTranslation("settings");
  const navigate = useNavigate();
  const inNotebook = useMatch(routes.notebook(":id"));
  const notebookId = inNotebook?.params.id;
  const { setTheme } = useTheme();
  const [opening, setOpening] = useState<symbol | null>(null);
  const [search, setSearch] = useState("");
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const [, setVersion] = useState(0);
  const keys = shortcutKeys("k");

  const changeOpen = (next: boolean) => {
    setOpening((current) => (next ? (current ?? Symbol()) : null));
    if (!next) setSearch("");
  };
  useEffect(() => onOpenCommandPalette(() => changeOpen(true)), []);
  useEffect(() => searchIndex.subscribe(() => setVersion((n) => n + 1)), []);

  const result = useStoreQuery<{ opening: symbol; catalogue: Catalogue } | null>(
    async () => (opening ? { opening, catalogue: await readCatalogue() } : null),
    [opening],
    ["vaults", "folders", "notebooks", "sources", "outputs", "study", "notes"],
  );
  // A live query can still hold results from the previous opening while it refreshes.
  const catalogue = result && result.opening === opening ? result.catalogue : null;
  useEffect(() => {
    if (catalogue && !searchIndex.isCurrent(catalogue)) void searchIndex.sync(catalogue);
  }, [catalogue]);
  const notebookTitle = new Map(catalogue?.notebooks.map((nb) => [nb.id, nb.title]) ?? []);
  const vaultName = (id: string) => {
    const vault = catalogue?.vaults.find((each) => each.id === id);
    return vault?.name || tHome("vaults.default");
  };

  const openSettings = (page: SettingsPage) => setSettingsPage(page);
  const go = (path: string) => navigate(path);

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [
      {
        id: "home",
        label: t("command.home"),
        icon: Home01Icon,
        keywords: ["notebooks", "vault", "home"],
        run: () => go(routes.home),
      },
      {
        id: "study",
        label: tHome("vaults.study"),
        icon: Notebook01Icon,
        keywords: [
          "review",
          "flashcards",
          "library",
          "vocabulary",
          "tutor",
          "reading",
          "epub",
          "pdf",
        ],
        run: () => go(routes.study),
      },
      {
        id: "calendar",
        label: t("command.calendar"),
        icon: Calendar03Icon,
        keywords: ["calendar", "event", "schedule", "agenda", "entry"],
        run: () => go(`${routes.home}?view=calendar`),
      },
      {
        id: "bot",
        label: t("command.bot"),
        icon: BotIcon,
        keywords: ["bot", "agent", "assistant", "delegate", "chief of staff"],
        run: () => go(`${routes.home}?view=bot`),
      },
      {
        id: "new-notebook",
        label: tHome("newNotebook"),
        icon: Notebook01Icon,
        keywords: ["create", "add"],
        run: () => {
          void (async () => {
            const vaultId = localStorage.getItem("better-vault:vault") ?? DEFAULT_VAULT;
            const id = await createNotebook(tHome("untitled"), {
              ...(vaultId !== DEFAULT_VAULT ? { vaultId } : {}),
            });
            go(routes.notebook(id));
          })();
        },
      },
    ];
    if (notebookId) {
      list.push(
        {
          id: "add-source",
          label: t("command.addSource"),
          icon: FileAddIcon,
          keywords: ["pdf", "file", "upload", "import"],
          run: () => go(`${routes.notebook(notebookId)}?add=source`),
        },
        {
          id: "tab-chat",
          label: t("command.chat"),
          icon: BubbleChatIcon,
          run: () => go(`${routes.notebook(notebookId)}?tab=chat`),
        },
        {
          id: "tab-sources",
          label: t("command.sources"),
          icon: Book02Icon,
          run: () => go(`${routes.notebook(notebookId)}?tab=sources`),
        },
        {
          id: "tab-studio",
          label: t("command.studio"),
          icon: SparklesIcon,
          run: () => go(`${routes.notebook(notebookId)}?tab=studio`),
        },
      );
    }
    const themes: [Theme, typeof Sun03Icon][] = [
      ["light", Sun03Icon],
      ["dark", Moon02Icon],
      ["system", ComputerIcon],
    ];
    for (const [theme, icon] of themes)
      list.push({
        id: `theme-${theme}`,
        label: t("command.theme", { theme: tSettings(`appearance.${theme}`) }),
        icon,
        keywords: ["theme", "appearance", "mode"],
        run: () => setTheme(theme),
      });
    return list;
    // `go` and `setTheme` are stable enough; the list follows the page and language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, t, tHome, tSettings]);

  const settingsActions: Action[] = [
    {
      page: "subscriptions",
      icon: AiBrain02Icon,
      keywords: [
        "subscription",
        "connect",
        "reconnect",
        "chatgpt",
        "claude",
        "antigravity",
        "grok",
      ],
    },
    { page: "providers", icon: AiBrain02Icon, keywords: ["ai", "model", "key", "api", "effort"] },
    { page: "appearance", icon: PaintBoardIcon, keywords: ["theme", "colour", "color", "dark"] },
    { page: "calendar", icon: Calendar03Icon, keywords: ["calendar", "google", "outlook", "ics"] },
    { page: "storage", icon: CloudIcon, keywords: ["drive", "google", "s3", "backup"] },
    { page: "account", icon: UserIcon, keywords: ["profile", "name"] },
    { page: "language", icon: LanguageSkillIcon, keywords: ["language", "translate"] },
    { page: "data", icon: Database01Icon, keywords: ["backup", "export", "import", "delete"] },
    { page: "about", icon: InformationCircleIcon, keywords: ["version", "update"] },
  ].map(({ page, icon, keywords }) => ({
    id: `settings-${page}`,
    label: tSettings(`rows.${page as SettingsPage}`),
    icon,
    keywords: ["settings", ...keywords],
    kind: tSettings("title"),
    run: () => openSettings(page as SettingsPage),
  }));

  const vaultActions: Action[] = (catalogue?.vaults ?? []).map((vault) => ({
    id: `vault-${vault.id}`,
    label: t("command.vault", { name: vaultName(vault.id) }),
    icon: notebookIcon(vault.icon ?? "notebook"),
    keywords: ["vault", "switch"],
    kind: tHome("vaults.label"),
    run: () => {
      setCurrentVault(vault.id);
      go(routes.home);
    },
  }));

  const query = search.trim();
  const ready = searchIndex.isCurrent(catalogue);
  const hits = query && ready ? searchIndex.search(query) : [];
  const recent = [...(catalogue?.notebooks ?? [])]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  const openHit = (hit: Hit) => {
    switch (hit.kind) {
      case "notebook":
        return go(routes.notebook(hit.notebookId!));
      case "source":
        return go(`${routes.notebook(hit.notebookId!)}?source=${hit.sourceId}`);
      case "passage":
        return go(
          `${routes.notebook(hit.notebookId!)}?source=${hit.sourceId}&passage=${encodeURIComponent(hit.chunkId!)}`,
        );
      case "output":
        return go(`${routes.notebook(hit.notebookId!)}?output=${hit.outputId}`);
      case "study":
        if (hit.study) return go(hit.study.href);
        return;
      case "folder":
        setCurrentVault(hit.vaultId ?? DEFAULT_VAULT);
        return go(`${routes.home}?folder=${hit.folderId}`);
      case "vault":
        setCurrentVault(hit.vaultId ?? DEFAULT_VAULT);
        return go(routes.home);
    }
  };

  const hitIcon = (hit: Hit) =>
    hit.kind === "passage"
      ? QuoteDownIcon
      : hit.kind === "source"
        ? Book02Icon
        : hit.kind === "output"
          ? SparklesIcon
          : hit.kind === "folder"
            ? Folder01Icon
            : hit.kind === "vault"
              ? DashboardSquare01Icon
              : Notebook01Icon;

  const groups: { kind: Hit["kind"]; heading: string }[] = [
    { kind: "notebook", heading: t("command.groups.notebooks") },
    { kind: "source", heading: t("command.groups.sources") },
    { kind: "study", heading: tHome("vaults.study") },
    { kind: "passage", heading: t("command.groups.passages") },
    { kind: "output", heading: t("command.groups.outputs") },
    { kind: "folder", heading: t("command.groups.folders") },
    { kind: "vault", heading: t("command.groups.vaults") },
  ];

  const studyIcons = {
    book: Book02Icon,
    card: Cards01Icon,
    highlight: QuoteDownIcon,
    word: LanguageSkillIcon,
    thread: BubbleChatIcon,
    message: BubbleChatIcon,
    report: Notebook01Icon,
  };
  const renderStudyHit = (hit: Hit, study: NonNullable<Hit["study"]>) => {
    const kind = t(`command.study.${study.type}`);
    const snippet = hit.snippet && <Marked text={hit.snippet} terms={hit.terms} />;
    const location = [study.context, vaultName(hit.vaultId ?? DEFAULT_VAULT)]
      .filter(Boolean)
      .join(" · ");
    return (
      <Command.Item
        key={hit.id}
        value={hit.id}
        icon={<Icon icon={studyIcons[study.type]} size={18} />}
        subtitle={hit.title && snippet ? snippet : location}
        kind={kind}
        textValue={hit.title || hit.snippet || kind}
        onSelect={() => openHit(hit)}
      >
        {hit.title ? <Marked text={hit.title} terms={hit.terms} /> : snippet || kind}
      </Command.Item>
    );
  };

  const renderAction = (action: Action) => (
    <Command.Item
      key={action.id}
      value={action.id}
      icon={<Icon icon={action.icon} size={18} />}
      kind={action.kind}
      onSelect={action.run}
    >
      {action.label}
    </Command.Item>
  );

  const shownActions = query ? actions.filter((action) => matches(query, action)) : actions;
  const shownSettings = query
    ? settingsActions.filter((action) => matches(query, action))
    : settingsActions;
  const shownVaults = query ? vaultActions.filter((action) => matches(query, action)) : [];
  const nothing =
    query.length > 0 &&
    hits.length === 0 &&
    shownActions.length === 0 &&
    shownSettings.length === 0 &&
    shownVaults.length === 0;

  return (
    <>
      <Command.Dialog
        open={opening !== null}
        onOpenChange={changeOpen}
        hotkey="mod+k"
        label={t("command.label")}
      >
        <Command variant="spotlight" filter={false} search={search} onSearchChange={setSearch}>
          <Command.Input placeholder={t("command.placeholder")} />
          <Command.List>
            {query ? (
              groups.map(({ kind, heading }) => {
                const items = hits.filter((hit) => hit.kind === kind);
                if (items.length === 0) return null;
                return (
                  <Command.Group key={kind} heading={heading}>
                    {items.map((hit) =>
                      hit.study ? (
                        renderStudyHit(hit, hit.study)
                      ) : (
                        <Command.Item
                          key={hit.id}
                          value={hit.id}
                          icon={<Icon icon={hitIcon(hit)} size={18} />}
                          subtitle={
                            hit.kind === "passage" || hit.kind === "vault"
                              ? undefined
                              : hit.snippet
                                ? hit.snippet && <Marked text={hit.snippet} terms={hit.terms} />
                                : hit.kind !== "notebook" && hit.notebookId
                                  ? notebookTitle.get(hit.notebookId)
                                  : vaultName(hit.vaultId ?? DEFAULT_VAULT)
                          }
                          kind={hit.kind === "passage" ? hit.title : undefined}
                          textValue={hit.title}
                          onSelect={() => openHit(hit)}
                        >
                          {hit.kind === "passage" && hit.snippet ? (
                            <span className="font-normal">
                              <Marked text={hit.snippet} terms={hit.terms} />
                            </span>
                          ) : hit.kind === "vault" ? (
                            vaultName(hit.vaultId ?? DEFAULT_VAULT)
                          ) : (
                            hit.title
                          )}
                        </Command.Item>
                      ),
                    )}
                  </Command.Group>
                );
              })
            ) : recent.length > 0 ? (
              <Command.Group heading={t("command.groups.recent")}>
                {recent.map((notebook) => (
                  <Command.Item
                    key={notebook.id}
                    value={`recent-${notebook.id}`}
                    icon={<Icon icon={notebookIcon(notebook.icon)} size={18} />}
                    subtitle={vaultName(vaultOf(notebook))}
                    onSelect={() => go(routes.notebook(notebook.id))}
                  >
                    {notebook.title}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {shownActions.length > 0 ? (
              <Command.Group heading={t("command.groups.actions")}>
                {shownActions.map(renderAction)}
              </Command.Group>
            ) : null}
            {shownVaults.length > 0 ? (
              <Command.Group heading={t("command.groups.vaults")}>
                {shownVaults.map(renderAction)}
              </Command.Group>
            ) : null}
            {shownSettings.length > 0 ? (
              <Command.Group heading={tSettings("title")}>
                {shownSettings.map(renderAction)}
              </Command.Group>
            ) : null}
            {nothing ? (
              <Command.Empty>
                {ready ? t("command.empty", { query }) : t("command.indexing")}
              </Command.Empty>
            ) : null}
          </Command.List>
          <Command.Footer lead={<Lead keys={keys}>{t("command.lead")}</Lead>}>
            <Command.FooterAction keys={["↵"]}>{t("command.open")}</Command.FooterAction>
            <Command.FooterAction keys={["Esc"]} onClick={() => changeOpen(false)}>
              {t("actions.close")}
            </Command.FooterAction>
          </Command.Footer>
        </Command>
      </Command.Dialog>
      {/* Its own Settings sheet, opened at the page chosen here. */}
      <SettingsSheet
        open={settingsPage !== null}
        onOpenChange={(next) => !next && setSettingsPage(null)}
        page={settingsPage}
        trigger={<button type="button" hidden aria-hidden tabIndex={-1} />}
      />
    </>
  );
}

function Lead({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex gap-0.5">
        {keys.map((key) => (
          <kbd key={key} className="rounded border bg-muted px-1 font-sans text-[0.6875rem]">
            {key}
          </kbd>
        ))}
      </span>
      {children}
    </span>
  );
}
