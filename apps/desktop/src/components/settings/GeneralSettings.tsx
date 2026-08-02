import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { Card, Switch } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { SettingRow, SettingsSection, SegmentedControl } from "./SettingRow";

const THEME_VALUES = ["light", "dark", "system"] as const;

export function GeneralSettings() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { hidden, toggleHidden } = useValuesHidden();

  const activeTheme = THEME_VALUES.find((value) => value === theme) ?? "system";
  const activeLanguage = i18n.language.startsWith("fr") ? "fr" : "en";

  const changeLanguage = (next: string) => {
    void i18n.changeLanguage(next);
  };

  return (
    <div className="space-y-section-gap" data-testid="settings-general">
      <div>
        <h2 className="text-h1 text-ink">{t("settings.generalTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("settings.generalDescription")}
        </p>
      </div>

      <SettingsSection heading={t("settings.sectionAppearance")}>
        <Card flush>
          <SettingRow
            title={t("settings.themeTitle")}
            description={t("settings.themeDescription")}
            control={
              <SegmentedControl
                name="settings-theme"
                label={t("settings.themeGroupLabel")}
                value={activeTheme}
                onChange={setTheme}
                options={[
                  { value: "light", label: t("sidebar.light") },
                  { value: "dark", label: t("sidebar.dark") },
                  { value: "system", label: t("sidebar.system") },
                ]}
              />
            }
            data-testid="setting-theme"
          />
          <SettingRow
            title={t("settings.languageTitle")}
            description={t("settings.languageDescription")}
            control={
              <SegmentedControl
                name="settings-language"
                label={t("settings.languageGroupLabel")}
                value={activeLanguage}
                onChange={changeLanguage}
                options={[
                  { value: "en", label: t("sidebar.english") },
                  { value: "fr", label: t("sidebar.french") },
                ]}
              />
            }
            data-testid="setting-language"
          />
        </Card>
      </SettingsSection>

      <SettingsSection heading={t("settings.sectionPrivacy")}>
        <Card flush>
          <SettingRow
            title={t("settings.hideAmountsTitle")}
            description={t("settings.hideAmountsDescription")}
            control={
              <Switch
                checked={hidden}
                onCheckedChange={toggleHidden}
                aria-label={t("settings.hideAmountsTitle")}
                data-testid="setting-hide-amounts-switch"
              />
            }
            data-testid="setting-hide-amounts"
          />
        </Card>
      </SettingsSection>

      {/* No toggle: nothing in the Rust side registers a tray or intercepts window close, so a
        * switch here would promise behaviour that does not exist. The consequence is stated
        * instead, because a user who quits and then wonders why nothing reminded her has been
        * failed by the copy. */}
      <SettingsSection heading={t("settings.sectionWindow")}>
        <Card flush>
          <SettingRow
            title={t("settings.trayTitle")}
            description={t("settings.trayDescription")}
            data-testid="setting-tray"
          />
        </Card>
      </SettingsSection>
    </div>
  );
}
