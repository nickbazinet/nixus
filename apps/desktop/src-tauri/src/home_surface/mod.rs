//! The AI-generated Home Surface's app-side rules: what may be composed (`catalog`), what a
//! composed change must satisfy before anyone sees it (`validate`), and how a removal request is
//! resolved to one widget (`matcher`). Pure logic — SQL lives in `db::home_surface`, prompts in
//! `ai::home_surface`.

pub mod catalog;
pub mod matcher;
pub mod router;
pub mod validate;
