import { PillTabs } from "@nixus/shared";
import { useTranslation } from "react-i18next";
import {
  COST_GROUPS,
  COST_GROUP_LABEL_KEYS,
  type CostGroup,
} from "./insights-chart";

interface CostGroupTabsProps {
  value: CostGroup;
  onChange: (value: CostGroup) => void;
  testId?: string;
}

/**
 * The fixed/changeable toggle. A mortgage in the same scale as restaurants flattens everything
 * else, so any surface that ranks categories against one another offers this split.
 *
 * On screen the groups are "Bills you can't easily change" and "What you can change" — the words
 * "fixed" and "variable" are engineering vocabulary and never reach the screen.
 */
export function CostGroupTabs({ value, onChange, testId }: CostGroupTabsProps) {
  const { t } = useTranslation();

  const labels = Object.fromEntries(
    COST_GROUPS.map((group) => [group, t(COST_GROUP_LABEL_KEYS[group])]),
  ) as Record<CostGroup, string>;

  return (
    <PillTabs
      options={COST_GROUPS}
      labels={labels}
      value={value}
      onChange={onChange}
      data-testid={testId}
    />
  );
}
