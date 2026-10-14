import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
} from "@nixus/shared";
import {
  useRecentlyDeleted,
  useRestoreDeleted,
} from "@/hooks/useRecentlyDeleted";
import { isSyncError, parseAppError, syncMessageKey } from "@/lib/appError";
import type { RecentlyDeletedItem } from "@/lib/types";
import { SettingRow, SettingsSection } from "./SettingRow";

/**
 * The tables a delete can be listed under, with the noun the user knows them by.
 *
 * Mapped explicitly rather than interpolated into a key: an unmapped table has to fall back to a
 * real translated word, and a dynamic `t()` key would silently render the SQL table name instead
 * (and would be invisible to the locale parity test).
 */
const TYPE_KEYS: Record<string, string> = {
  accounts: "recentlyDeleted.typeAccount",
  budget_categories: "recentlyDeleted.typeBudgetCategory",
  budget_groups: "recentlyDeleted.typeBudgetGroup",
  chat_conversations: "recentlyDeleted.typeConversation",
  expenses: "recentlyDeleted.typeExpense",
  income_entries: "recentlyDeleted.typeIncomeEntry",
  income_sources: "recentlyDeleted.typeIncomeSource",
  maintenance_service_logs: "recentlyDeleted.typeServiceLog",
  passive_assets: "recentlyDeleted.typeAsset",
  project_contributions: "recentlyDeleted.typeContribution",
  projects: "recentlyDeleted.typeProject",
  recurring_expense_templates: "recentlyDeleted.typeRecurringExpense",
  recurring_income_templates: "recentlyDeleted.typeRecurringIncome",
  vehicles: "recentlyDeleted.typeVehicle",
};

function groupByType(items: RecentlyDeletedItem[]): [string, RecentlyDeletedItem[]][] {
  const groups = new Map<string, RecentlyDeletedItem[]>();
  for (const item of items) {
    const existing = groups.get(item.table_name);
    if (existing === undefined) {
      groups.set(item.table_name, [item]);
    } else {
      existing.push(item);
    }
  }

  return [...groups.entries()];
}

export function RecentlyDeletedSettings() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleted = useRecentlyDeleted({ enabled: open });
  const restore = useRestoreDeleted();
  const restoringId = restore.isPending ? restore.variables : undefined;

  const handleRestore = (item: RecentlyDeletedItem) => {
    setError(null);
    restore.mutate(item.id, {
      onError: (failure: unknown) => {
        const parsed = parseAppError(failure);
        setError(
          isSyncError(parsed)
            ? t(syncMessageKey(parsed.code))
            : t("recentlyDeleted.errorGeneric")
        );
      },
    });
  };

  const view = deleted.data;
  const groups = groupByType(view?.items ?? []);

  return (
    <SettingsSection heading={t("recentlyDeleted.sectionHeading")}>
      <Card flush>
        <SettingRow
          title={t("recentlyDeleted.title")}
          description={t("recentlyDeleted.body")}
          control={
            <Button
              variant="outline"
              onClick={() => {
                setOpen((wasOpen) => !wasOpen);
                setError(null);
              }}
              aria-expanded={open}
              aria-controls="recently-deleted-list"
              data-testid="recently-deleted-toggle"
            >
              {open ? t("recentlyDeleted.hideAction") : t("recentlyDeleted.showAction")}
            </Button>
          }
          data-testid="setting-recently-deleted"
        />

        {open && (
          <div id="recently-deleted-list" data-testid="recently-deleted-list">
            {deleted.isPending && (
              <SettingRow
                title={t("recentlyDeleted.loading")}
                data-testid="recently-deleted-loading"
              />
            )}

            {deleted.isError && (
              <SettingRow
                title={t("recentlyDeleted.errorList")}
                control={
                  <Button variant="outline" onClick={() => void deleted.refetch()}>
                    {t("recentlyDeleted.retryAction")}
                  </Button>
                }
                data-testid="recently-deleted-error"
              />
            )}

            {view !== undefined && !view.sync_available && (
              <SettingRow
                title={t("recentlyDeleted.localOnlyTitle")}
                description={t("recentlyDeleted.localOnlyBody")}
                data-testid="recently-deleted-local-only"
              />
            )}

            {view !== undefined && view.sync_available && view.items.length === 0 && (
              <SettingRow
                title={t("recentlyDeleted.emptyTitle")}
                description={t("recentlyDeleted.emptyBody")}
                data-testid="recently-deleted-empty"
              />
            )}

            {groups.map(([table, items]) => (
              <div key={table}>
                <SettingRow
                  title={
                    <span className="text-micro uppercase text-ink-faint">
                      {t(TYPE_KEYS[table] ?? "recentlyDeleted.typeOther")}
                    </span>
                  }
                  data-testid={`recently-deleted-group-${table}`}
                />
                {items.map((item) => (
                  <SettingRow
                    key={item.id}
                    title={item.label || t("recentlyDeleted.unnamed")}
                    description={
                      item.child_count > 0
                        ? t("recentlyDeleted.itemWithChildren", {
                            deletedAt: item.deleted_at,
                            days: item.days_left,
                            count: item.child_count,
                          })
                        : t("recentlyDeleted.item", {
                            deletedAt: item.deleted_at,
                            days: item.days_left,
                          })
                    }
                    control={
                      <Button
                        variant="outline"
                        onClick={() => handleRestore(item)}
                        disabled={restore.isPending}
                        aria-disabled={restore.isPending || undefined}
                        data-testid={`recently-deleted-restore-${item.id}`}
                      >
                        {restoringId === item.id
                          ? t("recentlyDeleted.restoring")
                          : t("recentlyDeleted.restoreAction")}
                      </Button>
                    }
                    data-testid={`recently-deleted-item-${item.id}`}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {error !== null && (
          <Alert variant="over" data-testid="recently-deleted-restore-error">
            <AlertTitle>{t("recentlyDeleted.errorTitle")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </Card>
    </SettingsSection>
  );
}
