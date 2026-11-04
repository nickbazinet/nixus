//! Tauri commands for the AI-generated Home Surface (PRD §4).
//!
//! Generation is hosted-only and premium-only (§4.6): nothing here reads `AiState`, so a BYO
//! provider configured in Settings cannot be reached from this module by construction. The
//! eligibility gate runs before any write and before any AI call.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tracing::info;

use crate::ai::backend::{AiRole, AiTurn};
use crate::ai::home_surface::{self as home_ai, GenerationInput, GenerationOutcome};
use crate::ai::hosted_bedrock::{self, HostedEligibility};
use crate::db::audit as audit_db;
use crate::db::chat as chat_db;
use crate::db::home_surface as home_db;
use crate::commands::datasets::{find_registered, is_signed_in};
use crate::datasets;
use crate::db::{ActiveDataset, DbState};
use crate::error::AppError;
use crate::home_surface::validate::{self, SurfaceChange};
use crate::models::{DatasetKind, HomeWidget};

/// The confirm-then-persist `action_type` a Home Surface change travels as (FR-4).
pub const HOME_SURFACE_ACTION: &str = "propose_home_surface_change";

/// The conversation owner for Composer turns. Not an AI-section agent, so these conversations never
/// appear in the chat lists, and the general chat refuses to write into them.
pub const HOME_AGENT_ID: &str = "home-composer";

const MAX_REQUEST_CHARS: usize = 1_000;

const FAILED_TEXT: &str = "I couldn't build that one. Nothing on your Home dashboard was changed.";

#[derive(Debug, Serialize)]
pub struct HomeComposerReply {
    pub conversation_id: i64,
    /// `proposal`, `message`, `ambiguous`, `no_match` or `failed`.
    pub outcome: String,
    /// The persisted assistant turn: an ```action``` fence for a proposal, prose otherwise.
    pub content: String,
    /// Widget titles the user can pick from, for `ambiguous` and `no_match`.
    pub candidates: Vec<String>,
}

fn lock<'a>(
    state: &'a State<'_, DbState>,
) -> Result<std::sync::MutexGuard<'a, ActiveDataset>, AppError> {
    state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_home_surface(state: State<DbState>) -> Result<Vec<HomeWidget>, AppError> {
    let active = lock(&state)?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
    home_db::resolve_surface(conn)
}

/// The widest `span` the grid offers: a full-width widget. `1` is the half-width default.
const FULL_WIDTH_SPAN: i64 = 2;

/// The last offset into the renderer's 8-step chart ramp.
const MAX_ACCENT: i64 = 7;

/// The user's own presentation choices — reorder, width, rename, accent — are PLAIN LOCAL EDITS.
/// They read no `AiState`, call no model and pass no eligibility gate, because nothing here is
/// generated: the four commands below work on a local profile, offline, with no premium. They also
/// return `()` rather than the surface, since `resolve_surface` re-queries every data source and
/// that is far too much work for a colour tap; the frontend invalidates its query instead.
fn presentation_write(
    active: &ActiveDataset,
    widget_id: &str,
    update: &home_db::PresentationUpdate,
) -> Result<(), AppError> {
    let change = active.write(|tx| home_db::set_presentation(tx, widget_id, update))?;
    audit_db::record(
        active,
        "home_widget",
        change.widget_id,
        "update",
        Some(&change.old_json),
        Some(&change.new_json),
    );

    Ok(())
}

fn reorder_presentation(active: &ActiveDataset, widget_ids: &[String]) -> Result<(), AppError> {
    let changes = active.write(|tx| home_db::reorder_widgets(tx, widget_ids))?;
    for change in &changes {
        audit_db::record(
            active,
            "home_widget",
            change.widget_id,
            "update",
            Some(&change.old_json),
            Some(&change.new_json),
        );
    }

    Ok(())
}

/// Blank after trimming is how a user hands the title back to the AI, so it clears the override
/// rather than being refused as empty.
fn rename_presentation(
    active: &ActiveDataset,
    widget_id: &str,
    title: Option<&str>,
) -> Result<(), AppError> {
    let trimmed = title.map(str::trim).unwrap_or_default();
    if trimmed.chars().count() > validate::MAX_TITLE_CHARS {
        return Err(AppError::Validation {
            message: format!(
                "A widget title is at most {} characters",
                validate::MAX_TITLE_CHARS
            ),
            field: Some("title".to_string()),
        });
    }

    let update =
        home_db::PresentationUpdate::Title((!trimmed.is_empty()).then(|| trimmed.to_string()));
    presentation_write(active, widget_id, &update)
}

fn span_presentation(active: &ActiveDataset, widget_id: &str, span: i64) -> Result<(), AppError> {
    if !(1..=FULL_WIDTH_SPAN).contains(&span) {
        return Err(AppError::Validation {
            message: "A widget is either half or full width".to_string(),
            field: Some("span".to_string()),
        });
    }

    presentation_write(active, widget_id, &home_db::PresentationUpdate::Span(span))
}

fn accent_presentation(
    active: &ActiveDataset,
    widget_id: &str,
    accent: Option<i64>,
) -> Result<(), AppError> {
    if accent.is_some_and(|offset| !(0..=MAX_ACCENT).contains(&offset)) {
        return Err(AppError::Validation {
            message: format!("A widget accent is an offset from 0 to {MAX_ACCENT}"),
            field: Some("accent".to_string()),
        });
    }

    presentation_write(
        active,
        widget_id,
        &home_db::PresentationUpdate::Accent(accent),
    )
}

/// Removing a widget by hand takes the same `Remove` path the Composer's confirmed removal takes,
/// so there is one delete in the codebase rather than two that can drift. The `title` a
/// Composer-built change carries is only ever used to word its confirmation card, and this one has
/// no card to word: the UI asks before calling, and `apply_change` reads the real title back off
/// the stored spec for the audit row.
fn remove_widget(active: &ActiveDataset, widget_id: &str) -> Result<(), AppError> {
    let change = SurfaceChange::Remove {
        widget_id: widget_id.to_string(),
        title: String::new(),
    };
    let applied = active.write(|tx| home_db::apply_change(tx, &change))?;
    audit_db::record(
        active,
        "home_widget",
        applied.entity_id,
        applied.action,
        applied.old_value.as_deref(),
        applied.new_value.as_deref(),
    );

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn reorder_home_widgets(
    state: State<DbState>,
    widget_ids: Vec<String>,
) -> Result<(), AppError> {
    let active = lock(&state)?;
    reorder_presentation(&active, &widget_ids)
}

/// Deleting one's own widget is not an AI action and needs no confirmation card: it is gated by a
/// dialog in the UI, and the removed spec stays recoverable from the audit row.
#[tauri::command(rename_all = "snake_case")]
pub fn delete_home_widget(state: State<DbState>, widget_id: String) -> Result<(), AppError> {
    let active = lock(&state)?;
    remove_widget(&active, &widget_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn rename_home_widget(
    state: State<DbState>,
    widget_id: String,
    title: Option<String>,
) -> Result<(), AppError> {
    let active = lock(&state)?;
    rename_presentation(&active, &widget_id, title.as_deref())
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_home_widget_span(
    state: State<DbState>,
    widget_id: String,
    span: i64,
) -> Result<(), AppError> {
    let active = lock(&state)?;
    span_presentation(&active, &widget_id, span)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_home_widget_accent(
    state: State<DbState>,
    widget_id: String,
    accent: Option<i64>,
) -> Result<(), AppError> {
    let active = lock(&state)?;
    accent_presentation(&active, &widget_id, accent)
}

/// Who may use the Composer right now. The hosted account session is account-wide — it outlives a
/// switch to a local profile — so eligibility is decided per PROFILE first: the composer belongs to
/// the Nixus Cloud profile signed in as its own account, never to a local profile that merely shares
/// the machine with a signed-in session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ComposerAccess {
    LocalProfile,
    Hosted(HostedEligibility),
}

/// The profile half of the gate, split out so it is testable without a registry or a keyring.
fn profile_access(kind: DatasetKind, signed_in: bool) -> Option<ComposerAccess> {
    match (kind, signed_in) {
        (DatasetKind::Local, _) => Some(ComposerAccess::LocalProfile),
        (DatasetKind::CloudLinked, false) => {
            Some(ComposerAccess::Hosted(HostedEligibility::SignedOut))
        }
        (DatasetKind::CloudLinked, true) => None,
    }
}

async fn composer_access(app: &AppHandle) -> Result<ComposerAccess, AppError> {
    let active_id = datasets::active_dataset_id(&app.state::<DbState>())?;
    let entry = find_registered(datasets::load_registry(app)?, &active_id)?;
    // Resolved only for a cloud-linked profile, as `get_active_profile` does: a local profile must
    // never refresh a session over the network just to be told it is local.
    let subject = if entry.kind == DatasetKind::CloudLinked {
        crate::commands::auth::current_subject().await.ok()
    } else {
        None
    };
    let signed_in = is_signed_in(&entry, subject.as_deref());
    if let Some(denied) = profile_access(entry.kind, signed_in) {
        return Ok(denied);
    }
    Ok(ComposerAccess::Hosted(hosted_bedrock::eligibility().await))
}

fn authorize_access(access: ComposerAccess) -> Result<HostedEligibility, AppError> {
    match access {
        ComposerAccess::LocalProfile => Err(crate::ai::backend::hosted_error(
            "premium_required",
            "The Home dashboard composer is available on your Nixus Cloud profile.",
        )),
        ComposerAccess::Hosted(eligibility) => {
            home_ai::authorize(eligibility)?;
            Ok(eligibility)
        }
    }
}

fn access_state(access: ComposerAccess) -> &'static str {
    let ComposerAccess::Hosted(eligibility) = access else {
        return "local_profile";
    };
    match eligibility {
        HostedEligibility::Eligible => "available",
        HostedEligibility::SignedOut => "signed_out",
        HostedEligibility::NotPremium => "not_premium",
        HostedEligibility::QuotaExhausted => "quota_exhausted",
        HostedEligibility::ReauthenticationRequired => "reauthentication_required",
        HostedEligibility::Unavailable => "unavailable",
    }
}

/// Which Composer the Home page draws (FR-7 vs FR-11). A state name only — never a figure.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_home_composer_access(app: AppHandle) -> Result<String, AppError> {
    Ok(access_state(composer_access(&app).await?).to_string())
}

fn action_label(change: &SurfaceChange) -> String {
    let title = match change {
        SurfaceChange::Add { widget } | SurfaceChange::Modify { widget, .. } => widget
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        SurfaceChange::Remove { title, .. } => title.clone(),
    };
    let verb = match change {
        SurfaceChange::Add { .. } => "Add widget",
        SurfaceChange::Modify { .. } => "Update widget",
        SurfaceChange::Remove { .. } => "Remove widget",
    };
    format!("{verb}: {title}")
}

/// The proposal as the existing ```action``` fence `ChatMessageBubble` already parses. The card's
/// label is server-written from the validated change, never model prose.
fn action_fence(change: &SurfaceChange) -> String {
    let payload = json!({
        "action": true,
        "action_type": HOME_SURFACE_ACTION,
        "display": { "label": action_label(change), "details": [] },
        "params": change.to_params(),
    });
    format!("```action\n{payload}\n```")
}

fn reply_for(outcome: GenerationOutcome) -> (&'static str, String, Vec<String>) {
    match outcome {
        GenerationOutcome::Proposal(change) => ("proposal", action_fence(&change), Vec::new()),
        GenerationOutcome::Message(text) => ("message", text, Vec::new()),
        GenerationOutcome::Ambiguous(titles) => (
            "ambiguous",
            format!(
                "More than one widget matches. Which one should I remove: {}?",
                titles.join(", ")
            ),
            titles,
        ),
        GenerationOutcome::NoMatch(titles) => (
            "no_match",
            if titles.is_empty() {
                "There are no widgets on your Home dashboard to remove.".to_string()
            } else {
                format!(
                    "I couldn't tell which widget you mean. Your widgets are: {}.",
                    titles.join(", ")
                )
            },
            titles,
        ),
        GenerationOutcome::Failed => ("failed", FAILED_TEXT.to_string(), Vec::new()),
    }
}

fn require_home_conversation(
    conn: &rusqlite::Connection,
    conversation_id: i64,
) -> Result<(), AppError> {
    match chat_db::conversation_agent(conn, conversation_id)? {
        Some(agent) if agent == HOME_AGENT_ID => Ok(()),
        _ => Err(AppError::Validation {
            message: "Home dashboard changes can only come from the Home composer".to_string(),
            field: Some("conversation_id".to_string()),
        }),
    }
}

fn history_turns(
    conn: &rusqlite::Connection,
    conversation_id: i64,
) -> Result<Vec<AiTurn>, AppError> {
    Ok(
        chat_db::get_conversation_messages_for_ai(conn, conversation_id)?
            .into_iter()
            .filter_map(|message| {
                let role = match message.role.as_str() {
                    "user" => AiRole::User,
                    "assistant" => AiRole::Assistant,
                    _ => return None,
                };
                Some(AiTurn {
                    role,
                    text: message.content,
                })
            })
            .collect(),
    )
}

/// One Composer turn: gate, persist the request, generate (with its one self-healing retry), and
/// persist the answer. A proposal is returned as a card to confirm — nothing on the surface changes
/// until the user confirms it through `execute_chat_action` (FR-6).
#[tauri::command(rename_all = "snake_case")]
pub async fn send_home_composer_message(
    app: AppHandle,
    db_state: State<'_, DbState>,
    message: String,
    conversation_id: Option<i64>,
    locale: String,
) -> Result<HomeComposerReply, AppError> {
    let request = message.trim().to_string();
    if request.is_empty() || request.chars().count() > MAX_REQUEST_CHARS {
        return Err(AppError::Validation {
            message: format!("Ask in 1 to {MAX_REQUEST_CHARS} characters"),
            field: Some("message".to_string()),
        });
    }

    // FR-11: refused before anything is written and before any AI call — on a local profile too,
    // even when this machine holds a premium account's session.
    let eligibility = authorize_access(composer_access(&app).await?)?;

    let (conv_id, history, current, categories) = {
        let active = lock(&db_state)?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
        let conv_id = match conversation_id {
            Some(id) => {
                require_home_conversation(conn, id)?;
                id
            }
            None => {
                let title: String = request.chars().take(40).collect();
                active
                    .write(|tx| {
                        chat_db::create_conversation(tx, Some(title.trim()), HOME_AGENT_ID)
                    })?
                    .id
            }
        };
        let history = history_turns(conn, conv_id)?;
        active.write(|tx| chat_db::insert_message(tx, conv_id, "user", &request, "chat"))?;
        (
            conv_id,
            history,
            home_db::list_summaries(conn)?,
            home_db::category_names(conn)?,
        )
    };

    let locale = if locale == "fr" { "fr" } else { "en" }.to_string();
    let generated = home_ai::generate(
        eligibility,
        GenerationInput {
            request,
            history,
            current,
            locale,
            categories,
        },
    )
    .await?;

    let (outcome, content, candidates) = reply_for(generated.outcome);
    {
        let active = lock(&db_state)?;
        active.write(|tx| chat_db::insert_message(tx, conv_id, "assistant", &content, "chat"))?;
    }

    info!(
        "Home composer turn (outcome={}, attempts={})",
        outcome, generated.attempts
    );

    Ok(HomeComposerReply {
        conversation_id: conv_id,
        outcome: outcome.to_string(),
        content,
        candidates,
    })
}

/// The confirmed half of the pipeline, dispatched from `execute_chat_action` (FR-4, FR-6, FR-9).
///
/// The card's params crossed IPC, so they are Surface-Validated again against the surface as it is
/// NOW — a widget removed since the card was drawn, or a cap reached meanwhile, is refused. Exactly
/// one audit row per change, carrying the prior and new state.
pub(crate) fn confirm_change(
    active: &ActiveDataset,
    params: &Value,
    conversation_id: i64,
) -> Result<String, AppError> {
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
    require_home_conversation(conn, conversation_id)?;

    let current = home_db::list_summaries(conn)?;
    let change =
        validate::validate_change(params, &current).map_err(|errors| AppError::Validation {
            message: errors.join("; "),
            field: Some("params".to_string()),
        })?;

    let applied = active.write(|tx| home_db::apply_change(tx, &change))?;
    audit_db::record(
        active,
        "home_widget",
        applied.entity_id,
        applied.action,
        applied.old_value.as_deref(),
        applied.new_value.as_deref(),
    );

    let message = match change {
        SurfaceChange::Add { .. } => {
            format!("Done. \"{}\" is on your Home dashboard.", applied.title)
        }
        SurfaceChange::Modify { .. } => format!("Done. \"{}\" was updated.", applied.title),
        SurfaceChange::Remove { .. } => format!("Done. \"{}\" was removed.", applied.title),
    };
    active
        .write(|tx| chat_db::insert_message(tx, conversation_id, "assistant", &message, "chat"))?;

    info!("Home Surface change confirmed (op={})", change.op());
    Ok(message)
}

#[cfg(test)]
#[path = "tests_home.rs"]
mod tests;
