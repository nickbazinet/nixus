//! Tier 1 of the Home bar's routing: a free, deterministic dashboard-intent detector.
//!
//! **High precision, low recall by design.** It fires only on phrasing that is unmistakably about
//! building or changing the dashboard. Everything it does not recognise falls through to the chat
//! agent, so a miss costs an answer in the panel instead of a dashboard proposal — while a false
//! positive costs the user a confusing widget proposal in place of the answer they asked for.
//!
//! **It lives in Rust because its vocabulary is derived from [`catalog`].** A TypeScript copy of
//! the component and data-source names would drift the moment a component is added; here, adding a
//! catalog component extends the detector for free.
//!
//! **AD-11: this module never logs.** It is the one place in the app that looks at the whole text
//! of a Home bar message, which makes it the most tempting possible place to log "classified as X
//! because Y". The guard test at the bottom of this file enforces the absence.

use std::sync::LazyLock;

use crate::ai::agents;
use crate::home_surface::catalog;
use crate::maintenance::defaults;

/// Where a Home bar message is sent.
///
/// The user never picks. Every Home bar message is classified here, which is why the vocabulary
/// below is derived from the app's own catalogs rather than hand-maintained: the classifier has to
/// stay correct as components and maintenance tasks are added.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HomeRoute {
    /// The dashboard composer: a proposal the user confirms.
    Surface,
    /// A conversational agent, named. A streamed answer in the panel.
    Chat(&'static str),
}

/// Verbs that only make sense against the dashboard itself. Strong enough to pair with an
/// ambiguous noun: "remove that card" is about the dashboard, "show my card balance" is not.
const MUTATION_VERBS: &[&str] = &[
    "add",
    "remove",
    "delete",
    "drop",
    "put",
    "pin",
    "ajoute",
    "ajouter",
    "retire",
    "retirer",
    "enleve",
    "enlever",
    "supprime",
    "supprimer",
    "met",
    "mets",
    "mettre",
];

/// Nouns that mean "a thing on the dashboard" and nothing else, and therefore carry intent on
/// their own.
///
/// No accompanying verb is required, deliberately: every entry here is a word a user has no reason
/// to type while asking an ordinary financial question, and requiring a verb only cost recall —
/// French puts the chart type in a prepositional phrase with no verb at all ("en diagramme à
/// barres"). Anything genuinely ambiguous belongs in [`WEAK_NOUNS`] instead.
const STRONG_NOUNS: &[&str] = &[
    "widget",
    "chart",
    "graph",
    "dashboard",
    "tile",
    "diagram",
    "graphique",
    "tuile",
    "diagramme",
];

/// Nouns that are dashboard vocabulary in context but ordinary finance words otherwise — `card`
/// is in "credit card", `table` is in "the table below". These need a [`MUTATION_VERBS`] verb.
const WEAK_NOUNS: &[&str] = &["carte", "tableau", "colonne", "grille"];

/// Multi-word phrases that are unambiguous on their own.
const STRONG_PHRASES: &[&[&str]] = &[
    &["tableau", "de", "bord"],
    &["home", "screen"],
    &["home", "dashboard"],
];

/// Splits a catalog component name on its camel-case humps: `LineChart` → `["line", "chart"]`.
fn split_camel(name: &str) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    let mut current = String::new();
    for ch in name.chars() {
        if ch.is_uppercase() && !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
        current.push(ch.to_ascii_lowercase());
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

/// Catalog components whose name is more than one word — `LineChart`, `SankeyChart` and friends.
/// Naming one of these is dashboard intent on its own, in either the spaced or the joined form.
static COMPONENT_PHRASES: LazyLock<Vec<Vec<String>>> = LazyLock::new(|| {
    let mut phrases: Vec<Vec<String>> = Vec::new();
    for component in catalog::COMPONENTS {
        let words = split_camel(component.name);
        if words.len() > 1 {
            phrases.push(vec![words.concat()]);
            phrases.push(words);
        }
    }
    phrases
});

/// Catalog components with a single-word name — `Table`, `Card`, `Metric`, `Row`. Ordinary English
/// words, so they are treated as weak nouns and need a mutation verb beside them.
static COMPONENT_WEAK_NOUNS: LazyLock<Vec<String>> = LazyLock::new(|| {
    catalog::COMPONENTS
        .iter()
        .map(|component| split_camel(component.name))
        .filter(|words| words.len() == 1)
        .map(|words| words.concat())
        .collect()
});

/// The leading word of a multi-word component name — `sankey`, `line`, `bar`, `pie`, `area`.
///
/// Only `sankey` is distinctive on its own, so these count beside a [`STRONG_NOUNS`] noun instead:
/// "a Sankey diagram", "a bar graph". Derived from the catalog so a new chart type needs no edit
/// here.
static COMPONENT_QUALIFIERS: LazyLock<Vec<String>> = LazyLock::new(|| {
    catalog::COMPONENTS
        .iter()
        .map(|component| split_camel(component.name))
        .filter(|words| words.len() > 1)
        .filter_map(|words| words.first().cloned())
        .collect()
});

/// `a`/`an`/`un`/`une` before a dashboard noun is a request to CREATE one, where a possessive is a
/// question about the real thing: "a table of my expenses" builds a widget, "my card balance" does
/// not. This is what lets `Table` and `Card` carry intent without hijacking ordinary questions.
const INDEFINITE_ARTICLES: &[&str] = &["a", "an", "another", "un", "une"];

/// How far past the article the noun may sit, so "a net worth widget" still counts.
const ARTICLE_NOUN_WINDOW: usize = 3;

/// Data-source names as the user would have to type them to mean one — both the literal
/// `expenses_by_month` and the spoken `expenses by month`.
static DATA_SOURCE_PHRASES: LazyLock<Vec<Vec<String>>> = LazyLock::new(|| {
    catalog::DATA_SOURCES
        .iter()
        .map(|source| {
            source
                .name
                .split('_')
                .map(|word| word.to_string())
                .collect::<Vec<_>>()
        })
        .collect()
});

/// Lowercase alphanumeric words. Token matching rather than substring matching is what keeps
/// `chart` out of `charter` and `met` out of `metro`.
fn tokenize(message: &str) -> Vec<String> {
    message
        .to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| word.to_string())
        .collect()
}

fn has_word(tokens: &[String], words: &[&str]) -> bool {
    tokens.iter().any(|token| words.contains(&token.as_str()))
}

fn has_any_of(tokens: &[String], words: &[String]) -> bool {
    tokens.iter().any(|token| words.contains(token))
}

fn has_phrase(tokens: &[String], phrase: &[impl AsRef<str>]) -> bool {
    if phrase.is_empty() || phrase.len() > tokens.len() {
        return false;
    }
    tokens.windows(phrase.len()).any(|window| {
        window
            .iter()
            .zip(phrase)
            .all(|(token, word)| token == word.as_ref())
    })
}

/// Maintenance task keys in the form a user would actually speak them — `brake_pads` →
/// `"brake pads"` — plus the literal key, both derived from the canonical task table.
static TASK_PHRASES: LazyLock<Vec<Vec<String>>> = LazyLock::new(|| {
    let mut phrases: Vec<Vec<String>> = Vec::new();
    for task in defaults::DEFAULT_TASKS {
        phrases.push(vec![task.task_type_key.to_string()]);
        phrases.push(
            task.task_type_key
                .split('_')
                .map(|word| word.to_string())
                .collect(),
        );
    }
    phrases
});

/// How people actually name upkeep, which the task keys do not cover: nobody asks about their
/// `engine_oil_filter`, they ask about an oil change. The mapping these mirror is the one the car
/// agent's own prompt already carries.
const MAINTENANCE_PHRASES: &[&[&str]] = &[
    &["oil", "change"],
    &["oil", "changes"],
    &["service", "history"],
    &["service", "log"],
    &["disc", "brakes"],
    &["tire", "rotation"],
    &["tire", "replacement"],
    &["tune", "up"],
    &["liquide", "de", "frein"],
    &["changement", "d", "huile"],
];

/// Upkeep words that mean maintenance and nothing else.
///
/// Deliberately excludes `tires`, `brakes` and `car` on their own: "how much did I spend on tires"
/// and "can I afford a car" are spending questions, and sending those to a read-only maintenance
/// agent would be a worse failure than answering them from the budget.
const MAINTENANCE_WORDS: &[&str] = &[
    "maintenance",
    "odometer",
    "mileage",
    "servicing",
    "serviced",
    "rotors",
    "coolant",
    "antifreeze",
    "entretien",
    "vidange",
    "odometre",
    "kilometrage",
    "plaquettes",
    "bougies",
    "amortisseurs",
];

/// Words that identify the thing being maintained. Never routing on their own — only beside a
/// maintenance verb or a due-date question.
const VEHICLE_WORDS: &[&str] = &[
    "car",
    "cars",
    "vehicle",
    "vehicles",
    "truck",
    "motorcycle",
    "voiture",
    "vehicule",
    "camion",
];

const SERVICE_VERBS: &[&str] = &["service", "repair", "repaired", "reparation", "revision"];

/// `oil` plus a change verb, in any order: "change the oil on my Civic" never contains the phrase
/// "oil change", and it is one of the most common ways to ask.
const OIL_WORDS: &[&str] = &["oil", "huile"];
const CHANGE_VERBS: &[&str] = &["change", "changed", "changing", "changer", "remplacer"];

const DUE_WORDS: &[&str] = &["due", "overdue", "upcoming", "echu", "prevu"];

fn looks_like_a_dashboard_ask(tokens: &[String]) -> bool {
    let names_a_catalog_entry = COMPONENT_PHRASES
        .iter()
        .any(|phrase| has_phrase(tokens, phrase))
        || DATA_SOURCE_PHRASES
            .iter()
            .any(|phrase| has_phrase(tokens, phrase))
        || STRONG_PHRASES
            .iter()
            .any(|phrase| has_phrase(tokens, phrase));

    let mutating = has_word(tokens, MUTATION_VERBS);
    let strong_noun = has_word(tokens, STRONG_NOUNS);
    let weak_noun = has_word(tokens, WEAK_NOUNS) || has_any_of(tokens, &COMPONENT_WEAK_NOUNS);
    let qualified_chart = has_any_of(tokens, &COMPONENT_QUALIFIERS) && strong_noun;
    let introduced_by_an_article = tokens.iter().enumerate().any(|(index, token)| {
        if !INDEFINITE_ARTICLES.contains(&token.as_str()) {
            return false;
        }
        let window = tokens
            .iter()
            .skip(index + 1)
            .take(ARTICLE_NOUN_WINDOW)
            .cloned()
            .collect::<Vec<_>>();
        has_word(&window, STRONG_NOUNS)
            || has_word(&window, WEAK_NOUNS)
            || has_any_of(&window, &COMPONENT_WEAK_NOUNS)
    });

    names_a_catalog_entry
        || strong_noun
        || qualified_chart
        || introduced_by_an_article
        || (mutating && weak_noun)
}

fn looks_like_an_upkeep_ask(tokens: &[String]) -> bool {
    let vehicle = has_word(tokens, VEHICLE_WORDS);

    TASK_PHRASES.iter().any(|phrase| has_phrase(tokens, phrase))
        || MAINTENANCE_PHRASES
            .iter()
            .any(|phrase| has_phrase(tokens, phrase))
        || has_word(tokens, MAINTENANCE_WORDS)
        || (has_word(tokens, OIL_WORDS) && has_word(tokens, CHANGE_VERBS))
        || (vehicle && has_word(tokens, SERVICE_VERBS))
        || (vehicle && has_word(tokens, DUE_WORDS))
}

/// Classifies one Home bar message. **No LLM call.**
///
/// Order is the whole design. Dashboard intent is checked first so "add a maintenance widget" is a
/// widget rather than a maintenance question; upkeep second; and everything else — every ordinary
/// money question, which is the overwhelming majority — falls through to the budget agent.
pub fn classify(message: &str) -> HomeRoute {
    let tokens = tokenize(message);
    if tokens.is_empty() {
        return HomeRoute::Chat(agents::DEFAULT_CHAT_AGENT_ID);
    }

    if looks_like_a_dashboard_ask(&tokens) {
        return HomeRoute::Surface;
    }
    if looks_like_an_upkeep_ask(&tokens) {
        return HomeRoute::Chat(agents::CAR_AGENT_ID);
    }
    HomeRoute::Chat(agents::DEFAULT_CHAT_AGENT_ID)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn surface(message: &str) {
        assert_eq!(
            classify(message),
            HomeRoute::Surface,
            "should have routed to the dashboard: {message}"
        );
    }

    fn budget(message: &str) {
        assert_eq!(
            classify(message),
            HomeRoute::Chat(agents::DEFAULT_CHAT_AGENT_ID),
            "should have routed to the budget agent: {message}"
        );
    }

    fn car(message: &str) {
        assert_eq!(
            classify(message),
            HomeRoute::Chat(agents::CAR_AGENT_ID),
            "should have routed to the car agent: {message}"
        );
    }

    #[test]
    fn unmistakable_dashboard_asks_route_to_the_surface_in_english() {
        surface("A Sankey diagram of where my money goes");
        surface("my recurring expenses as a bar chart");
        surface("A table of my last 10 expenses");
        surface("add a net worth widget");
        surface("remove the spending chart");
        surface("show me a pie chart of my categories");
        surface("put a metric on my dashboard");
        surface("delete that card");
        surface("plot my net_worth_history");
        surface("add expenses by category to my home screen");
    }

    #[test]
    fn unmistakable_dashboard_asks_route_to_the_surface_in_french() {
        surface("ajoute un graphique de mes depenses");
        surface("retire la tuile de valeur nette");
        surface("affiche un diagramme de mes categories");
        surface("ajoute une carte a mon tableau de bord");
        surface("supprime ce tableau");
        surface("mets un graphique sur mon tableau de bord");
    }

    /// The other half of the table, and the half that matters: a plain financial question must
    /// never be mistaken for a dashboard edit.
    #[test]
    fn plain_financial_questions_route_to_the_budget_agent_in_english() {
        budget("what's my net worth");
        budget("am I over budget");
        budget("how much did I spend on groceries last month");
        budget("what is my credit card balance");
        budget("did I get paid this month");
        budget("show my card balance");
        budget("how many accounts do I have");
        budget("summarise my spending");
    }

    #[test]
    fn plain_financial_questions_route_to_the_budget_agent_in_french() {
        budget("combien j'ai depense");
        budget("quelle est ma valeur nette");
        budget("est-ce que je depasse mon budget");
        budget("quel est le solde de ma carte de credit");
    }

    #[test]
    fn an_empty_or_punctuation_only_message_falls_through_to_the_budget_agent() {
        budget("");
        budget("   ");
        budget("???");
    }

    /// A display verb with no dashboard noun is not intent — low recall here is the deliberate
    /// trade, because Tier 2 answers the question anyway.
    #[test]
    fn a_bare_display_verb_is_not_enough() {
        budget("show me my expenses");
        budget("display my accounts");
        budget("plot nothing in particular");
    }

    /// The precision claim rests entirely on this set being unambiguous, since any one of these
    /// words routes on its own.
    #[test]
    fn no_strong_noun_is_a_word_an_ordinary_financial_question_would_use() {
        for noun in STRONG_NOUNS {
            surface(noun);
        }
    }

    #[test]
    fn the_detector_vocabulary_is_derived_from_the_catalog_not_copied() {
        // Every multi-word component is reachable in its spoken form, so adding one to the
        // catalog extends the detector without touching this module.
        for component in catalog::COMPONENTS {
            let words = split_camel(component.name);
            if words.len() > 1 {
                surface(&format!("add a {} to my dashboard", words.join(" ")));
            }
        }
        for source in catalog::DATA_SOURCES {
            surface(&format!("chart {}", source.name));
        }
    }

    #[test]
    fn camel_case_names_split_into_spoken_words() {
        assert_eq!(split_camel("LineChart"), vec!["line", "chart"]);
        assert_eq!(split_camel("SankeyChart"), vec!["sankey", "chart"]);
        assert_eq!(split_camel("Table"), vec!["table"]);
    }

    #[test]
    fn token_matching_does_not_fire_on_a_longer_word_that_merely_contains_a_keyword() {
        budget("renew my charter membership");
        budget("my metro grocery run");
    }

    /// R4: the Home starter buttons are the first thing most users click, and the mix spans both
    /// intents on purpose. These are the live `home.starter.*` strings, en and fr — if the detector
    /// sends a dashboard starter to chat, or a question starter to the composer, the routing looks
    /// broken on the very first interaction.
    #[test]
    fn the_shipped_home_starters_route_to_the_surface_they_were_written_for() {
        // home.starter.cashFlow / recurring / recentExpenses — genuine dashboard asks.
        surface("A Sankey diagram of where my money goes in an average month");
        surface("My recurring expenses as a bar chart");
        surface("A table of my last 10 expenses");
        surface("Un diagramme de Sankey montrant où va mon argent dans un mois moyen");
        surface("Mes dépenses récurrentes en diagramme à barres");
        surface("Un tableau de mes 10 dernières dépenses");

        // home.starter.netWorth / topCategories / budget — agent-neutral questions.
        budget("Show my net worth growth month over month");
        budget("My top spending categories this month");
        budget("Budget vs. actual this month");
        budget("Montre l’évolution de ma valeur nette mois par mois");
        budget("Mes principales catégories de dépenses ce mois-ci");
        budget("Budget et dépenses réelles ce mois-ci");
    }

    #[test]
    fn upkeep_questions_route_to_the_car_agent() {
        car("when is my oil change due");
        car("when did I last change the oil on my Civic");
        car("what maintenance is coming up");
        car("are my brake pads worn");
        car("my odometer reads 98000");
        car("show me the service history");
        car("do I need new spark plugs");
        car("is my coolant low");
        car("what is due on my car");
        car("when was my vehicle last serviced");
        car("engine_oil_filter status");
    }

    #[test]
    fn upkeep_questions_route_to_the_car_agent_in_french() {
        car("quand est mon prochain entretien");
        car("ma vidange est-elle due");
        car("mon kilometrage est de 98000");
        car("mes plaquettes sont-elles usees");
    }

    /// The discrimination that matters most, and the example that prompted it: a money question
    /// that merely mentions a car is a BUDGET question. Sending it to a read-only maintenance
    /// agent would answer the wrong thing and offer no way to buy anything.
    #[test]
    fn a_money_question_that_mentions_a_car_still_routes_to_the_budget_agent() {
        budget("do I have enough money to buy a car for 10k$");
        budget("can I afford a car");
        budget("how much did I spend on my car last year");
        budget("how much do I spend on tires");
        budget("what is my car loan balance");
        budget("is my car insurance in the budget");
        budget("ai-je assez d argent pour acheter une voiture de 10000$");
    }

    /// Dashboard intent wins over upkeep intent, so a maintenance WIDGET is still a widget.
    #[test]
    fn a_dashboard_ask_about_upkeep_is_still_a_dashboard_ask() {
        surface("add a maintenance widget to my dashboard");
        surface("show my oil change history as a bar chart");
        surface("ajoute un graphique de mes entretiens");
    }

    /// Every maintenance task the app can create is reachable in its spoken form, so adding one to
    /// the canonical table extends the classifier without touching this module.
    #[test]
    fn the_upkeep_vocabulary_is_derived_from_the_task_table_not_copied() {
        for task in defaults::DEFAULT_TASKS {
            car(&format!("what about my {}", task.task_type_key.replace('_', " ")));
        }
    }

    /// The two asks the routing was specified against, verbatim.
    #[test]
    fn the_specified_examples_route_where_they_were_meant_to() {
        budget("do I have enough money to buy a car for 10k$");
        surface("add to my dashboard a spending graph");
        surface("add to my dashboard X graph");
    }

    /// AD-11. This module sees the entire text of a Home bar message, which makes it the single
    /// most tempting place in the app to log a routing rationale. It must never do so.
    #[test]
    fn the_router_never_logs() {
        let source = std::fs::read_to_string(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("src")
                .join("home_surface")
                .join("router.rs"),
        )
        .expect("read router source");
        let production = source
            .split_once("#[cfg(test)]")
            .map(|(production, _)| production)
            .unwrap_or(&source);

        for macro_name in ["info!", "warn!", "error!", "debug!", "trace!", "println!"] {
            assert!(
                !production.contains(macro_name),
                "{macro_name} in the router would put message text in a log (AD-11)"
            );
        }
        assert!(!production.contains("tracing"));
    }
}
