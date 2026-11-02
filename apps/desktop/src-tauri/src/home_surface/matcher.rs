//! Best-effort resolution of "remove the spending categories one" to exactly one widget (FR-6).
//!
//! Deliberately conservative: the only outcome that leads to a deletion card is a single widget
//! scoring strictly higher than every other. A tie or no overlap at all asks the user to name the
//! widget by title instead, because a wrong-target removal is the failure the PRD worries about.

use std::collections::BTreeSet;

use serde_json::Value;

use super::validate::WidgetSummary;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemovalMatch {
    One(usize),
    Ambiguous(Vec<usize>),
    None,
}

/// Words that say nothing about WHICH widget is meant.
const STOPWORDS: &[&str] = &[
    "a",
    "an",
    "and",
    "the",
    "my",
    "me",
    "of",
    "for",
    "to",
    "in",
    "on",
    "by",
    "per",
    "one",
    "ones",
    "that",
    "this",
    "these",
    "those",
    "it",
    "please",
    "remove",
    "delete",
    "drop",
    "hide",
    "get",
    "rid",
    "widget",
    "chart",
    "graph",
    "card",
    "panel",
    "tile",
    "show",
    "showing",
    "view",
    "with",
    "over",
    "time",
    "from",
    "le",
    "la",
    "les",
    "de",
    "du",
    "des",
    "un",
    "une",
    "mon",
    "ma",
    "mes",
    "retire",
    "retirer",
    "supprime",
    "supprimer",
    "enleve",
    "enlever",
    "graphique",
];

fn stem(word: &str) -> String {
    if let Some(base) = word.strip_suffix("ies") {
        if base.len() >= 2 {
            return format!("{base}y");
        }
    }
    if word.len() > 3 && word.ends_with('s') && !word.ends_with("ss") {
        return word[..word.len() - 1].to_string();
    }
    word.to_string()
}

fn tokens(text: &str) -> BTreeSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty() && !STOPWORDS.contains(word))
        .map(stem)
        .collect()
}

fn normalized(text: &str) -> String {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// What a widget can be called besides its title: the sources it shows and the kind of chart.
fn content_words(node: &Value, words: &mut Vec<String>) {
    if let Some(component) = node.get("component").and_then(Value::as_str) {
        words.push(match component {
            "LineChart" => "line".to_string(),
            "BarChart" => "bar".to_string(),
            "AreaChart" => "area".to_string(),
            "PieChart" => "pie donut".to_string(),
            other => other.to_lowercase(),
        });
    }
    if let Some(title) = node.get("title").and_then(Value::as_str) {
        words.push(title.to_string());
    }
    if let Some(source) = node.pointer("/dataBinding/source").and_then(Value::as_str) {
        words.push(source.replace('_', " "));
    }
    if let Some(children) = node.get("children").and_then(Value::as_array) {
        for child in children {
            content_words(child, words);
        }
    }
}

pub fn match_removal_target(target: &str, widgets: &[WidgetSummary]) -> RemovalMatch {
    let wanted = normalized(target);
    let exact: Vec<usize> = widgets
        .iter()
        .enumerate()
        .filter(|(_, widget)| !wanted.is_empty() && normalized(widget.title()) == wanted)
        .map(|(index, _)| index)
        .collect();
    match exact.as_slice() {
        [only] => return RemovalMatch::One(*only),
        [] => {}
        _ => return RemovalMatch::Ambiguous(exact),
    }

    let target_tokens = tokens(target);
    if target_tokens.is_empty() {
        return RemovalMatch::None;
    }

    let scores: Vec<usize> = widgets
        .iter()
        .map(|widget| {
            let mut words = Vec::new();
            content_words(&widget.spec, &mut words);
            let haystack = tokens(&words.join(" "));
            target_tokens.intersection(&haystack).count()
        })
        .collect();

    let best = scores.iter().copied().max().unwrap_or(0);
    if best == 0 {
        return RemovalMatch::None;
    }

    let leaders: Vec<usize> = scores
        .iter()
        .enumerate()
        .filter(|(_, score)| **score == best)
        .map(|(index, _)| index)
        .collect();
    match leaders.as_slice() {
        [only] => RemovalMatch::One(*only),
        _ => RemovalMatch::Ambiguous(leaders),
    }
}

fn tokens_agree(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let shorter = a.len().min(b.len());
    if shorter >= 4 && (a.starts_with(b) || b.starts_with(a)) {
        return true;
    }
    // "groceries" against a category the user spelled "Grocerie": same word, different ending.
    let common = a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count();
    common >= 5 && common * 5 >= shorter * 4
}

fn category_tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty() && !STOPWORDS.contains(word))
        .map(stem)
        .collect()
}

/// The budget categories a user's words name — "groceries" finds "Groceries", "Grocerie" or
/// "Groceries & Household". An exact name wins outright; otherwise every category whose words all
/// agree with words the user used. Matched here, locally, so category names never have to be
/// shown to the model for it to filter by one.
pub fn match_categories(term: &str, categories: &[(i64, String)]) -> Vec<i64> {
    let wanted = normalized(term);
    let exact: Vec<i64> = categories
        .iter()
        .filter(|(_, name)| !wanted.is_empty() && normalized(name) == wanted)
        .map(|(id, _)| *id)
        .collect();
    if !exact.is_empty() {
        return exact;
    }

    let term_tokens = category_tokens(term);
    if term_tokens.is_empty() {
        return Vec::new();
    }
    categories
        .iter()
        .filter(|(_, name)| {
            let name_tokens = category_tokens(name);
            !name_tokens.is_empty()
                && (name_tokens
                    .iter()
                    .all(|n| term_tokens.iter().any(|t| tokens_agree(n, t)))
                    || term_tokens
                        .iter()
                        .all(|t| name_tokens.iter().any(|n| tokens_agree(n, t))))
        })
        .map(|(id, _)| *id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn widget(key: &str, title: &str, component: &str, source: &str) -> WidgetSummary {
        WidgetSummary {
            widget_key: key.to_string(),
            spec: json!({
                "component": component,
                "title": title,
                "dataBinding": { "source": source, "params": {} }
            }),
        }
    }

    fn surface() -> Vec<WidgetSummary> {
        vec![
            widget(
                "w1",
                "Net Worth, Last 6 Months",
                "LineChart",
                "net_worth_history",
            ),
            widget(
                "w2",
                "Top Spending Categories This Month",
                "PieChart",
                "expenses_by_category",
            ),
            widget("w3", "Spending by Month", "BarChart", "expenses_by_month"),
        ]
    }

    #[test]
    fn a_description_that_points_at_one_widget_resolves_to_it() {
        assert_eq!(
            match_removal_target("the spending categories one", &surface()),
            RemovalMatch::One(1)
        );
        assert_eq!(
            match_removal_target("net worth chart", &surface()),
            RemovalMatch::One(0)
        );
        assert_eq!(
            match_removal_target("the pie", &surface()),
            RemovalMatch::One(1)
        );
    }

    #[test]
    fn an_exact_title_wins_regardless_of_case_and_punctuation() {
        assert_eq!(
            match_removal_target("spending by month", &surface()),
            RemovalMatch::One(2)
        );
        assert_eq!(
            match_removal_target("Net worth last 6 months", &surface()),
            RemovalMatch::One(0)
        );
    }

    /// FR-6: more than one plausible match proposes no deletion at all.
    #[test]
    fn a_description_shared_by_two_widgets_is_ambiguous() {
        assert_eq!(
            match_removal_target("the spending one", &surface()),
            RemovalMatch::Ambiguous(vec![1, 2])
        );
    }

    /// FR-6: zero matches proposes no deletion either.
    #[test]
    fn a_description_matching_nothing_is_no_match() {
        assert_eq!(
            match_removal_target("the car one", &surface()),
            RemovalMatch::None
        );
        assert_eq!(
            match_removal_target("the first one", &surface()),
            RemovalMatch::None
        );
        assert_eq!(match_removal_target("   ", &surface()), RemovalMatch::None);
        assert_eq!(match_removal_target("net worth", &[]), RemovalMatch::None);
    }

    #[test]
    fn a_category_is_found_from_the_users_own_words() {
        let categories = vec![
            (1, "Grocerie".to_string()),
            (2, "Restaurants".to_string()),
            (3, "Others".to_string()),
            (4, "Home & Garden".to_string()),
        ];
        assert_eq!(match_categories("groceries", &categories), vec![1]);
        assert_eq!(match_categories("Restaurants", &categories), vec![2]);
        assert_eq!(match_categories("restaurant", &categories), vec![2]);
        assert_eq!(match_categories("home and garden", &categories), vec![4]);
        assert!(match_categories("car insurance", &categories).is_empty());
        assert!(match_categories("  ", &categories).is_empty());
    }

    #[test]
    fn plural_and_singular_forms_match_each_other() {
        assert_eq!(stem("categories"), "category");
        assert_eq!(stem("expenses"), "expense");
        assert_eq!(stem("assets"), "asset");
        assert_eq!(stem("class"), "class");
    }
}
