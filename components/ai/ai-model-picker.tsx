import { Tick02Icon } from "@hugeicons/core-free-icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { ModelPicker, type ModelPickerProvider } from "@/components/panelui/model-picker";
import { ProviderIcon } from "@/components/provider-icon";
import {
  chatProviderIds,
  modelKey,
  parseModelKey,
  providers,
  type Effort,
  type ModelRef,
} from "@/lib/ai/catalog";
import {
  cliProxyBrands,
  cliProxySignInProviders,
  type CliProxySignInProvider,
} from "@/lib/ai/cliproxyapi-oauth";
import {
  availableModels,
  chooseEffort,
  chooseModel,
  modelDisplayLabel,
  modelFor,
  resolveModel,
  updateSettings,
  usesChatGPT,
  useSettings,
  type AppSettings,
  type ModelUse,
} from "@/lib/db/settings";
import { cn } from "@/lib/utils";
import { SubscriptionLogo } from "./subscription-logo";

type Remembered = {
  /** The feature whose model and effort are remembered. */
  use: ModelUse;
  /** A model to start from when the feature has no choice yet, such as a bot's. */
  fallback?: ModelRef | null;
  /** Called once a chosen model is saved, to keep it elsewhere or ask again with it. */
  onModelChange?: (model: ModelRef) => void;
  value?: never;
  onValueChange?: never;
};

type Controlled = {
  use?: never;
  fallback?: never;
  onModelChange?: never;
  /** A model held by the caller, such as a Studio option. No effort is offered. */
  value: ModelRef | null;
  onValueChange: (model: ModelRef) => void;
};

type AIModelPickerProps = (Remembered | Controlled) & {
  /** The trigger's id, for a form field's label. */
  id?: string;
  /** `ghost` for a composer's footer, `outline` for a form or toolbar. Default `ghost`. */
  appearance?: "ghost" | "outline";
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  className?: string;
};

/** The rail group a model is listed under: its subscription, or its provider. */
function groupOf(settings: AppSettings, model: ModelRef): string {
  if (model.provider !== "cliproxyapi") return model.provider;
  const brand = settings.providers.cliproxyapi.modelBrands?.[model.modelId];
  return brand ? `subscription:${brand}` : model.provider;
}

/**
 * The one model picker for every AI feature: subscriptions and providers on a
 * rail, their models, and the chosen model's reasoning levels beside them.
 * With `use`, the feature remembers its own model and effort.
 */
export function AIModelPicker(props: AIModelPickerProps) {
  const { id, appearance = "ghost", side = "top", align = "start", className } = props;
  const { t } = useTranslation("chat");
  const { t: tCommon } = useTranslation();
  const { t: tSettings } = useTranslation("settings");
  const settings = useSettings();

  const models = useMemo(() => (settings ? availableModels(settings) : []), [settings]);
  const choice = settings
    ? props.use !== undefined
      ? modelFor(settings, props.use, props.fallback)
      : props.value
        ? (() => {
            const model = resolveModel(settings, props.value);
            return model ? { model, effort: undefined } : null;
          })()
        : null
    : null;

  const items = useMemo(
    () =>
      settings
        ? models.map((ref) => {
            const info = providers[ref.provider];
            return {
              value: modelKey(ref),
              label: modelDisplayLabel(settings, ref),
              provider: groupOf(settings, ref),
              note: usesChatGPT(settings, ref.provider)
                ? tSettings("chatgpt.planLabel")
                : undefined,
              contextWindow: settings.providers[ref.provider].contextTokens[ref.modelId],
              tags: [
                ...(info.webSearch ? [t("modelTags.web")] : []),
                ...(info.local ? [t("modelTags.local")] : []),
              ],
            };
          })
        : [],
    [settings, models, t, tSettings],
  );

  const groups = useMemo<ModelPickerProvider[]>(() => {
    if (!settings) return [];
    const present = new Set(items.map((item) => item.provider));
    const subscriptions = cliProxySignInProviders
      .filter((brand) => present.has(`subscription:${brand}`))
      .map((brand: CliProxySignInProvider) => ({
        value: `subscription:${brand}`,
        label: cliProxyBrands[brand],
        icon: <SubscriptionLogo provider={brand} size={20} />,
      }));
    const others = chatProviderIds
      .filter((id) => present.has(id))
      .map((id) => ({
        value: id,
        label: providers[id].name,
        icon: <ProviderIcon provider={id} size={20} />,
      }));
    return [...subscriptions, ...others];
  }, [settings, items]);

  if (!settings || items.length === 0) return null;

  const model = choice?.model ?? null;
  const effort = choice?.effort;
  const levels: readonly Effort[] =
    props.use !== undefined && model ? providers[model.provider].efforts : [];

  const choose = (key: string) => {
    const next = parseModelKey(key);
    if (!next) return;
    if (props.use !== undefined) {
      const { onModelChange } = props;
      void chooseModel(props.use, next).then(() => onModelChange?.(next));
    } else props.onValueChange(next);
  };

  return (
    <ModelPicker
      variant="rail"
      items={items}
      providers={groups}
      value={model ? modelKey(model) : null}
      label={t("model")}
      favorites={settings.favoriteModels}
      onFavoritesChange={(favorites) =>
        void updateSettings((saved) => void (saved.favoriteModels = favorites))
      }
      onValueChange={choose}
    >
      <ModelPicker.Trigger
        id={id}
        appearance={appearance}
        className={cn("max-w-56", className)}
        placeholder={t("chooseModel")}
        suffix={
          effort && effort !== "provider-default" ? tCommon(`effort.levels.${effort}`) : undefined
        }
      />
      <ModelPicker.Content
        side={side}
        align={align}
        placeholder={t("searchModels")}
        emptyText={t("noModels")}
        className={levels.length > 0 ? "w-[37rem] max-w-[calc(100vw-1rem)]" : undefined}
        aside={
          levels.length > 0 && model && props.use !== undefined ? (
            <EffortColumn
              label={modelDisplayLabel(settings, model)}
              levels={levels}
              value={effort ?? "provider-default"}
              onChange={(level) => void chooseEffort(props.use, model, level)}
            />
          ) : null
        }
      />
    </ModelPicker>
  );
}

/** The chosen model's reasoning levels. Choosing one keeps the list open. */
function EffortColumn({
  label,
  levels,
  value,
  onChange,
}: {
  label: string;
  levels: readonly Effort[];
  value: Effort;
  onChange: (effort: Effort) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t("effort.reasoning")}
      className="flex w-44 shrink-0 flex-col gap-0.5 border-s p-2"
    >
      <div className="flex items-center justify-between gap-2 px-2 pt-1.5 pb-2 text-xs text-muted-foreground">
        <span className="font-medium">{t("effort.reasoning")}</span>
        <span className="truncate">{label}</span>
      </div>
      {levels.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={level === value}
          title={t("effort.hint")}
          onClick={() => onChange(level)}
          className="flex h-9 cursor-pointer items-center justify-between gap-2 rounded-lg px-2 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t(`effort.levels.${level}`)}
          {level === value ? <Icon icon={Tick02Icon} size={16} /> : null}
        </button>
      ))}
    </div>
  );
}
