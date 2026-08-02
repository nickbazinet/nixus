import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { Badge, Card } from "@nixus/shared";
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
    <div className="space-y-section-gap" data-testid="settings-about">
      <div>
        <h2 className="text-h1 text-ink">{t("settings.aboutTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("settings.aboutDescription")}
        </p>
      </div>

      {version !== "" && (
        <Card flush>
          <SettingRow
            title={t("settings.aboutVersionLabel")}
            description={version}
            control={<Badge variant="neutral">{t("settings.aboutStage")}</Badge>}
            data-testid="setting-version"
          />
        </Card>
      )}

      <SettingsSection heading={t("settings.aboutLimitsTitle")}>
        <Card flush>
          {LIMIT_KEYS.map((key) => (
            <SettingRow key={key} title={t(key)} />
          ))}
        </Card>
      </SettingsSection>

      {/* Never an app-level encryption claim: the only protection is whatever the OS already does
        * to this disk, and saying more would be a promise the product cannot keep. */}
      <Card flush>
        <SettingRow
          title={t("settings.aboutStorageTitle")}
          description={t("settings.aboutStorageBody")}
          data-testid="setting-storage-note"
        />
      </Card>
    </div>
  );
}
