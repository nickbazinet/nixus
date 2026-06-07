import {
  Wallet,
  PiggyBank,
  CreditCard,
  TrendingUp,
  LineChart,
  Home,
  BarChart3,
  Bitcoin,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Account, NetWorthBreakdownCategory } from "@/lib/types";

export const ACCOUNT_TYPE_ORDER = [
  "chequing",
  "savings",
  "credit_card",
  "tfsa",
  "rrsp",
  "fhsa",
  "non_registered",
  "crypto",
] as const;

export const LIABILITY_ACCOUNT_TYPES = ["credit_card"] as const;

export const ACCOUNT_TYPE_KEYS: Record<string, string> = {
  chequing: "accounts.typeChequing",
  savings: "accounts.typeSavings",
  credit_card: "accounts.typeCreditCard",
  tfsa: "accounts.typeTFSA",
  rrsp: "accounts.typeRRSP",
  fhsa: "accounts.typeFHSA",
  non_registered: "accounts.typeNonRegistered",
  crypto: "accounts.typeCrypto",
};

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  chequing: "#0D9488",
  savings: "#0D9488",
  credit_card: "#EF4444",
  tfsa: "#0EA5E9",
  rrsp: "#9333EA",
  fhsa: "#7C3AED",
  non_registered: "#6366F1",
  crypto: "#F59E0B",
};

export const ACCOUNT_TYPE_ICONS: Record<string, LucideIcon> = {
  chequing: Wallet,
  savings: PiggyBank,
  credit_card: CreditCard,
  tfsa: TrendingUp,
  rrsp: LineChart,
  fhsa: Home,
  non_registered: BarChart3,
  crypto: Bitcoin,
};

export function groupAccountsByType(accounts: Account[]) {
  const groups = new Map<string, Account[]>();
  for (const account of accounts) {
    const list = groups.get(account.account_type) ?? [];
    list.push(account);
    groups.set(account.account_type, list);
  }
  return [...groups.entries()].sort(
    (a, b) =>
      ACCOUNT_TYPE_ORDER.indexOf(
        a[0] as (typeof ACCOUNT_TYPE_ORDER)[number]
      ) - ACCOUNT_TYPE_ORDER.indexOf(b[0] as (typeof ACCOUNT_TYPE_ORDER)[number])
  );
}

export function partitionAccounts(accounts: Account[]) {
  const assetAccounts: Account[] = [];
  const liabilityAccounts: Account[] = [];
  for (const account of accounts) {
    if (
      (LIABILITY_ACCOUNT_TYPES as readonly string[]).includes(
        account.account_type
      )
    ) {
      liabilityAccounts.push(account);
    } else {
      assetAccounts.push(account);
    }
  }
  return { assetAccounts, liabilityAccounts };
}

export function groupAccountsBySection(accounts: Account[]) {
  const { assetAccounts, liabilityAccounts } = partitionAccounts(accounts);
  return {
    assetGroups: groupAccountsByType(assetAccounts),
    liabilityGroups: groupAccountsByType(liabilityAccounts),
  };
}

export function buildAccountBreakdown(
  accounts: Account[],
  getTypeLabel: (accountType: string) => string
): NetWorthBreakdownCategory[] {
  const assetAccounts = accounts.filter(
    (account) => !isLiabilityAccountType(account.account_type)
  );
  const totals = new Map<string, number>();
  for (const account of assetAccounts) {
    totals.set(
      account.account_type,
      (totals.get(account.account_type) ?? 0) + account.balance_cents
    );
  }

  const categories: NetWorthBreakdownCategory[] = [];
  for (const [accountType, cents] of totals) {
    if (cents === 0) continue;
    categories.push({
      name: getTypeLabel(accountType),
      cents,
      percentage: 0,
      color: ACCOUNT_TYPE_COLORS[accountType] ?? "#64748B",
    });
  }

  const absTotal = categories.reduce(
    (sum, category) => sum + Math.abs(category.cents),
    0
  );
  if (absTotal === 0) return [];

  for (const category of categories) {
    category.percentage = (Math.abs(category.cents) / absTotal) * 100;
  }

  categories.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  return categories;
}

export function formatAccountUpdatedAt(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function hasMixedCurrencies(accounts: Account[]): boolean {
  const currencies = new Set(accounts.map((account) => account.currency));
  return currencies.size > 1;
}

export function sumBalanceCents(accounts: Account[]): number {
  return accounts.reduce((sum, account) => sum + account.balance_cents, 0);
}

/** Owed amount for a liability account (positive or negative stored balance). */
export function owedBalanceCents(balanceCents: number): number {
  return balanceCents === 0 ? 0 : Math.abs(balanceCents);
}

export function sumLiabilityOwedCents(accounts: Account[]): number {
  return accounts.reduce((sum, account) => sum + owedBalanceCents(account.balance_cents), 0);
}

export function netAccountPositionCents(accounts: Account[]): number {
  const { assetAccounts, liabilityAccounts } = partitionAccounts(accounts);
  return sumBalanceCents(assetAccounts) - sumLiabilityOwedCents(liabilityAccounts);
}

export function isLiabilityAccountType(accountType: string): boolean {
  return (LIABILITY_ACCOUNT_TYPES as readonly string[]).includes(accountType);
}
