import { useTranslation } from "react-i18next";
import { Badge, Button } from "@nixus/shared";

import { AccountSection, PILL_BUTTON_CLASS, SectionRow } from "./AccountSection";

/**
 * "Sign-in and data": how this account signs in, and the two data rights.
 *
 * Export and deletion have no service behind them yet, so their buttons are
 * disabled and say so rather than pretending to start something.
 */
export function SignInSection({
  email,
  active,
}: {
  readonly email: string | null;
  readonly active: boolean;
}) {
  const { t } = useTranslation();

  const comingSoon = (
    <Badge variant="neutral" className="ml-2 rounded-full px-2 align-middle">
      {t("account.comingSoon")}
    </Badge>
  );

  return (
    <AccountSection id="signin" active={active} title={t("account.signin.title")}>
      <SectionRow
        title={t("account.signin.method")}
        detail={
          <span data-testid="signin-email" className="break-all">
            {email ?? t("account.signin.methodUnknown")}
          </span>
        }
        action={
          <Badge variant="good" className="rounded-full px-2">
            {t("account.signin.connected")}
          </Badge>
        }
      />

      <SectionRow
        title={
          <>
            {t("account.signin.exportTitle")}
            {comingSoon}
          </>
        }
        detail={t("account.signin.exportDetail")}
        action={
          <Button variant="outline" className={PILL_BUTTON_CLASS} disabled data-testid="data-export">
            {t("account.signin.exportAction")}
          </Button>
        }
      />

      <SectionRow
        title={
          <>
            {t("account.signin.deleteTitle")}
            {comingSoon}
          </>
        }
        detail={t("account.signin.deleteDetail")}
        action={
          <Button
            variant="outline"
            className={`${PILL_BUTTON_CLASS} border-over/50 text-over-ink hover:bg-over-bg`}
            disabled
            data-testid="account-delete"
          >
            {t("account.signin.deleteAction")}
          </Button>
        }
      />
    </AccountSection>
  );
}
