import { Loading03Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Field } from "@/components/common/field";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { providerIds } from "@/lib/ai/catalog";
import { createNotebook } from "@/lib/db/notebooks";
import { updateProfile, useProfile } from "@/lib/db/profile";
import { isProviderReady, updateSettings, useSettings } from "@/lib/db/settings";
import { routes } from "@/lib/routes";
import { ACCEPTED_FILES, ingestFile, ingestText, ingestUrl } from "@/lib/sources/ingest";

const STEPS = 3;

/** Marks the first-run flow, and the upgrade notice with it, as done for good. */
function finish() {
  return updateSettings((settings) => {
    settings.onboardingDone = true;
    settings.upgradeNoticeSeen = true;
  });
}

/**
 * The first-run flow for someone with no material and no model: welcome and
 * name, an AI (optional, set up in Settings), and a first piece of material.
 */
export function OnboardingDialog() {
  const { t } = useTranslation("onboarding");
  const { t: tCommon } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  const settings = useSettings();
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const named = useRef(false);

  // Start the name field from a saved profile, once.
  useEffect(() => {
    if (profile && !named.current) {
      named.current = true;
      setName(profile.name);
    }
  }, [profile]);

  const connected = settings ? providerIds.some((id) => isProviderReady(settings, id)) : false;

  function close() {
    setOpen(false);
    void finish();
  }

  async function add(run: (notebookId: string) => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const id = await createNotebook(t("material.inbox"));
      await run(id);
      await finish();
      setOpen(false);
      navigate(routes.notebook(id));
    } catch (failure) {
      setError(
        t("material.failed", {
          error: failure instanceof Error ? failure.message : String(failure),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  function addTyped() {
    const value = source.trim();
    if (!value) return;
    const isLink = /^https?:\/\/\S+$/i.test(value);
    void add((id) =>
      isLink ? ingestUrl(id, value) : ingestText(id, value.split("\n")[0].slice(0, 60), value),
    );
  }

  return (
    <>
      <Dialog
        open={open && !settingsOpen}
        onOpenChange={(next) => !next && close()}
        dismissible={false}
      >
        <Dialog.Content size="md" closeLabel={tCommon("actions.close")}>
          <Dialog.Header
            title={
              step === 1 ? t("welcome.title") : step === 2 ? t("ai.title") : t("material.title")
            }
            description={
              step === 1
                ? t("welcome.lead")
                : step === 2
                  ? t("ai.description")
                  : t("material.description")
            }
          />
          <Dialog.Body>
            <p className="mb-4 text-xs font-medium text-muted-foreground">
              {t("step", { current: step, total: STEPS })}
            </p>
            {step === 1 ? (
              <form
                id="onboarding-name"
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void updateProfile({ name: name.trim() });
                  setStep(2);
                }}
              >
                <p className="text-sm leading-6 text-muted-foreground">{t("welcome.body")}</p>
                <Field
                  label={t("name.label")}
                  htmlFor="onboarding-name-input"
                  hint={t("name.hint")}
                >
                  <Input
                    id="onboarding-name-input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <p className="text-xs leading-5 text-muted-foreground">{t("welcome.steps")}</p>
              </form>
            ) : null}

            {step === 2 ? (
              <div className="flex flex-col gap-3">
                <ul className="flex flex-col gap-2 text-sm">
                  {(["key", "local", "plan"] as const).map((id) => (
                    <li key={id} className="rounded-xl bg-card p-3 ring-1 ring-border">
                      <p className="font-medium text-foreground">{t(`ai.${id}`)}</p>
                      <p className="text-xs leading-5 text-muted-foreground">{t(`ai.${id}Body`)}</p>
                    </li>
                  ))}
                </ul>
                {connected ? <p className="text-sm text-success">{t("ai.connected")}</p> : null}
                <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
                  {t("ai.open")}
                </Button>
              </div>
            ) : null}

            {step === 3 ? (
              <form
                id="onboarding-material"
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  addTyped();
                }}
              >
                <Field label={t("material.label")} htmlFor="onboarding-source">
                  <Input
                    id="onboarding-source"
                    value={source}
                    placeholder={t("material.placeholder")}
                    onChange={(event) => setSource(event.target.value)}
                  />
                </Field>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    {t("material.file")}
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept={ACCEPTED_FILES}
                    className="hidden"
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      event.target.value = "";
                      if (files.length === 0) return;
                      void add(async (id) => {
                        for (const file of files) await ingestFile(id, file);
                      });
                    }}
                  />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{t("material.examples")}</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("material.goesTo", { notebook: t("material.inbox") })}
                </p>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
              </form>
            ) : null}
          </Dialog.Body>
          <Dialog.Footer>
            {step === 1 ? (
              <Button type="submit" form="onboarding-name">
                {t("continue")}
              </Button>
            ) : null}
            {step === 2 ? (
              <>
                <Button variant="ghost" onClick={() => setStep(1)}>
                  {t("back")}
                </Button>
                <Button variant="secondary" onClick={() => setStep(3)}>
                  {connected ? t("continue") : t("ai.skip")}
                </Button>
              </>
            ) : null}
            {step === 3 ? (
              <>
                <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>
                  {t("back")}
                </Button>
                <Button variant="secondary" onClick={close} disabled={busy}>
                  {t("material.skip")}
                </Button>
                <Button
                  type="submit"
                  form="onboarding-material"
                  disabled={!source.trim() || busy}
                  aria-busy={busy}
                >
                  {busy ? <Icon icon={Loading03Icon} size={16} className="animate-spin" /> : null}
                  {t("material.add")}
                </Button>
              </>
            ) : null}
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} page="providers" />
    </>
  );
}
