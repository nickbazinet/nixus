//! Surface Validation (PRD FR-1..FR-6): the check every model-proposed Home Surface change passes
//! BEFORE a confirmation card exists, and that the confirmed change passes AGAIN before it is
//! persisted, because the card's params cross IPC and are therefore input like any other.
//!
//! Everything is checked against the closed catalog and whitelist in `catalog`. Unknown fields are
//! refused rather than ignored: an ignored `"data": [...]` would be a literal value riding along in
//! a persisted spec, which is the one thing the design forbids (FR-3). A widget's free-text `title`
//! is exempt from the literal-value rule by explicit PRD decision — it is the model's own prose.

use serde_json::{Map, Value};

use super::catalog::{self, ComponentKind};
use super::matcher::{self, RemovalMatch};

/// FR-2 NFR: the Home Surface holds at most this many widgets.
pub const MAX_WIDGETS: usize = 12;
/// Bounds a single widget's render cost so the 12-widget cap is also a bound on Home-open work.
/// Counts layout levels: three nested layouts, then display components.
pub const MAX_DEPTH: usize = 3;
pub const MAX_CHILDREN: usize = 4;
pub const MAX_DISPLAYS_PER_WIDGET: usize = 4;
pub const MAX_TITLE_CHARS: usize = 80;
pub const MAX_MESSAGE_CHARS: usize = 600;
const DEFAULT_GRID_COLUMNS: i64 = 2;
const MAX_GRID_COLUMNS: i64 = 4;

/// Field names that would carry a figure if they were allowed. Named so the refusal can say WHY
/// rather than only "unknown field" — the model corrects a reason faster than a rejection.
const DATA_BEARING_KEYS: &[&str] = &[
    "data",
    "dataset",
    "value",
    "values",
    "rows",
    "series",
    "points",
    "items",
    "records",
    "labels",
    "amount",
    "amount_cents",
    "total",
    "total_cents",
];

/// A persisted widget as validation and the Composer see it: its key and its spec. Never values.
#[derive(Debug, Clone, PartialEq)]
pub struct WidgetSummary {
    pub widget_key: String,
    pub spec: Value,
}

impl WidgetSummary {
    pub fn title(&self) -> &str {
        self.spec.get("title").and_then(Value::as_str).unwrap_or("")
    }
}

/// A validated change, in the canonical form the confirmation card carries and the DB applies.
#[derive(Debug, Clone, PartialEq)]
pub enum SurfaceChange {
    Add { widget: Value },
    Modify { widget_id: String, widget: Value },
    Remove { widget_id: String, title: String },
}

impl SurfaceChange {
    pub fn op(&self) -> &'static str {
        match self {
            SurfaceChange::Add { .. } => "add",
            SurfaceChange::Modify { .. } => "modify",
            SurfaceChange::Remove { .. } => "remove",
        }
    }

    /// The card params. `title` on a removal is display-only: re-validation reads the stored one.
    pub fn to_params(&self) -> Value {
        match self {
            SurfaceChange::Add { widget } => serde_json::json!({ "op": "add", "widget": widget }),
            SurfaceChange::Modify { widget_id, widget } => {
                serde_json::json!({ "op": "modify", "widget_id": widget_id, "widget": widget })
            }
            SurfaceChange::Remove { widget_id, title } => {
                serde_json::json!({ "op": "remove", "widget_id": widget_id, "title": title })
            }
        }
    }
}

/// What a valid model turn resolves to.
#[derive(Debug, Clone, PartialEq)]
pub enum Proposal {
    Change(SurfaceChange),
    /// The model answered in prose instead of proposing a change (out of scope, at the cap...).
    Message(String),
    /// A removal whose target matched several widgets: their titles, for the user to pick from.
    Ambiguous(Vec<String>),
    /// A removal whose target matched nothing: every current title, for the user to pick from.
    NoMatch(Vec<String>),
}

type Errors = Vec<String>;

fn object<'a>(value: &'a Value, path: &str, errors: &mut Errors) -> Option<&'a Map<String, Value>> {
    let found = value.as_object();
    if found.is_none() {
        errors.push(format!("{path} must be a JSON object"));
    }
    found
}

fn refuse_unknown_keys(
    map: &Map<String, Value>,
    allowed: &[&str],
    path: &str,
    errors: &mut Errors,
) {
    for key in map.keys() {
        if allowed.contains(&key.as_str()) {
            continue;
        }
        if DATA_BEARING_KEYS.contains(&key.as_str()) {
            errors.push(format!(
                "{path}.{key}: literal data values are not allowed; bind a data source with dataBinding instead"
            ));
        } else {
            errors.push(format!("{path}.{key} is not a recognised field"));
        }
    }
}

fn title_of(
    map: &Map<String, Value>,
    path: &str,
    required: bool,
    errors: &mut Errors,
) -> Option<String> {
    match map.get("title") {
        None if required => {
            errors.push(format!("{path}.title is required"));
            None
        }
        None => None,
        Some(Value::String(raw)) => {
            let title: String = raw.chars().filter(|c| !c.is_control()).collect();
            let title = title.trim().to_string();
            if title.is_empty() {
                errors.push(format!("{path}.title must not be empty"));
                None
            } else if title.chars().count() > MAX_TITLE_CHARS {
                errors.push(format!(
                    "{path}.title must be at most {MAX_TITLE_CHARS} characters"
                ));
                None
            } else {
                Some(title)
            }
        }
        Some(_) => {
            errors.push(format!("{path}.title must be a string"));
            None
        }
    }
}

fn validate_binding(
    raw: &Value,
    path: &str,
    errors: &mut Errors,
) -> Option<(Value, catalog::SourceShape)> {
    let map = object(raw, path, errors)?;
    refuse_unknown_keys(map, &["source", "params"], path, errors);

    let Some(name) = map.get("source").and_then(Value::as_str) else {
        errors.push(format!("{path}.source must name a whitelisted data source"));
        return None;
    };
    let Some(source) = catalog::data_source(name) else {
        let known: Vec<&str> = catalog::DATA_SOURCES.iter().map(|s| s.name).collect();
        errors.push(format!(
            "{path}.source \"{name}\" is not a whitelisted data source; use one of: {}",
            known.join(", ")
        ));
        return None;
    };

    let empty = Map::new();
    let given = match map.get("params") {
        None | Some(Value::Null) => &empty,
        Some(Value::Object(params)) => params,
        Some(_) => {
            errors.push(format!("{path}.params must be a JSON object"));
            return None;
        }
    };

    for key in given.keys() {
        if source.param(key).is_none() {
            errors.push(format!(
                "{path}.params.{key} is not a parameter of {}; literal data values are not allowed",
                source.name
            ));
        }
    }

    let mut params = Map::new();
    for spec in source.params {
        match spec.kind {
            catalog::ParamKind::Integer { min, max, default } => {
                let value = match given.get(spec.name) {
                    None => default,
                    Some(raw) => match raw.as_i64() {
                        Some(value) if value >= min && value <= max => value,
                        _ => {
                            errors.push(format!(
                                "{path}.params.{} must be an integer between {min} and {max}",
                                spec.name
                            ));
                            continue;
                        }
                    },
                };
                params.insert(spec.name.to_string(), Value::from(value));
            }
            catalog::ParamKind::CategoryName { max_chars } => {
                let Some(raw) = given.get(spec.name) else {
                    continue;
                };
                // A category is named in words. Digits and currency signs are refused so this one
                // text parameter can never carry a figure into a persisted spec.
                match raw.as_str().map(str::trim) {
                    Some(name)
                        if !name.is_empty()
                            && name.chars().count() <= max_chars
                            && !name.chars().any(|c| {
                                c.is_ascii_digit() || c.is_control() || "$€£¥".contains(c)
                            }) =>
                    {
                        params.insert(spec.name.to_string(), Value::from(name));
                    }
                    _ => errors.push(format!(
                        "{path}.params.{} must be a budget category name in words (at most {max_chars} characters, no numbers), or omitted",
                        spec.name
                    )),
                }
            }
        }
    }

    Some((
        serde_json::json!({ "source": source.name, "params": params }),
        source.shape,
    ))
}

struct Walk {
    errors: Errors,
    displays: usize,
}

fn validate_node(
    raw: &Value,
    path: &str,
    depth: usize,
    is_root: bool,
    walk: &mut Walk,
) -> Option<Value> {
    let map = object(raw, path, &mut walk.errors)?;

    let Some(name) = map.get("component").and_then(Value::as_str) else {
        walk.errors
            .push(format!("{path}.component must name a catalog component"));
        return None;
    };
    let Some(component) = catalog::component(name) else {
        let known: Vec<&str> = catalog::COMPONENTS.iter().map(|c| c.name).collect();
        walk.errors.push(format!(
            "{path}.component \"{name}\" is not in the component catalog; use one of: {}",
            known.join(", ")
        ));
        return None;
    };

    let title = title_of(map, path, is_root, &mut walk.errors);
    let mut node = Map::new();
    node.insert("component".to_string(), Value::from(component.name));
    if let Some(title) = title {
        node.insert("title".to_string(), Value::from(title));
    }

    match component.kind {
        ComponentKind::Display => {
            refuse_unknown_keys(
                map,
                &["component", "title", "dataBinding"],
                path,
                &mut walk.errors,
            );
            walk.displays += 1;
            let Some(raw_binding) = map.get("dataBinding") else {
                walk.errors.push(format!(
                    "{path}.dataBinding is required on {}",
                    component.name
                ));
                return None;
            };
            let (binding, shape) = validate_binding(
                raw_binding,
                &format!("{path}.dataBinding"),
                &mut walk.errors,
            )?;
            if let Some(required) = component.requires {
                if required != shape {
                    walk.errors.push(format!(
                        "{path}: {} cannot display {}; it needs a {} source",
                        component.name,
                        binding["source"].as_str().unwrap_or(""),
                        match required {
                            catalog::SourceShape::TimeSeries => "monthly (time series)",
                            catalog::SourceShape::Categorical => "categorical",
                            catalog::SourceShape::Transactions => "transaction-list",
                        }
                    ));
                }
            }
            if shape == catalog::SourceShape::Transactions && component.name != "Table" {
                walk.errors.push(format!(
                    "{path}: {} lists individual transactions and can only be shown in a Table, not a {}",
                    binding["source"].as_str().unwrap_or(""),
                    component.name
                ));
            }
            node.insert("dataBinding".to_string(), binding);
        }
        ComponentKind::Layout => {
            refuse_unknown_keys(
                map,
                &["component", "title", "children", "columns"],
                path,
                &mut walk.errors,
            );
            if map.contains_key("dataBinding") {
                walk.errors.push(format!(
                    "{path}: {} is a layout primitive and cannot carry a dataBinding",
                    component.name
                ));
            }
            if depth > MAX_DEPTH {
                walk.errors.push(format!(
                    "{path}: layouts may nest at most {MAX_DEPTH} levels deep"
                ));
                return None;
            }

            if component.name == "Grid" {
                let columns = match map.get("columns") {
                    None => DEFAULT_GRID_COLUMNS,
                    Some(raw) => match raw.as_i64() {
                        Some(columns) if (1..=MAX_GRID_COLUMNS).contains(&columns) => columns,
                        _ => {
                            walk.errors.push(format!(
                                "{path}.columns must be an integer between 1 and {MAX_GRID_COLUMNS}"
                            ));
                            DEFAULT_GRID_COLUMNS
                        }
                    },
                };
                node.insert("columns".to_string(), Value::from(columns));
            } else if map.contains_key("columns") {
                walk.errors
                    .push(format!("{path}.columns is only allowed on Grid"));
            }

            let children = match map.get("children").and_then(Value::as_array) {
                Some(children) if !children.is_empty() && children.len() <= MAX_CHILDREN => {
                    children
                }
                _ => {
                    walk.errors.push(format!(
                        "{path}.children must be an array of 1 to {MAX_CHILDREN} components"
                    ));
                    return None;
                }
            };
            let validated: Vec<Value> = children
                .iter()
                .enumerate()
                .filter_map(|(index, child)| {
                    validate_node(
                        child,
                        &format!("{path}.children[{index}]"),
                        depth + 1,
                        false,
                        walk,
                    )
                })
                .collect();
            node.insert("children".to_string(), Value::Array(validated));
        }
    }

    Some(Value::Object(node))
}

/// One widget description, returned in canonical form (defaults made explicit, unknowns refused).
pub fn validate_widget(raw: &Value) -> Result<Value, Errors> {
    let mut walk = Walk {
        errors: Vec::new(),
        displays: 0,
    };
    let widget = validate_node(raw, "widget", 1, true, &mut walk);

    if walk.displays == 0 && walk.errors.is_empty() {
        walk.errors
            .push("widget must contain at least one display component".to_string());
    }
    if walk.displays > MAX_DISPLAYS_PER_WIDGET {
        walk.errors.push(format!(
            "widget contains {} display components; at most {MAX_DISPLAYS_PER_WIDGET} are allowed",
            walk.displays
        ));
    }

    match widget {
        Some(widget) if walk.errors.is_empty() => Ok(widget),
        _ => Err(walk.errors),
    }
}

fn too_many_widgets() -> String {
    format!(
        "too many widgets: the Home Surface already holds the maximum of {MAX_WIDGETS}. Do not add another; reply with op \"message\" explaining that one must be removed first"
    )
}

fn existing<'a>(current: &'a [WidgetSummary], id: &str) -> Option<&'a WidgetSummary> {
    current.iter().find(|widget| widget.widget_key == id)
}

fn required_str<'a>(
    map: &'a Map<String, Value>,
    key: &str,
    errors: &mut Errors,
) -> Option<&'a str> {
    let found = map
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if found.is_none() {
        errors.push(format!("{key} must be a non-empty string"));
    }
    found
}

/// A model turn, already parsed as JSON. Removal targets are resolved here, app-side, so the model
/// never decides on its own which widget is deleted (FR-6).
pub fn validate_proposal(raw: &Value, current: &[WidgetSummary]) -> Result<Proposal, Errors> {
    let mut errors = Vec::new();
    let Some(map) = object(raw, "response", &mut errors) else {
        return Err(errors);
    };

    match map.get("op").and_then(Value::as_str) {
        Some("add") => {
            refuse_unknown_keys(map, &["op", "widget"], "response", &mut errors);
            if current.len() >= MAX_WIDGETS {
                errors.push(too_many_widgets());
            }
            let widget = validate_widget(map.get("widget").unwrap_or(&Value::Null));
            match (widget, errors.is_empty()) {
                (Ok(widget), true) => Ok(Proposal::Change(SurfaceChange::Add { widget })),
                (Ok(_), false) => Err(errors),
                (Err(mut widget_errors), _) => {
                    errors.append(&mut widget_errors);
                    Err(errors)
                }
            }
        }
        Some("modify") => {
            refuse_unknown_keys(map, &["op", "widget_id", "widget"], "response", &mut errors);
            let widget_id = required_str(map, "widget_id", &mut errors).map(str::to_string);
            if let Some(id) = &widget_id {
                if existing(current, id).is_none() {
                    errors.push(format!(
                        "widget_id \"{id}\" is not one of the current widgets"
                    ));
                }
            }
            match validate_widget(map.get("widget").unwrap_or(&Value::Null)) {
                Ok(widget) if errors.is_empty() => Ok(Proposal::Change(SurfaceChange::Modify {
                    widget_id: widget_id.unwrap_or_default(),
                    widget,
                })),
                Ok(_) => Err(errors),
                Err(mut widget_errors) => {
                    errors.append(&mut widget_errors);
                    Err(errors)
                }
            }
        }
        Some("remove") => {
            refuse_unknown_keys(map, &["op", "target"], "response", &mut errors);
            let target = required_str(map, "target", &mut errors).map(str::to_string);
            let Some(target) = target.filter(|_| errors.is_empty()) else {
                return Err(errors);
            };
            Ok(match matcher::match_removal_target(&target, current) {
                RemovalMatch::One(index) => Proposal::Change(SurfaceChange::Remove {
                    widget_id: current[index].widget_key.clone(),
                    title: current[index].title().to_string(),
                }),
                RemovalMatch::Ambiguous(indices) => Proposal::Ambiguous(
                    indices
                        .into_iter()
                        .map(|i| current[i].title().to_string())
                        .collect(),
                ),
                RemovalMatch::None => {
                    Proposal::NoMatch(current.iter().map(|w| w.title().to_string()).collect())
                }
            })
        }
        Some("message") => {
            refuse_unknown_keys(map, &["op", "text"], "response", &mut errors);
            let text = required_str(map, "text", &mut errors).map(str::to_string);
            match text {
                Some(text) if errors.is_empty() => Ok(Proposal::Message(
                    text.chars().take(MAX_MESSAGE_CHARS).collect(),
                )),
                _ => Err(errors),
            }
        }
        _ => {
            errors.push("op must be one of: add, modify, remove, message".to_string());
            Err(errors)
        }
    }
}

/// The confirmed card's params, re-validated before anything is written: they crossed IPC, so a
/// card the webview edited is refused exactly like a model turn would have been.
pub fn validate_change(params: &Value, current: &[WidgetSummary]) -> Result<SurfaceChange, Errors> {
    let mut errors = Vec::new();
    let Some(map) = object(params, "params", &mut errors) else {
        return Err(errors);
    };

    let change = match map.get("op").and_then(Value::as_str) {
        Some("add") => {
            refuse_unknown_keys(map, &["op", "widget"], "params", &mut errors);
            if current.len() >= MAX_WIDGETS {
                errors.push(too_many_widgets());
            }
            validate_widget(map.get("widget").unwrap_or(&Value::Null))
                .map(|widget| SurfaceChange::Add { widget })
        }
        Some("modify") => {
            refuse_unknown_keys(map, &["op", "widget_id", "widget"], "params", &mut errors);
            let widget_id = required_str(map, "widget_id", &mut errors)
                .unwrap_or_default()
                .to_string();
            if !widget_id.is_empty() && existing(current, &widget_id).is_none() {
                errors.push(format!(
                    "widget_id \"{widget_id}\" is not one of the current widgets"
                ));
            }
            validate_widget(map.get("widget").unwrap_or(&Value::Null))
                .map(|widget| SurfaceChange::Modify { widget_id, widget })
        }
        Some("remove") => {
            refuse_unknown_keys(map, &["op", "widget_id", "title"], "params", &mut errors);
            let widget_id = required_str(map, "widget_id", &mut errors)
                .unwrap_or_default()
                .to_string();
            match existing(current, &widget_id) {
                Some(widget) => Ok(SurfaceChange::Remove {
                    title: widget.title().to_string(),
                    widget_id,
                }),
                None => Err(vec![format!(
                    "widget_id \"{widget_id}\" is not one of the current widgets"
                )]),
            }
        }
        _ => Err(vec!["op must be one of: add, modify, remove".to_string()]),
    };

    match change {
        Ok(change) if errors.is_empty() => Ok(change),
        Ok(_) => Err(errors),
        Err(mut change_errors) => {
            errors.append(&mut change_errors);
            Err(errors)
        }
    }
}

#[cfg(test)]
#[path = "tests_validate.rs"]
mod tests;
