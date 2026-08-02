import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  focusRing,
} from "@nixus/shared";
import { cn } from "@/lib/utils";

const DISMISS_STORAGE_KEY = "finance.onboarding.dismissed";

// Deliberately a plain Card, not an Alert: the `info` Alert variant carries a brand left border,
// and the 3px brand accent is reserved for the one suggested-next-step card on this surface. Its
// scarcity is what makes that card read as "do this".
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
    <Card size="sm" data-testid="setup-incomplete-banner">
      <CardHeader>
        <CardTitle>{t("dashboard.setupIncompleteTitle")}</CardTitle>
        <CardAction>
          <button
            type="button"
            onClick={handleDismiss}
            className={cn(
              "min-h-target-min text-caption text-ink-dim hover:text-ink",
              focusRing,
            )}
            data-testid="setup-incomplete-dismiss"
          >
            {t("dashboard.setupIncompleteDismiss")}
          </button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <p className="text-caption text-ink-dim">{t("dashboard.setupIncompleteBody")}</p>

        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          render={<Link to="/onboarding" />}
          data-testid="setup-incomplete-cta"
        >
          {t("dashboard.setupIncompleteCta")}
          <ArrowRight data-icon="inline-end" aria-hidden="true" />
        </Button>
      </CardContent>
    </Card>
  );
}
