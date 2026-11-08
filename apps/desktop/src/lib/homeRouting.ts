/**
 * Tier 0 of the Home bar's routing: the user's own explicit override.
 *
 * Free, instant, and the recovery mechanism for every misroute — which is what lets Tier 1 stay
 * high-precision/low-recall. A forced route bypasses `route_home_message` entirely.
 */

/**
 * The composer's agent id, mirrored from `commands::home::HOME_AGENT_ID`.
 *
 * Duplicated here because the frontend has to know which route decision means "call
 * `send_home_composer_message` instead of `send_chat_message`", and `list_agents` deliberately
 * withholds surface agents. A Rust drift test asserts this literal still matches the backend.
 */
export const HOME_COMPOSER_AGENT_ID = "home-composer";

/** The `@mention` vocabulary. Short, typeable, and stable — these are user-facing shortcuts. */
export const AGENT_MENTIONS: Readonly<Record<string, string>> = {
  budget: "budget-helper",
  car: "car-maintenance",
  dashboard: HOME_COMPOSER_AGENT_ID,
};

export interface ForcedRoute {
  readonly agentId: string;
  /** The message with the mention stripped, so the agent never reads the routing token. */
  readonly message: string;
}

/**
 * Reads a leading `@agent` override.
 *
 * Leading-only on purpose: an `@` anywhere in a sentence is as likely to be an email address or a
 * handle as a routing instruction, and a mention the user did not intend is exactly the misroute
 * this mechanism exists to fix.
 */
export function parseAgentMention(text: string): ForcedRoute | null {
  const match = text.trimStart().match(/^@([a-z-]+)\s*([\s\S]*)$/i);
  if (match === null) return null;

  const agentId = AGENT_MENTIONS[match[1].toLowerCase()];
  if (agentId === undefined) return null;

  return { agentId, message: match[2].trim() };
}

/** Whether a routed agent is served by the dashboard composer rather than a chat agent. */
export function isSurfaceAgent(agentId: string): boolean {
  return agentId === HOME_COMPOSER_AGENT_ID;
}
