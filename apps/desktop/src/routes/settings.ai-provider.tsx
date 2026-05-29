import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/shared/PageHeader";
import { CredentialsForm } from "../components/settings/CredentialsForm";

export const Route = createFileRoute("/settings/ai-provider")({
  component: AiProviderSettingsPage,
});

function AiProviderSettingsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t("settings.title", "Settings")} />
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="mb-6 text-sm text-muted-foreground">
            {t(
              "settings.aiProviderDescription",
              "Configure your AI provider to enable statement import and chat features."
            )}
          </p>
          <CredentialsForm />
        </div>
      </div>
    </div>
  );
}
