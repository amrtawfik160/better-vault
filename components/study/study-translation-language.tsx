import { Tick02Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { translationLanguageName, translationLanguages } from "@/lib/study/translation-language";
import { cn } from "@/lib/utils";

/** A language's name in the interface language, with its own name beside it when they differ. */
export function useTranslationLanguageName() {
  const { i18n } = useTranslation();
  return (code: string) => {
    const local = translationLanguageName(code, i18n.language);
    const native = translationLanguageName(code, code);
    return local === native ? local : `${local} · ${native}`;
  };
}

/** The languages a selection can be translated into, as a short list to pick from. */
export function StudyTranslationLanguages({
  value,
  onChange,
  className,
}: {
  value?: string;
  onChange: (code: string) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation("home");
  const name = useTranslationLanguageName();
  const languages = [...translationLanguages].sort((a, b) =>
    translationLanguageName(a, i18n.language).localeCompare(translationLanguageName(b, i18n.language), i18n.language),
  );
  return (
    <ScrollArea className={cn("h-44 rounded-xl border", className)}>
      <ul aria-label={t("study.reader.translateInto")} className="grid gap-0.5 p-1">
        {languages.map((code) => (
          <li key={code}>
            <button
              type="button"
              aria-pressed={code === value}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent"
              onClick={() => onChange(code)}
            >
              <span className="min-w-0 flex-1 truncate">{name(code)}</span>
              {code === value ? <Icon icon={Tick02Icon} size={15} /> : null}
            </button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
