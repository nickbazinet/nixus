import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { Button, Card, CardContent, EmptyState, IconChip } from "@nixus/shared";

export function OnboardingImportStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-grid-gap" data-testid="onboarding-import-step">
      <div className="flex items-start gap-4">
        <IconChip icon={Upload} size="lg" />
        <div className="min-w-0">
          <h2 className="font-display text-h1 text-ink">{t("onboarding.importTitle")}</h2>
          <p className="mt-1 text-caption text-ink-dim">
            {t("onboarding.importDescription")}
          </p>
        </div>
      </div>

      <Card>
        <CardContent>
          <EmptyState
            icon={<Upload />}
            title={t("onboarding.importReady")}
            action={
              <Button
                onClick={() => navigate({ to: "/import" })}
                data-testid="go-to-import-button"
              >
                {t("onboarding.goToImportPage")}
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
