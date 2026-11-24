import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@nixus/shared";
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
    <div
      className="flex flex-col gap-grid-gap"
      data-testid="settings-reading-statements"
    >
      {isPremium && (
        /* Gold, not green: the design system reserves green (`good`) for budget status and gives
         * the premium entitlement its own `premium-ink` token, matching the profile badge. */
        <Alert
          variant="info"
          className="border-premium-ink bg-[color-mix(in_srgb,var(--premium-ink)_12%,transparent)]"
          data-testid="settings-reading-premium-banner"
        >
          <AlertTitle className="text-premium-ink">
            {t("settings.readingPremiumTitle")}
          </AlertTitle>
          <AlertDescription>{t("settings.readingPremiumBody")}</AlertDescription>
        </Alert>
      )}

      {/* The upgrade sits ABOVE the key form and never replaces it: a user who brings their own
        * provider gets the same feature for free, and burying that behind a purchase would be
        * charging for something this app does not require payment for. */}
      {offersUpgrade && (
        <Alert variant="info" data-testid="settings-reading-upgrade">
          <AlertTitle>{t("settings.readingUpgradeTitle")}</AlertTitle>
          <AlertDescription>{t("settings.readingUpgradeBody")}</AlertDescription>
          <BillingUpgradeAction
            className="mt-3"
            labelKey="settings.readingUpgradeAction"
            testId="settings-reading-upgrade-action"
          />
        </Alert>
      )}

      <Alert variant="info">
        <AlertTitle>{t("settings.readingReassuranceTitle")}</AlertTitle>
        <AlertDescription>{t("settings.readingReassuranceBody")}</AlertDescription>
      </Alert>

      <CredentialsForm />

      {/* Required UI, not optional reassurance: the product's whole positioning is local-first, so
        * a user who hands over an API key is owed an exact statement of what leaves the machine.
        * One row per AI surface, because what they send differs — an import carries the statement
        * and the names it is filed under, a chat turn carries a summary of the user's finances, and
        * the Home composer carries no figures at all. A single row cannot be true for all three. */}
      <SettingsSection heading={t("settings.sectionWhatGetsSent")} icon={Send}>
        <SettingRow
          title={t("settings.whatGetsSentTitle")}
          description={t("settings.whatGetsSentBody")}
          data-testid="setting-what-gets-sent"
        />
        <SettingRow
          title={t("settings.whatGetsSentChatTitle")}
          description={t("settings.whatGetsSentChatBody")}
          data-testid="setting-what-gets-sent-chat"
        />
        <SettingRow
          title={t("settings.whatGetsSentInsightsTitle")}
          description={t("settings.whatGetsSentInsightsBody")}
          data-testid="setting-what-gets-sent-insights"
        />
        <SettingRow
          title={t("settings.whatGetsSentHostedTitle")}
          description={t("settings.whatGetsSentHostedBody")}
          data-testid="setting-what-gets-sent-hosted"
        />
        <SettingRow
          title={t("settings.rememberMerchantsTitle")}
          description={t("settings.rememberMerchantsBody")}
          data-testid="setting-remember-merchants"
        />
      </SettingsSection>
    </div>
  );
}
