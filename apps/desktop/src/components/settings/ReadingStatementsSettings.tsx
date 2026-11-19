import { useTranslation } from "react-i18next";
import { Alert, AlertTitle, AlertDescription, Card } from "@nixus/shared";
import {
  useBillingEntitlementState,
  usePremiumEntitlementState,
} from "@/hooks/useAuth";
import { useActiveProfile } from "@/hooks/useDatasets";
import { BillingUpgradeAction } from "@/components/billing/BillingUpgradeAction";
import { HOSTED_AI_CAPABILITY, lacksCapability } from "@/lib/billing";
import { CredentialsForm } from "./CredentialsForm";
import { SettingRow, SettingsSection } from "./SettingRow";

export function ReadingStatementsSettings() {
  const { t } = useTranslation();
  const { premium: isPremium } = usePremiumEntitlementState();
  const entitlement = useBillingEntitlementState();
  const activeProfile = useActiveProfile();

  /* The refusal half of this page, and the one state an upgrade can repair: a Nixus Cloud
   * account whose entitlement was ESTABLISHED and does not hold `hosted_ai`.
   *
   * `lacksCapability` rather than `!isPremium`, and the difference is the whole point.
   * `premium: false` is three facts wearing one boolean — not entitled, nobody has asked yet, and
   * the entitlement could not be established — and the third is not something a purchase repairs.
   * Selling hosted reading to a user whose connection failed, and who may already own it, is
   * exactly what AD-9's "a free account receives a signed statement" exists to prevent: a free
   * account is `established: true` with an empty list, and an unreachable server is
   * `established: false`, so only the first is invited to upgrade.
   *
   * A local profile and a signed-out one are excluded for the same reason the Home notice
   * excludes them: there is no account for a plan to attach to, so the first step is a sign-in
   * rather than a purchase. */
  const signedInCloudAccount =
    activeProfile.data?.kind === "cloud-linked" && activeProfile.data.is_signed_in;
  const offersUpgrade =
    signedInCloudAccount && lacksCapability(entitlement, HOSTED_AI_CAPABILITY);

  return (
    <div className="space-y-section-gap" data-testid="settings-reading-statements">
      <div>
        <h2 className="text-h1 text-ink">{t("settings.readingTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("settings.readingDescription")}
        </p>
      </div>

      {isPremium && (
        <Card flush data-testid="settings-reading-premium-banner">
          {/* Gold, not green: the design system reserves green (`good`) for budget status and gives
            * the premium entitlement its own `premium-ink` token, matching the profile badge. */}
          <Alert
            variant="info"
            className="border-premium-ink bg-[color-mix(in_srgb,var(--premium-ink)_12%,transparent)]"
          >
            <AlertTitle className="text-premium-ink">{t("settings.readingPremiumTitle")}</AlertTitle>
            <AlertDescription>{t("settings.readingPremiumBody")}</AlertDescription>
          </Alert>
        </Card>
      )}

      {/* The upgrade sits ABOVE the key form and never replaces it: a user who brings their own
        * provider gets the same feature for free, and burying that behind a purchase would be
        * charging for something this app does not require payment for. */}
      {offersUpgrade && (
        <Card flush data-testid="settings-reading-upgrade">
          <Alert variant="info">
            <AlertTitle>{t("settings.readingUpgradeTitle")}</AlertTitle>
            <AlertDescription>{t("settings.readingUpgradeBody")}</AlertDescription>
            <BillingUpgradeAction
              className="mt-2"
              labelKey="settings.readingUpgradeAction"
              testId="settings-reading-upgrade-action"
            />
          </Alert>
        </Card>
      )}

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
