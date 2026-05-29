import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@nkbaz/shared";
import { Card, CardContent } from "@nkbaz/shared";
import { Upload } from "lucide-react";

export function OnboardingImportStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div data-testid="onboarding-import-step">
      <h2 className="text-lg font-medium mb-2">{t("onboarding.importTitle")}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("onboarding.importDescription")}
      </p>

      <Card>
        <CardContent className="p-8 text-center">
          <Upload className="size-10 mx-auto text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground mb-4">
            {t("onboarding.importReady")}
          </p>
          <Button
            variant="ghost"
            onClick={() => navigate({ to: "/import" })}
            data-testid="go-to-import-button"
          >
            {t("onboarding.goToImportPage")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
