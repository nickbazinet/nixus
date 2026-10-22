//! Multi-device sync (Milestone 1). The module list below is the Structural Seed's;
//! each file states which story fills it, so the shape of the feature is reviewable
//! before the behaviour exists.
//!
//! Story 10 landed the manager and `commands/sync.rs`, so the subtree-wide
//! `#![allow(dead_code)]` that covered every item written ahead of its caller is gone and
//! the dead-code gate applies here like anywhere else. What remains unreached is marked
//! item by item, each naming the Milestone-2 story that is its first caller.

pub mod adopt;
pub mod apply;
pub mod auth;
pub mod balance;
pub mod blob;
pub mod bootstrap;
pub mod capture;
pub mod clock;
pub mod config;
pub mod dedupe;
pub mod gate;
pub mod host;
pub mod identity;
pub mod limits;
pub mod manager;
pub mod object;
pub mod owner;
pub mod reconcile;
pub mod registry;
pub mod retention;
pub mod restore;
pub mod s3;
pub mod segment;
pub mod settle;
pub mod snapshot;
pub mod state;
pub mod store;

#[cfg(test)]
mod sim;
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests_apply;
#[cfg(test)]
mod tests_auth_boundary;
#[cfg(test)]
mod tests_capture;
#[cfg(test)]
mod tests_capture_latency;
#[cfg(test)]
mod tests_balance_emitters;
#[cfg(test)]
mod tests_audit_replication;
#[cfg(test)]
mod tests_auto;
#[cfg(test)]
mod tests_bootstrap;
#[cfg(test)]
mod tests_domain_capture;
#[cfg(test)]
mod tests_e2e;
#[cfg(test)]
mod tests_finance_capture;
#[cfg(test)]
mod tests_gate_boundary;
#[cfg(test)]
mod tests_images;
#[cfg(test)]
mod tests_m2_e2e;
#[cfg(test)]
mod tests_manager;
#[cfg(test)]
mod tests_port_boundary;
#[cfg(test)]
mod tests_reconcile;
#[cfg(test)]
mod tests_retention;
#[cfg(test)]
mod tests_legacy_rows;
#[cfg(test)]
mod tests_lifecycle;
#[cfg(test)]
mod tests_limits;
#[cfg(test)]
mod tests_restore;
#[cfg(test)]
mod tests_s3_endpoint;
#[cfg(test)]
mod tests_segment;
#[cfg(test)]
mod tests_skew;
#[cfg(test)]
mod tests_write_site_budget;
