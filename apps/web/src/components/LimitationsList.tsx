import { useTranslation } from "react-i18next";

import { limitationIds } from "@/content/limitations";

type LimitationsListProps = {
  testId?: string;
  className?: string;
};

export function LimitationsList({
  testId = "beta-limitations-list",
  className = "space-y-3 text-sm text-muted-foreground",
}: LimitationsListProps) {
  const { t } = useTranslation();

  return (
    <ul role="list" data-testid={testId} className={className}>
      {limitationIds.map((id) => (
        <li key={id} className="flex gap-3">
          <span
            aria-hidden="true"
            className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
          />
          <span>{t(`beta.limitations.items.${id}`)}</span>
        </li>
      ))}
    </ul>
  );
}
