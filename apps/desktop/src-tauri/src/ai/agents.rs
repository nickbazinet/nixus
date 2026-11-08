//! The agent registry: the single source of truth for agent identity and prompt selection.
//!
//! Everything that needs to know "which agents exist", "what is this agent called", or "which
//! prompt does this agent speak with" reads it from here. `src/lib/agents.ts` is presentation
//! only — it owns icons and nothing else, and the drift tests at the bottom of this module are
//! what hold that line.

use crate::ai::chat::{build_budget_helper_prompt, build_car_maintenance_prompt};
use crate::ai::context::ContextProviderId;
use crate::error::AppError;

/// Where a Home bar message goes when nothing more specific applies.
///
/// Tier 2 of the Home routing: the deterministic detector only recognises dashboard intent, so
/// everything else lands here. Named once so the fallback is not spelled out at each call site.
pub const DEFAULT_CHAT_AGENT_ID: &str = "budget-helper";

/// The maintenance agent, named so the Home router can route to it without a literal.
pub const CAR_AGENT_ID: &str = "car-maintenance";

/// What surface serves an agent.
///
/// The asymmetry is permanent, not transitional: a `Chat` agent is served by `ai::chat` and has a
/// system prompt; a `Surface` agent (the dashboard composer) is driven by its own command pair
/// with its own prompt builder and request shape. Encoding that in the type is why
/// `AgentSpec::prompt` is an `Option` rather than a stub that can be called by accident.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    Chat,
    Surface,
}

impl AgentKind {
    /// The string the frontend switches on. Kept as a method so the wire vocabulary lives beside
    /// the enum rather than being spelled out at each serialization site.
    pub fn wire_name(self) -> &'static str {
        match self {
            AgentKind::Chat => "chat",
            AgentKind::Surface => "surface",
        }
    }
}

/// Deliberately carries only fields something already reads. `ai` is a private module, so `pub`
/// buys no external reachability and `dead_code` fires on any field declared ahead of its
/// consumer — and `#[allow(dead_code)]` on a half-built type is what `docs/guidelines/warnings.md`
/// forbids. The router's `routing_description` therefore lands in the step that reads it.
pub struct AgentSpec {
    pub id: &'static str,
    pub name_key: &'static str,
    pub description_key: &'static str,
    pub kind: AgentKind,
    /// `None` for `Surface` agents, which `ai::chat` does not serve. Takes the whole spec so a
    /// prompt renders its own allowlists and the prose can never disagree with what is enforced.
    pub prompt: Option<fn(spec: &AgentSpec, today: &str, context: &str) -> String>,
    /// Rendered in slice order, so this is what pins the prompt's data layout.
    pub context: &'static [ContextProviderId],
    /// Enforced at the tool dispatch site, not merely advertised in the prompt.
    pub tools: &'static [&'static str],
    /// Enforced in `execute_chat_action`, not merely advertised in the prompt.
    pub actions: &'static [&'static str],
    /// The empty-state heading on the agent's own surface: what this agent is for, in the user's
    /// words. Registry-owned so a new agent adds locale rows rather than a frontend branch.
    pub ready_key: &'static str,
    /// The empty-state sub-line: which of the user's data this agent answers from.
    pub scope_key: &'static str,
    /// Suggested opening asks, offered on an empty conversation.
    pub starter_keys: &'static [&'static str],
    /// Router-exposure flag, and the rollback lever once a router exists: flipping it to false
    /// disables an agent's delegation without a release.
    pub routable: bool,
}

static AGENTS: &[AgentSpec] = &[
    AgentSpec {
        id: "budget-helper",
        name_key: "agents.budgetHelper.name",
        description_key: "agents.budgetHelper.description",
        kind: AgentKind::Chat,
        prompt: Some(build_budget_helper_prompt),
        context: &[
            ContextProviderId::BudgetSummary,
            ContextProviderId::BudgetGroups,
            ContextProviderId::BudgetCategories,
            ContextProviderId::Accounts,
            ContextProviderId::Assets,
            ContextProviderId::IncomeThisMonth,
        ],
        tools: &["query_expenses"],
        actions: &[
            "create_expense",
            "create_budget_category",
            "batch_actions",
            "update_balance",
            "create_account",
            "update_asset_value",
        ],
        ready_key: "agents.budgetHelper.ready",
        scope_key: "agents.budgetHelper.scope",
        starter_keys: &[
            "agents.budgetHelper.starterTracking",
            "agents.budgetHelper.starterVsLastMonth",
            "agents.budgetHelper.starterWhereItGoes",
        ],
        routable: false,
    },
    AgentSpec {
        id: "car-maintenance",
        name_key: "agents.carMaintenance.name",
        description_key: "agents.carMaintenance.description",
        kind: AgentKind::Chat,
        prompt: Some(build_car_maintenance_prompt),
        context: &[ContextProviderId::VehicleRoster],
        tools: &["query_maintenance_status", "query_maintenance_history"],
        // Read-only on purpose: shipping the first second agent without a new write path means
        // this step cannot widen the blast radius while the action enforcement is still new.
        actions: &[],
        ready_key: "agents.carMaintenance.ready",
        scope_key: "agents.carMaintenance.scope",
        starter_keys: &[
            "agents.carMaintenance.starterDue",
            "agents.carMaintenance.starterHistory",
            "agents.carMaintenance.starterOdometer",
        ],
        routable: false,
    },
    AgentSpec {
        id: "home-composer",
        // The existing panel copy, not a new `agents.*` pair: a Surface agent is never listed or
        // titled as an agent, so inventing keys nothing renders would be dead translation.
        name_key: "home.panel.title",
        description_key: "home.panel.description",
        kind: AgentKind::Surface,
        prompt: None,
        context: &[],
        tools: &[],
        // The one action the surface owns. `commands/chat.rs` keeps its explicit named refusal for
        // this id as well; the allowlist makes that refusal derivable, it does not replace it.
        actions: &[crate::commands::home::HOME_SURFACE_ACTION],
        // A Surface agent has no `/ai` surface, so none of this is ever rendered or sent: the
        // panel's own copy stands in rather than inventing keys nothing reads.
        ready_key: "home.panel.title",
        scope_key: "home.panel.description",
        starter_keys: &[],
        routable: false,
    },
];

/// Looks up an agent by the id stored on its conversation rows.
///
/// Unknown ids are an error rather than a fallback: the previous catch-all silently served the
/// budget-helper prompt under a conversation labelled something else.
pub fn spec(agent_id: &str) -> Result<&'static AgentSpec, AppError> {
    AGENTS
        .iter()
        .find(|spec| spec.id == agent_id)
        .ok_or_else(|| AppError::Validation {
            message: "unknown agent id".to_string(),
            field: Some("agent_id".to_string()),
        })
}

pub fn all() -> &'static [AgentSpec] {
    AGENTS
}

/// Registry completeness guards. They read the frontend's own source and locale files because the
/// invariant is "every chat agent the backend will serve is renderable", which no Rust type can
/// express. Both live here rather than being split across languages so the registry's module is
/// the single place that asserts its own completeness.
#[cfg(test)]
mod drift {
    use super::{all, spec, AgentKind};
    use crate::error::AppError;
    use std::path::PathBuf;

    fn read_frontend(relative: &str) -> String {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("src")
            .join(relative);
        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
    }

    fn chat_agent_ids() -> Vec<&'static str> {
        all()
            .iter()
            .filter(|spec| spec.kind == AgentKind::Chat)
            .map(|spec| spec.id)
            .collect()
    }

    #[test]
    fn every_chat_agent_has_a_frontend_icon_entry() {
        let source = read_frontend("lib/agents.ts");

        for id in chat_agent_ids() {
            assert!(
                source.contains(&format!("\"{id}\"")),
                "{id} has no entry in lib/agents.ts"
            );
        }
    }

    #[test]
    fn every_chat_agent_is_named_and_described_in_both_locales() {
        for locale in ["en", "fr"] {
            let source = read_frontend(&format!("locales/{locale}.json"));

            for spec in all().iter().filter(|spec| spec.kind == AgentKind::Chat) {
                let keys = [spec.name_key, spec.description_key, spec.ready_key, spec.scope_key]
                    .into_iter()
                    .chain(spec.starter_keys.iter().copied());
                for key in keys {
                    assert!(
                        source.contains(&format!("\"{key}\"")),
                        "{key} missing from {locale}.json"
                    );
                }
            }
        }
    }

    /// The frontend must know which route decision means "call the composer command" and
    /// `list_agents` withholds surface agents, so the id is mirrored in `lib/homeRouting.ts`. This
    /// is the guard that keeps the mirror honest.
    #[test]
    fn the_frontend_mirror_of_the_surface_agent_id_still_matches() {
        let source = read_frontend("lib/homeRouting.ts");
        let surface_id = all()
            .iter()
            .find(|spec| spec.kind == AgentKind::Surface)
            .map(|spec| spec.id)
            .expect("a surface agent is registered");

        assert!(
            source.contains(&format!("\"{surface_id}\"")),
            "{surface_id} is not the id lib/homeRouting.ts mirrors"
        );
    }

    #[test]
    fn only_chat_agents_carry_a_prompt() {
        for agent in all() {
            match agent.kind {
                AgentKind::Chat => assert!(agent.prompt.is_some(), "{} has no prompt", agent.id),
                AgentKind::Surface => {
                    assert!(agent.prompt.is_none(), "{} has a chat prompt", agent.id)
                }
            }
        }
    }

    #[test]
    fn an_unknown_agent_id_is_a_validation_error_naming_the_field() {
        match spec("budgt-helper") {
            Err(AppError::Validation { message, field }) => {
                assert_eq!(message, "unknown agent id");
                assert_eq!(field.as_deref(), Some("agent_id"));
            }
            Err(other) => panic!("expected a validation error, got {other:?}"),
            Ok(found) => panic!("expected a validation error, got agent {}", found.id),
        }
    }

    /// The frontend's seeded agent list leans on this: a reply of zero chat agents is treated as
    /// a malformed one rather than an empty registry.
    /// An empty conversation with no suggestions is a dead end, so every chat agent owes the user
    /// somewhere to start.
    #[test]
    fn every_chat_agent_offers_at_least_one_starter() {
        for spec in all().iter().filter(|spec| spec.kind == AgentKind::Chat) {
            assert!(
                !spec.starter_keys.is_empty(),
                "{} offers no starters",
                spec.id
            );
        }
    }

    #[test]
    fn at_least_one_chat_agent_is_always_registered() {
        assert!(!chat_agent_ids().is_empty());
    }

    #[test]
    fn agent_ids_are_unique() {
        let mut ids: Vec<&str> = all().iter().map(|spec| spec.id).collect();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total, "duplicate agent id in the registry");
    }
}
