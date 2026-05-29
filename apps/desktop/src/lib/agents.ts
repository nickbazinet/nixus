import type { LucideIcon } from "lucide-react";
import { PiggyBank } from "lucide-react";

export interface Agent {
  id: string;
  nameKey: string;
  icon: LucideIcon;
  descriptionKey: string;
}

export const AGENTS: Agent[] = [
  {
    id: "budget-helper",
    nameKey: "agents.budgetHelper.name",
    icon: PiggyBank,
    descriptionKey: "agents.budgetHelper.description",
  },
];

const LAST_USED_AGENT_KEY = "nixus:last_used_agent_id";
const DEFAULT_AGENT_ID = "budget-helper";

export function getLastUsedAgentId(): string {
  const stored = localStorage.getItem(LAST_USED_AGENT_KEY);
  if (!stored) return DEFAULT_AGENT_ID;
  const isKnown = AGENTS.some((a) => a.id === stored);
  if (!isKnown) {
    localStorage.setItem(LAST_USED_AGENT_KEY, DEFAULT_AGENT_ID);
    return DEFAULT_AGENT_ID;
  }
  return stored;
}

export function setLastUsedAgentId(id: string): void {
  localStorage.setItem(LAST_USED_AGENT_KEY, id);
}
