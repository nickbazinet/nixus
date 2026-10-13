//! Identity-pool credentials obtained from a call-time ID token, held only in memory,
//! and the account pin that makes a second identity refuse to sync (AD-7, inherited
//! AD-10 and the inherited "no AWS credential on a device" amendment).
//!
//! This is the **only** file in the crate that names `aws_sdk_cognitoidentity`
//! (`sync/tests_port_boundary.rs` fails the build if that stops being true), and the
//! only place sync credentials exist at all. Four properties are load-bearing.
//!
//! **The ID token is borrowed, never stored.** `commands/auth.rs` owns the session and
//! its 120-second proactive refresh; this module asks for a token at the moment it
//! needs one, through the narrow `IdTokenProvider` seam the caller injects. It cannot
//! reach the OS credential store, and `sync/tests_auth_boundary.rs` proves it.
//!
//! **Both Cognito calls are unsigned.** `GetId` and `GetCredentialsForIdentity` resolve
//! to the SDK's no-auth scheme, so the client is built from a bare
//! `aws_sdk_cognitoidentity::Config` with **no credentials provider at all** — never
//! through `aws_config`, whose job is precisely to go looking for the environment, the
//! shared profile and the instance metadata service. A machine that happens to have
//! AWS credentials configured must not be able to influence a sync request, and a
//! machine that has none must not be slowed down by a provider chain that will be
//! ignored anyway.
//!
//! **The vended credentials are unreachable from `ai/`.** They are `pub(in crate::sync)`,
//! carry no `Serialize`, redact their secrets in `Debug`, are never logged and are never
//! written to disk, to the database or to the OS credential store. Hosted AI keeps its
//! "no AWS client on the device" property because it cannot name these types.
//!
//! **The identity is pinned.** `GetId` is not a promise: a different Cognito identity, or
//! an `owner` object holding a different user-pool `sub`, means this dataset would start a
//! second source of truth under someone else's prefix. `verify_account_pin` refuses on
//! either mismatch. Persisting the pin into `sync_state` is Story 6, which implements
//! `AccountPinStore`; there is deliberately no SQL here.

use std::collections::HashMap;
use std::fmt;
use std::time::Duration;

use aws_sdk_cognitoidentity::config::retry::RetryConfig;
use aws_sdk_cognitoidentity::config::timeout::TimeoutConfig;
use aws_sdk_cognitoidentity::config::{BehaviorVersion, Region};
use aws_sdk_cognitoidentity::error::SdkError;
use aws_sdk_cognitoidentity::operation::get_credentials_for_identity::GetCredentialsForIdentityError;
use aws_sdk_cognitoidentity::operation::get_id::GetIdError;
use aws_sdk_cognitoidentity::Client;
use chrono::{DateTime, TimeDelta, Utc};

use super::config::IdentityPoolConfig;

/// How long before the 1-hour expiry a refresh is triggered. Five minutes, an order of
/// magnitude above the ID token's 120-second skew, because a sync pass is not a single
/// request: credentials handed to the object store at `T` are still in use while a
/// multi-megabyte snapshot uploads, and an expiry mid-upload costs the whole transfer.
const REFRESH_MARGIN_SECS: i64 = 300;

/// One retry at most, with the SDK's backoff. AD-16 forbids a fault degrading the app,
/// and a credential vend sits in front of every network operation: retrying it harder
/// would turn an outage into a hot loop against a billed API.
const MAX_VEND_ATTEMPTS: u32 = 2;

const VEND_ATTEMPT_TIMEOUT_SECS: u64 = 10;
const VEND_TOTAL_TIMEOUT_SECS: u64 = 25;

/// The relative object key (the adapter owns `acct/<identity-id>/`) whose body pins the
/// account's user-pool `sub`. Written create-only, so the first computer to enable sync
/// fixes the owner and every later one must agree with it (AD-7).
pub const OWNER_OBJECT_KEY: &str = "owner";

/// Which Cognito call failed. A code, not prose: diagnostics stay countable (AD-16).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VendOp {
    GetId,
    GetCredentials,
}

/// Why the identity pool could not answer, at the granularity that changes behaviour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VendorFault {
    Throttled,
    ServiceError,
    /// The pool answered, but its own configuration is wrong (no role for the
    /// authenticated flow, pool or identity absent). Retrying cannot fix it.
    PoolMisconfigured,
    /// The request never produced a modelled answer: DNS, TLS, timeout, offline.
    Unreachable,
}

/// Every way obtaining or pinning sync credentials can fail, as distinct outcomes.
/// Story 10 maps these onto `AppError::Sync { code, message, recoverable }` (AD-16).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    /// The identity pool coordinates are not compiled in yet (see `sync/config.rs`).
    Unconfigured,
    /// No usable Nixus Cloud session: sync cannot start, and this is not a fault the
    /// user needs to see as one.
    SignedOut,
    /// A session exists but could not be read or refreshed.
    Session,
    /// Cognito refused the ID token in the `Logins` map. A refresh cannot help: the
    /// token is structurally unacceptable to this pool.
    TokenRejected,
    IdentityPoolUnreachable {
        operation: VendOp,
        fault: VendorFault,
        retryable: bool,
    },
    /// A fresh vend produced credentials that are already expired — a clock
    /// disagreement, not a transport fault.
    CredentialsExpired,
    /// The pool answered without an identity id, or without one of the three
    /// credential fields. Not retryable as-is.
    IncompleteVendedCredentials,
    /// This dataset is pinned to a different account. Refuses to sync (AD-7).
    PinMismatch(PinMismatch),
    /// The `owner` object exists but does not hold a usable `sub`.
    MalformedOwnerObject,
}

impl AuthError {
    pub fn retryable(&self) -> bool {
        match self {
            AuthError::IdentityPoolUnreachable { retryable, .. } => *retryable,
            AuthError::Unconfigured
            | AuthError::SignedOut
            | AuthError::Session
            | AuthError::TokenRejected
            | AuthError::CredentialsExpired
            | AuthError::IncompleteVendedCredentials
            | AuthError::PinMismatch(_)
            | AuthError::MalformedOwnerObject => false,
        }
    }
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AuthError::Unconfigured => f.write_str("sync infrastructure is not configured"),
            AuthError::SignedOut => f.write_str("no Nixus Cloud session"),
            AuthError::Session => f.write_str("the Nixus Cloud session could not be resolved"),
            AuthError::TokenRejected => f.write_str("the identity pool rejected the ID token"),
            AuthError::IdentityPoolUnreachable {
                operation, fault, ..
            } => write!(f, "identity pool {operation:?} failed: {fault:?}"),
            AuthError::CredentialsExpired => f.write_str("the vended credentials are expired"),
            AuthError::IncompleteVendedCredentials => {
                f.write_str("the identity pool answered without complete credentials")
            }
            AuthError::PinMismatch(mismatch) => {
                write!(f, "account pin mismatch on {:?}", mismatch.field)
            }
            AuthError::MalformedOwnerObject => f.write_str("the owner object is malformed"),
        }
    }
}

impl std::error::Error for AuthError {}

/// A user-pool ID token and the `sub` claim read from that same token.
///
/// The two travel together on purpose: pinning an account against a `sub` taken from a
/// different (possibly older) session would pin the wrong owner.
#[derive(Clone)]
pub(in crate::sync) struct IdToken {
    token: String,
    subject_sub: String,
}

impl IdToken {
    pub(in crate::sync) fn new(
        token: impl Into<String>,
        subject_sub: impl Into<String>,
    ) -> Result<Self, AuthError> {
        let token = Self {
            token: token.into(),
            subject_sub: subject_sub.into(),
        };
        if token.token.is_empty() || token.subject_sub.is_empty() {
            return Err(AuthError::Session);
        }
        Ok(token)
    }

    pub(in crate::sync) fn subject_sub(&self) -> &str {
        &self.subject_sub
    }
}

/// Bearer material: the token itself never appears in a formatted string.
impl fmt::Debug for IdToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("IdToken")
            .field("token", &"<redacted>")
            .field("subject_sub", &self.subject_sub)
            .finish()
    }
}

/// The whole of sync's dependency on the signed-in session. Narrow by design: a wider
/// seam (an `AppHandle`, a session struct) would let this module grow a second way to
/// obtain a token, and the one guarantee worth having here is that there is only one.
pub(in crate::sync) trait IdTokenProvider {
    async fn id_token(&self) -> Result<IdToken, AuthError>;
}

/// The production provider: the call-time accessor in `commands/auth.rs`, which owns the
/// OS credential store access and the 120-second proactive refresh (inherited AD-10).
pub(in crate::sync) struct CommandAuthIdTokenProvider;

impl IdTokenProvider for CommandAuthIdTokenProvider {
    async fn id_token(&self) -> Result<IdToken, AuthError> {
        match crate::commands::auth::sync_id_token().await {
            Ok(crate::commands::auth::SyncIdToken::Ready {
                id_token,
                subject_sub,
            }) => IdToken::new(id_token, subject_sub),
            Ok(crate::commands::auth::SyncIdToken::SignedOut) => Err(AuthError::SignedOut),
            // The session's own error text is deliberately dropped rather than carried
            // into a sync fault: AD-16 keeps sync diagnostics to states and codes.
            Err(_) => Err(AuthError::Session),
        }
    }
}

/// Time, injectable. Distinct from `sync/clock.rs`, which is the hybrid logical clock of
/// AD-4: this one only answers "is it time to refresh?".
pub(in crate::sync) trait Clock {
    fn now(&self) -> DateTime<Utc>;
}

pub(in crate::sync) struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// 1-hour credentials scoped to this account's prefix, plus the two identifiers that pin
/// the account they belong to.
///
/// `pub(in crate::sync)` is the narrowest visibility that still lets the S3 adapter be
/// configured: nothing outside `sync/` — `ai/` above all — can name this type, so no
/// other feature can acquire an AWS credential by accident. No `Serialize`, no
/// `Display`, redacted `Debug`, and no persistence anywhere.
#[derive(Clone)]
pub(in crate::sync) struct VendedCredentials {
    pub(in crate::sync) identity_id: String,
    pub(in crate::sync) owner_sub: String,
    pub(in crate::sync) access_key_id: String,
    pub(in crate::sync) secret_access_key: String,
    pub(in crate::sync) session_token: String,
    pub(in crate::sync) expires_at: DateTime<Utc>,
}

impl VendedCredentials {
    /// What this credential set claims about the account, for comparison against the
    /// stored pin.
    pub(in crate::sync) fn pin(&self) -> AccountPin {
        AccountPin {
            identity_id: self.identity_id.clone(),
            owner_sub: self.owner_sub.clone(),
        }
    }

    pub(in crate::sync) fn is_expired(&self, now: DateTime<Utc>) -> bool {
        now >= self.expires_at
    }

    /// True once the expiry is closer than the refresh margin. Checked against an
    /// injected clock so the boundary is testable without sleeping.
    pub(in crate::sync) fn needs_refresh(&self, now: DateTime<Utc>) -> bool {
        now + TimeDelta::seconds(REFRESH_MARGIN_SECS) >= self.expires_at
    }
}

impl fmt::Debug for VendedCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("VendedCredentials")
            .field("identity_id", &self.identity_id)
            .field("owner_sub", &self.owner_sub)
            .field("expires_at", &self.expires_at)
            .field("access_key_id", &"<redacted>")
            .field("secret_access_key", &"<redacted>")
            .field("session_token", &"<redacted>")
            .finish()
    }
}

/// Where credentials come from. A trait so the cache's behaviour — margins, coalescing,
/// pinning — is tested against a counting fake, while the SDK path below is tested on its
/// own against stubbed HTTP.
pub(in crate::sync) trait CredentialVendor {
    async fn vend(&self, token: &IdToken) -> Result<VendedCredentials, AuthError>;
}

/// The enhanced-flow vendor: `GetId` then `GetCredentialsForIdentity`, both carrying the
/// same `Logins` map. The basic flow (`GetOpenIdToken` + `AssumeRoleWithWebIdentity`) is
/// disabled on the pool (AD-7) and is deliberately not implemented here.
pub(in crate::sync) struct CognitoIdentityVendor {
    client: Client,
    identity_pool_id: String,
    provider_name: String,
}

impl CognitoIdentityVendor {
    pub(in crate::sync) fn new(config: &IdentityPoolConfig) -> Self {
        // No `credentials_provider` is set, and `aws_config` is never involved: both
        // operations resolve to the no-auth scheme (see this module's header), so the
        // default chain would be consulted for nothing — or, worse, would make a
        // developer machine's profile part of the request.
        let sdk_config = aws_sdk_cognitoidentity::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(config.region.clone()))
            .retry_config(RetryConfig::standard().with_max_attempts(MAX_VEND_ATTEMPTS))
            .timeout_config(
                TimeoutConfig::builder()
                    .operation_attempt_timeout(Duration::from_secs(VEND_ATTEMPT_TIMEOUT_SECS))
                    .operation_timeout(Duration::from_secs(VEND_TOTAL_TIMEOUT_SECS))
                    .build(),
            )
            .build();

        Self::from_client(Client::from_conf(sdk_config), config)
    }

    pub(in crate::sync) fn from_client(client: Client, config: &IdentityPoolConfig) -> Self {
        Self {
            client,
            identity_pool_id: config.identity_pool_id.clone(),
            provider_name: config.logins_provider_name(),
        }
    }

    fn logins(&self, token: &IdToken) -> HashMap<String, String> {
        HashMap::from([(self.provider_name.clone(), token.token.clone())])
    }
}

impl CredentialVendor for CognitoIdentityVendor {
    async fn vend(&self, token: &IdToken) -> Result<VendedCredentials, AuthError> {
        let identity = self
            .client
            .get_id()
            .identity_pool_id(&self.identity_pool_id)
            .set_logins(Some(self.logins(token)))
            .send()
            .await
            .map_err(map_get_id_error)?;

        let identity_id = identity
            .identity_id
            .filter(|id| !id.is_empty())
            .ok_or(AuthError::IncompleteVendedCredentials)?;

        // The same `Logins` map is required again: the enhanced flow authenticates each
        // call independently, and omitting it here would vend *unauthenticated* role
        // credentials, which have no access to the account prefix at all.
        let vended = self
            .client
            .get_credentials_for_identity()
            .identity_id(&identity_id)
            .set_logins(Some(self.logins(token)))
            .send()
            .await
            .map_err(map_get_credentials_error)?;

        let credentials = vended
            .credentials
            .ok_or(AuthError::IncompleteVendedCredentials)?;

        let expires_at = credentials
            .expiration
            .and_then(|expiration| {
                DateTime::from_timestamp(expiration.secs(), expiration.subsec_nanos())
            })
            .ok_or(AuthError::IncompleteVendedCredentials)?;

        Ok(VendedCredentials {
            identity_id,
            owner_sub: token.subject_sub.clone(),
            access_key_id: non_empty(credentials.access_key_id)?,
            secret_access_key: non_empty(credentials.secret_key)?,
            session_token: non_empty(credentials.session_token)?,
            expires_at,
        })
    }
}

fn non_empty(field: Option<String>) -> Result<String, AuthError> {
    field
        .filter(|value| !value.is_empty())
        .ok_or(AuthError::IncompleteVendedCredentials)
}

/// Classified on the **typed** error variants rather than on the error code string: a
/// modelled Cognito error does not always carry error metadata, so matching codes would
/// make the mapping depend on whether the service bothered to echo one.
fn map_get_id_error(error: SdkError<GetIdError>) -> AuthError {
    let service_error = match error {
        SdkError::ServiceError(ref inner) => inner.err(),
        _ => return unreachable_pool(VendOp::GetId, VendorFault::Unreachable, true),
    };

    match service_error {
        GetIdError::NotAuthorizedException(_) | GetIdError::InvalidParameterException(_) => {
            AuthError::TokenRejected
        }
        GetIdError::TooManyRequestsException(_) => {
            unreachable_pool(VendOp::GetId, VendorFault::Throttled, true)
        }
        GetIdError::InternalErrorException(_) | GetIdError::ExternalServiceException(_) => {
            unreachable_pool(VendOp::GetId, VendorFault::ServiceError, true)
        }
        _ => unreachable_pool(VendOp::GetId, VendorFault::PoolMisconfigured, false),
    }
}

fn map_get_credentials_error(error: SdkError<GetCredentialsForIdentityError>) -> AuthError {
    let service_error = match error {
        SdkError::ServiceError(ref inner) => inner.err(),
        _ => return unreachable_pool(VendOp::GetCredentials, VendorFault::Unreachable, true),
    };

    match service_error {
        GetCredentialsForIdentityError::NotAuthorizedException(_)
        | GetCredentialsForIdentityError::InvalidParameterException(_) => AuthError::TokenRejected,
        GetCredentialsForIdentityError::TooManyRequestsException(_) => {
            unreachable_pool(VendOp::GetCredentials, VendorFault::Throttled, true)
        }
        GetCredentialsForIdentityError::InternalErrorException(_)
        | GetCredentialsForIdentityError::ExternalServiceException(_) => {
            unreachable_pool(VendOp::GetCredentials, VendorFault::ServiceError, true)
        }
        _ => unreachable_pool(VendOp::GetCredentials, VendorFault::PoolMisconfigured, false),
    }
}

fn unreachable_pool(operation: VendOp, fault: VendorFault, retryable: bool) -> AuthError {
    AuthError::IdentityPoolUnreachable {
        operation,
        fault,
        retryable,
    }
}

/// The in-memory credential holder: one vend shared by every caller, refreshed before
/// expiry, and never persisted.
///
/// Coalescing is the single `tokio::sync::Mutex` held **across** the vend. Checking the
/// cache, deciding to refresh and publishing the result are one critical section, so N
/// concurrent callers produce exactly one `GetId`/`GetCredentialsForIdentity` pair: the
/// first does the work, the rest wake up, see fresh credentials and return them. A
/// read-then-write split would instead let all N decide to refresh simultaneously, which
/// is the failure this type exists to prevent — a thundering herd against a billed API
/// every hour, each call racing to overwrite the others' result.
pub(in crate::sync) struct SyncCredentials<V, P, C> {
    vendor: V,
    provider: P,
    clock: C,
    cached: tokio::sync::Mutex<Option<VendedCredentials>>,
}

impl<V, P, C> SyncCredentials<V, P, C>
where
    V: CredentialVendor,
    P: IdTokenProvider,
    C: Clock,
{
    pub(in crate::sync) fn new(vendor: V, provider: P, clock: C) -> Self {
        Self {
            vendor,
            provider,
            clock,
            cached: tokio::sync::Mutex::new(None),
        }
    }

    pub(in crate::sync) async fn current(&self) -> Result<VendedCredentials, AuthError> {
        let mut cached = self.cached.lock().await;

        if let Some(credentials) = cached.as_ref() {
            if !credentials.needs_refresh(self.clock.now()) {
                return Ok(credentials.clone());
            }
        }

        let token = self.provider.id_token().await?;
        let fresh = self.vendor.vend(&token).await?;

        // A vend that answers with already-expired credentials means this computer's
        // clock and AWS's disagree by more than an hour. Caching them would produce one
        // vend per call forever, so it is a terminal fault instead.
        if fresh.is_expired(self.clock.now()) {
            *cached = None;
            return Err(AuthError::CredentialsExpired);
        }

        *cached = Some(fresh.clone());
        Ok(fresh)
    }

    /// Credentials whose account has been checked against the stored pin, which is the
    /// only form a caller should use for a network operation (AD-7). A first sync writes
    /// the pin; any mismatch refuses and writes nothing.
    pub(in crate::sync) async fn current_pinned<S: AccountPinStore>(
        &self,
        pins: &S,
    ) -> Result<VendedCredentials, AuthError> {
        let credentials = self.current().await?;
        let observed = credentials.pin();

        match verify_account_pin(pins.load()?.as_ref(), &observed) {
            Ok(PinOutcome::Matches) => Ok(credentials),
            Ok(PinOutcome::FirstPin) => {
                pins.store(&observed)?;
                Ok(credentials)
            }
            Err(mismatch) => {
                // Dropped rather than kept: credentials for the wrong account must not
                // stay reachable, and the next attempt has to re-observe the identity.
                *self.cached.lock().await = None;
                Err(AuthError::PinMismatch(mismatch))
            }
        }
    }

    /// Drops the cached credentials, so a dataset or session change can never let a new
    /// account inherit the previous one's vend.
    pub(in crate::sync) async fn forget(&self) {
        *self.cached.lock().await = None;
    }
}

/// The account this dataset belongs to: the Cognito identity id that owns the S3 prefix,
/// and the user-pool `sub` the `owner` object pins to it (AD-7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountPin {
    pub identity_id: String,
    pub owner_sub: String,
}

impl AccountPin {
    pub fn new(identity_id: impl Into<String>, owner_sub: impl Into<String>) -> Self {
        Self {
            identity_id: identity_id.into(),
            owner_sub: owner_sub.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinField {
    IdentityId,
    OwnerSub,
}

/// Carries which field disagreed, never the two values: an account identifier in a log
/// line is what AD-16 forbids, and the field alone is what handling differs on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PinMismatch {
    pub field: PinField,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinOutcome {
    Matches,
    /// Nothing was pinned yet: this observation becomes the pin.
    FirstPin,
}

/// Refuses on **either** field. The identity id is reported first only because it is the
/// one that decides which prefix is addressed; both are fatal, and neither is repaired
/// automatically — a mismatch means this dataset would start a second source of truth
/// under another account, which no retry can make safe.
pub fn verify_account_pin(
    stored: Option<&AccountPin>,
    observed: &AccountPin,
) -> Result<PinOutcome, PinMismatch> {
    let Some(stored) = stored else {
        return Ok(PinOutcome::FirstPin);
    };

    if stored.identity_id != observed.identity_id {
        return Err(PinMismatch {
            field: PinField::IdentityId,
        });
    }

    if stored.owner_sub != observed.owner_sub {
        return Err(PinMismatch {
            field: PinField::OwnerSub,
        });
    }

    Ok(PinOutcome::Matches)
}

/// The load/store seam for the pin. Story 6 implements it over `sync_state` in the
/// dataset's own database (AD-15); keeping it a trait is what lets the refusal logic
/// above ship, and be fully tested, with no SQL in this story.
pub trait AccountPinStore {
    fn load(&self) -> Result<Option<AccountPin>, AuthError>;
    fn store(&self, pin: &AccountPin) -> Result<(), AuthError>;
}

/// The body of the create-only `owner` object: the user-pool `sub`, as UTF-8, and
/// nothing else.
///
/// Chosen deliberately over JSON: the object's only job is to be compared, it is written
/// once and never migrated, and a bare value cannot develop a second field whose absence
/// two client versions disagree about. If the infrastructure track pins a different
/// format, this is the one function to change.
pub fn owner_object_body(owner_sub: &str) -> Vec<u8> {
    owner_sub.as_bytes().to_vec()
}

/// Tolerates surrounding whitespace (a trailing newline is what any hand-written or
/// console-uploaded object would carry) but refuses anything that is not a usable `sub`:
/// an unreadable owner object must not be mistaken for an absent one.
pub fn owner_sub_from_body(body: &[u8]) -> Result<String, AuthError> {
    let text = std::str::from_utf8(body).map_err(|_| AuthError::MalformedOwnerObject)?;
    let owner_sub = text.trim();
    if owner_sub.is_empty() {
        return Err(AuthError::MalformedOwnerObject);
    }
    Ok(owner_sub.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aws_sdk_cognitoidentity::operation::get_credentials_for_identity::GetCredentialsForIdentityOutput;
    use aws_sdk_cognitoidentity::operation::get_id::GetIdOutput;
    use aws_sdk_cognitoidentity::types::error::{
        InternalErrorException, NotAuthorizedException, ResourceNotFoundException,
    };
    use aws_sdk_cognitoidentity::types::Credentials as CognitoCredentials;
    use aws_smithy_mocks::{mock, Rule, RuleMode};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    const POOL: &str = "us-east-1:00000000-1111-2222-3333-444444444444";
    const USER_POOL: &str = "us-east-1_ABCdef123";
    const PROVIDER: &str = "cognito-idp.us-east-1.amazonaws.com/us-east-1_ABCdef123";
    const IDENTITY: &str = "us-east-1:11111111-2222-3333-4444-555555555555";
    const SUB: &str = "a1b2c3-sub";
    const TOKEN: &str = "header.payload.signature";

    fn pool_config() -> IdentityPoolConfig {
        IdentityPoolConfig::new(POOL, "us-east-1", USER_POOL).expect("a complete configuration")
    }

    fn id_token() -> IdToken {
        IdToken::new(TOKEN, SUB).expect("a usable token")
    }

    fn at(unix_secs: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(unix_secs, 0).expect("a valid timestamp")
    }

    fn vendor(rules: Vec<&Rule>) -> CognitoIdentityVendor {
        let mut interceptor =
            aws_smithy_mocks::MockResponseInterceptor::new().rule_mode(RuleMode::MatchAny);
        for rule in rules {
            interceptor = interceptor.with_rule(rule);
        }
        let config = aws_sdk_cognitoidentity::Config::builder()
            .with_test_defaults()
            .region(Region::new("us-east-1"))
            // Story 4's trap, and the reason these tests are trustworthy: the
            // interceptor alone stubs responses but leaves the real connector in place,
            // so an unmatched request would reach the live Cognito endpoint.
            .http_client(aws_smithy_mocks::create_mock_http_client())
            // A modelled retryable fault would otherwise be retried with real backoff,
            // which these tests neither assert nor want to wait for.
            .retry_config(RetryConfig::disabled())
            .interceptor(interceptor)
            .build();

        CognitoIdentityVendor::from_client(Client::from_conf(config), &pool_config())
    }

    fn identity_output() -> GetIdOutput {
        GetIdOutput::builder().identity_id(IDENTITY).build()
    }

    fn vended_output(expiry_secs: i64) -> GetCredentialsForIdentityOutput {
        GetCredentialsForIdentityOutput::builder()
            .identity_id(IDENTITY)
            .credentials(
                CognitoCredentials::builder()
                    .access_key_id("ASIAEXAMPLE")
                    .secret_key("secret-example")
                    .session_token("session-example")
                    .expiration(aws_sdk_cognitoidentity::primitives::DateTime::from_secs(
                        expiry_secs,
                    ))
                    .build(),
            )
            .build()
    }

    #[tokio::test]
    async fn the_enhanced_flow_sends_the_fresh_id_token_as_the_logins_entry_of_both_calls() {
        let get_id = mock!(Client::get_id)
            .match_requests(|request| {
                request.identity_pool_id() == Some(POOL)
                    && request.logins().and_then(|logins| logins.get(PROVIDER))
                        == Some(&TOKEN.to_string())
            })
            .then_output(identity_output);
        let get_credentials = mock!(Client::get_credentials_for_identity)
            .match_requests(|request| {
                request.identity_id() == Some(IDENTITY)
                    && request.logins().and_then(|logins| logins.get(PROVIDER))
                        == Some(&TOKEN.to_string())
            })
            .then_output(|| vended_output(1_700_003_600));

        let credentials = vendor(vec![&get_id, &get_credentials])
            .vend(&id_token())
            .await
            .expect("the enhanced flow vends credentials");

        assert_eq!(credentials.identity_id, IDENTITY);
        assert_eq!(credentials.owner_sub, SUB);
        assert_eq!(credentials.access_key_id, "ASIAEXAMPLE");
        assert_eq!(credentials.secret_access_key, "secret-example");
        assert_eq!(credentials.session_token, "session-example");
        assert_eq!(credentials.expires_at, at(1_700_003_600));
        assert_eq!(get_id.num_calls(), 1);
        assert_eq!(get_credentials.num_calls(), 1);
    }

    #[tokio::test]
    async fn a_rejected_id_token_is_not_reported_as_an_outage() {
        let get_id = mock!(Client::get_id).then_error(|| {
            GetIdError::NotAuthorizedException(NotAuthorizedException::builder().build())
        });

        let error = vendor(vec![&get_id])
            .vend(&id_token())
            .await
            .expect_err("a refused token fails the vend");

        assert_eq!(error, AuthError::TokenRejected);
        assert!(!error.retryable());
    }

    #[tokio::test]
    async fn a_service_fault_on_the_second_call_is_retryable_and_names_that_call() {
        let get_id = mock!(Client::get_id).then_output(identity_output);
        let get_credentials = mock!(Client::get_credentials_for_identity).then_error(|| {
            GetCredentialsForIdentityError::InternalErrorException(
                InternalErrorException::builder().build(),
            )
        });

        let error = vendor(vec![&get_id, &get_credentials])
            .vend(&id_token())
            .await
            .expect_err("a service fault fails the vend");

        assert_eq!(
            error,
            AuthError::IdentityPoolUnreachable {
                operation: VendOp::GetCredentials,
                fault: VendorFault::ServiceError,
                retryable: true,
            }
        );
        assert!(error.retryable());
    }

    #[tokio::test]
    async fn a_missing_pool_is_a_configuration_fault_and_is_not_retried() {
        let get_id = mock!(Client::get_id).then_error(|| {
            GetIdError::ResourceNotFoundException(ResourceNotFoundException::builder().build())
        });

        let error = vendor(vec![&get_id])
            .vend(&id_token())
            .await
            .expect_err("a missing pool fails the vend");

        assert_eq!(
            error,
            AuthError::IdentityPoolUnreachable {
                operation: VendOp::GetId,
                fault: VendorFault::PoolMisconfigured,
                retryable: false,
            }
        );
        assert!(!error.retryable());
    }

    #[tokio::test]
    async fn credentials_without_a_session_token_are_refused_rather_than_half_used() {
        let get_id = mock!(Client::get_id).then_output(identity_output);
        let get_credentials = mock!(Client::get_credentials_for_identity).then_output(|| {
            GetCredentialsForIdentityOutput::builder()
                .identity_id(IDENTITY)
                .credentials(
                    CognitoCredentials::builder()
                        .access_key_id("ASIAEXAMPLE")
                        .secret_key("secret-example")
                        .expiration(aws_sdk_cognitoidentity::primitives::DateTime::from_secs(
                            1_700_003_600,
                        ))
                        .build(),
                )
                .build()
        });

        let error = vendor(vec![&get_id, &get_credentials])
            .vend(&id_token())
            .await
            .expect_err("incomplete credentials fail the vend");

        assert_eq!(error, AuthError::IncompleteVendedCredentials);
    }

    #[test]
    fn neither_the_id_token_nor_the_secret_material_can_reach_a_log_line() {
        let credentials = VendedCredentials {
            identity_id: IDENTITY.to_string(),
            owner_sub: SUB.to_string(),
            access_key_id: "ASIAEXAMPLE".to_string(),
            secret_access_key: "secret-example".to_string(),
            session_token: "session-example".to_string(),
            expires_at: at(1_700_003_600),
        };

        let rendered = format!("{credentials:?}");
        for secret in ["ASIAEXAMPLE", "secret-example", "session-example"] {
            assert!(
                !rendered.contains(secret),
                "{secret} leaked into the Debug output"
            );
        }
        assert!(rendered.contains(IDENTITY), "the identity id stays visible");
        assert!(!format!("{:?}", id_token()).contains(TOKEN));
    }

    /// Counts vends and reports the expiry it is told to, so the cache's margin,
    /// coalescing and refusal behaviour are observable without a network or a sleep.
    struct FakeVendor {
        calls: AtomicUsize,
        expiries: Mutex<Vec<i64>>,
        delay: Option<Duration>,
    }

    impl FakeVendor {
        fn new(expiries: Vec<i64>) -> Self {
            Self {
                calls: AtomicUsize::new(0),
                expiries: Mutex::new(expiries),
                delay: None,
            }
        }

        fn with_delay(mut self, delay: Duration) -> Self {
            self.delay = Some(delay);
            self
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl CredentialVendor for FakeVendor {
        async fn vend(&self, token: &IdToken) -> Result<VendedCredentials, AuthError> {
            if let Some(delay) = self.delay {
                tokio::time::sleep(delay).await;
            }
            self.calls.fetch_add(1, Ordering::SeqCst);

            let expires_at = {
                let mut expiries = self.expiries.lock().expect("not poisoned");
                if expiries.len() > 1 {
                    expiries.remove(0)
                } else {
                    expiries[0]
                }
            };

            Ok(VendedCredentials {
                identity_id: IDENTITY.to_string(),
                owner_sub: token.subject_sub().to_string(),
                access_key_id: "ASIAEXAMPLE".to_string(),
                secret_access_key: "secret-example".to_string(),
                session_token: "session-example".to_string(),
                expires_at: at(expires_at),
            })
        }
    }

    struct FakeProvider {
        sub: String,
        calls: AtomicUsize,
    }

    impl FakeProvider {
        fn new(sub: &str) -> Self {
            Self {
                sub: sub.to_string(),
                calls: AtomicUsize::new(0),
            }
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl IdTokenProvider for FakeProvider {
        async fn id_token(&self) -> Result<IdToken, AuthError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            IdToken::new(TOKEN, self.sub.clone())
        }
    }

    struct SignedOutProvider;

    impl IdTokenProvider for SignedOutProvider {
        async fn id_token(&self) -> Result<IdToken, AuthError> {
            Err(AuthError::SignedOut)
        }
    }

    struct FakeClock {
        now: Mutex<DateTime<Utc>>,
    }

    impl FakeClock {
        fn at(unix_secs: i64) -> Self {
            Self {
                now: Mutex::new(at(unix_secs)),
            }
        }

        fn set(&self, unix_secs: i64) {
            *self.now.lock().expect("not poisoned") = at(unix_secs);
        }
    }

    impl Clock for FakeClock {
        fn now(&self) -> DateTime<Utc> {
            *self.now.lock().expect("not poisoned")
        }
    }

    struct FakePinStore {
        pin: Mutex<Option<AccountPin>>,
    }

    impl FakePinStore {
        fn empty() -> Self {
            Self {
                pin: Mutex::new(None),
            }
        }

        fn pinned(pin: AccountPin) -> Self {
            Self {
                pin: Mutex::new(Some(pin)),
            }
        }

        fn stored(&self) -> Option<AccountPin> {
            self.pin.lock().expect("not poisoned").clone()
        }
    }

    impl AccountPinStore for FakePinStore {
        fn load(&self) -> Result<Option<AccountPin>, AuthError> {
            Ok(self.stored())
        }

        fn store(&self, pin: &AccountPin) -> Result<(), AuthError> {
            *self.pin.lock().expect("not poisoned") = Some(pin.clone());
            Ok(())
        }
    }

    #[tokio::test]
    async fn credentials_are_vended_once_and_reused_while_they_are_fresh() {
        let credentials = SyncCredentials::new(
            FakeVendor::new(vec![1_700_003_600]),
            FakeProvider::new(SUB),
            FakeClock::at(1_700_000_000),
        );

        credentials.current().await.expect("vends");
        credentials.current().await.expect("reuses the cache");

        assert_eq!(credentials.vendor.calls(), 1);
        assert_eq!(credentials.provider.calls(), 1);
    }

    #[tokio::test]
    async fn the_refresh_margin_is_what_decides_a_second_vend() {
        let expiry = 1_700_003_600;
        let credentials = SyncCredentials::new(
            FakeVendor::new(vec![expiry, expiry + 3_600]),
            FakeProvider::new(SUB),
            FakeClock::at(1_700_000_000),
        );

        credentials.current().await.expect("vends");

        credentials.clock.set(expiry - REFRESH_MARGIN_SECS - 1);
        credentials.current().await.expect("reuses the cache");
        assert_eq!(credentials.vendor.calls(), 1);

        credentials.clock.set(expiry - REFRESH_MARGIN_SECS);
        let refreshed = credentials.current().await.expect("refreshes");
        assert_eq!(credentials.vendor.calls(), 2);
        assert_eq!(
            refreshed.expires_at,
            at(expiry + 3_600),
            "the refreshed credentials, not the cached ones, are returned"
        );
    }

    #[tokio::test]
    async fn expired_credentials_are_replaced_rather_than_handed_out() {
        let credentials = SyncCredentials::new(
            FakeVendor::new(vec![1_700_003_600, 1_700_010_000]),
            FakeProvider::new(SUB),
            FakeClock::at(1_700_000_000),
        );

        credentials.current().await.expect("vends");
        credentials.clock.set(1_700_004_000);

        let refreshed = credentials.current().await.expect("refreshes");

        assert_eq!(refreshed.expires_at, at(1_700_010_000));
        assert_eq!(credentials.vendor.calls(), 2);
    }

    #[tokio::test]
    async fn a_vend_that_answers_with_already_expired_credentials_is_a_terminal_fault() {
        let credentials = SyncCredentials::new(
            FakeVendor::new(vec![1_700_000_000]),
            FakeProvider::new(SUB),
            FakeClock::at(1_700_000_001),
        );

        let error = credentials
            .current()
            .await
            .expect_err("expired credentials are refused");

        assert_eq!(error, AuthError::CredentialsExpired);
        assert_eq!(credentials.vendor.calls(), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_callers_coalesce_onto_one_vend() {
        let credentials = std::sync::Arc::new(SyncCredentials::new(
            FakeVendor::new(vec![1_700_003_600]).with_delay(Duration::from_millis(50)),
            FakeProvider::new(SUB),
            FakeClock::at(1_700_000_000),
        ));

        let mut callers = Vec::new();
        for _ in 0..8 {
            let credentials = std::sync::Arc::clone(&credentials);
            callers.push(tokio::spawn(async move { credentials.current().await }));
        }
        for caller in callers {
            caller
                .await
                .expect("the task completes")
                .expect("every caller gets credentials");
        }

        assert_eq!(credentials.vendor.calls(), 1);
        assert_eq!(credentials.provider.calls(), 1);
    }

    #[tokio::test]
    async fn a_signed_out_session_is_a_distinct_outcome_from_a_pool_fault() {
        let credentials = SyncCredentials::new(
            FakeVendor::new(vec![1_700_003_600]),
            SignedOutProvider,
            FakeClock::at(1_700_000_000),
        );

        assert_eq!(
            credentials.current().await.expect_err("no session"),
            AuthError::SignedOut
        );
        assert_eq!(credentials.vendor.calls(), 0);
    }

    #[tokio::test]
    async fn the_first_sync_pins_the_observed_identity_and_owner() {
        let pins = FakePinStore::empty();
        let credentials = SyncCredentials::new(
            FakeVendor::new(vec![1_700_003_600]),
            FakeProvider::new(SUB),
            FakeClock::at(1_700_000_000),
        );

        credentials
            .current_pinned(&pins)
            .await
            .expect("the first pin succeeds");

        assert_eq!(pins.stored(), Some(AccountPin::new(IDENTITY, SUB)));
    }

    #[tokio::test]
    async fn a_matching_pin_leaves_the_stored_one_alone() {
        let pins = FakePinStore::pinned(AccountPin::new(IDENTITY, SUB));
        let credentials = SyncCredentials::new(
            FakeVendor::new(vec![1_700_003_600]),
            FakeProvider::new(SUB),
            FakeClock::at(1_700_000_000),
        );

        credentials
            .current_pinned(&pins)
            .await
            .expect("a matching pin syncs");

        assert_eq!(pins.stored(), Some(AccountPin::new(IDENTITY, SUB)));
    }

    #[tokio::test]
    async fn a_different_identity_id_refuses_to_sync_and_drops_the_credentials() {
        let pins = FakePinStore::pinned(AccountPin::new("us-east-1:other-identity", SUB));
        let credentials = SyncCredentials::new(
            FakeVendor::new(vec![1_700_003_600]),
            FakeProvider::new(SUB),
            FakeClock::at(1_700_000_000),
        );

        let error = credentials
            .current_pinned(&pins)
            .await
            .expect_err("a different identity refuses");

        assert_eq!(
            error,
            AuthError::PinMismatch(PinMismatch {
                field: PinField::IdentityId
            })
        );
        assert!(!error.retryable());
        assert_eq!(
            pins.stored(),
            Some(AccountPin::new("us-east-1:other-identity", SUB)),
            "a refusal never overwrites the pin"
        );

        credentials
            .current()
            .await
            .expect("the dropped cache forces a fresh observation");
        assert_eq!(credentials.vendor.calls(), 2);
    }

    #[tokio::test]
    async fn a_different_owner_sub_under_the_same_identity_refuses_to_sync() {
        let pins = FakePinStore::pinned(AccountPin::new(IDENTITY, "someone-elses-sub"));
        let credentials = SyncCredentials::new(
            FakeVendor::new(vec![1_700_003_600]),
            FakeProvider::new(SUB),
            FakeClock::at(1_700_000_000),
        );

        let error = credentials
            .current_pinned(&pins)
            .await
            .expect_err("a different owner refuses");

        assert_eq!(
            error,
            AuthError::PinMismatch(PinMismatch {
                field: PinField::OwnerSub
            })
        );
    }

    #[tokio::test]
    async fn forgetting_the_credentials_forces_the_next_caller_to_vend_again() {
        let credentials = SyncCredentials::new(
            FakeVendor::new(vec![1_700_003_600]),
            FakeProvider::new(SUB),
            FakeClock::at(1_700_000_000),
        );

        credentials.current().await.expect("vends");
        credentials.forget().await;
        credentials.current().await.expect("vends again");

        assert_eq!(credentials.vendor.calls(), 2);
    }

    #[test]
    fn nothing_pinned_yet_is_a_first_pin_rather_than_a_match() {
        assert_eq!(
            verify_account_pin(None, &AccountPin::new(IDENTITY, SUB)),
            Ok(PinOutcome::FirstPin)
        );
    }

    #[test]
    fn an_identical_observation_matches() {
        let pin = AccountPin::new(IDENTITY, SUB);
        assert_eq!(verify_account_pin(Some(&pin), &pin), Ok(PinOutcome::Matches));
    }

    #[test]
    fn each_field_of_the_pin_is_refused_on_its_own() {
        let stored = AccountPin::new(IDENTITY, SUB);

        assert_eq!(
            verify_account_pin(Some(&stored), &AccountPin::new("us-east-1:other", SUB)),
            Err(PinMismatch {
                field: PinField::IdentityId
            })
        );
        assert_eq!(
            verify_account_pin(Some(&stored), &AccountPin::new(IDENTITY, "other-sub")),
            Err(PinMismatch {
                field: PinField::OwnerSub
            })
        );
        assert_eq!(
            verify_account_pin(
                Some(&stored),
                &AccountPin::new("us-east-1:other", "other-sub")
            ),
            Err(PinMismatch {
                field: PinField::IdentityId
            })
        );
    }

    #[test]
    fn the_owner_object_round_trips_and_tolerates_a_trailing_newline() {
        assert_eq!(owner_object_body(SUB), SUB.as_bytes());
        assert_eq!(
            owner_sub_from_body(&owner_object_body(SUB)).expect("round trips"),
            SUB
        );
        assert_eq!(
            owner_sub_from_body(format!("{SUB}\n").as_bytes()).expect("tolerates whitespace"),
            SUB
        );
    }

    #[test]
    fn an_unreadable_owner_object_is_never_mistaken_for_an_absent_one() {
        for body in [b"".as_slice(), b"   \n".as_slice(), &[0xff, 0xfe][..]] {
            assert_eq!(
                owner_sub_from_body(body),
                Err(AuthError::MalformedOwnerObject)
            );
        }
    }

    #[test]
    fn a_token_without_a_subject_is_refused_before_any_call() {
        assert_eq!(IdToken::new("", SUB).unwrap_err(), AuthError::Session);
        assert_eq!(IdToken::new(TOKEN, "").unwrap_err(), AuthError::Session);
    }
}
