import type { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  /** One plain sentence under the title. */
  description?: string;
  children: ReactNode;
}

/** A titled block inside a settings group's page. */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="flex flex-col">
      <h3 className="text-xs leading-4 font-medium text-muted-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 mb-3 text-[0.8125rem] leading-5 text-pretty text-muted-foreground">
          {description}
        </p>
      ) : (
        <div className="mb-2" />
      )}
      {children}
    </section>
  );
}
