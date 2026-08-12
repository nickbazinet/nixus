import { useState, useMemo, useCallback, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Check, FileQuestion } from "lucide-react";
import { toast } from "sonner";
import {
  Alert,
  AlertTitle,
  AlertDescription,
  BulkBar,
  Button,
  Card,
  CardContent,
  Checkbox,
  DatePicker,
  Input,
  Label,
  Money,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SubStat,
} from "@nixus/shared";
import { MoneyInput } from "../components/shared/MoneyInput";
import { PageHeader } from "../components/shared/PageHeader";
import { UploadZone } from "../components/import/UploadZone";
import { ImportProgressStepper } from "../components/import/ImportProgressStepper";
import { TransactionReviewCard } from "../components/import/TransactionReviewCard";
import { AutoCategorizedSummary } from "../components/import/AutoCategorizedSummary";
import { MerchantGroup } from "../components/import/MerchantGroup";
import {
  clearImportDraft,
  readImportDraft,
  writeImportDraft,
  type ImportDraft,
  type ManualEntry,
} from "../components/import/importDraft";
import { useImport, type ParsedTransaction, type ImportError } from "../hooks/useImport";
import { useFormatCurrency } from "../hooks/useFormatCurrency";
import { useCreateBudgetGroup, useCreateBudgetCategory } from "../hooks/useBudget";
import { useMaskProps } from "../contexts/ValuesVisibilityContext";
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
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** The 30s NFR ceiling. Past it the surface degrades to the AI-unavailable state rather than
 *  leaving a stepper spinning, which a user reasonably reads as a freeze. */
const HARD_TIMEOUT_MS = 30_000;

function ImportPage() {
  const { t } = useTranslation();
  const { status, stage, message, result, error, startImport, reset } = useImport();
  const [timedOut, setTimedOut] = useState(false);
  const [storedDraft, setStoredDraft] = useState<ImportDraft | null>(() => readImportDraft());
  const [resumedDraft, setResumedDraft] = useState<ImportDraft | null>(null);

  useEffect(() => {
    if (status !== "processing") {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), HARD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const handleReset = useCallback(() => {
    clearImportDraft();
    setStoredDraft(null);
    setResumedDraft(null);
    reset();
  }, [reset]);

  const showDraftPrompt =
    status === "idle" && resumedDraft === null && storedDraft !== null;

  return (
    <div>
      <PageHeader title={t("import.import")} />
      <div className="mx-auto max-w-2xl space-y-section-gap py-8">
        {resumedDraft !== null ? (
          <ReviewScreen
            key="resumed"
            transactions={resumedDraft.transactions}
            unreadable={resumedDraft.unreadable}
            duplicateIndices={new Set(resumedDraft.duplicateIndices)}
            draft={resumedDraft}
            onReset={handleReset}
          />
        ) : (
          <>
            {showDraftPrompt && storedDraft !== null && (
              <DraftResumePrompt
                draft={storedDraft}
                onResume={() => setResumedDraft(storedDraft)}
                onDiscard={() => {
                  clearImportDraft();
                  setStoredDraft(null);
                }}
              />
            )}

            {status === "idle" && (
              <UploadZone
                onValidated={(file) => {
                  startImport(file.file_path);
                }}
              />
            )}

            {status === "processing" &&
              (timedOut ? (
                <ImportUnavailable
                  title={t("import.timedOutTitle")}
                  body={t("import.timedOutBody")}
                  onReset={handleReset}
                />
              ) : (
                <ImportProgressStepper currentStage={stage} message={message} />
              ))}

            {status === "done" && result && (
              <ReviewScreen
                transactions={result.transactions}
                unreadable={result.unreadable}
                duplicateIndices={new Set(result.duplicate_indices ?? [])}
                onReset={handleReset}
              />
            )}

            {status === "error" && <ErrorScreen error={error} onReset={handleReset} />}
          </>
        )}
      </div>
    </div>
  );
}

function DraftResumePrompt({
  draft,
  onResume,
  onDiscard,
}: {
  draft: ImportDraft;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card data-testid="import-draft-prompt">
      <CardContent>
        <h2 className="text-h2 text-ink">{t("import.draftFoundTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("import.draftFoundBody", { count: draft.transactions.length })}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={onResume} data-testid="import-draft-resume">
            {t("import.draftResume")}
          </Button>
          <Button variant="outline" onClick={onDiscard} data-testid="import-draft-discard">
            {t("import.draftDiscard")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewScreen({
  transactions,
  unreadable,
  duplicateIndices,
  draft,
  onReset,
}: {
  transactions: ParsedTransaction[];
  unreadable: string[];
  duplicateIndices: Set<number>;
  draft?: ImportDraft;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.allBudgetCategories,
    queryFn: () => invoke<BudgetCategory[]>("get_all_budget_categories"),
  });

  const createGroup = useCreateBudgetGroup();
  const createCategory = useCreateBudgetCategory();
  const [creatingProposalIndices, setCreatingProposalIndices] = useState<Set<number>>(
    () => new Set()
  );
  // Keyed by transaction index: reuses a group created on a previous failed attempt
  // instead of creating a duplicate group on every retry.
  const [createdGroupIdFor, setCreatedGroupIdFor] = useState<Record<number, number>>({});

  const autoGlobalIndices = useMemo(
    () =>
      transactions.reduce<number[]>((acc, tx, i) => {
        if (tx.confidence >= CONFIDENCE_THRESHOLD) acc.push(i);
        return acc;
      }, []),
    [transactions]
  );

  const flaggedGlobalIndices = useMemo(
    () =>
      transactions.reduce<number[]>((acc, tx, i) => {
        if (tx.confidence < CONFIDENCE_THRESHOLD) acc.push(i);
        return acc;
      }, []),
    [transactions]
  );

  const autoTransactions = useMemo(
    () => autoGlobalIndices.map((i) => transactions[i]),
    [autoGlobalIndices, transactions]
  );

  const [fieldOverrides, setFieldOverrides] = useState<
    Record<number, Partial<ParsedTransaction>>
  >(() => draft?.fieldOverrides ?? {});

  const [deselected, setDeselected] = useState<Set<number>>(
    () => new Set(draft ? draft.deselected : duplicateIndices)
  );

  const [manualEntries, setManualEntries] = useState<ManualEntry[]>(
    () =>
      draft?.manualEntries ??
      unreadable.map(() => ({
        merchant: "",
        amount_cents: 0,
        budget_category_id: 0,
        date: "",
      }))
  );

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  // Written on every review change, not just on failure: a force-quit mid-review and a failed
  // commit lose the same 40-80 corrections, and neither is recoverable from the backend.
  useEffect(() => {
    if (confirmed) return;
    writeImportDraft({
      transactions,
      unreadable,
      duplicateIndices: [...duplicateIndices],
      fieldOverrides,
      deselected: [...deselected],
      manualEntries,
      savedAt: new Date().toISOString(),
    });
  }, [
    confirmed,
    transactions,
    unreadable,
    duplicateIndices,
    fieldOverrides,
    deselected,
    manualEntries,
  ]);

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
      if (next.has(globalIndex)) next.delete(globalIndex);
      else next.add(globalIndex);
      return next;
    });
  }, []);

  const setSelectionFor = useCallback((indices: number[], selected: boolean) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      for (const index of indices) {
        if (selected) next.delete(index);
        else next.add(index);
      }
      return next;
    });
  }, []);

  const handleFlaggedCategoryChange = useCallback(
    (globalIndex: number, categoryId: number) => {
      setFieldOverrides((prev) => ({
        ...prev,
        [globalIndex]: { ...prev[globalIndex], suggested_category_id: categoryId },
      }));
    },
    []
  );

  const PROPOSED_CATEGORY_PLACEHOLDER_TARGET_CENTS = 100;

  const handleCreateProposedCategory = useCallback(
    async (globalIndex: number) => {
      const proposal = transactions[globalIndex]?.propose_category;
      const name = proposal?.name.trim();
      if (!proposal || !name || creatingProposalIndices.has(globalIndex)) return;

      setCreatingProposalIndices((prev) => new Set(prev).add(globalIndex));
      try {
        const validGroupId =
          proposal.group_id != null && proposal.group_id > 0 ? proposal.group_id : null;
        const groupName = proposal.group_name?.trim() || name;

        const groupId =
          createdGroupIdFor[globalIndex] ??
          validGroupId ??
          (await createGroup.mutateAsync(groupName)).id;

        if (validGroupId == null && !createdGroupIdFor[globalIndex]) {
          setCreatedGroupIdFor((prev) => ({ ...prev, [globalIndex]: groupId }));
        }

        const category = await createCategory.mutateAsync({
          group_id: groupId,
          name,
          target_cents: PROPOSED_CATEGORY_PLACEHOLDER_TARGET_CENTS,
        });

        handleFlaggedCategoryChange(globalIndex, category.id);
        toast.success(t("import.createCategorySuccess", { name }));
      } catch {
        toast.error(t("import.createCategoryError"));
      } finally {
        setCreatingProposalIndices((prev) => {
          const next = new Set(prev);
          next.delete(globalIndex);
          return next;
        });
      }
    },
    [
      transactions,
      creatingProposalIndices,
      createdGroupIdFor,
      createGroup,
      createCategory,
      handleFlaggedCategoryChange,
      t,
    ]
  );

  const handleAutoCategoryChange = useCallback(
    (localIndex: number, categoryId: number) => {
      const globalIndex = autoGlobalIndices[localIndex];
      setFieldOverrides((prev) => ({
        ...prev,
        [globalIndex]: { ...prev[globalIndex], suggested_category_id: categoryId },
      }));
    },
    [autoGlobalIndices]
  );

  const applyCategoryTo = useCallback(
    (indices: number[], categoryId: number) => {
      setFieldOverrides((prev) => {
        const next = { ...prev };
        for (const index of indices) {
          next[index] = { ...next[index], suggested_category_id: categoryId };
        }
        return next;
      });
    },
    []
  );

  const selectedIndices = useMemo(
    () => transactions.map((_tx, i) => i).filter((i) => !deselected.has(i)),
    [transactions, deselected]
  );

  const validManualEntries = useMemo(
    () => manualEntries.filter((e) => e.merchant.trim() !== "" && e.amount_cents > 0),
    [manualEntries]
  );

  const selectedSumCents = useMemo(
    () =>
      selectedIndices.reduce(
        (sum, i) =>
          sum + (fieldOverrides[i]?.amount_cents ?? transactions[i].amount_cents),
        0
      ) + validManualEntries.reduce((sum, e) => sum + e.amount_cents, 0),
    [selectedIndices, fieldOverrides, transactions, validManualEntries]
  );

  const startedManualEntries = manualEntries.filter((e) => e.merchant.trim() !== "");
  const manualComplete = startedManualEntries.every(
    (e) => e.amount_cents > 0 && e.budget_category_id > 0 && DATE_REGEX.test(e.date)
  );
  const datesComplete = selectedIndices.every((i) =>
    DATE_REGEX.test(fieldOverrides[i]?.date ?? transactions[i].date)
  );
  const categoriesComplete = selectedIndices.every((i) => {
    const catId =
      fieldOverrides[i]?.suggested_category_id ?? transactions[i].suggested_category_id;
    return catId != null && catId > 0;
  });

  const totalCount = selectedIndices.length + startedManualEntries.length;
  const blockedReason = !categoriesComplete
    ? t("import.confirmBlockedCategory")
    : !datesComplete
      ? t("import.confirmBlockedDate")
      : !manualComplete
        ? t("import.confirmBlockedManual")
        : totalCount === 0
          ? t("import.confirmBlockedEmpty")
          : null;
  const canConfirm = blockedReason === null && !confirming;

  const autoSelectedSet = useMemo(
    () => new Set(autoGlobalIndices.filter((i) => !deselected.has(i))),
    [autoGlobalIndices, deselected]
  );

  const flaggedGroups = useMemo(() => {
    const byMerchant = new Map<string, number[]>();
    for (const globalIndex of flaggedGlobalIndices) {
      const key = (fieldOverrides[globalIndex]?.merchant ?? transactions[globalIndex].merchant)
        .trim()
        .toLowerCase();
      const bucket = byMerchant.get(key);
      if (bucket) bucket.push(globalIndex);
      else byMerchant.set(key, [globalIndex]);
    }
    return [...byMerchant.values()];
  }, [flaggedGlobalIndices, fieldOverrides, transactions]);

  const allSelected = deselected.size === 0;
  const someSelected = selectedIndices.length > 0 && !allSelected;

  const handleConfirm = async () => {
    setConfirming(true);
    setCommitError(null);
    try {
      const finalTransactions = selectedIndices.map((i) => ({
        merchant: fieldOverrides[i]?.merchant ?? transactions[i].merchant,
        amount_cents: fieldOverrides[i]?.amount_cents ?? transactions[i].amount_cents,
        budget_category_id:
          fieldOverrides[i]?.suggested_category_id ??
          transactions[i].suggested_category_id ??
          0,
        date: fieldOverrides[i]?.date ?? transactions[i].date,
      }));

      const allTransactions = [...finalTransactions, ...validManualEntries];
      const invalidDate = allTransactions.find((tx) => !DATE_REGEX.test(tx.date));
      if (invalidDate) {
        setCommitError(
          `${t("import.invalidDateFormat")}"${invalidDate.date}"${t("import.useDatePicker")}`
        );
        setConfirming(false);
        return;
      }

      await invoke("confirm_import", { transactions: allTransactions });

      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["budget-status"] });
      queryClient.invalidateQueries({ queryKey: ["budget-summary"] });
      queryClient.invalidateQueries({ queryKey: ["spending-breakdown"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.financialHealth });

      clearImportDraft();
      setConfirmed(true);
      toast.success(t("import.completionTitle"));
    } catch (err: unknown) {
      const e = err as { message?: string };
      setCommitError(e.message ?? t("import.commitFailedBody"));
    } finally {
      setConfirming(false);
    }
  };

  if (confirmed) {
    const uniqueCategories = new Set(
      selectedIndices
        .map(
          (i) =>
            fieldOverrides[i]?.suggested_category_id ??
            transactions[i].suggested_category_id
        )
        .filter((id): id is number => id !== null)
    );
    for (const entry of validManualEntries) uniqueCategories.add(entry.budget_category_id);

    return (
      <div
        className="flex flex-col items-center gap-4 py-8 text-center"
        data-testid="import-completion"
      >
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-lg bg-good-bg text-good-ink"
        >
          <Check className="size-5" />
        </span>
        <h2 className="text-h2 text-ink">{t("import.completionTitle")}</h2>
        <SubStat
          value={formatCurrency(selectedSumCents)}
          label={t("import.completionTotalLabel")}
          caption={`${t("import.completionCount", { count: totalCount })} · ${t(
            "import.completionCategories",
            { count: uniqueCategories.size }
          )}`}
          data-testid="completion-total"
        />
        <p className="text-caption text-ink-dim">{t("import.rememberLine")}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => navigate({ to: "/" })} data-testid="view-dashboard-button">
            {t("import.viewDashboard")}
          </Button>
          <Button variant="outline" onClick={onReset} data-testid="import-another-link">
            {t("import.importAnother")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="import-review-screen">
      <div data-testid="review-summary">
        <h2 className="text-h2 text-ink">
          {t("import.reviewHeading", { count: transactions.length })}
        </h2>
        <p className="mt-1 text-caption text-ink-dim">
          {flaggedGlobalIndices.length > 0
            ? t("import.reviewSubheading", {
                auto: autoGlobalIndices.length,
                flagged: flaggedGlobalIndices.length,
              })
            : t("import.reviewSubheadingAllSorted")}
        </p>
      </div>

      {duplicateIndices.size > 0 && (
        <Alert variant="caution" data-testid="duplicates-unchecked-notice">
          {t("import.duplicatesUncheckedNotice", { count: duplicateIndices.size })}
        </Alert>
      )}

      <Card flush>
        <BulkBar
          countLabel={t("import.bulkSelected", { count: selectedIndices.length })}
          sum={<Money cents={selectedSumCents} {...maskProps} />}
          onClear={() => setDeselected(new Set(transactions.map((_tx, i) => i)))}
          leading={
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onCheckedChange={(next) =>
                setSelectionFor(
                  transactions.map((_tx, i) => i),
                  next
                )
              }
              aria-label={t("import.selectAll")}
              data-testid="review-select-all"
            />
          }
          data-testid="import-bulk-bar"
        >
          <BulkCategoryAssign
            categories={categories}
            disabled={selectedIndices.length === 0}
            onApply={(categoryId) => applyCategoryTo(selectedIndices, categoryId)}
          />
        </BulkBar>
      </Card>

      <AutoCategorizedSummary
        transactions={autoTransactions}
        categories={categories}
        onCategoryChange={handleAutoCategoryChange}
        selectedSet={autoSelectedSet}
        onToggleSelect={(localIndex) => handleToggleSelect(autoGlobalIndices[localIndex])}
        onSelectAll={(selected) => setSelectionFor(autoGlobalIndices, selected)}
        onFieldChange={(localIndex, field, value) =>
          handleFieldChange(autoGlobalIndices[localIndex], field, value)
        }
        fieldOverrides={fieldOverrides}
        globalIndices={autoGlobalIndices}
        duplicateIndices={duplicateIndices}
      />

      {flaggedGlobalIndices.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-h3 text-ink">{t("import.needsReview")}</h3>
          {flaggedGroups.map((groupIndices) => {
            const cards = groupIndices.map((globalIndex) => {
              const tx = transactions[globalIndex];
              const overrides = fieldOverrides[globalIndex];
              const selectedId = overrides?.suggested_category_id ?? tx.suggested_category_id;
              return (
                <TransactionReviewCard
                  key={globalIndex}
                  rowId={String(globalIndex)}
                  merchant={overrides?.merchant ?? tx.merchant}
                  amountCents={overrides?.amount_cents ?? tx.amount_cents}
                  date={overrides?.date ?? tx.date}
                  suggestedCategoryId={tx.suggested_category_id}
                  categories={categories}
                  selectedCategoryId={selectedId}
                  onCategoryChange={(catId) =>
                    handleFlaggedCategoryChange(globalIndex, catId)
                  }
                  isResolved={selectedId != null && selectedId > 0}
                  selected={!deselected.has(globalIndex)}
                  onToggleSelect={() => handleToggleSelect(globalIndex)}
                  onMerchantChange={(value) =>
                    handleFieldChange(globalIndex, "merchant", value)
                  }
                  onAmountChange={(value) =>
                    handleFieldChange(globalIndex, "amount_cents", value)
                  }
                  onDateChange={(value) => handleFieldChange(globalIndex, "date", value)}
                  isDuplicate={duplicateIndices.has(globalIndex)}
                  proposedCategory={
                    deselected.has(globalIndex) ? null : tx.propose_category
                  }
                  onCreateProposedCategory={() =>
                    handleCreateProposedCategory(globalIndex)
                  }
                  creatingProposedCategory={creatingProposalIndices.has(globalIndex)}
                />
              );
            });

            if (groupIndices.length < 2) {
              return <div key={groupIndices[0]}>{cards}</div>;
            }

            const firstIndex = groupIndices[0];
            return (
              <MerchantGroup
                key={firstIndex}
                merchant={
                  fieldOverrides[firstIndex]?.merchant ?? transactions[firstIndex].merchant
                }
                count={groupIndices.length}
                categories={categories}
                onApplyToAll={(categoryId) => applyCategoryTo(groupIndices, categoryId)}
              >
                {cards}
              </MerchantGroup>
            );
          })}
        </section>
      )}

      {unreadable.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-h3 text-ink">
            {t("import.couldntBeRead")} ({unreadable.length})
          </h3>
          {unreadable.map((desc, i) => (
            <UnreadableLineForm
              key={i}
              index={i}
              originalLine={desc}
              entry={
                manualEntries[i] ?? {
                  merchant: "",
                  amount_cents: 0,
                  budget_category_id: 0,
                  date: "",
                }
              }
              categories={categories}
              touched={touched}
              onTouch={markTouched}
              onChange={(next) => {
                setManualEntries((prev) => {
                  const updated = [...prev];
                  updated[i] = next;
                  return updated;
                });
              }}
            />
          ))}
        </section>
      )}

      {commitError !== null && (
        <Alert variant="over" data-testid="import-commit-error">
          <AlertTitle>{t("import.commitFailedTitle")}</AlertTitle>
          <AlertDescription>{t("import.commitFailedBody")}</AlertDescription>
          <AlertDescription className="mt-1 text-ink">{commitError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Button
          size="lg"
          className="w-full"
          disabled={!canConfirm}
          aria-disabled={!canConfirm || undefined}
          aria-describedby={blockedReason !== null ? "confirm-blocked-reason" : undefined}
          onClick={handleConfirm}
          data-testid="confirm-import-button"
        >
          {confirming
            ? t("import.importing")
            : commitError !== null
              ? t("import.commitRetry")
              : t("import.confirmButton", { count: totalCount })}
        </Button>
        {blockedReason !== null && (
          <p id="confirm-blocked-reason" className="text-caption text-ink-dim">
            {blockedReason}
          </p>
        )}
        <p className="text-caption text-ink-faint">{t("import.draftKeptNote")}</p>
      </div>
    </div>
  );
}

function BulkCategoryAssign({
  categories,
  disabled,
  onApply,
}: {
  categories: BudgetCategory[];
  disabled: boolean;
  onApply: (categoryId: number) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="bulk-category" className="sr-only">
        {t("import.bulkCategoryLabel")}
      </Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next === null) return;
          setValue(next);
          onApply(Number(next));
        }}
        items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}
      >
        <SelectTrigger
          id="bulk-category"
          disabled={disabled}
          className="w-44"
          data-testid="bulk-category-select"
        >
          <SelectValue placeholder={t("import.bulkApplyCategory")} />
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
  );
}

function UnreadableLineForm({
  index,
  originalLine,
  entry,
  categories,
  touched,
  onTouch,
  onChange,
}: {
  index: number;
  originalLine: string;
  entry: ManualEntry;
  categories: BudgetCategory[];
  touched: Record<string, boolean>;
  onTouch: (field: string) => void;
  onChange: (entry: ManualEntry) => void;
}) {
  const { t } = useTranslation();
  const merchantId = `manual-merchant-${index}`;
  const amountId = `manual-amount-${index}`;
  const categoryId = `manual-category-${index}`;
  const dateId = `manual-date-${index}`;

  const started = entry.merchant.trim() !== "";
  const merchantError = touched[merchantId] && !started;
  const amountError = touched[amountId] && started && entry.amount_cents <= 0;
  const categoryError = touched[categoryId] && started && entry.budget_category_id <= 0;
  const dateError = touched[dateId] && started && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date);

  return (
    <Card data-testid="unreadable-line-form">
      <CardContent>
        <p className="text-label text-ink">{t("import.unreadableInvite")}</p>
        <p className="mt-1 text-caption text-ink-dim">
          <span className="text-ink-faint">{t("import.unreadableOriginal")}: </span>
          {originalLine}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={merchantId} required>
              {t("expenses.merchant")}
            </Label>
            <Input
              id={merchantId}
              placeholder={t("expenses.merchant")}
              value={entry.merchant}
              required
              aria-required="true"
              aria-invalid={merchantError || undefined}
              aria-describedby={merchantError ? `${merchantId}-error` : undefined}
              onBlur={() => onTouch(merchantId)}
              onChange={(e) => onChange({ ...entry, merchant: e.target.value })}
            />
            {merchantError && (
              <p id={`${merchantId}-error`} className="text-caption text-over-ink">
                {t("import.manualMerchantRequired")}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={amountId} required>
              {t("common.amount")}
            </Label>
            <MoneyInput
              id={amountId}
              value={entry.amount_cents}
              aria-invalid={amountError || undefined}
              onBlur={() => onTouch(amountId)}
              onChange={(cents) => onChange({ ...entry, amount_cents: cents })}
            />
            {amountError && (
              <p className="text-caption text-over-ink">
                {t("import.manualAmountRequired")}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={categoryId} required>
              {t("common.category")}
            </Label>
            <Select
              value={String(entry.budget_category_id || "")}
              onValueChange={(val) => {
                onTouch(categoryId);
                onChange({ ...entry, budget_category_id: Number(val) });
              }}
              items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}
            >
              <SelectTrigger
                id={categoryId}
                className="w-full"
                aria-invalid={categoryError || undefined}
                onBlur={() => onTouch(categoryId)}
              >
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
            {categoryError && (
              <p className="text-caption text-over-ink">
                {t("import.manualCategoryRequired")}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={dateId} required>
              {t("common.date")}
            </Label>
            <DatePicker
              id={dateId}
              value={entry.date}
              aria-invalid={dateError || undefined}
              onChange={(value) => {
                onTouch(dateId);
                onChange({ ...entry, date: value });
              }}
            />
            {dateError && (
              <p className="text-caption text-over-ink">{t("import.manualDateRequired")}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ImportUnavailable({
  title,
  body,
  onReset,
}: {
  title: string;
  body: string;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card data-testid="import-error-state">
      <CardContent>
        <h2 className="text-h2 text-ink">{title}</h2>
        <p className="mt-1 text-caption text-ink-dim">{body}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onReset} data-testid="try-again-button">
            {t("import.tryAgain")}
          </Button>
          {/* The named manual path has to land where an expense can actually be added; /spending/budget
            * is where targets are set, not where a transaction gets typed in. */}
          <Button
            variant="link"
            render={<Link to="/spending/transactions" />}
            data-testid="manual-entry-link"
          >
            {t("import.addManually")}
          </Button>
        </div>
      </CardContent>
    </Card>
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
      <Card data-testid="import-error-state">
        <CardContent>
          <span
            aria-hidden="true"
            className="mb-3 grid size-10 place-items-center rounded-lg bg-track text-ink-dim"
          >
            <FileQuestion className="size-4" />
          </span>
          <h2 className="text-h2 text-ink">{t("import.notConfiguredTitle")}</h2>
          <p className="mt-1 text-caption text-ink-dim">{t("import.notConfiguredBody")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button render={<Link to="/settings" />} data-testid="open-settings-link">
              {t("import.setUpReading")}
            </Button>
            <Button
              variant="outline"
              render={<Link to="/spending/transactions" />}
              data-testid="manual-entry-link"
            >
              {t("import.addManually")}
            </Button>
            <Button variant="link" onClick={onReset} data-testid="try-again-button">
              {t("import.tryAgain")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <ImportUnavailable
      title={t("import.unavailable")}
      body={error?.message ?? t("import.timedOutBody")}
      onReset={onReset}
    />
  );
}
