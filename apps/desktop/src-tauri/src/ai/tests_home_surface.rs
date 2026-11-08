use std::cell::RefCell;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::db::home_surface as home_db;
use crate::db::test_dataset::migrated_dataset;
use crate::db::tests_home_surface_fixtures::seed_known_profile;

const NET_WORTH_REPLY: &str = r#"{"op":"add","widget":{"component":"LineChart","title":"Net Worth, Month over Month","dataBinding":{"source":"net_worth_history","params":{"months":12}}}}"#;

fn input(request: &str, current: Vec<WidgetSummary>) -> GenerationInput {
    GenerationInput {
        request: request.to_string(),
        history: Vec::new(),
        current,
        locale: "en".to_string(),
        categories: vec![(1, "Groceries".to_string()), (2, "Restaurants".to_string())],
    }
}

fn hosted_code(error: AppError) -> String {
    match error {
        AppError::HostedAi { code, .. } => code,
        other => panic!("expected a hosted-AI error, got {other:?}"),
    }
}

/// Replays `replies` in order and records every request it was handed.
struct Scripted {
    replies: RefCell<Vec<Result<String, AppError>>>,
    seen: RefCell<Vec<AiRequest>>,
}

impl Scripted {
    fn new(replies: Vec<Result<&str, AppError>>) -> Self {
        Scripted {
            replies: RefCell::new(
                replies
                    .into_iter()
                    .rev()
                    .map(|reply| reply.map(str::to_string))
                    .collect(),
            ),
            seen: RefCell::new(Vec::new()),
        }
    }

    fn invoker(
        &self,
    ) -> impl FnMut(AiRequest) -> std::future::Ready<Result<String, AppError>> + '_ {
        move |request| {
            self.seen.borrow_mut().push(request);
            std::future::ready(
                self.replies
                    .borrow_mut()
                    .pop()
                    .unwrap_or(Err(AppError::Unavailable)),
            )
        }
    }

    fn calls(&self) -> usize {
        self.seen.borrow().len()
    }
}

#[tokio::test]
async fn an_eligible_request_with_a_valid_reply_becomes_a_proposal() {
    let script = Scripted::new(vec![Ok(NET_WORTH_REPLY)]);

    let generated = generate_within(
        input("show me my net worth growth month over month", vec![]),
        GENERATION_BUDGET,
        script.invoker(),
    )
    .await
    .expect("generates");

    assert_eq!(generated.attempts, 1);
    match generated.outcome {
        GenerationOutcome::Proposal(SurfaceChange::Add { widget }) => {
            assert_eq!(widget["component"], "LineChart");
            assert_eq!(widget["dataBinding"]["source"], "net_worth_history");
        }
        other => panic!("expected an add proposal, got {other:?}"),
    }
}

/// The gate itself (now run one level up, in `commands::home`, before `generate` is ever called):
/// every non-eligible reason still names its own typed code, unchanged by the move.
#[test]
fn authorize_names_each_non_eligible_reason_with_its_own_code() {
    for (eligibility, code) in [
        (HostedEligibility::SignedOut, "premium_required"),
        (HostedEligibility::NotPremium, "premium_required"),
        (HostedEligibility::QuotaExhausted, "quota_exhausted"),
        (
            HostedEligibility::ReauthenticationRequired,
            "reauthentication_required",
        ),
        (HostedEligibility::Unavailable, "hosted_unavailable"),
    ] {
        assert_eq!(
            hosted_code(authorize(eligibility).expect_err("refused")),
            code,
            "{eligibility:?}"
        );
    }
    assert!(authorize(HostedEligibility::Eligible).is_ok());
}

/// FR-5: the validation error goes back to the model for exactly one corrective attempt.
#[tokio::test]
async fn an_invalid_first_reply_gets_one_corrective_turn_with_the_specific_error() {
    let invalid = r#"{"op":"add","widget":{"component":"LineChart","title":"Net worth","dataBinding":{"source":"net_worth_by_month"}}}"#;
    let script = Scripted::new(vec![Ok(invalid), Ok(NET_WORTH_REPLY)]);

    let generated = generate_within(
        input("net worth trend", vec![]),
        GENERATION_BUDGET,
        script.invoker(),
    )
    .await
    .expect("self-heals");

    assert_eq!(generated.attempts, 2);
    assert!(matches!(generated.outcome, GenerationOutcome::Proposal(_)));

    let seen = script.seen.borrow();
    let retry = seen[1].turns.last().expect("a corrective turn");
    assert_eq!(retry.role, AiRole::User);
    assert!(retry.text.contains("net_worth_by_month"));
    assert!(retry.text.contains("not a whitelisted data source"));
    assert_eq!(
        seen[1].turns[seen[1].turns.len() - 2].text,
        invalid,
        "the model sees its own reply"
    );
}

/// FR-5: two attempts, then a plain failure — never a third invocation.
#[tokio::test]
async fn two_invalid_replies_end_in_a_failure_without_a_third_attempt() {
    let script = Scripted::new(vec![
        Ok("not json"),
        Ok(r#"{"op":"add","widget":{"component":"Sparkline"}}"#),
        Ok(NET_WORTH_REPLY),
    ]);

    let generated = generate_within(
        input("anything", vec![]),
        GENERATION_BUDGET,
        script.invoker(),
    )
    .await
    .expect("a failure is an outcome, not an error");

    assert_eq!(generated.outcome, GenerationOutcome::Failed);
    assert_eq!(generated.attempts, MAX_ATTEMPTS);
    assert_eq!(script.calls(), MAX_ATTEMPTS);
}

/// FR-7: a hosted failure is surfaced as itself, keeping its recoverable flag, and is not retried.
#[tokio::test]
async fn a_transient_hosted_failure_is_returned_as_a_recoverable_hosted_error() {
    let script = Scripted::new(vec![Err(backend::hosted_error(
        "hosted_unavailable",
        "down",
    ))]);

    let error = generate_within(
        input("net worth", vec![]),
        GENERATION_BUDGET,
        script.invoker(),
    )
    .await
    .expect_err("surfaced");

    match error {
        AppError::HostedAi {
            code, recoverable, ..
        } => {
            assert_eq!(code, "hosted_unavailable");
            assert!(recoverable);
        }
        other => panic!("expected hosted, got {other:?}"),
    }
    assert_eq!(script.calls(), 1);
}

/// FR-6 NFR: exceeding the budget is the same plain failure, not an indefinite wait.
#[tokio::test]
async fn exceeding_the_time_budget_is_a_plain_failure() {
    let calls = AtomicUsize::new(0);
    let generated = generate_within(
        input("net worth", vec![]),
        Duration::from_millis(50),
        |_request| {
            calls.fetch_add(1, Ordering::SeqCst);
            async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                Ok(NET_WORTH_REPLY.to_string())
            }
        },
    )
    .await
    .expect("a timeout is an outcome");

    assert_eq!(generated.outcome, GenerationOutcome::Failed);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(GENERATION_BUDGET, Duration::from_secs(20));
}

#[tokio::test]
async fn a_removal_the_app_cannot_pin_down_asks_instead_of_proposing() {
    let current = vec![
        WidgetSummary {
            widget_key: "w1".to_string(),
            spec: json!({ "component": "Metric", "title": "Spending by Month", "dataBinding": { "source": "expenses_by_month", "params": {} } }),
        },
        WidgetSummary {
            widget_key: "w2".to_string(),
            spec: json!({ "component": "PieChart", "title": "Spending by Category", "dataBinding": { "source": "expenses_by_category", "params": {} } }),
        },
    ];
    let script = Scripted::new(vec![Ok(r#"{"op":"remove","target":"the spending one"}"#)]);

    let generated = generate_within(
        input("remove the spending one", current),
        GENERATION_BUDGET,
        script.invoker(),
    )
    .await
    .unwrap();

    assert_eq!(
        generated.outcome,
        GenerationOutcome::Ambiguous(vec![
            "Spending by Month".to_string(),
            "Spending by Category".to_string()
        ])
    );
}

/// SM-2 (FR-3 NFR), the regression gate: for a profile seeded with known figures and names, no
/// value from its expense, account, asset, budget or net-worth tables appears anywhere in any
/// outbound generation request — first attempt and corrective retry alike.
#[tokio::test]
async fn no_seeded_financial_value_appears_in_any_outbound_generation_request() {
    let dir = TempDir::new().expect("temp dir");
    let conn = migrated_dataset(&dir.path().join("nixus.db"));
    let known = seed_known_profile(&conn);
    for (title, component, source) in [
        ("Spending Trend", "BarChart", "expenses_by_month"),
        ("Where It Goes", "PieChart", "expenses_by_category"),
        ("Balances", "Table", "account_balances"),
    ] {
        let widget = validate::validate_widget(&json!({
            "component": component, "title": title, "dataBinding": { "source": source }
        }))
        .unwrap();
        home_db::apply_change(&conn, &SurfaceChange::Add { widget }).unwrap();
    }

    let generation = GenerationInput {
        request: "show me my net worth growth month over month".to_string(),
        history: vec![
            AiTurn::user("add a spending trend"),
            AiTurn {
                role: AiRole::Assistant,
                text: "```action\n{\"action\":true,\"action_type\":\"propose_home_surface_change\"}\n```".to_string(),
            },
        ],
        current: home_db::list_summaries(&conn).unwrap(),
        locale: "en".to_string(),
        // Handed to the generation step for checking, which is exactly why it must not leak.
        categories: home_db::category_names(&conn).unwrap(),
    };
    let script = Scripted::new(vec![
        Ok(
            r#"{"op":"add","widget":{"component":"LineChart","title":"x","dataBinding":{"source":"wealth"}}}"#,
        ),
        Ok(NET_WORTH_REPLY),
    ]);

    generate_within(
        generation,
        GENERATION_BUDGET,
        script.invoker(),
    )
    .await
    .expect("generates");

    let seen = script.seen.borrow();
    assert_eq!(seen.len(), 2, "both attempts are inspected");
    assert!(known.needles.len() > 30, "the seed must be non-trivial");
    for request in seen.iter() {
        let mut outbound = request.system.clone();
        for turn in &request.turns {
            outbound.push('\n');
            outbound.push_str(&turn.text);
        }
        for needle in &known.needles {
            assert!(
                !outbound.contains(needle.as_str()),
                "the outbound generation request leaked `{needle}`"
            );
        }
    }
}

/// The catalog stays out of the always-on chat prompt (addendum).
#[test]
fn the_catalog_lives_only_in_the_dedicated_generation_prompt() {
    let home = build_system_prompt("en");
    for component in catalog::COMPONENTS {
        assert!(home.contains(component.name), "{}", component.name);
    }
    for source in catalog::DATA_SOURCES {
        assert!(home.contains(source.name), "{}", source.name);
    }

    let chat = crate::ai::chat::build_system_prompt("budget-helper", "2026-11-02", "")
        .expect("budget-helper is a chat agent");
    for source in catalog::DATA_SOURCES {
        assert!(
            !chat.contains(source.name),
            "{} leaked into the chat prompt",
            source.name
        );
    }
    assert!(!chat.contains("Component catalog"));
}

#[test]
fn the_reply_language_follows_the_locale() {
    assert!(build_system_prompt("fr").contains("written in French"));
    assert!(build_system_prompt("en").contains("written in English"));
}

#[test]
fn history_is_alternating_bounded_and_ends_before_the_new_request() {
    let turn = |role, text: &str| AiTurn {
        role,
        text: text.to_string(),
    };
    let turns = alternate(vec![
        turn(AiRole::Assistant, "orphan"),
        turn(AiRole::User, "a"),
        turn(AiRole::User, "b"),
        turn(AiRole::Assistant, "c"),
        turn(AiRole::User, "unanswered"),
    ]);
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].text, "a\n\nb");
    assert_eq!(turns[1].role, AiRole::Assistant);

    let long: Vec<AiTurn> = (0..20)
        .map(|i| {
            turn(
                if i % 2 == 0 {
                    AiRole::User
                } else {
                    AiRole::Assistant
                },
                &i.to_string(),
            )
        })
        .collect();
    let bounded = alternate(long);
    assert!(bounded.len() <= 6);
    assert_eq!(bounded[0].role, AiRole::User);
    assert_eq!(bounded.last().unwrap().role, AiRole::Assistant);
}

#[test]
fn a_fenced_or_prefixed_reply_is_still_parsed() {
    let fenced = format!("Here you go:\n```json\n{NET_WORTH_REPLY}\n```");
    assert!(matches!(parse_reply(&fenced, &[]), Ok(Proposal::Change(_))));
    assert!(parse_reply("no braces here", &[]).is_err());
}

/// The reported scenario: "Spending by Category – Last Month" must be expressible as a window that
/// ends last month, not one that always starts from the current month.
#[test]
fn the_prompt_teaches_any_period_and_category_filters() {
    let prompt = build_system_prompt("en");
    assert!(prompt.contains("params.months_ago"));
    assert!(prompt.contains("\"Last month\" is months 1, months_ago 1"));
    assert!(prompt.contains("params.category: text"));
}

#[tokio::test]
async fn a_category_filter_naming_no_category_gets_one_corrective_turn() {
    let unknown = r#"{"op":"add","widget":{"component":"BarChart","title":"Car insurance","dataBinding":{"source":"expenses_by_month","params":{"category":"car insurance"}}}}"#;
    let known = r#"{"op":"add","widget":{"component":"BarChart","title":"Groceries by Month","dataBinding":{"source":"expenses_by_month","params":{"category":"groceries"}}}}"#;
    let script = Scripted::new(vec![Ok(unknown), Ok(known)]);

    let generated = generate_within(
        input("car insurance by month", vec![]),
        GENERATION_BUDGET,
        script.invoker(),
    )
    .await
    .expect("self-heals");

    assert_eq!(generated.attempts, 2);
    let seen = script.seen.borrow();
    let correction = &seen[1].turns.last().unwrap().text;
    assert!(correction.contains("\"car insurance\" matches none"));
    assert!(!correction.contains("Groceries"), "the category list never reaches the model");
    match &generated.outcome {
        GenerationOutcome::Proposal(SurfaceChange::Add { widget }) => {
            assert_eq!(widget["dataBinding"]["params"]["category"], "groceries");
        }
        other => panic!("expected a proposal, got {other:?}"),
    }
}
