//! Multi-device sync (Milestone 1). The module list below is the Structural Seed's;
//! each file states which story fills it, so the shape of the feature is reviewable
//! before the behaviour exists.
//!
//! Nothing here is wired into app startup: `sync` adds no runtime behaviour until the
//! manager and `commands/sync.rs` arrive. That is also why the whole subtree is
//! exempted from the dead-code gate from one place — every item is written, tested
//! and reviewed one story before its caller exists, and deleting this single line
//! when the manager lands restores the gate for the entire module at once.
#![allow(dead_code)]

pub mod apply;
pub mod auth;
pub mod blob;
pub mod capture;
pub mod clock;
pub mod config;
pub mod gate;
pub mod manager;
pub mod object;
pub mod registry;
pub mod s3;
pub mod segment;
pub mod snapshot;
pub mod state;
pub mod store;

#[cfg(test)]
mod tests_auth_boundary;
#[cfg(test)]
mod tests_gate_boundary;
#[cfg(test)]
mod tests_port_boundary;
#[cfg(test)]
mod tests_s3_endpoint;
