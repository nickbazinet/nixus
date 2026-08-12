import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { format, parseISO } from "date-fns";
import { Target } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Label,
  Money,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { MetricInfoTooltip } from "@/components/financial-health/MetricInfoTooltip";
import {
  ALLOCATION_OVERAGE_ID,
  SuggestedAllocationRow,
} from "@/components/projects/SuggestedAllocationRow";
import { useAccounts } from "@/hooks/useAccounts";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import { groupAccountsBySection } from "@/lib/accountUtils";
import { sumAllocationCents, validateAllocationTotal } from "@/lib/allocation";
import type { ProjectAllocationSuggestion } from "@/lib/types";

const ACCOUNT_FIELD_ID = "suggested-allocation-account";

export interface SuggestedAllocationDraft {
  project_id: number;
  account_id: number;
  amount_cents: number;
}

interface SuggestedAllocationPanelProps {
  suggestions: ProjectAllocationSuggestion[];
  availableSurplusCents: number;
  nextSuggestionDate: string;
  onConfirm: (allocations: SuggestedAllocationDraft[]) => void;
  onSkip: () => void;
  isSubmitting?: boolean;
}

function seedDrafts(
  suggestions: ProjectAllocationSuggestion[]
): Record<number, number> {
  return Object.fromEntries(
    suggestions.map((s) => [s.project_id, s.suggested_cents])
  );
}

export function SuggestedAllocationPanel({
  suggestions,
  availableSurplusCents,
  nextSuggestionDate,
  onConfirm,
  onSkip,
  isSubmitting = false,
}: SuggestedAllocationPanelProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const { data: accounts = [] } = useAccounts();
  const [drafts, setDrafts] = useState<Record<number, number>>(() =>
    seedDrafts(suggestions)
  );
  // One account for the whole batch, and never defaulted: silently attributing money to an account
  // the user did not choose is the trust failure this feature exists to avoid.
  const [accountId, setAccountId] = useState("");
  const seededFrom = useRef(suggestions);
  // MoneyInput keeps its own display string, seeded on mount. Bumping this remounts the fields so a
  // re-seeded draft is what the user actually sees, not just what the total counts.
  const [seedVersion, setSeedVersion] = useState(0);

  const { assetGroups, liabilityGroups } = groupAccountsBySection(accounts);
  // Same ordering and the same inline `Select` as `ProjectContributionForm`, deliberately not
  // `OptionalAccountSelect`: its leading `common.none` option is invalid for a NOT NULL column.
  const orderedAccounts = useMemo(
    () => [
      ...assetGroups.flatMap(([, groupAccounts]) => groupAccounts),
      ...liabilityGroups.flatMap(([, groupAccounts]) => groupAccounts),
    ],
    [assetGroups, liabilityGroups]
  );
  const accountItems = orderedAccounts.map((account) => ({
    value: String(account.id),
    label: `${account.name} — ${account.institution}`,
  }));

  // A reorder or a new contribution refetches the suggestion, and the project set itself can change.
  // Reseeding wholesale rather than merging is what keeps stale keys for removed projects out of the
  // total the user is reading. The in-flight guard mirrors InlineEdit's isEditing guard.
  useEffect(() => {
    if (seededFrom.current === suggestions || isSubmitting) return;
    seededFrom.current = suggestions;
    setDrafts(seedDrafts(suggestions));
    setSeedVersion((version) => version + 1);
  }, [suggestions, isSubmitting]);

  if (suggestions.length === 0) return null;

  const totalCents = sumAllocationCents(drafts);
  const { ok, overageCents } = validateAllocationTotal(
    totalCents,
    availableSurplusCents
  );
  const canConfirm = ok && accountId !== "" && !isSubmitting;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(
      suggestions.map((s) => ({
        project_id: s.project_id,
        account_id: Number(accountId),
        amount_cents: drafts[s.project_id] ?? 0,
      }))
    );
  };

  return (
    <Card
      className="mb-section-gap border-l-3 border-l-brand"
      data-testid="suggested-allocation-panel"
    >
      <CardHeader className="flex-row items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink"
        >
          <Target className="size-4" />
        </span>
        <CardTitle className="text-h2">
          {t("projects.suggestionTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Alert variant="info" className="mb-3 rounded-md">
          <AlertDescription data-testid="suggested-allocation-intro">
            {t("projects.suggestionIntro")}
          </AlertDescription>
        </Alert>
        {suggestions.map((suggestion, index) => (
          <SuggestedAllocationRow
            key={`${suggestion.project_id}-${seedVersion}`}
            suggestion={suggestion}
            valueCents={drafts[suggestion.project_id] ?? 0}
            onChange={(cents) =>
              setDrafts((prev) => ({ ...prev, [suggestion.project_id]: cents }))
            }
            hasOverage={!ok}
            striped={index % 2 === 1}
          />
        ))}
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3">
        <div
          role="status"
          aria-live="polite"
          data-testid="suggested-allocation-summary"
        >
          <div className="flex items-center justify-between gap-3 text-label text-ink">
            <span className="flex items-center gap-1">
              {t("projects.suggestionSurplus")}
              <MetricInfoTooltip
                ariaLabel={t("projects.suggestionSurplusInfoAria")}
                content={t("projects.suggestionSurplusInfoPlain")}
                testId="suggested-allocation-surplus-info"
              />
            </span>
            <span data-testid="suggested-allocation-surplus">
              <Money
                cents={availableSurplusCents}
                locale={i18n.language}
                {...maskProps}
              />
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-label text-ink">
            <span>{t("projects.suggestionTotal")}</span>
            <span data-testid="suggested-allocation-total">
              <Money cents={totalCents} locale={i18n.language} {...maskProps} />
            </span>
          </div>
          {ok ? (
            <p
              className="text-caption text-ink-dim"
              data-testid="suggested-allocation-remainder"
            >
              {t("projects.suggestionRemainder", {
                amount: formatCurrency(availableSurplusCents - totalCents),
              })}
            </p>
          ) : (
            <p
              id={ALLOCATION_OVERAGE_ID}
              className="text-caption text-over"
              data-testid="suggested-allocation-overage"
            >
              {t("projects.suggestionOverBy", {
                amount: formatCurrency(overageCents),
              })}
            </p>
          )}
        </div>

        <div className="space-y-1.5" data-testid="suggested-allocation-account">
          <Label htmlFor={ACCOUNT_FIELD_ID} required>
            {t("projects.suggestionAccountLabel")}
          </Label>
          <Select
            value={accountId}
            onValueChange={(next) => setAccountId(next ?? "")}
            items={accountItems}
          >
            <SelectTrigger id={ACCOUNT_FIELD_ID} aria-required="true">
              <SelectValue placeholder={t("projects.suggestionAccountLabel")} />
            </SelectTrigger>
            <SelectContent>
              {orderedAccounts.map((account) => (
                <SelectItem key={account.id} value={String(account.id)}>
                  {account.name} — {account.institution}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {accountId === "" && (
            <p
              className="text-caption text-ink-dim"
              data-testid="suggested-allocation-account-hint"
            >
              {t("projects.suggestionAccountRequired")}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onSkip}
            data-testid="suggested-allocation-skip"
          >
            {t("projects.suggestionSkip")}
          </Button>
          <Button
            size="sm"
            disabled={!canConfirm}
            onClick={handleConfirm}
            data-testid="suggested-allocation-confirm"
          >
            {t("projects.suggestionConfirm")}
          </Button>
        </div>

        <p
          className="text-right text-caption text-ink-dim"
          data-testid="suggested-allocation-cadence"
        >
          {t("projects.suggestionCadenceNote", {
            date: format(parseISO(nextSuggestionDate), "MMMM d"),
          })}
        </p>
      </CardFooter>
    </Card>
  );
}
