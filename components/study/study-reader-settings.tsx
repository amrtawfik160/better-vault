import { TextFontIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Menu } from "@/components/panelui/menu";
import { defaultStudyReadingAppearance, studyEpubTheme, type StudyReadingAppearance } from "@/lib/study/records";

const textSizes = Array.from({ length: 15 }, (_, index) => index + 14);
const zoomLevels = [75, 100, 125, 150, 175, 200];

function AppearanceChoices<T extends string | number>({
  name,
  selected,
  values,
  label,
  choose,
}: {
  name: string;
  selected: T;
  values: readonly T[];
  label: (value: T) => string;
  choose: (value: T) => void;
}) {
  return (
    <Menu.Sub>
      <Menu.SubTrigger end={<Menu.Badge>{label(selected)}</Menu.Badge>}>{name}</Menu.SubTrigger>
      <Menu.SubContent>
        <Menu.RadioGroup value={selected} aria-label={name} onValueChange={(next: unknown) => {
          const choice = values.find((value) => value === next);
          if (choice !== undefined && choice !== selected) choose(choice);
        }}>
          {values.map((value) => (
            <Menu.RadioItem key={value} value={value} closeOnClick>{label(value)}</Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.SubContent>
    </Menu.Sub>
  );
}

export function StudyReaderSettings({
  appearance,
  original,
  layoutToggle,
  onOpen,
  onChange,
}: {
  appearance: StudyReadingAppearance;
  original?: "pdf" | "epub";
  layoutToggle?: { label: string; disabled: boolean; toggle: () => void };
  onOpen: () => void;
  onChange: (change: Partial<StudyReadingAppearance>) => void;
}) {
  const { t } = useTranslation("home");
  const label = t("study.reader.appearance");
  const defaults = defaultStudyReadingAppearance;
  const customized = appearance.textSize !== defaults.textSize ||
    appearance.pdfZoom !== defaults.pdfZoom || appearance.epubTheme !== defaults.epubTheme;
  const percent = new Intl.NumberFormat(undefined, { style: "percent" });
  return (
    <Menu modal={false} onOpenChange={(open) => { if (open) onOpen(); }}>
      <Menu.Trigger render={<Button size="icon-sm" variant="ghost" className="ms-auto" />} aria-label={label} title={label}>
        <Icon icon={TextFontIcon} size={17} />
      </Menu.Trigger>
      <Menu.Content align="end">
        <Menu.Group>
          <Menu.GroupLabel>{label}</Menu.GroupLabel>
          {original === "pdf" ? (
            <AppearanceChoices
              name={t("study.reader.pdfZoom")}
              selected={appearance.pdfZoom}
              values={zoomLevels}
              label={(zoom) => percent.format(zoom / 100)}
              choose={(pdfZoom) => onChange({ pdfZoom })}
            />
          ) : null}
          <AppearanceChoices
            name={t(original === "pdf" ? "study.reader.extractedTextSize" : "study.reader.textSize")}
            selected={appearance.textSize}
            values={textSizes}
            label={(size) => t("study.reader.textSizeValue", { size })}
            choose={(textSize) => onChange({ textSize })}
          />
          {original === "epub" ? (
            <AppearanceChoices
              name={t("study.reader.theme")}
              selected={appearance.epubTheme}
              values={studyEpubTheme.options}
              label={(theme) => t(`study.reader.themes.${theme}`)}
              choose={(epubTheme) => onChange({ epubTheme })}
            />
          ) : null}
        </Menu.Group>
        {layoutToggle || customized ? <Menu.Separator /> : null}
        {layoutToggle ? <Menu.Item disabled={layoutToggle.disabled} onClick={layoutToggle.toggle}>{layoutToggle.label}</Menu.Item> : null}
        {customized ? <Menu.Item onClick={() => onChange(defaults)}>{t("study.reader.resetAppearance")}</Menu.Item> : null}
      </Menu.Content>
    </Menu>
  );
}
