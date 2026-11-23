import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { CircleAlert, Info } from "lucide-react";
import { Badge } from "@nixus/shared";
import { SettingRow, SettingsSection } from "./SettingRow";

const LIMIT_KEYS = [
  "settings.aboutLimitLocal",
  "settings.aboutLimitNoBank",
  "settings.aboutLimitSingleUser",
  "settings.aboutLimitNotAdvice",
  "settings.aboutLimitEarly",
];

export function AboutSettings() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-grid-gap" data-testid="settings-about">
      <SettingsSection
        heading={t("settings.aboutTitle")}
        icon={Info}
        description={t("settings.aboutDescription")}
      >
        {version !== "" && (
          <SettingRow
            title={t("settings.aboutVersionLabel")}
            description={version}
            control={<Badge variant="brand">{t("settings.aboutStage")}</Badge>}
            data-testid="setting-version"
          />
        )}
        {/* Never an app-level encryption claim: the only protection is whatever the OS already
          * does to this disk, and saying more would be a promise the product cannot keep. */}
        <SettingRow
          title={t("settings.aboutStorageTitle")}
          description={t("settings.aboutStorageBody")}
          data-testid="setting-storage-note"
        />
      </SettingsSection>

      <SettingsSection heading={t("settings.aboutLimitsTitle")} icon={CircleAlert}>
        {LIMIT_KEYS.map((key) => (
          <SettingRow key={key} title={t(key)} />
        ))}
      </SettingsSection>
    </div>
  );
}
