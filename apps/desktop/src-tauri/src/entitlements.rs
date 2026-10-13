//! Which capabilities an account's entitlement grants.
//!
//! This is the seam the rest of the app asks "may this account do X?" through, and it
//! exists so that no feature has to know what the account *is*. A feature names a
//! capability; the one table below is the only place a product tier and a capability are
//! mentioned in the same breath. Changing which accounts include `multi_device_sync` is
//! therefore a change here (or, in the normal case, a change on the server that decides
//! the entitlement) and never a change in `sync/**` (AD-14).
//!
//! The entitlement itself is not invented here: it is the existing Nixus Cloud account
//! entitlement that `ai::hosted_bedrock` already reads from the account status endpoint
//! and caches per signed-in subject in `ai::hosted_state`. There is deliberately no
//! second source of truth, no local flag and no license file.

/// A named capability. Opaque so a caller cannot build one from a runtime string: the set
/// of capabilities is fixed at compile time, which is what makes the registry below an
/// exhaustive answer rather than a lookup that can miss.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capability(&'static str);

impl Capability {
    /// The stable diagnostic name. Stable because AD-16's diagnostics report it and SPEC
    /// CAP-1 names it; it is not a user-facing string.
    ///
    /// Not yet read outside tests: `sync_diagnostics` is Story 10, and this is the value
    /// it reports. Narrowly scoped rather than module-wide so the next unused item here
    /// still fails the gate.
    #[allow(dead_code)]
    pub fn name(self) -> &'static str {
        self.0
    }
}

/// Multi-device sync (SPEC CAP-1, AD-14). The only capability in Milestone 1.
pub const MULTI_DEVICE_SYNC: Capability = Capability("multi_device_sync");

/// What a Nixus Cloud account with a live premium entitlement may do.
///
/// The one place in the codebase where a tier and a capability appear together. A tier
/// gaining or losing a capability is an edit to this slice and to nothing else.
const PREMIUM_CLOUD_CAPABILITIES: &[Capability] = &[MULTI_DEVICE_SYNC];

/// The capability set of the account currently signed in.
///
/// A plain value rather than a live reader, so a caller cannot accidentally make a second
/// network round trip per check and a test can state an account's capabilities without
/// standing up the status endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountCapabilities {
    cloud_entitled: bool,
}

impl AccountCapabilities {
    /// Builds the set from the account entitlement signal the app already has. `false`
    /// covers a signed-out account and one whose entitlement could not be established:
    /// denying is correct for both, because AD-14 makes an absent capability the Frozen
    /// state, which leaves the local app fully working.
    pub fn from_cloud_entitlement(cloud_entitled: bool) -> Self {
        Self { cloud_entitled }
    }

    pub fn grants(&self, capability: Capability) -> bool {
        self.cloud_entitled && PREMIUM_CLOUD_CAPABILITIES.contains(&capability)
    }
}

/// Reads the account's entitlement and projects it onto capabilities.
///
/// Cheap to call repeatedly — `ai::hosted_bedrock` caches the entitlement per subject with
/// its own TTL and backoff — which is what lets AD-14's "check before every network
/// operation" be literal rather than aspirational. Never fails: an unreachable or
/// unreadable entitlement is no capability, not an error the caller has to handle.
pub async fn account_capabilities() -> AccountCapabilities {
    AccountCapabilities::from_cloud_entitlement(
        crate::ai::hosted_bedrock::premium_entitlement().await,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_premium_account_is_granted_multi_device_sync() {
        assert!(AccountCapabilities::from_cloud_entitlement(true).grants(MULTI_DEVICE_SYNC));
    }

    #[test]
    fn an_account_without_the_entitlement_is_granted_nothing() {
        assert!(!AccountCapabilities::from_cloud_entitlement(false).grants(MULTI_DEVICE_SYNC));
    }

    #[test]
    fn the_capability_name_is_the_one_the_spec_pins() {
        assert_eq!(MULTI_DEVICE_SYNC.name(), "multi_device_sync");
    }
}
