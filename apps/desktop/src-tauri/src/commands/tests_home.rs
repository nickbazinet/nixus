use rusqlite::params;
use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::db::test_dataset::migrated_dataset;

fn dataset() -> (TempDir, ActiveDataset) {
    let dir = TempDir::new().expect("temp dir");
    let conn = migrated_dataset(&dir.path().join("nixus.db"));
    (
        dir,
        ActiveDataset {
            id: Some("home-test".to_string()),
            conn: Some(conn),
            capture: None,
        },
    )
}

fn conversation(active: &ActiveDataset, agent: &str) -> i64 {
    active
        .write(|tx| chat_db::create_conversation(tx, Some("t"), agent))
        .expect("conversation")
        .id
}

fn net_worth_widget(component: &str) -> Value {
    json!({
        "component": component,
        "title": "Net Worth",
        "dataBinding": { "source": "net_worth_history", "params": { "months": 6 } }
    })
}

/// `(entity_type, entity_id, action, old_value, new_value)`.
type AuditRow = (String, i64, String, Option<String>, Option<String>);

fn audit_rows(active: &ActiveDataset) -> Vec<AuditRow> {
    let conn = active.conn.as_ref().unwrap();
    let mut stmt = conn
        .prepare("SELECT entity_type, entity_id, action, old_value, new_value FROM audit_log ORDER BY id")
        .unwrap();
    stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })
    .unwrap()
    .collect::<Result<Vec<_>, _>>()
    .unwrap()
}

fn widgets(active: &ActiveDataset) -> Vec<crate::models::StoredHomeWidget> {
    home_db::list_widgets(active.conn.as_ref().unwrap()).unwrap()
}

fn seed_widgets(active: &ActiveDataset, count: usize) -> Vec<String> {
    for _ in 0..count {
        active
            .write(|tx| {
                home_db::apply_change(
                    tx,
                    &SurfaceChange::Add {
                        widget: validate::validate_widget(&net_worth_widget("LineChart")).unwrap(),
                    },
                )
            })
            .expect("the widget seeds");
    }

    widgets(active)
        .into_iter()
        .map(|widget| widget.widget_key)
        .collect()
}

/// FR-4/FR-6/FR-9 end to end on the confirm side: each confirmed change persists, writes exactly
/// one `home_widget` audit row with its prior and new state, and tells the conversation.
#[test]
fn confirmed_add_modify_and_remove_each_persist_and_audit_once() {
    let (_dir, active) = dataset();
    let conv = conversation(&active, HOME_AGENT_ID);

    confirm_change(
        &active,
        &json!({ "op": "add", "widget": net_worth_widget("LineChart") }),
        conv,
    )
    .expect("add confirms");
    let added = widgets(&active);
    assert_eq!(added.len(), 1);

    confirm_change(
        &active,
        &json!({ "op": "modify", "widget_id": added[0].widget_key, "widget": net_worth_widget("BarChart") }),
        conv,
    )
    .expect("modify confirms");
    let modified = widgets(&active);
    assert_eq!(modified[0].widget_key, added[0].widget_key);
    assert_eq!(modified[0].position, added[0].position);
    assert!(modified[0].spec_json.contains("BarChart"));

    confirm_change(
        &active,
        &json!({ "op": "remove", "widget_id": added[0].widget_key, "title": "Net Worth" }),
        conv,
    )
    .expect("remove confirms");
    assert!(widgets(&active).is_empty());

    let audit = audit_rows(&active);
    assert_eq!(audit.len(), 3, "exactly one audit row per change");
    let entity = added[0].id;
    assert_eq!(
        (audit[0].0.as_str(), audit[0].1, audit[0].2.as_str()),
        ("home_widget", entity, "create")
    );
    assert!(audit[0].3.is_none() && audit[0].4.as_deref().unwrap().contains("LineChart"));
    assert_eq!(audit[1].2, "update");
    assert!(audit[1].3.as_deref().unwrap().contains("LineChart"));
    assert!(audit[1].4.as_deref().unwrap().contains("BarChart"));
    assert_eq!(audit[2].2, "delete");
    assert!(audit[2].3.as_deref().unwrap().contains("BarChart") && audit[2].4.is_none());

    let replies =
        chat_db::get_conversation_messages_for_ai(active.conn.as_ref().unwrap(), conv).unwrap();
    assert_eq!(replies.len(), 3);
    assert!(replies[0].content.contains("Net Worth"));
}

/// A card's params crossed IPC: an edited card is refused exactly like an invalid model turn.
#[test]
fn a_tampered_or_stale_card_is_refused_and_nothing_changes() {
    let (_dir, active) = dataset();
    let conv = conversation(&active, HOME_AGENT_ID);

    let literal = json!({ "op": "add", "widget": {
        "component": "Metric", "title": "Net worth", "value": 4210000,
        "dataBinding": { "source": "net_worth_history" }
    }});
    assert!(confirm_change(&active, &literal, conv).is_err());

    let stale = json!({ "op": "remove", "widget_id": "w_deadbeef0000", "title": "Gone" });
    assert!(confirm_change(&active, &stale, conv).is_err());

    assert!(widgets(&active).is_empty());
    assert!(audit_rows(&active).is_empty());
}

#[test]
fn a_card_from_outside_the_home_composer_is_refused() {
    let (_dir, active) = dataset();
    let chat = conversation(&active, "budget-helper");

    let error = confirm_change(
        &active,
        &json!({ "op": "add", "widget": net_worth_widget("LineChart") }),
        chat,
    )
    .expect_err("only Home conversations confirm Home changes");
    assert!(matches!(error, AppError::Validation { .. }));
    assert!(confirm_change(
        &active,
        &json!({ "op": "add", "widget": net_worth_widget("LineChart") }),
        9_999
    )
    .is_err());
    assert!(widgets(&active).is_empty());
}

/// FR-2 NFR at confirm time: a card drawn under the cap cannot push the surface past it.
#[test]
fn confirming_past_the_cap_is_refused() {
    let (_dir, active) = dataset();
    let conv = conversation(&active, HOME_AGENT_ID);
    let conn = active.conn.as_ref().unwrap();
    for i in 0..validate::MAX_WIDGETS {
        conn.execute(
            "INSERT INTO home_widgets (widget_key, position, spec_json) VALUES (?1, ?2, ?3)",
            params![
                format!("w_{i}"),
                i as i64,
                net_worth_widget("LineChart").to_string()
            ],
        )
        .unwrap();
    }

    let error = confirm_change(
        &active,
        &json!({ "op": "add", "widget": net_worth_widget("LineChart") }),
        conv,
    )
    .expect_err("capped");
    match error {
        AppError::Validation { message, .. } => assert!(message.contains("too many widgets")),
        other => panic!("expected validation, got {other:?}"),
    }
    assert_eq!(widgets(&active).len(), validate::MAX_WIDGETS);
}

/// FR-4: the proposal reaches the user as the existing ```action``` fence, whose params are exactly
/// what the confirm path re-validates.
#[test]
fn a_proposal_is_written_as_an_action_fence_the_confirm_path_accepts() {
    let change = SurfaceChange::Add {
        widget: validate::validate_widget(&net_worth_widget("LineChart")).unwrap(),
    };
    let (outcome, content, _) = reply_for(GenerationOutcome::Proposal(change));
    assert_eq!(outcome, "proposal");

    let body = content
        .strip_prefix("```action\n")
        .and_then(|rest| rest.strip_suffix("\n```"))
        .expect("fenced");
    let payload: Value = serde_json::from_str(body).expect("JSON");
    assert_eq!(payload["action"], true);
    assert_eq!(payload["action_type"], HOME_SURFACE_ACTION);
    assert_eq!(payload["display"]["label"], "Add widget: Net Worth");
    assert!(validate::validate_change(&payload["params"], &[]).is_ok());
}

#[test]
fn non_proposals_never_carry_an_action_fence() {
    for outcome in [
        GenerationOutcome::Failed,
        GenerationOutcome::Message("Car data isn't available here.".to_string()),
        GenerationOutcome::Ambiguous(vec!["A".to_string(), "B".to_string()]),
        GenerationOutcome::NoMatch(vec![]),
    ] {
        let (_, content, _) = reply_for(outcome);
        assert!(!content.contains("```action"), "{content}");
    }
    assert_eq!(reply_for(GenerationOutcome::Failed).1, FAILED_TEXT);
}

#[test]
fn each_eligibility_maps_to_its_own_composer_state() {
    let hosted = |e| access_state(ComposerAccess::Hosted(e));
    assert_eq!(hosted(HostedEligibility::Eligible), "available");
    assert_eq!(hosted(HostedEligibility::SignedOut), "signed_out");
    assert_eq!(hosted(HostedEligibility::NotPremium), "not_premium");
    assert_eq!(hosted(HostedEligibility::QuotaExhausted), "quota_exhausted");
    assert_eq!(
        hosted(HostedEligibility::ReauthenticationRequired),
        "reauthentication_required"
    );
    assert_eq!(hosted(HostedEligibility::Unavailable), "unavailable");
    assert_eq!(access_state(ComposerAccess::LocalProfile), "local_profile");
}

/// The hosted session is account-wide and survives a switch to a local profile, so the profile is
/// checked first: a local profile is locked even beside a premium session, and only a cloud profile
/// signed in as its own account goes on to the hosted check at all.
#[test]
fn a_local_profile_is_locked_whatever_the_account_session_says() {
    assert_eq!(
        profile_access(DatasetKind::Local, false),
        Some(ComposerAccess::LocalProfile)
    );
    assert_eq!(
        profile_access(DatasetKind::Local, true),
        Some(ComposerAccess::LocalProfile)
    );
    assert_eq!(
        profile_access(DatasetKind::CloudLinked, false),
        Some(ComposerAccess::Hosted(HostedEligibility::SignedOut))
    );
    assert_eq!(profile_access(DatasetKind::CloudLinked, true), None);
}

/// A send from a local profile is refused before any write or AI call, as a lock, not an outage.
#[test]
fn a_send_from_a_local_profile_is_refused_as_premium_required() {
    match authorize_access(ComposerAccess::LocalProfile) {
        Err(AppError::HostedAi { code, .. }) => assert_eq!(code, "premium_required"),
        other => panic!("expected a premium lock, got {other:?}"),
    }
    assert_eq!(
        authorize_access(ComposerAccess::Hosted(HostedEligibility::Eligible)).unwrap(),
        HostedEligibility::Eligible
    );
}

/// A presentation edit is a plain local write — no AI, no eligibility gate, no Home conversation —
/// so the only thing that can refuse it is a value outside its own range, named by field.
#[test]
fn presentation_edits_refuse_out_of_range_values_and_write_nothing() {
    let (_dir, active) = dataset();
    let key = seed_widgets(&active, 1).remove(0);

    for span in [0_i64, 3, -1] {
        match span_presentation(&active, &key, span) {
            Err(AppError::Validation { field, .. }) => assert_eq!(field.as_deref(), Some("span")),
            other => panic!("expected a span refusal for {span}, got {other:?}"),
        }
    }
    for accent in [-1_i64, 8] {
        match accent_presentation(&active, &key, Some(accent)) {
            Err(AppError::Validation { field, .. }) => assert_eq!(field.as_deref(), Some("accent")),
            other => panic!("expected an accent refusal for {accent}, got {other:?}"),
        }
    }
    let too_long = "x".repeat(validate::MAX_TITLE_CHARS + 1);
    match rename_presentation(&active, &key, Some(&too_long)) {
        Err(AppError::Validation { field, .. }) => assert_eq!(field.as_deref(), Some("title")),
        other => panic!("expected a title refusal, got {other:?}"),
    }

    let stored = widgets(&active).remove(0);
    assert_eq!(stored.span, 1);
    assert!(stored.accent.is_none() && stored.title_override.is_none());
    assert!(audit_rows(&active).is_empty(), "a refusal is never audited");
}

/// The accepted edges, plus the blank rename that hands the title back to the AI rather than
/// storing an empty string.
#[test]
fn presentation_edits_persist_and_a_blank_rename_clears_the_override() {
    let (_dir, active) = dataset();
    let key = seed_widgets(&active, 1).remove(0);

    span_presentation(&active, &key, 2).expect("full width");
    accent_presentation(&active, &key, Some(0)).expect("the first palette offset");
    accent_presentation(&active, &key, Some(7)).expect("the last palette offset");
    rename_presentation(&active, &key, Some("  Spending  ")).expect("a rename");

    let stored = widgets(&active).remove(0);
    assert_eq!(stored.span, 2);
    assert_eq!(stored.accent, Some(7));
    assert_eq!(stored.title_override.as_deref(), Some("Spending"));

    let longest = "x".repeat(validate::MAX_TITLE_CHARS);
    rename_presentation(&active, &key, Some(&longest)).expect("the title ceiling itself fits");
    accent_presentation(&active, &key, None).expect("back to the default palette");
    rename_presentation(&active, &key, Some("  ")).expect("blank clears rather than refuses");

    let cleared = widgets(&active).remove(0);
    assert!(cleared.accent.is_none() && cleared.title_override.is_none());

    rename_presentation(&active, &key, None).expect("None clears too");
    assert!(widgets(&active)[0].title_override.is_none());

    let audit = audit_rows(&active);
    assert_eq!(audit.len(), 8, "one audit row per accepted edit");
    assert!(audit
        .iter()
        .all(|row| row.0 == "home_widget" && row.2 == "update"));
}

#[test]
fn a_manual_reorder_persists_and_audits_only_the_widgets_that_moved() {
    let (_dir, active) = dataset();
    let keys = seed_widgets(&active, 3);

    reorder_presentation(&active, &keys).expect("the current order normalises the positions");
    let normalised = audit_rows(&active).len();

    let swapped = vec![keys[2].clone(), keys[1].clone(), keys[0].clone()];
    reorder_presentation(&active, &swapped).expect("a permutation applies");

    assert_eq!(
        widgets(&active)
            .into_iter()
            .map(|widget| widget.widget_key)
            .collect::<Vec<_>>(),
        swapped
    );
    assert_eq!(audit_rows(&active).len() - normalised, 2);
    assert!(reorder_presentation(&active, &keys[..1]).is_err());
}

/// A manual delete needs no conversation, no card and no AI gate — and it leaves the OTHER widgets
/// and their presentation choices alone, which is the part a shared `DELETE` could get wrong.
#[test]
fn a_manual_delete_removes_only_its_own_widget() {
    let (_dir, active) = dataset();
    let keys = seed_widgets(&active, 3);
    accent_presentation(&active, &keys[2], Some(4)).expect("a presentation choice to preserve");
    let before = audit_rows(&active).len();

    remove_widget(&active, &keys[1]).expect("the user's own widget is theirs to remove");

    let remaining = widgets(&active);
    assert_eq!(
        remaining
            .iter()
            .map(|widget| widget.widget_key.clone())
            .collect::<Vec<_>>(),
        vec![keys[0].clone(), keys[2].clone()]
    );
    assert_eq!(remaining[1].accent, Some(4));

    let audit = audit_rows(&active);
    assert_eq!(audit.len() - before, 1);
    assert_eq!(audit.last().expect("the delete row").2, "delete");
}

/// A widget a second computer already removed is refused rather than silently succeeding, so the
/// dialog cannot report a delete that never happened.
#[test]
fn deleting_an_absent_widget_is_refused() {
    let (_dir, active) = dataset();
    let keys = seed_widgets(&active, 1);

    assert!(remove_widget(&active, "w_gone").is_err());
    assert_eq!(widgets(&active).len(), 1);

    remove_widget(&active, &keys[0]).expect("the real one still removes");
    assert!(remove_widget(&active, &keys[0]).is_err(), "and only once");
}
