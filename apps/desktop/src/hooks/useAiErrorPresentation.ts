import { useTranslation } from "react-i18next";

import {
  hostedAiIsRetryable,
  hostedAiMessageKey,
  isHostedAiError,
  parseAppError,
} from "@/lib/appError";

/**
 * Title and retry affordance for a failed AI call.
 *
 * A hosted-AI failure carries a code whose remedy differs per value, so a single
 * static "couldn't be generated" line is misleading for most of them — and offering
 * "retry" for a validation, size, encoding, or reauthentication failure invites the
 * user to repeat something that cannot succeed.
 */
export function useAiErrorPresentation(
  error: unknown,
  fallbackKey: string
): { title: string; retryable: boolean } {
  const { t } = useTranslation();
  const parsed = parseAppError(error);

  if (isHostedAiError(parsed)) {
    return {
      title: t(hostedAiMessageKey(parsed.code)),
      retryable: hostedAiIsRetryable(parsed.code),
    };
  }

  return { title: t(fallbackKey), retryable: true };
}
