import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@nixus/shared";

const DISMISS_STORAGE_KEY = "finance.onboarding.dismissed";

export function SetupIncompleteBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, "true");
    } catch {
      // localStorage unavailable
    }
    setDismissed(true);
  };

  return (
    <Card className="shadow-sm rounded-lg mb-4" data-testid="setup-incomplete-banner">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-sm font-medium text-foreground">
            {t("dashboard.setupIncompleteTitle")}
          </p>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-xs text-primary hover:underline"
            data-testid="setup-incomplete-dismiss"
          >
            {t("dashboard.setupIncompleteDismiss")}
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-3">
          {t("dashboard.setupIncompleteBody")}
        </p>

        <Link
          to="/onboarding"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          data-testid="setup-incomplete-cta"
        >
          {t("dashboard.setupIncompleteCta")}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
