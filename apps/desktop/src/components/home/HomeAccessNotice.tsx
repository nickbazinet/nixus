import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button } from "@nixus/shared";
import type { HomeComposerAccess } from "@/lib/types";

/** FR-11 states: AI is locked, with a reason that is not "try again". */
export const HOME_ACCESS_LOCKED: Partial<
  Record<HomeComposerAccess, { title: string; body: string }>
> = {
  local_profile: { title: "home.locked.setupTitle", body: "home.locked.localBody" },
  signed_out: { title: "home.locked.setupTitle", body: "home.locked.signedOutBody" },
  not_premium: { title: "home.locked.setupTitle", body: "home.locked.premiumBody" },
  quota_exhausted: { title: "home.locked.quotaTitle", body: "home.locked.quotaBody" },
  reauthentication_required: { title: "home.locked.reauthTitle", body: "home.locked.reauthBody" },
};

/**
 * The inline, non-modal notice shared by the composer panel and the hero prompt: a locked
 * reason names the actual cause instead of a generic lock icon, and every reason here — including
 * the transient hosted problem below — is one a BYO key in Settings would unlock just as well as
 * premium would, so the same action sits under all of them. Never blocks anything else on the
 * page — it only replaces the prompt the notice sits beside.
 */
export function HomeAccessNotice({
  state,
  onRetry,
  ...props
}: {
  state: HomeComposerAccess;
  onRetry: () => void;
} & React.ComponentProps<"div">) {
  const { t } = useTranslation();
  const locked = HOME_ACCESS_LOCKED[state];

  if (locked) {
    return (
      <Alert variant="info" icon={<Lock className="size-4" />} data-state={state} {...props}>
        <AlertTitle>{t(locked.title)}</AlertTitle>
        <AlertDescription>{t(locked.body)}</AlertDescription>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          render={<Link to="/settings" />}
        >
          {t("home.locked.setupAction")}
        </Button>
      </Alert>
    );
  }

  // FR-7: a transient hosted problem. Whatever sits beside this still renders.
  return (
    <Alert variant="caution" {...props}>
      <AlertTitle>{t("home.unavailable.title")}</AlertTitle>
      <AlertDescription>
        {t("home.unavailable.body")}{" "}
        <button type="button" className="underline" onClick={onRetry}>
          {t("home.unavailable.retry")}
        </button>
      </AlertDescription>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        render={<Link to="/settings" />}
      >
        {t("home.locked.setupAction")}
      </Button>
    </Alert>
  );
}
