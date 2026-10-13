//! Non-secret coordinates of the sync infrastructure (AD-7, AD-17), in one place.
//!
//! Three values travel together — the identity pool, its region, and the user pool
//! whose ID token the pool trusts — and a mismatch between any two of them fails at
//! the Cognito call with an opaque `NotAuthorized`. Keeping them in one struct is what
//! makes "which pool did we ask?" answerable from a single line of code.
//!
//! The values are public by design: they travel in every unsigned `GetId` request, the
//! way `COGNITO_CLIENT_ID` and the custom domain in `commands/auth.rs` already do. They
//! are the `nixus-sync` stack's own outputs, so a wrong one is a deploy-time mistake
//! rather than a secret leak — but an *invented* one would fail on a user's machine, which
//! is why `production()` refuses instead of guessing when a constant is absent.

use super::auth::AuthError;

/// Both the stack and the user pool live in `us-east-1` (AD-17), the region of
/// `nixus-bedrock-api` and of the user pool that issues the ID token.
pub const SYNC_REGION: &str = "us-east-1";

/// The deployed `nixus-sync` stack's `IdentityPoolId` output (us-east-1).
const PRODUCTION_IDENTITY_POOL_ID: Option<&str> =
    Some("us-east-1:952bbe95-591a-4260-854d-c218cadbbaf2");

/// The user pool that issues the ID token. `commands/auth.rs` only ever needed the app
/// client id and the custom domain, so the repository did not carry the pool id until
/// the identity pool's `Logins` key required it.
const PRODUCTION_USER_POOL_ID: Option<&str> = Some("us-east-1_7gfGQ0emg");

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

    /// Drift guard against the deployed stack: these are the `nixus-sync` outputs, and
    /// the shape is what distinguishes a real output from a placeholder — an identity
    /// pool id is `<region>:<uuid>`, a user pool id is `<region>_<suffix>`, and both must
    /// be in the stack's region.
    #[test]
    fn the_production_configuration_is_the_deployed_stacks_own_identifiers() {
        let config = IdentityPoolConfig::production().expect("the stack outputs are recorded");

        assert_eq!(config.region, SYNC_REGION);
        assert!(
            config
                .identity_pool_id
                .starts_with(&format!("{SYNC_REGION}:")),
            "an identity pool id is region-qualified"
        );
        assert_eq!(config.identity_pool_id.len(), SYNC_REGION.len() + 1 + 36);
        assert!(
            config.user_pool_id.starts_with(&format!("{SYNC_REGION}_")),
            "a user pool id is region-qualified"
        );
        assert_eq!(
            config.logins_provider_name(),
            format!(
                "cognito-idp.{SYNC_REGION}.amazonaws.com/{}",
                config.user_pool_id
            )
        );
    }

    /// The app client in `commands/auth.rs` and this pool must describe the same user
    /// pool: the identity pool's trust configuration pins `:aud` to that client, so a
    /// drift between the two files is an unrecognised-login failure at runtime.
    #[test]
    fn the_user_pool_region_agrees_with_the_signed_in_pools_region() {
        assert_eq!(SYNC_REGION, crate::commands::auth::COGNITO_REGION);
    }
}
