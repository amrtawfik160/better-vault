import {
  Add01Icon,
  AiBrain01Icon,
  AiVoiceIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BotIcon,
  Books01Icon,
  CloudServerIcon,
  PaintBoardIcon,
  Calendar03Icon,
  Camera01Icon,
  Clock01Icon,
  GoogleIcon,
  InformationCircleIcon,
  Mail01Icon,
  MagicWand01Icon,
  Note01Icon,
  PlugSocketIcon,
  RepeatIcon,
  Sun03Icon,
  Target02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Avatar } from "@/components/account/avatar";
import { Logo } from "@/components/brand/logo";
import { Field } from "@/components/common/field";
import { SubscriptionConnect } from "@/components/settings/cliproxyapi-sign-in";
import {
  subscriptionConnectionsAllowed,
  useSubscriptionConnections,
} from "@/lib/ai/cliproxyapi-client";
import { cliProxyBrands } from "@/lib/ai/cliproxyapi-oauth";
import { useSettings } from "@/lib/db/settings";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import {
  setUsername,
  signIn,
  startCheckout,
  useAccount,
  usernameAvailable,
} from "@/lib/account/account";
import { useStoreQuery } from "@/lib/db/live";
import { updateProfile, useProfile } from "@/lib/db/profile";
import { store } from "@/lib/db/store";
import { avatarFromFile } from "@/lib/profile/avatar";
import { onRadioKeys } from "@/components/common/roving";
import { cn } from "@/lib/utils";

const KEY = "onboarding";
type Step = "profile" | "ai" | "account" | "username" | "plan";
type Plan = "free" | "pro" | "max";

/**
 * The first screens of the app, two columns like a setup wizard: the step's
 * form on the left, and on the right a small better-vault window that fills
 * in with what is typed (name, picture, username). The account is
 * optional at every step: the app works fully on this device without one.
 */
export function OnboardingGate() {
  const done = useStoreQuery(
    async () => ((await store().getSetting(KEY)) as { done?: boolean } | undefined)?.done === true,
    [],
    ["settings"],
  );
  return done === false ? <Onboarding /> : null;
}

const finish = () => store().putSetting(KEY, { done: true, at: Date.now() });

function Onboarding() {
  const { t } = useTranslation("common");
  const account = useAccount();
  const profile = useProfile();
  const [step, setStep] = useState<Step>("profile");
  const [name, setName] = useState<string | null>(null);
  const [username, setUsernameDraft] = useState("");
  const [plan, setPlan] = useState<Plan>("free");
  const [busy, setBusy] = useState(false);
  const settings = useSettings();
  const shownName = name ?? profile?.name ?? "";

  // Connecting AI comes first: nothing in better-vault that thinks works without it.
  const connectAI = subscriptionConnectionsAllowed();
  const needsUsername = account != null && !account.user.username;
  const steps: Step[] = [
    "profile",
    ...(connectAI ? (["ai"] as const) : []),
    "account",
    ...(step === "username" || needsUsername ? (["username"] as const) : []),
    // A plan (Better Vault AI and Cloud) needs an account, so it is offered once signed in.
    ...(account ? (["plan"] as const) : []),
  ];
  const at = steps.indexOf(step);
  const back = () => setStep(steps[Math.max(0, at - 1)]);

  const saveName = async () => {
    if (name !== null && name.trim() !== (profile?.name ?? ""))
      await updateProfile({ name: name.trim() });
  };

  const complete = async () => {
    await saveName();
    if (plan !== "free" && account && account.account.plan !== plan) await startCheckout(plan);
    await finish();
  };

  const finishSetup = async () => {
    setBusy(true);
    try {
      await complete();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const signInWith = async (mode: "signin" | "signup") => {
    setBusy(true);
    try {
      const state = await signIn(mode);
      setStep(state.user.username ? "plan" : "username");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "cancelled")
        toast.error(message === "popup-blocked" ? t("onboarding.popupBlocked") : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={t("onboarding.label")}
      className="fixed inset-0 z-50 flex overflow-y-auto bg-background p-4 sm:p-8"
    >
      {/* `m-auto` centres it while it fits and lets it scroll from the top when the window is short. */}
      <div className="m-auto grid w-full max-w-5xl overflow-hidden rounded-3xl bg-card ring-1 ring-border lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* The step. */}
        <div className="flex min-h-[min(34rem,calc(100dvh-4rem))] flex-col p-6 sm:p-10">
          <header className="flex items-center gap-3">
            <Logo size={28} />
            <span className="text-sm font-semibold">deepLe</span>
            <span className="ms-auto text-xs text-muted-foreground tabular-nums">
              {t("onboarding.stepOf", { step: at + 1, total: steps.length })}
            </span>
          </header>
          <div className="mt-4 flex gap-1.5" aria-hidden>
            {steps.map((each, index) => (
              <span
                key={each}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  index <= at ? "bg-foreground" : "bg-muted",
                )}
              />
            ))}
          </div>

          <div className="flex flex-1 flex-col justify-center gap-6 py-8">
            {step === "profile" ? (
              <ProfileStep name={shownName} onName={setName} />
            ) : step === "ai" ? (
              <>
                <Heading title={t("onboarding.ai.title")} body={t("onboarding.ai.body")} />
                <SubscriptionConnect saved={settings?.providers.cliproxyapi} />
                <p className="text-xs text-muted-foreground">{t("onboarding.ai.later")}</p>
              </>
            ) : step === "account" ? (
              <>
                <Heading
                  title={t("onboarding.account.title")}
                  body={t("onboarding.account.body")}
                />
                <div className="flex flex-col gap-2">
                  {account ? (
                    <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3 text-sm">
                      <Icon icon={Tick02Icon} size={18} className="text-success" />
                      {t("onboarding.account.signedIn", { email: account.user.email })}
                    </div>
                  ) : (
                    <>
                      <Button size="lg" disabled={busy} onClick={() => void signInWith("signin")}>
                        <Icon icon={GoogleIcon} size={18} />
                        {t("onboarding.account.google")}
                      </Button>
                      <Button
                        size="lg"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void signInWith("signup")}
                      >
                        <Icon icon={Mail01Icon} size={18} />
                        {t("onboarding.account.email")}
                      </Button>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t("onboarding.account.keys")}</p>
              </>
            ) : step === "username" ? (
              <UsernameStep
                value={username}
                onChange={setUsernameDraft}
                onDone={async () => setStep("plan")}
              />
            ) : (
              <PlanStep plan={plan} onPlan={setPlan} />
            )}
          </div>

          <footer className="flex items-center gap-2">
            {at > 0 ? (
              <Button variant="ghost" onClick={back} disabled={busy}>
                <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
                {t("onboarding.back")}
              </Button>
            ) : null}
            {step === "profile" ? (
              <>
                {!account && !connectAI ? (
                  <Button variant="ghost" disabled={busy} onClick={() => void finishSetup()}>
                    {t("onboarding.withoutAccount")}
                  </Button>
                ) : null}
                <Button
                  className="ms-auto"
                  disabled={busy}
                  onClick={() => {
                    void saveName().catch((error: unknown) =>
                      toast.error(error instanceof Error ? error.message : String(error)),
                    );
                    setStep(connectAI ? "ai" : "account");
                  }}
                >
                  {t("onboarding.next")}
                </Button>
              </>
            ) : step === "ai" ? (
              <Button className="ms-auto" disabled={busy} onClick={() => setStep("account")}>
                {t("onboarding.next")}
              </Button>
            ) : step === "plan" ? (
              <>
                {plan !== "free" && account?.account.plan !== plan ? (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setPlan("free");
                      void saveName()
                        .then(finish)
                        .catch((error: unknown) =>
                          toast.error(error instanceof Error ? error.message : String(error)),
                        );
                    }}
                  >
                    {t("onboarding.plan.later")}
                  </Button>
                ) : null}
                <Button className="ms-auto" disabled={busy} onClick={() => void finishSetup()}>
                  {plan === "free" || account?.account.plan === plan
                    ? t("onboarding.finish")
                    : t("onboarding.plan.subscribe", { plan: t(`onboarding.plan.${plan}.name`) })}
                </Button>
              </>
            ) : (
              <Button
                className="ms-auto"
                variant={step === "username" ? "ghost" : "default"}
                disabled={busy}
                onClick={() =>
                  step === "account" && needsUsername
                    ? setStep("username")
                    : account
                      ? setStep("plan")
                      : void finishSetup()
                }
              >
                {step === "username"
                  ? t("onboarding.skip")
                  : !account
                    ? t("onboarding.withoutAccount")
                    : t("onboarding.next")}
              </Button>
            )}
          </footer>
        </div>

        {/* The live preview. */}
        <Preview
          name={shownName}
          username={account?.user.username ?? (username || null)}
          email={account?.user.email ?? null}
          step={step}
        />
      </div>
    </div>
  );
}

/** Better Vault AI and Cloud: Free, Pro or Max, bought through Dodo Payments when finishing. */
function PlanStep({ plan, onPlan }: { plan: Plan; onPlan: (plan: Plan) => void }) {
  const { t } = useTranslation("common");
  const plans = ["free", "pro", "max"] as const;
  return (
    <>
      <Heading title={t("onboarding.plan.title")} body={t("onboarding.plan.body")} />
      <div
        role="radiogroup"
        aria-label={t("onboarding.plan.title")}
        className="flex flex-wrap gap-2"
      >
        {plans.map((each) => (
          <button
            key={each}
            type="button"
            role="radio"
            aria-checked={plan === each}
            tabIndex={plan === each ? 0 : -1}
            onKeyDown={(event) => onRadioKeys(event, plans, plan, onPlan)}
            onClick={() => onPlan(each)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm ring-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              plan === each
                ? "bg-foreground text-background ring-foreground"
                : "ring-border hover:bg-accent",
            )}
          >
            <span className="font-medium">{t(`onboarding.plan.${each}.name`)}</span>
            <span
              className={cn(
                "tabular-nums",
                plan === each ? "text-background/70" : "text-muted-foreground",
              )}
            >
              {t(`onboarding.plan.${each}.price`)}
            </span>
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t(`onboarding.plan.${plan}.detail`)}</p>
    </>
  );
}

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function ProfileStep({ name, onName }: { name: string; onName: (name: string) => void }) {
  const { t } = useTranslation("common");
  const profile = useProfile();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Heading title={t("onboarding.profile.title")} body={t("onboarding.profile.body")} />
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          aria-label={t("onboarding.profile.picture")}
          className="group relative cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar profile={profile ? { ...profile, name } : undefined} size={64} />
          <span className="absolute -end-1 -bottom-1 flex size-7 items-center justify-center rounded-full bg-foreground text-background ring-2 ring-card">
            <Icon icon={Camera01Icon} size={14} />
          </span>
        </button>
        <div className="text-sm">
          <p className="font-medium">{t("onboarding.profile.picture")}</p>
          <p className="text-xs text-muted-foreground">{t("onboarding.profile.pictureHint")}</p>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file)
              void avatarFromFile(file)
                .then((avatar) => updateProfile({ avatar }))
                .catch(() => toast.error(t("onboarding.profile.pictureFailed")));
          }}
        />
      </div>
      <Field
        label={t("onboarding.profile.name")}
        htmlFor={id}
        hint={t("onboarding.profile.nameHint")}
      >
        <Input
          id={id}
          autoFocus
          autoComplete="name"
          value={name}
          onChange={(event) => onName(event.target.value)}
        />
      </Field>
    </>
  );
}

function UsernameStep({
  value,
  onChange,
  onDone,
}: {
  value: string;
  onChange: (value: string) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation("common");
  const id = useId();
  const [state, setState] = useState<"idle" | "checking" | "free" | "taken" | "invalid">("idle");
  const [saving, setSaving] = useState(false);
  const valid = /^[a-zA-Z0-9_.]{3,30}$/.test(value);

  useEffect(() => {
    if (!value) return;
    let live = true;
    const timer = setTimeout(
      () => {
        if (!valid) return setState("invalid");
        setState("checking");
        void usernameAvailable(value).then((free) => live && setState(free ? "free" : "taken"));
      },
      valid ? 350 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [value, valid]);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (state !== "free") return;
        setSaving(true);
        void setUsername(value)
          .then(onDone)
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : String(error)),
          )
          .finally(() => setSaving(false));
      }}
    >
      <Heading title={t("onboarding.username.title")} body={t("onboarding.username.body")} />
      <Field
        label={t("onboarding.username.label")}
        htmlFor={id}
        hint={
          !value
            ? t("onboarding.username.hint")
            : state === "invalid"
              ? t("onboarding.username.invalid")
              : state === "taken"
                ? t("onboarding.username.taken")
                : state === "free"
                  ? t("onboarding.username.free")
                  : t("onboarding.username.checking")
        }
      >
        <Input.Group>
          <Input.Addon>@</Input.Addon>
          <Input
            id={id}
            autoFocus
            autoComplete="username"
            spellCheck={false}
            value={value}
            onChange={(event) => onChange(event.target.value.trim())}
            aria-invalid={state === "invalid" || state === "taken" ? true : undefined}
          />
        </Input.Group>
      </Field>
      <Button type="submit" className="self-end" disabled={state !== "free" || saving}>
        {t("onboarding.next")}
      </Button>
    </form>
  );
}

const PAGE_W = 820;
const PAGE_H = 600;

/**
 * The real notebooks page, drawn small, with the Settings sheet open as it
 * really is: its seven groups, the Account row showing the name, picture and
 * username typed, and the AI row the subscriptions connected. It uses the
 * live components' styles, scaled to fit.
 */
function Preview({
  name,
  username,
  email,
  step,
}: {
  name: string;
  username: string | null;
  email: string | null;
  step: Step;
}) {
  const { t } = useTranslation("common");
  const { t: tHome } = useTranslation("home");
  const { t: tShell } = useTranslation("shell");
  const { t: tSettings } = useTranslation("settings");
  const profile = useProfile();
  const { accounts } = useSubscriptionConnections();
  const subscriptions = [...new Set(accounts.map(({ provider }) => cliProxyBrands[provider]))];
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / PAGE_W));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const row =
    "flex h-8 w-full min-w-0 items-center gap-3 rounded-md px-2 text-start text-[0.8125rem] leading-5 text-muted-foreground";
  const heading = "px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground";
  const highlight = "ring-2 ring-primary/70";
  return (
    <div
      className="relative hidden flex-col justify-center gap-4 border-s bg-muted/40 p-6 lg:flex"
      aria-hidden
    >
      <div
        ref={frame}
        className="relative w-full overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border"
        style={{ aspectRatio: `${PAGE_W} / ${PAGE_H}` }}
      >
        <div
          className="pointer-events-none absolute start-0 top-0 flex origin-top-left bg-background select-none rtl:origin-top-right"
          style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})` }}
        >
          {/* The sidebar, as in components/shell/app-sidebar.tsx. */}
          <aside className="flex w-56 shrink-0 flex-col ps-3 pe-2 pb-2">
            <div className="flex h-13 shrink-0 items-center gap-3 px-2 text-[0.8125rem] font-medium">
              <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs inset-ring inset-ring-border">
                {tHome("vaults.default").slice(0, 1)}
              </span>
              {tHome("vaults.default")}
            </div>
            <span className={cn(row, "mt-1 border border-input font-medium text-foreground")}>
              <Icon icon={Add01Icon} size={16} strokeWidth={1.5} />
              <span className="flex-1">{tShell("nav.add")}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {tShell("nav.addHint")}
              </span>
            </span>
            <p className={heading}>{tShell("nav.study")}</p>
            {(
              [
                [Sun03Icon, tShell("nav.today")],
                [Target02Icon, tShell("nav.practice")],
                [RepeatIcon, tShell("nav.review")],
                [Books01Icon, tShell("nav.library")],
              ] as const
            ).map(([icon, label]) => (
              <span key={label} className={row}>
                <Icon icon={icon} size={16} strokeWidth={1.5} />
                {label}
              </span>
            ))}
            <p className={heading}>{tShell("nav.notebooks")}</p>
            {(
              [
                [Clock01Icon, tShell("nav.recent")],
                [Note01Icon, tShell("nav.notes")],
              ] as const
            ).map(([icon, label]) => (
              <span key={label} className={row}>
                <Icon icon={icon} size={16} strokeWidth={1.5} />
                {label}
              </span>
            ))}
            <p className={heading}>{tShell("nav.tools")}</p>
            {(
              [
                [Calendar03Icon, tShell("nav.calendar")],
                [BotIcon, tShell("nav.bot")],
                [MagicWand01Icon, tShell("nav.skills")],
              ] as const
            ).map(([icon, label]) => (
              <span key={label} className={row}>
                <Icon icon={icon} size={16} strokeWidth={1.5} />
                {label}
              </span>
            ))}
          </aside>

          {/* The notebooks list, as in components/home/notebook-home.tsx. */}
          <div className="my-2 me-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
            <header className="flex h-13 shrink-0 items-center gap-3 border-b ps-5 pe-2">
              <h1 className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">
                {tShell("list.title")}
              </h1>
              <span className="flex h-8 items-center gap-2 rounded-md px-3 text-[0.8125rem] font-medium">
                <Icon icon={Add01Icon} size={16} className="text-muted-foreground" />
                {tShell("list.add")}
              </span>
              <span className="flex h-8 items-center rounded-md bg-primary px-3 text-[0.8125rem] font-medium text-primary-foreground">
                {tShell("list.newNotebook")}
              </span>
            </header>
            <main className="flex flex-col px-6 pt-8">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex items-center gap-4 border-b py-4">
                  <span className="h-12 w-9 shrink-0 rounded-md bg-muted" />
                  <span className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="h-3 w-2/5 rounded-full bg-muted" />
                    <span className="h-2.5 w-3/5 rounded-full bg-muted/70" />
                  </span>
                </div>
              ))}
            </main>
          </div>

          {/* Settings, open over the page, as in components/settings/settings-sheet.tsx. */}
          <div className="absolute start-3 top-3 bottom-3 flex w-[26rem] flex-col rounded-[1.75rem] bg-card p-6 shadow-2xl ring-1 ring-border">
            <h2 className="text-lg font-semibold">{tSettings("title")}</h2>
            <p className="pb-4 text-sm text-muted-foreground">{tSettings("description")}</p>
            <div className="-mx-2 flex flex-col gap-0.5">
              <SheetRow
                className={step === "ai" ? highlight : undefined}
                icon={<Icon icon={AiBrain01Icon} />}
                label={tSettings("groups.ai.label")}
                hint={
                  subscriptions.length > 0
                    ? subscriptions.join(", ")
                    : tSettings("groups.ai.detail")
                }
              />
              <SheetRow
                icon={<Icon icon={AiVoiceIcon} />}
                label={tSettings("groups.reading.label")}
                hint={tSettings("groups.reading.detail")}
              />
              <SheetRow
                className={step === "ai" ? undefined : highlight}
                icon={<Avatar profile={profile ? { ...profile, name } : undefined} size={36} />}
                label={name || tSettings("groups.account.label")}
                hint={
                  username
                    ? `@${username}`
                    : (email ??
                      (name ? tSettings("rows.accountHint") : tSettings("groups.account.detail")))
                }
              />
              <SheetRow
                icon={<Icon icon={CloudServerIcon} />}
                label={tSettings("groups.storage.label")}
                hint={tSettings("groups.storage.detail")}
              />
              <SheetRow
                icon={<Icon icon={PaintBoardIcon} />}
                label={tSettings("groups.appearance.label")}
                hint={tSettings("groups.appearance.detail")}
              />
              <SheetRow
                icon={<Icon icon={PlugSocketIcon} />}
                label={tSettings("groups.tools.label")}
                hint={tSettings("groups.tools.detail")}
              />
              <SheetRow
                icon={<Icon icon={InformationCircleIcon} />}
                label={tSettings("groups.about.label")}
                hint={tSettings("groups.about.detail")}
              />
            </div>
          </div>
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {t(`onboarding.preview.caption.${step}`)}
      </p>
    </div>
  );
}

/** A Settings row, drawn as components/settings/settings-row.tsx draws it. */
function SheetRow({
  icon,
  label,
  hint,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 transition-shadow",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block truncate text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Icon
        icon={ArrowRight01Icon}
        size={16}
        className="shrink-0 text-muted-foreground rtl:rotate-180"
      />
    </div>
  );
}
