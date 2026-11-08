import type { LucideIcon } from "lucide-react";
import { PiggyBank, Wrench } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";

/** The `list_agents` wire shape. Snake-cased because the command is `rename_all = "snake_case"`. */
export interface AgentInfo {
  id: string;
  name_key: string;
  description_key: string;
  kind: string;
  ready_key: string;
  scope_key: string;
  starter_keys: string[];
  routable: boolean;
}

export interface Agent {
  id: string;
  nameKey: string;
  descriptionKey: string;
  /** Empty-state heading: what this agent is for. */
  readyKey: string;
  /** Empty-state sub-line: which data it answers from. */
  scopeKey: string;
  /** Suggested opening asks for an empty conversation. */
  starterKeys: string[];
  icon: LucideIcon;
}

/** The one piece of agent identity Rust cannot own. */
export const AGENT_ICONS: Record<string, LucideIcon> = {
  "budget-helper": PiggyBank,
  "car-maintenance": Wrench,
};

export const DEFAULT_AGENT_ID = "budget-helper";

/* `DestinationNav` and `FloatingChatBar` are app-wide chrome, so a pending or failed query must
 * never leave them with an empty agent list. Seeding with the one agent whose id is already a
 * compile-time constant keeps navigation populated from the first paint, and — because
 * `initialData` makes the query resolved rather than pending — survives a rejected invoke too.
 * The fetched list replaces it as soon as it arrives. */
const SEED_AGENTS: AgentInfo[] = [
  {
    id: DEFAULT_AGENT_ID,
    name_key: "agents.budgetHelper.name",
    description_key: "agents.budgetHelper.description",
    kind: "chat",
    ready_key: "agents.budgetHelper.ready",
    scope_key: "agents.budgetHelper.scope",
    starter_keys: [
      "agents.budgetHelper.starterTracking",
      "agents.budgetHelper.starterVsLastMonth",
      "agents.budgetHelper.starterWhereItGoes",
    ],
    routable: false,
  },
];

function toAgent(info: AgentInfo): Agent {
  return {
    id: info.id,
    nameKey: info.name_key,
    descriptionKey: info.description_key,
    readyKey: info.ready_key,
    scopeKey: info.scope_key,
    starterKeys: info.starter_keys ?? [],
    icon: AGENT_ICONS[info.id] ?? PiggyBank,
  };
}

/* `fetching` is what lets a consumer tell "this agent does not exist" from "the real list has not
 * landed yet" — `initialData` means there is no pending state to read, so a route that 404s an
 * unknown agent must wait for the seed to be replaced before it does. */
export function useAgents(): { agents: Agent[]; fetching: boolean } {
  const { data, isFetching } = useQuery({
    queryKey: queryKeys.agents,
    /* Shape-checked at the IPC boundary, and an empty list counts as malformed: the registry
     * always holds at least one chat agent (asserted in `ai::agents`), so a non-array or empty
     * reply means the command did not really answer — and chrome that indexes `agents[0]` must
     * not be handed nothing. */
    queryFn: async () => {
      const fetched = await invoke<unknown>("list_agents");
      const usable = Array.isArray(fetched) && fetched.length > 0;
      return usable ? (fetched as AgentInfo[]) : SEED_AGENTS;
    },
    initialData: SEED_AGENTS,
    /* No `staleTime: Infinity` here, deliberately: it wins over `initialData`'s own staleness and
     * the command then never runs at all, leaving the seed as the permanent answer. The registry
     * is fixed for the process, so the default refetch-on-mount is both correct and nearly free —
     * one local IPC call, deduplicated across every consumer of this key. */
  });

  return { agents: data.map(toAgent), fetching: isFetching };
}

const LAST_USED_AGENT_KEY = "nixus:last_used_agent_id";

/* No longer validates the stored id: the known-agent list is async now, and this is a synchronous
 * localStorage read. Validation belongs to the callers, which hold the fetched list. */
export function getLastUsedAgentId(): string {
  return localStorage.getItem(LAST_USED_AGENT_KEY) ?? DEFAULT_AGENT_ID;
}

export function setLastUsedAgentId(id: string): void {
  localStorage.setItem(LAST_USED_AGENT_KEY, id);
}
