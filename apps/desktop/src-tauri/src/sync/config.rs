//! Non-secret coordinates of the sync infrastructure (AD-7, AD-17), in one place.
//!
//! Three values travel together — the identity pool, its region, and the user pool
//! whose ID token the pool trusts — and a mismatch between any two of them fails at
//! the Cognito call with an opaque `NotAuthorized`. Keeping them in one struct is what
//! makes "which pool did we ask?" answerable from a single line of code.
//!
//! The values are public by design (they travel in every unsigned `GetId` request),
//! but the deployed `nixus-sync` stack's outputs are not in this repository yet, so
//! `production()` refuses rather than guessing: a wrong pool id would fail at runtime
//! on a user's machine instead of here. Story 10 fills the two constants in from the
//! stack outputs.

use super::auth::AuthError;

/// Both the stack and the user pool live in `us-east-1` (AD-17), the region of
/// `nixus-bedrock-api` and of the user pool that issues the ID token.
pub const SYNC_REGION: &str = "us-east-1";

/// `None` until the `nixus-sync` stack's `IdentityPoolId` output is recorded here.
const PRODUCTION_IDENTITY_POOL_ID: Option<&str> = None;

/// `None` until the user pool id is recorded here. `commands/auth.rs` only needs the
/// app client id and the custom domain, so the repository has never carried the pool
/// id itself; the identity pool's `Logins` key is the first thing that needs it.
const PRODUCTION_USER_POOL_ID: Option<&str> = None;

/// Where the vended credentials come from. Injectable rather than global so tests, and
/// a future second environment, do not have to mutate process state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityPoolConfig {
    pub identity_pool_id: String,
    pub region: String,
    pub user_pool_id: String,
}

impl IdentityPoolConfig {
    pub fn new(
        identity_pool_id: impl Into<String>,
        region: impl Into<String>,
        user_pool_id: impl Into<String>,
    ) -> Result<Self, AuthError> {
        let config = Self {
            identity_pool_id: identity_pool_id.into(),
            region: region.into(),
            user_pool_id: user_pool_id.into(),
        };

        // An empty part would otherwise compose a syntactically valid but wrong
        // provider name (`cognito-idp..amazonaws.com/`), which Cognito rejects as an
        // unrecognised login — a fault that reads like a bad token, not like a
        // configuration gap.
        if config.identity_pool_id.is_empty()
            || config.region.is_empty()
            || config.user_pool_id.is_empty()
        {
            return Err(AuthError::Unconfigured);
        }

        Ok(config)
    }

    pub fn production() -> Result<Self, AuthError> {
        match (PRODUCTION_IDENTITY_POOL_ID, PRODUCTION_USER_POOL_ID) {
            (Some(identity_pool_id), Some(user_pool_id)) => {
                Self::new(identity_pool_id, SYNC_REGION, user_pool_id)
            }
            _ => Err(AuthError::Unconfigured),
        }
    }

    /// The `Logins` map key of the enhanced flow: the user pool's OIDC issuer without
    /// its scheme, which is the exact string the identity pool's trust configuration
    /// stores (`cognito-idp.<region>.amazonaws.com/<user pool id>`).
    pub fn logins_provider_name(&self) -> String {
        format!(
            "cognito-idp.{}.amazonaws.com/{}",
            self.region, self.user_pool_id
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_logins_key_is_the_user_pools_issuer_without_a_scheme() {
        let config = IdentityPoolConfig::new(
            "us-east-1:00000000-1111-2222-3333-444444444444",
            "us-east-1",
            "us-east-1_ABCdef123",
        )
        .expect("a complete configuration");

        assert_eq!(
            config.logins_provider_name(),
            "cognito-idp.us-east-1.amazonaws.com/us-east-1_ABCdef123"
        );
    }

    #[test]
    fn any_missing_part_is_unconfigured_rather_than_a_malformed_provider_name() {
        for (pool, region, user_pool) in [
            ("", "us-east-1", "us-east-1_ABCdef123"),
            ("us-east-1:0000", "", "us-east-1_ABCdef123"),
            ("us-east-1:0000", "us-east-1", ""),
        ] {
            assert_eq!(
                IdentityPoolConfig::new(pool, region, user_pool),
                Err(AuthError::Unconfigured)
            );
        }
    }

    /// Guards the rule that matters more than the values: no invented identifier is
    /// ever committed. When Story 10 records the real outputs this test is updated to
    /// assert the shape of the real ones instead.
    #[test]
    fn production_refuses_until_the_deployed_stack_outputs_are_recorded() {
        assert_eq!(IdentityPoolConfig::production(), Err(AuthError::Unconfigured));
    }
}
