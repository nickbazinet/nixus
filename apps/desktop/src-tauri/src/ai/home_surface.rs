//! The Home Surface generation turn (PRD FR-4, FR-5): the fourth dedicated prompt-construction
//! path beside `project_advice` and `trends_insight`, so the Component Catalog and Data Source
//! Whitelist never ride on the shared chat system prompt (addendum, "Keep the catalog out").
//!
//! What this module puts in front of the model is the catalog, the whitelist, the current widgets'
//! specs and the user's own words — never a resolved figure (FR-3 NFR, SM-2). It does not read the
//! database at all; the caller hands it the surface as `WidgetSummary`s.

use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde_json::Value;
use tracing::info;

use crate::ai::backend::{self, AiOperation, AiRequest, AiRole, AiTurn};
use crate::ai::hosted_bedrock::HostedEligibility;
use crate::ai::AiProvider;
use crate::error::AppError;
use crate::home_surface::catalog::{self, ComponentKind, ParamKind, SourceShape};
use crate::home_surface::validate::{self, Proposal, SurfaceChange, WidgetSummary};

/// FR-5: one initial attempt plus one corrective retry.
pub const MAX_ATTEMPTS: usize = 2;
/// FR-6 NFR: the whole round-trip, retry included.
pub const GENERATION_BUDGET: Duration = Duration::from_secs(20);
/// Enough for "make that a bar chart" to know what "that" is, without growing every request.
const MAX_HISTORY_TURNS: usize = 6;

#[derive(Debug, Clone, PartialEq)]
pub enum GenerationOutcome {
    Proposal(SurfaceChange),
    Message(String),
    Ambiguous(Vec<String>),
    NoMatch(Vec<String>),
    /// Both attempts failed validation, or the time budget ran out (FR-5, FR-6 NFR).
    Failed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Generated {
    pub outcome: GenerationOutcome,
    /// Observability for SM-1 / SM-C2: how many invocations this request spent.
    pub attempts: usize,
}

pub struct GenerationInput {
    pub request: String,
    /// Earlier Composer turns of this conversation, oldest first.
    pub history: Vec<AiTurn>,
    pub current: Vec<WidgetSummary>,
    pub locale: String,
    /// The profile's budget categories, used ONLY to check a proposal's `category` filter against
    /// before a card exists. Never placed in a prompt (SM-2).
    pub categories: Vec<(i64, String)>,
}

/// The hosted-reason gate: called by `commands::home` only when the user has configured no BYO
/// provider at all, to name why the composer is locked. A configured BYO key skips this entirely
/// (same precedence every other AI surface uses) and reaches `generate` below regardless of it.
pub fn authorize(eligibility: HostedEligibility) -> Result<(), AppError> {
    let (code, message) = match eligibility {
        HostedEligibility::Eligible => return Ok(()),
        HostedEligibility::SignedOut | HostedEligibility::NotPremium => (
            "premium_required",
            "The Home dashboard composer requires Nixus Cloud premium.",
        ),
        HostedEligibility::QuotaExhausted => (
            "quota_exhausted",
            "This period's Nixus Cloud AI requests are used up.",
        ),
        HostedEligibility::ReauthenticationRequired => (
            "reauthentication_required",
            "Please sign in again to use Nixus Cloud AI.",
        ),
        HostedEligibility::Unavailable => (
            "hosted_unavailable",
            "Nixus Cloud AI is temporarily unavailable.",
        ),
    };
    Err(backend::hosted_error(code, message))
}

fn language(locale: &str) -> &'static str {
    match locale {
        "fr" => "French",
        _ => "English",
    }
}

fn catalog_section() -> String {
    let mut lines = vec!["Component catalog:".to_string()];
    for component in catalog::COMPONENTS {
        let kind = match component.kind {
            ComponentKind::Display => "display",
            ComponentKind::Layout => "layout",
        };
        lines.push(format!(
            "- {} ({kind}): {}",
            component.name, component.description
        ));
    }

    lines.push(String::new());
    lines.push("Data sources:".to_string());
    for source in catalog::DATA_SOURCES {
        let shape = match source.shape {
            SourceShape::TimeSeries => "monthly",
            SourceShape::Categorical => "categorical",
            SourceShape::Transactions => "transaction list, Table only",
            SourceShape::Flow => "flow, SankeyChart only",
            SourceShape::Scalar => "scalar, Date only",
        };
        lines.push(format!(
            "- {} ({shape}): {}",
            source.name, source.description
        ));
        if source.params.is_empty() {
            lines.push("    params: none".to_string());
        }
        for param in source.params {
            lines.push(match param.kind {
                ParamKind::Integer { min, max, default } => format!(
                    "    params.{}: integer {min}-{max}, default {default}. {}",
                    param.name, param.description
                ),
                ParamKind::CategoryName { max_chars } => format!(
                    "    params.{}: text, at most {max_chars} characters. {}",
                    param.name, param.description
                ),
                ParamKind::AssetType => format!(
                    "    params.{}: one of {}. {}",
                    param.name,
                    catalog::ASSET_TYPES.join(", "),
                    param.description
                ),
            });
        }
    }
    lines.join("\n")
}

pub fn build_system_prompt(locale: &str) -> String {
    let language = language(locale);
    let max_widgets = validate::MAX_WIDGETS;
    let max_title = validate::MAX_TITLE_CHARS;
    let max_displays = validate::MAX_DISPLAYS_PER_WIDGET;
    let max_depth = validate::MAX_DEPTH;
    let catalog = catalog_section();

    format!(
        r#"You compose widgets for the Home dashboard of Nixus, a personal finance app. You never see the user's financial figures. You only decide WHICH catalog component shows WHICH data source; the app fills in the numbers on the user's own computer after you answer.

Reply with exactly one JSON object and nothing else, in one of these shapes:
{{"op":"add","widget":WIDGET}}
{{"op":"modify","widget_id":"<id of a current widget>","widget":WIDGET}}  (replaces that whole widget; it keeps its place)
{{"op":"remove","target":"<the user's own words naming the widget to remove>"}}
{{"op":"message","text":"<a short reply in {language}>"}}  (when the request cannot be built from the catalog and sources below, or you need the user to clarify)

WIDGET is a tree of catalog components:
- display component: {{"component":"<name>","title":"<optional>","dataBinding":{{"source":"<data source>","params":{{...}}}}}}
- layout primitive: {{"component":"Card|Row|Column|Grid","title":"<optional>","children":[1 to 4 nodes]}}; Grid also takes "columns" (1-4)
The root node of WIDGET must have a "title" of at most {max_title} characters, written in {language}.

Rules:
- Use only the component and data source names listed below, spelled exactly as written.
- Never put an amount, a date or any other data value in a widget. The only numbers allowed are the integer dataBinding params documented below. Never add a field that is not described here.
- Any period can be shown: set months (the window length) and months_ago (how far back it ends). "Last month" is months 1, months_ago 1; "the last 3 months" is months 3, months_ago 0.
- To narrow spending to one budget category, put the user's words for it in params.category; the app matches it to their categories.
- Net-worth assets: "my portfolio", "investments", "holdings" or "stocks" mean assets of type stock (params.asset_type "stock"); "property" means real_estate. Use asset_values for one row per asset, asset_values_by_type to compare asset types, and either with a PieChart, BarChart, Table or Metric. There is no finer grouping than asset or asset type; if the user asks to group "by category", use the asset (per holding) or the asset type, whichever fits.
- Layout primitives never have a dataBinding; display components always have one.
- At most {max_displays} display components per widget, and layouts nested at most {max_depth} deep.
- LineChart and AreaChart need a monthly source; PieChart needs a categorical source; a transaction-list source can only be shown in a Table; a flow source can only be shown in a SankeyChart, and a SankeyChart can show nothing else; a scalar source can only be shown in a Date, and a Date can show nothing else.
- The Home dashboard holds at most {max_widgets} widgets. Propose exactly one change per reply.
- Only the finance data sources below exist. Car, maintenance or any other data cannot be shown; say so with op "message".
- To remove a widget, copy the user's description of it into "target"; the app decides which widget matches.

{catalog}"#
    )
}

fn surface_listing(current: &[WidgetSummary]) -> String {
    if current.is_empty() {
        return "The Home dashboard is empty.".to_string();
    }
    let mut lines = vec![format!(
        "Current Home dashboard ({} of {} widgets, in display order):",
        current.len(),
        validate::MAX_WIDGETS
    )];
    for widget in current {
        lines.push(format!("- id {}: {}", widget.widget_key, widget.spec));
    }
    lines.join("\n")
}

pub fn build_user_prompt(current: &[WidgetSummary], request: &str) -> String {
    format!(
        "{}\n\nUser request: {}",
        surface_listing(current),
        request.trim()
    )
}

fn correction_prompt(errors: &[String]) -> String {
    let mut lines = vec!["Your previous reply failed validation:".to_string()];
    lines.extend(errors.iter().map(|error| format!("- {error}")));
    lines.push("Reply again with one corrected JSON object only.".to_string());
    lines.join("\n")
}

/// The single JSON object a reply carries, whether bare or inside a code fence.
fn extract_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end > start).then(|| &text[start..=end])
}

fn parse_reply(text: &str, current: &[WidgetSummary]) -> Result<Proposal, Vec<String>> {
    let Some(json) = extract_object(text) else {
        return Err(vec!["the reply must be a single JSON object".to_string()]);
    };
    // The parse error's own text is returned, never the reply: it is the model's output, and it
    // goes back to the model, not into an `AppError` (AD-11).
    let value: Value = serde_json::from_str(json)
        .map_err(|error| vec![format!("the reply is not valid JSON ({error})")])?;
    validate::validate_proposal(&value, current)
}

/// Strictly alternating, starting with the user and ending with the assistant, so the new request
/// can follow as the next user turn. Same-role runs are merged rather than dropped.
pub fn alternate(turns: Vec<AiTurn>) -> Vec<AiTurn> {
    let mut merged: Vec<AiTurn> = Vec::new();
    for turn in turns {
        match merged.last_mut() {
            Some(last) if last.role == turn.role => {
                last.text.push_str("\n\n");
                last.text.push_str(&turn.text);
            }
            _ => merged.push(turn),
        }
    }
    while merged
        .first()
        .is_some_and(|turn| turn.role == AiRole::Assistant)
    {
        merged.remove(0);
    }
    if merged.last().is_some_and(|turn| turn.role == AiRole::User) {
        merged.pop();
    }

    let skip = merged.len().saturating_sub(MAX_HISTORY_TURNS);
    let mut recent: Vec<AiTurn> = merged.into_iter().skip(skip).collect();
    while recent
        .first()
        .is_some_and(|turn| turn.role == AiRole::Assistant)
    {
        recent.remove(0);
    }
    recent
}

fn collect_category_terms(node: &Value, terms: &mut Vec<String>) {
    if let Some(term) = node.pointer("/dataBinding/params/category").and_then(Value::as_str) {
        terms.push(term.to_string());
    }
    if let Some(children) = node.get("children").and_then(Value::as_array) {
        for child in children {
            collect_category_terms(child, terms);
        }
    }
}

/// A category filter that names none of the user's categories would build a widget that is empty
/// forever, so it is a validation failure like any other. The error repeats only the user's own
/// term — the category list itself never reaches the model.
fn unmatched_categories(proposal: &Proposal, categories: &[(i64, String)]) -> Vec<String> {
    let widget = match proposal {
        Proposal::Change(SurfaceChange::Add { widget })
        | Proposal::Change(SurfaceChange::Modify { widget, .. }) => widget,
        _ => return Vec::new(),
    };
    let mut terms = Vec::new();
    collect_category_terms(widget, &mut terms);
    terms
        .into_iter()
        .filter(|term| crate::home_surface::matcher::match_categories(term, categories).is_empty())
        .map(|term| {
            format!(
                "params.category \"{term}\" matches none of the user's budget categories; reply with op \"message\" asking which category they mean, or omit the filter"
            )
        })
        .collect()
}

fn into_outcome(proposal: Proposal) -> GenerationOutcome {
    match proposal {
        Proposal::Change(change) => GenerationOutcome::Proposal(change),
        Proposal::Message(text) => GenerationOutcome::Message(text),
        Proposal::Ambiguous(titles) => GenerationOutcome::Ambiguous(titles),
        Proposal::NoMatch(titles) => GenerationOutcome::NoMatch(titles),
    }
}

async fn attempt_loop<F, Fut>(
    input: &GenerationInput,
    invoke: &mut F,
    spent: &AtomicUsize,
) -> Result<GenerationOutcome, AppError>
where
    F: FnMut(AiRequest) -> Fut,
    Fut: Future<Output = Result<String, AppError>>,
{
    let system = build_system_prompt(&input.locale);
    let mut turns = alternate(input.history.clone());
    turns.push(AiTurn::user(build_user_prompt(
        &input.current,
        &input.request,
    )));

    for _ in 0..MAX_ATTEMPTS {
        spent.fetch_add(1, Ordering::SeqCst);
        let reply = invoke(AiRequest {
            // The hosted gateway's operation union is closed and deployed only by CI; until it
            // learns a Home operation, this turn travels under chat's limits, which fit it.
            operation: AiOperation::Chat,
            system: system.clone(),
            turns: turns.clone(),
            attachment: None,
        })
        .await?;

        let checked = parse_reply(&reply, &input.current).and_then(|proposal| {
            let unmatched = unmatched_categories(&proposal, &input.categories);
            if unmatched.is_empty() {
                Ok(proposal)
            } else {
                Err(unmatched)
            }
        });
        match checked {
            Ok(proposal) => return Ok(into_outcome(proposal)),
            Err(errors) => {
                turns.push(AiTurn {
                    role: AiRole::Assistant,
                    text: reply,
                });
                turns.push(AiTurn::user(correction_prompt(&errors)));
            }
        }
    }

    Ok(GenerationOutcome::Failed)
}

/// At most two attempts inside one time budget. The eligibility gate runs one level up, in
/// `commands::home`, before this is ever called — so this is the retry loop alone: a hosted error
/// ends the request at once and is returned as itself (FR-7), and exhausting the attempts or the
/// budget is the plain "couldn't build that" (FR-5).
pub async fn generate_within<F, Fut>(
    input: GenerationInput,
    budget: Duration,
    mut invoke: F,
) -> Result<Generated, AppError>
where
    F: FnMut(AiRequest) -> Fut,
    Fut: Future<Output = Result<String, AppError>>,
{
    let spent = AtomicUsize::new(0);
    let outcome =
        match tokio::time::timeout(budget, attempt_loop(&input, &mut invoke, &spent)).await {
            Ok(result) => result?,
            Err(_) => GenerationOutcome::Failed,
        };
    let attempts = spent.load(Ordering::SeqCst);

    info!(
        "Home Surface generation finished (attempts={}, failed={})",
        attempts,
        outcome == GenerationOutcome::Failed
    );

    Ok(Generated { outcome, attempts })
}

/// Routes through the shared port like every other AI surface: hosted Bedrock first, BYO as the
/// fallback `commands::home` already confirmed is viable.
pub async fn generate(
    byo: Option<&AiProvider>,
    input: GenerationInput,
) -> Result<Generated, AppError> {
    generate_within(input, GENERATION_BUDGET, |request| async move {
        backend::invoke(byo, request, &backend::ignore_deltas()).await
    })
    .await
}

#[cfg(test)]
#[path = "tests_home_surface.rs"]
mod tests;
