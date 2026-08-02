import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { Button, Card, CardContent, EmptyState } from "@nixus/shared";

export function OnboardingImportStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="space-y-4" data-testid="onboarding-import-step">
      <div>
        <h2 className="text-h2 text-ink">{t("onboarding.importTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("onboarding.importDescription")}
        </p>
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
