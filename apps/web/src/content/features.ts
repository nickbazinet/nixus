import {
  Car,
  MessageSquare,
  PieChart,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Feature data for `<FeatureGrid />`. Title and description text moved into
 * i18n locale files (apps/web/src/locales/{en,fr}.json) under
 * `features.<id>.title` / `features.<id>.description`. The id is a stable
 * kebab-case slug; the icon stays in code (it's a JS reference, not copy).
 */
export type Feature = {
  /** Stable slug used as a translation-key segment. */
  id:
    | "aiImport"
    | "financialHealth"
    | "budget"
    | "accounts"
    | "netWorth"
    | "aiChat"
    | "garage"
    | "localFirst";
  /** Lucide icon component (not JSX). */
  icon: LucideIcon;
};

export const features: readonly Feature[] = [
  { id: "aiImport", icon: Sparkles },
  { id: "financialHealth", icon: Target },
  { id: "budget", icon: PieChart },
  { id: "accounts", icon: Wallet },
  { id: "netWorth", icon: TrendingUp },
  { id: "aiChat", icon: MessageSquare },
  { id: "garage", icon: Car },
  { id: "localFirst", icon: Shield },
] as const;
