import { Popover } from "@base-ui/react/popover";
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "@/components/common/segmented";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import {
  defaultStudyReadingAppearance,
  studyEpubTheme,
  studyReadingFont,
  type StudyReadingAppearance,
} from "@/lib/study/records";
import { StudyTranslationLanguages, useTranslationLanguageName } from "./study-translation-language";

const textSizes = Array.from({ length: 15 }, (_, index) => index + 14);
const zoomLevels = [75, 100, 125, 150, 175, 200];

function Stepper<T extends number>({
  label,
  value,
  values,
  format,
  choose,
}: {
  label: string;
  value: T;
  values: readonly T[];
  format: (value: T) => string;
  choose: (value: T) => void;
}) {
  const { t } = useTranslation("home");
  const at = values.indexOf(value);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2" role="group" aria-label={label}>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t("study.reader.decrease", { name: label })}
          disabled={at <= 0}
          onClick={() => choose(values[at - 1])}
        >
          <Icon icon={MinusSignIcon} size={15} />
        </Button>
        <span aria-live="polite" className="min-w-0 flex-1 text-center text-sm tabular-nums">
          {format(value)}
        </span>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t("study.reader.increase", { name: label })}
          disabled={at < 0 || at >= values.length - 1}
          onClick={() => choose(values[at + 1])}
        >
          <Icon icon={PlusSignIcon} size={15} />
        </Button>
      </div>
    </div>
  );
}

/** The `Aa` popover: text size, zoom, font, the EPUB theme and the language to translate into. */
export function StudyReaderSettings({
  appearance,
  original,
  layoutToggle,
  translateTo,
  onTranslateTo,
  onOpen,
  onChange,
}: {
  appearance: StudyReadingAppearance;
  original?: "pdf" | "epub";
  layoutToggle?: { label: string; disabled: boolean; toggle: () => void };
  translateTo?: string;
  onTranslateTo: (code: string) => void;
  onOpen: () => void;
  onChange: (change: Partial<StudyReadingAppearance>) => void;
}) {
  const { t } = useTranslation("home");
  const languageName = useTranslationLanguageName();
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const label = t("study.reader.appearance");
  const defaults = defaultStudyReadingAppearance;
  const customized = appearance.textSize !== defaults.textSize || appearance.font !== defaults.font ||
    appearance.pdfZoom !== defaults.pdfZoom || appearance.epubTheme !== defaults.epubTheme;
  const percent = new Intl.NumberFormat(undefined, { style: "percent" });
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) onOpen();
        else setChoosingLanguage(false);
      }}
    >
      <Popover.Trigger
        render={<Button size="icon-sm" variant="ghost" aria-label={label} title={label} />}
      >
        <span aria-hidden className="font-serif text-[0.95rem] leading-none">{t("study.reader.appearanceGlyph")}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-50 outline-none">
          <Popover.Popup
            aria-label={label}
            className="w-[min(19rem,calc(100vw-1rem))] origin-(--transform-origin) space-y-4 rounded-2xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none"
          >
            {original === "pdf" ? (
              <Stepper
                label={t("study.reader.pdfZoom")}
                value={appearance.pdfZoom}
                values={zoomLevels}
                format={(zoom) => percent.format(zoom / 100)}
                choose={(pdfZoom) => onChange({ pdfZoom })}
              />
            ) : null}
            <Stepper
              label={t(original === "pdf" ? "study.reader.extractedTextSize" : "study.reader.textSize")}
              value={appearance.textSize}
              values={textSizes}
              format={(size) => t("study.reader.textSizeValue", { size })}
              choose={(textSize) => onChange({ textSize })}
            />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">{t("study.reader.font")}</p>
              <Segmented
                aria-label={t("study.reader.font")}
                className="grid w-full grid-cols-2"
                value={appearance.font}
                onValueChange={(font) => onChange({ font })}
                options={studyReadingFont.options.map((font) => ({
                  value: font,
                  label: <span className={font === "serif" ? "font-serif" : "font-sans"}>{t(`study.reader.fonts.${font}`)}</span>,
                }))}
              />
            </div>
            {original === "epub" ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t("study.reader.theme")}</p>
                <Segmented
                  aria-label={t("study.reader.theme")}
                  size="sm"
                  className="flex w-full [&>*]:flex-1"
                  value={appearance.epubTheme}
                  onValueChange={(epubTheme) => onChange({ epubTheme })}
                  options={studyEpubTheme.options.map((theme) => ({
                    value: theme,
                    label: t(`study.reader.themes.${theme}`),
                  }))}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">{t("study.reader.translateInto")}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm">
                  {translateTo ? languageName(translateTo) : t("study.reader.translateNotChosen")}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={choosingLanguage}
                  onClick={() => setChoosingLanguage(!choosingLanguage)}
                >
                  {t(choosingLanguage ? "study.reader.doneChoosing" : "study.reader.changeLanguage")}
                </Button>
              </div>
              {choosingLanguage ? (
                <StudyTranslationLanguages
                  value={translateTo}
                  onChange={(code) => {
                    onTranslateTo(code);
                    setChoosingLanguage(false);
                  }}
                />
              ) : null}
            </div>
            {layoutToggle || customized ? (
              <div className="flex flex-wrap gap-1.5 border-t pt-3">
                {layoutToggle ? (
                  <Button size="sm" variant="outline" disabled={layoutToggle.disabled} onClick={layoutToggle.toggle}>
                    {layoutToggle.label}
                  </Button>
                ) : null}
                {customized ? (
                  <Button size="sm" variant="ghost" onClick={() => onChange({ ...defaults })}>
                    {t("study.reader.resetAppearance")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
