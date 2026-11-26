import {
  chatProviderIds,
  providerIds,
  providers,
  type Effort,
  type ModelRef,
  type ProviderCredentials,
  type ProviderId,
} from "@/lib/ai/catalog";
import { subscriptionRoute } from "@/lib/ai/cliproxyapi-oauth";
import type { StudyThread } from "@/lib/study/records";
import { useStoreQuery } from "./live";
import { store } from "./store";

export interface ProviderSettings {
  enabled: boolean;
  apiKey: string;
  baseURL: string;
  /** The provider's models, as last fetched. Empty until fetched. */
  models: string[];
  /** Overrides the provider's default context size (characters of source text). */
  contextChars: number | null;
  /**
   * OpenAI only: the ChatGPT account signed in on the local server, whose
   * plan then pays for text. Only who it is; the tokens stay on the server.
   */
  chatgpt: ChatGPTAccountLabel | null;
  /** How much its models think before answering, in chat and in the Studio. */
  effort: Effort;
  /** Each model's context window in tokens, where the provider's list said. */
  contextTokens: Record<string, number>;
  modelLabels?: Record<string, string>;
  /** AI subscriptions only: the subscription each model comes from (`codex`, `claude`, …). */
  modelBrands?: Record<string, string>;
}

export interface ChatGPTAccountLabel {
  email: string;
  name: string;
}

export interface AppSettings {
  /** The first-run flow was finished or skipped; it never shows again. */
  /** The one-time "what changed" notice was dismissed. */
  upgradeNoticeSeen?: boolean;
  providers: Record<ProviderId, ProviderSettings>;
  /** The model chosen in the prompt bar, and the default for features with no choice of their own. */
  model: ModelRef | null;
  /** The model and effort each AI feature remembers (see `modelFor`). */
  modelChoices?: Partial<Record<ModelUse, ModelChoice>>;
  /** Models starred in the model picker, as `provider:modelId`. */
  favoriteModels: string[];
  study?: Pick<StudyThread, "corrections" | "keepVoiceTranscripts"> & {
    /** The language the Study reader translates selections into, as a BCP 47 code. */
    translateTo?: string;
    /**
     * Review, Today's due counts and saved words show items of every vault, not
     * only the current one. Reading, Library and Practice stay in the vault.
     */
    reviewAcrossVaults?: boolean;
  };
}

/**
 * The AI features that each remember their own model: notebook chat, Studio,
 * translation, the reader's Ask AI, Practice, written practice, drafting
 * flashcards, and each bot.
 */
export type ModelUse =
  | "chat"
  | "studio"
  | "translate"
  | "ask"
  | "practice"
  | "writing"
  | "cards"
  | `bot:${string}`;

export interface ModelChoice {
  model: ModelRef;
  effort?: Effort;
}

const SETTINGS_KEY = "app";
let settingsWrite = Promise.resolve();

export function defaultSettings(): AppSettings {
  const entries = providerIds.map((id) => [
    id,
    {
      enabled: false,
      apiKey: "",
      baseURL: providers[id].defaultBaseURL ?? "",
      models: [],
      contextChars: null,
      chatgpt: null,
      effort: "provider-default",
      contextTokens: {},
    } satisfies ProviderSettings,
  ]);
  return {
    providers: Object.fromEntries(entries) as Record<ProviderId, ProviderSettings>,
    model: null,
    favoriteModels: [],
  };
}

/** Fills in anything missing, so settings saved by an older version still work. */
function withDefaults(saved: Partial<AppSettings> | undefined): AppSettings {
  const base = defaultSettings();
  if (!saved) return base;
  for (const id of providerIds) {
    base.providers[id] = { ...base.providers[id], ...saved.providers?.[id] };
  }
  base.providers.cliproxyapi.apiKey = "";
  base.model = saved.model ?? null;
  base.modelChoices = saved.modelChoices;
  base.favoriteModels = saved.favoriteModels ?? [];
  base.study = saved.study;
  if (saved.upgradeNoticeSeen) base.upgradeNoticeSeen = true;
  return base;
}

export async function getSettings(): Promise<AppSettings> {
  const value = await store().getSetting(SETTINGS_KEY);
  return withDefaults(value as Partial<AppSettings> | undefined);
}

/** Applies a change to the saved settings. */
export async function updateSettings(change: (settings: AppSettings) => void): Promise<void> {
  const backend = store();
  const next = settingsWrite.then(async () => {
    const saved = (await backend.getSetting(SETTINGS_KEY)) as Partial<AppSettings> | undefined;
    const settings = withDefaults(saved);
    const before = JSON.stringify(settings);
    change(settings);
    if (JSON.stringify(settings) !== before) await backend.putSetting(SETTINGS_KEY, settings);
  });
  settingsWrite = next.catch(() => {});
  await next;
}

export async function updateProvider(id: ProviderId, patch: Partial<ProviderSettings>) {
  await updateSettings((settings) => {
    settings.providers[id] = { ...settings.providers[id], ...patch };
  });
}

/** The saved settings, live. `undefined` while loading. */
export function useSettings(): AppSettings | undefined {
  return useStoreQuery(getSettings, [], ["settings"]);
}

/**
 * A provider can be used once it is enabled and has a key (cloud) or an
 * address (local). OpenAI can use a ChatGPT sign-in instead of a key.
 */
export function isProviderReady(settings: AppSettings, id: ProviderId): boolean {
  const saved = settings.providers[id];
  if (!saved.enabled) return false;
  if (id === "cliproxyapi") return saved.models.length > 0;
  if (usesChatGPT(settings, id)) return true;
  return providers[id].needsKey ? saved.apiKey.trim() !== "" : saved.baseURL.trim() !== "";
}

/** Text requests to OpenAI go through the signed-in ChatGPT plan rather than the key. */
export function usesChatGPT(settings: AppSettings, id: ProviderId): boolean {
  return id === "openai" && settings.providers.openai.chatgpt !== null;
}

/** The credentials for text requests (chat, Studio). */
export function credentialsFor(settings: AppSettings, id: ProviderId): ProviderCredentials {
  if (id === "cliproxyapi") return {};
  const saved = settings.providers[id];
  if (usesChatGPT(settings, id)) return { chatgpt: true };
  if (!providers[id].needsKey)
    return { baseURL: saved.baseURL.trim() || providers[id].defaultBaseURL };
  // OpenCode's address picks the plan (Zen or Go); the server only accepts those two.
  if (id === "opencode")
    return { apiKey: saved.apiKey.trim(), baseURL: saved.baseURL || providers[id].defaultBaseURL };
  return { apiKey: saved.apiKey.trim() };
}

/** Pictures always need an API key: a ChatGPT plan cannot generate images here. */
function canDrawPictures(settings: AppSettings, id: ProviderId): boolean {
  const saved = settings.providers[id];
  return saved.enabled && saved.apiKey.trim() !== "" && providers[id].imageModels.length > 0;
}

/** The credentials for an image model: its API key. */
export function imageCredentialsFrom(
  settings: AppSettings,
  id: ProviderId,
): ProviderCredentials | null {
  return canDrawPictures(settings, id) ? { apiKey: settings.providers[id].apiKey.trim() } : null;
}

/** The credentials for a speech model: its provider's API key, when it is on. */
export function speechCredentialsFrom(
  settings: AppSettings,
  id: ProviderId,
): ProviderCredentials | null {
  const saved = settings.providers[id];
  return providers[id].kind === "audio" && saved.enabled && saved.apiKey.trim()
    ? { apiKey: saved.apiKey.trim() }
    : null;
}

/** The effort for text requests to this provider; `provider-default` when it has no levels. */
export function effortFor(settings: AppSettings, id: ProviderId): Effort {
  const effort = settings.providers[id].effort;
  return providers[id].efforts.includes(effort) ? effort : "provider-default";
}

/**
 * How many tokens a model reads at once: the provider's figure when its list
 * gave one, else the catalog's estimate (for local models, from the context
 * size the user set).
 */
export function contextTokensFor(settings: AppSettings, ref: ModelRef): number {
  const listed = settings.providers[ref.provider].contextTokens[ref.modelId];
  if (listed) return listed;
  if (providers[ref.provider].local) return Math.round(contextCharsFor(settings, ref.provider) / 4);
  return providers[ref.provider].contextTokens;
}

export function contextCharsFor(settings: AppSettings, id: ProviderId): number {
  return settings.providers[id].contextChars ?? providers[id].contextChars;
}

/** Every model the user can pick: the fetched list, or the suggestions until then. */
export function availableModels(settings: AppSettings): ModelRef[] {
  return chatProviderIds
    .filter((id) => isProviderReady(settings, id))
    .flatMap((id) => {
      const saved = settings.providers[id].models;
      const list = saved.length > 0 ? saved : providers[id].suggestedModels;
      return list.map((modelId) => ({ provider: id, modelId }));
    });
}

/** Every image model the user can pick: those of providers with a key that draw pictures. */
export function availableImageModels(settings: AppSettings): ModelRef[] {
  return providerIds
    .filter((id) => canDrawPictures(settings, id))
    .flatMap((id) => providers[id].imageModels.map((modelId) => ({ provider: id, modelId })));
}

/** Resolves a saved choice. Legacy subscription IDs can be upgraded when only one account matches. */
export function resolveModel(settings: AppSettings, chosen: ModelRef): ModelRef | null {
  const models = availableModels(settings).filter((model) => model.provider === chosen.provider);
  const exact = models.find((model) => model.modelId === chosen.modelId);
  if (exact) return exact;
  if (chosen.provider !== "cliproxyapi" || subscriptionRoute.test(chosen.modelId)) return null;
  const matches = models.filter(
    (model) => subscriptionRoute.exec(model.modelId)?.[2] === chosen.modelId,
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * The model and effort a feature uses: its own last choice, else `fallback`
 * (a bot's saved model), else the prompt bar's. A remembered effort the model's
 * provider doesn't offer gives way to the provider's own setting.
 */
export function modelFor(
  settings: AppSettings,
  use: ModelUse,
  fallback?: ModelRef | null,
): { model: ModelRef; effort: Effort } | null {
  const saved = settings.modelChoices?.[use];
  const model = activeModel(settings, saved?.model ?? fallback ?? settings.model);
  if (!model) return null;
  const effort =
    saved?.effort && providers[model.provider].efforts.includes(saved.effort)
      ? saved.effort
      : effortFor(settings, model.provider);
  return { model, effort };
}

/** Remembers the model a feature uses. Chat's choice is also the default for the rest. */
export function chooseModel(use: ModelUse, model: ModelRef) {
  return updateSettings((settings) => {
    const current = settings.modelChoices?.[use];
    settings.modelChoices = { ...settings.modelChoices, [use]: { ...current, model } };
    if (use === "chat") settings.model = model;
  });
}

/** Remembers how much a feature's model thinks. */
export function chooseEffort(use: ModelUse, model: ModelRef, effort: Effort) {
  return updateSettings((settings) => {
    settings.modelChoices = { ...settings.modelChoices, [use]: { model, effort } };
    if (use === "chat") settings.model = model;
  });
}

export function modelDisplayLabel(settings: AppSettings | undefined, model: ModelRef): string {
  return (
    settings?.providers[model.provider].modelLabels?.[model.modelId] ??
    (model.provider === "cliproxyapi" ? subscriptionRoute.exec(model.modelId)?.[2] : undefined) ??
    model.modelId
  );
}

/**
 * The model requests use. A chosen subscription model that its plan no longer
 * offers falls back to another model of the same account; while the account
 * itself is gone, nothing is chosen, so requests never move to another
 * provider unasked.
 */
export function activeModel(
  settings: AppSettings,
  chosen: ModelRef | null = settings.model,
): ModelRef | null {
  if (chosen) {
    const available = resolveModel(settings, chosen);
    if (available) return available;
    if (chosen.provider === "cliproxyapi") {
      const account = subscriptionRoute.exec(chosen.modelId)?.[1];
      return (
        (account &&
          availableModels(settings).find(
            (model) =>
              model.provider === "cliproxyapi" &&
              subscriptionRoute.exec(model.modelId)?.[1] === account,
          )) ||
        null
      );
    }
  }
  return availableModels(settings)[0] ?? null;
}
