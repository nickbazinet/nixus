import { useTranslation } from "react-i18next";
import { Alert, AlertTitle, AlertDescription, Card } from "@nixus/shared";
import { CredentialsForm } from "./CredentialsForm";
import { SettingRow, SettingsSection } from "./SettingRow";

export function ReadingStatementsSettings() {
  const { t } = useTranslation();

  return (
    <div className="space-y-section-gap" data-testid="settings-reading-statements">
      <div>
        <h2 className="text-h1 text-ink">{t("settings.readingTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("settings.readingDescription")}
        </p>
      </div>

      <Card flush>
        <Alert variant="info">
          <AlertTitle>{t("settings.readingReassuranceTitle")}</AlertTitle>
          <AlertDescription>{t("settings.readingReassuranceBody")}</AlertDescription>
        </Alert>
      </Card>

      <SettingsSection heading={t("settings.sectionService")}>
        <CredentialsForm />
      </SettingsSection>

      {/* Required UI, not optional reassurance: the product's whole positioning is local-first, so
        * a user who hands over an API key is owed an exact statement of what leaves the machine. */}
      <SettingsSection heading={t("settings.sectionWhatGetsSent")}>
        <Card flush>
          <SettingRow
            title={t("settings.whatGetsSentTitle")}
            description={t("settings.whatGetsSentBody")}
            data-testid="setting-what-gets-sent"
          />
          <SettingRow
            title={t("settings.rememberMerchantsTitle")}
            description={t("settings.rememberMerchantsBody")}
            data-testid="setting-remember-merchants"
          />
        </Card>
      </SettingsSection>
    </div>
  );
}
