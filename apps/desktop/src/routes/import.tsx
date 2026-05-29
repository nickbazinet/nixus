import { useState, useMemo, useCallback } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { DatePicker } from "@nixus/shared";
import { Input } from "@nixus/shared";
import { MoneyInput } from "../components/shared/MoneyInput";
import { Label } from "@nixus/shared";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nixus/shared";
import { PageHeader } from "../components/shared/PageHeader";
import { UploadZone } from "../components/import/UploadZone";
import { ImportProgressStepper } from "../components/import/ImportProgressStepper";
import { TransactionReviewCard } from "../components/import/TransactionReviewCard";
import { AutoCategorizedSummary } from "../components/import/AutoCategorizedSummary";
import { useImport, type ParsedTransaction, type ImportError } from "../hooks/useImport";
import { useFormatCurrency } from "../hooks/useFormatCurrency";
import { queryKeys } from "../lib/constants";

interface BudgetCategory {
  id: number;
  group_id: number;
  name: string;
  target_cents: number;
  sort_order: number;
  created_at: string;
}

export const Route = createFileRoute("/import")({
  component: ImportPage,
});

const CONFIDENCE_THRESHOLD = 0.8;

function ImportPage() {
  const { t } = useTranslation();
  const { status, stage, message, result, error, startImport, reset } =
    useImport();

  return (
    <div>
      <PageHeader title={t("import.import")} />
      <div className="mx-auto max-w-2xl py-8">
        {status === "idle" && (
          <UploadZone
            onValidated={(file) => {
              startImport(file.file_path);
            }}
          />
        )}

        {status === "processing" && (
          <ImportProgressStepper currentStage={stage} message={message} />
        )}

        {status === "done" && result && (
          <ReviewScreen
            transactions={result.transactions}
            unreadable={result.unreadable}
            duplicateIndices={new Set(result.duplicate_indices ?? [])}
            onReset={reset}
          />
        )}

        {status === "error" && (
          <ErrorScreen error={error} onReset={reset} />
        )}
      </div>
    </div>
  );
}

function ReviewScreen({
  transactions,
  unreadable,
  duplicateIndices,
  onReset,
}: {
  transactions: ParsedTransaction[];
  unreadable: string[];
  duplicateIndices: Set<number>;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.allBudgetCategories,
    queryFn: () => invoke<BudgetCategory[]>("get_all_budget_categories"),
  });

  const autoTransactions = useMemo(
    () => transactions.filter((t) => t.confidence >= CONFIDENCE_THRESHOLD),
    [transactions]
  );

  const flaggedTransactions = useMemo(
    () => transactions.filter((t) => t.confidence < CONFIDENCE_THRESHOLD),
    [transactions]
  );

  const autoGlobalIndices = useMemo(
    () =>
      transactions.reduce<number[]>((acc, t, i) => {
        if (t.confidence >= CONFIDENCE_THRESHOLD) acc.push(i);
        return acc;
      }, []),
    [transactions]
  );

  const flaggedGlobalIndices = useMemo(
    () =>
      transactions.reduce<number[]>((acc, t, i) => {
        if (t.confidence < CONFIDENCE_THRESHOLD) acc.push(i);
        return acc;
      }, []),
    [transactions]
  );

  // Track field overrides for all transactions
  const [fieldOverrides, setFieldOverrides] = useState<
    Record<number, Partial<ParsedTransaction>>
  >({});

  // Track deselected transactions (all start selected)
  const [deselected, setDeselected] = useState<Set<number>>(new Set());

  // Track manual entries for unreadable transactions
  const [manualEntries, setManualEntries] = useState<
    { merchant: string; amount_cents: number; budget_category_id: number; date: string }[]
  >(unreadable.map(() => ({ merchant: "", amount_cents: 0, budget_category_id: 0, date: "" })));

  const handleFieldChange = useCallback(
    (globalIndex: number, field: keyof ParsedTransaction, value: string | number | null) => {
      setFieldOverrides((prev) => ({
        ...prev,
        [globalIndex]: { ...prev[globalIndex], [field]: value },
      }));
    },
    []
  );

  const handleToggleSelect = useCallback((globalIndex: number) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(globalIndex)) {
        next.delete(globalIndex);
      } else {
        next.add(globalIndex);
      }
      return next;
    });
  }, []);

  const handleFlaggedCategoryChange = useCallback(
    (txIndex: number, categoryId: number) => {
      const globalIndex = flaggedGlobalIndices[txIndex];
      setFieldOverrides((prev) => ({
        ...prev,
        [globalIndex]: { ...prev[globalIndex], suggested_category_id: categoryId },
      }));
    },
    [flaggedGlobalIndices]
  );

  const handleAutoCategoryChange = useCallback(
    (txIndex: number, categoryId: number) => {
      const globalIndex = autoGlobalIndices[txIndex];
      setFieldOverrides((prev) => ({
        ...prev,
        [globalIndex]: { ...prev[globalIndex], suggested_category_id: categoryId },
      }));
    },
    [autoGlobalIndices]
  );

  // Check if all manual entries are valid
  const allManualValid =
    manualEntries.length === 0 ||
    manualEntries.every(
      (e) =>
        e.merchant.trim() !== "" &&
        e.amount_cents > 0 &&
        e.budget_category_id > 0 &&
        e.date !== ""
    );

  const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

  const allDatesValid = transactions.every((tx, i) => {
    if (deselected.has(i)) return true;
    const date = fieldOverrides[i]?.date ?? tx.date;
    return DATE_REGEX.test(date);
  });

  const allCategoriesValid = transactions.every((tx, i) => {
    if (deselected.has(i)) return true;
    const catId = fieldOverrides[i]?.suggested_category_id ?? tx.suggested_category_id;
    return catId != null && catId > 0;
  });

  const validManualCount = manualEntries.filter(
    (e) => e.merchant.trim() !== ""
  ).length;
  const selectedCount = transactions.filter((_, i) => !deselected.has(i)).length;
  const totalCount = selectedCount + validManualCount;
  const canConfirm = allCategoriesValid && allManualValid && allDatesValid && !confirming && totalCount > 0;

  const autoSelectedSet = useMemo(
    () => new Set(autoGlobalIndices.filter((i) => !deselected.has(i))),
    [autoGlobalIndices, deselected]
  );

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const finalTransactions = transactions
        .map((tx, i) => ({ tx, i }))
        .filter(({ i }) => !deselected.has(i))
        .map(({ tx, i }) => ({
          merchant: fieldOverrides[i]?.merchant ?? tx.merchant,
          amount_cents: fieldOverrides[i]?.amount_cents ?? tx.amount_cents,
          budget_category_id:
            fieldOverrides[i]?.suggested_category_id ?? tx.suggested_category_id ?? 0,
          date: fieldOverrides[i]?.date ?? tx.date,
        }));

      // Add valid manual entries
      const validManual = manualEntries.filter(
        (e) => e.merchant.trim() !== "" && e.amount_cents > 0
      );

      const allTransactions = [...finalTransactions, ...validManual];
      const invalidDate = allTransactions.find((t) => !DATE_REGEX.test(t.date));
      if (invalidDate) {
        toast.error(
          `${t("import.invalidDateFormat")}"${invalidDate.date}"${t("import.useDatePicker")}`
        );
        setConfirming(false);
        return;
      }

      await invoke("confirm_import", {
        transactions: allTransactions,
      });

      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["budget-status"] });
      queryClient.invalidateQueries({ queryKey: ["budget-summary"] });
      queryClient.invalidateQueries({ queryKey: ["spending-breakdown"] });

      toast.success(`${totalCount} ${t("import.transactionsImported")}`);
      setConfirmed(true);
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error(e.message ?? "Failed to import");
    } finally {
      setConfirming(false);
    }
  };

  if (confirmed) {
    const totalCents = transactions.reduce((sum, t, i) => {
      if (deselected.has(i)) return sum;
      return sum + (fieldOverrides[i]?.amount_cents ?? t.amount_cents);
    }, 0);
    const uniqueCategories = new Set(
      transactions
        .map((t, i) =>
          deselected.has(i)
            ? null
            : (fieldOverrides[i]?.suggested_category_id ?? t.suggested_category_id)
        )
        .filter((id) => id !== null)
    );

    return (
      <div className="flex flex-col items-center gap-6 py-12" data-testid="import-completion">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
          <Check className="h-8 w-8 text-emerald-500" />
        </div>
        <h2 className="text-xl font-semibold">{t("import.importComplete")}</h2>
        <div className="space-y-1 text-center text-sm text-muted-foreground">
          <p data-testid="completion-total">{formatCurrency(totalCents)} imported</p>
          <p>{uniqueCategories.size} {t("import.categoriesAffected")}</p>
          <p>{totalCount} {t("import.transactions")}</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => navigate({ to: "/" })}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            data-testid="view-dashboard-button"
          >
            {t("import.viewDashboard")}
          </button>
          <button
            onClick={onReset}
            className="text-sm text-primary underline"
            data-testid="import-another-link"
          >
            {t("import.importAnother")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="import-review-screen">
      <div className="mb-6" data-testid="review-summary">
        <h3 className="text-lg font-medium">
          {selectedCount} {t("import.of")} {transactions.length} {t("import.transactionsExtracted")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {autoTransactions.length} {t("import.autoCategorized")}, {flaggedTransactions.length}{" "}
          {t("import.needReview")}
        </p>
      </div>

      <div className="space-y-4">
        <AutoCategorizedSummary
          transactions={autoTransactions}
          categories={categories}
          onCategoryChange={handleAutoCategoryChange}
          selectedSet={autoSelectedSet}
          onToggleSelect={(localIndex) => handleToggleSelect(autoGlobalIndices[localIndex])}
          onFieldChange={(localIndex, field, value) =>
            handleFieldChange(autoGlobalIndices[localIndex], field, value)
          }
          fieldOverrides={fieldOverrides}
          globalIndices={autoGlobalIndices}
          duplicateIndices={duplicateIndices}
        />

        {flaggedTransactions.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              {t("import.needsReview")}
            </h4>
            {flaggedTransactions.map((tx, i) => {
              const globalIndex = flaggedGlobalIndices[i];
              const overrides = fieldOverrides[globalIndex];
              const selectedId = overrides?.suggested_category_id ?? tx.suggested_category_id;
              return (
                <TransactionReviewCard
                  key={i}
                  merchant={overrides?.merchant ?? tx.merchant}
                  amountCents={overrides?.amount_cents ?? tx.amount_cents}
                  date={overrides?.date ?? tx.date}
                  suggestedCategoryId={tx.suggested_category_id}
                  categories={categories}
                  selectedCategoryId={selectedId}
                  onCategoryChange={(catId) => handleFlaggedCategoryChange(i, catId)}
                  isResolved={selectedId != null}
                  selected={!deselected.has(globalIndex)}
                  onToggleSelect={() => handleToggleSelect(globalIndex)}
                  onMerchantChange={(value) => handleFieldChange(globalIndex, "merchant", value)}
                  onAmountChange={(value) => handleFieldChange(globalIndex, "amount_cents", value)}
                  onDateChange={(value) => handleFieldChange(globalIndex, "date", value)}
                  isDuplicate={duplicateIndices.has(globalIndex)}
                />
              );
            })}
          </div>
        )}

        {unreadable.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              {t("import.couldntBeRead")} ({unreadable.length})
            </h4>
            {unreadable.map((desc, i) => (
              <div key={i} className="rounded-lg border border-muted p-4">
                <p className="mb-3 text-sm text-muted-foreground">{desc}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`manual-merchant-${i}`}>{t("expenses.merchant")}</Label>
                    <Input
                      id={`manual-merchant-${i}`}
                      placeholder={t("expenses.merchant")}
                      value={manualEntries[i]?.merchant ?? ""}
                      onChange={(e) => {
                        const updated = [...manualEntries];
                        updated[i] = { ...updated[i], merchant: e.target.value };
                        setManualEntries(updated);
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`manual-amount-${i}`}>{t("common.amount")}</Label>
                    <MoneyInput
                      id={`manual-amount-${i}`}
                      value={manualEntries[i]?.amount_cents || 0}
                      onChange={(cents) => {
                        const updated = [...manualEntries];
                        updated[i] = { ...updated[i], amount_cents: cents };
                        setManualEntries(updated);
                      }}
                    />
                  </div>
                  <div>
                    <Label>{t("common.category")}</Label>
                    <Select
                      value={String(manualEntries[i]?.budget_category_id || "")}
                      onValueChange={(val) => {
                        const updated = [...manualEntries];
                        updated[i] = {
                          ...updated[i],
                          budget_category_id: Number(val),
                        };
                        setManualEntries(updated);
                      }}
                      items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("import.selectCategory")} />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={String(cat.id)}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("common.date")}</Label>
                    <DatePicker
                      value={manualEntries[i]?.date ?? ""}
                      onChange={(value) => {
                        const updated = [...manualEntries];
                        updated[i] = { ...updated[i], date: value };
                        setManualEntries(updated);
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          disabled={!canConfirm}
          onClick={handleConfirm}
          className="mt-6 w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          data-testid="confirm-import-button"
        >
          {confirming
            ? t("import.importing")
            : `${t("import.import")} ${totalCount} ${totalCount !== 1 ? t("import.transactions") : t("import.transaction")}`}
        </button>
      </div>
    </div>
  );
}

function ErrorScreen({
  error,
  onReset,
}: {
  error: ImportError | null;
  onReset: () => void;
}) {
  const { t } = useTranslation();

  if (error?.type === "not_configured") {
    return (
      <div data-testid="import-error-state">
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="font-medium text-foreground">
            {t("settings.notConfiguredPrompt", "AI not configured")}
            {" — "}
            <Link
              to="/settings"
              className="text-primary underline"
              data-testid="open-settings-link"
            >
              {t("settings.openSettings", "Open Settings")}
            </Link>
          </p>
          <button
            className="mt-4 text-sm text-primary underline"
            onClick={onReset}
            data-testid="try-again-button"
          >
            {t("import.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="import-error-state">
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <p className="font-medium text-destructive">
          {t("import.unavailable")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{error?.message}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          You can{" "}
          <Link
            to="/budget"
            className="text-primary underline"
            data-testid="manual-entry-link"
          >
            {t("import.addManually")}
          </Link>{" "}
          instead.
        </p>
        <button
          className="mt-4 text-sm text-primary underline"
          onClick={onReset}
          data-testid="try-again-button"
        >
          {t("import.tryAgain")}
        </button>
      </div>
    </div>
  );
}
