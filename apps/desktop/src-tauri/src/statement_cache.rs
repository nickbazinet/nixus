//! The on-disk entitlement statement cache and the one production call site of
//! `entitlements::verify_entitlement_statement` (billing AD-9, AD-10).
//!
//! Three properties are load-bearing, and each is a separate failure this module prevents:
//!
//! 1. **Verification is offline and fails closed.** The bytes on disk are a *cache*, never an
//!    authority: every read re-verifies against the embedded trusted-key set, this device's clock
//!    and the persisted high-water mark. A statement that is expired, tampered, bound to another
//!    `sub`, or signed by an unknown or no-longer-trusted `key_id` grants **nothing**. Last-known
//!    status may be displayed; it never authorizes. `TRUSTED_STATEMENT_KEYS` ships empty, so today
//!    every statement is refused with `UnknownKeyId` — the correct answer, and the reason this
//!    module is tested under both an empty and a populated key set.
//! 2. **The `iat` high-water mark is monotonic and outlives the statement.** It is persisted
//!    beside the statement but is *not* cleared with it, so a sign-out followed by restoring an
//!    older statement file and rewinding the device clock cannot re-admit a superseded grant. The
//!    only thing that moves the mark is a statement that verified, and only upwards.
//! 3. **Every entry is bound to its subject**, exactly as `ai::hosted_state` is. The file is named
//!    for the Cognito `sub` it belongs to *and* records that `sub` inside, and a mismatch on
//!    either is a miss — so a sign-out / sign-in-as-someone-else cycle cannot leak one account's
//!    entitlement to another, whether the mismatch comes from a stale process, a copied file or a
//!    hand-edited document.
//!
//! The statement is written only from a billing API response, through `billing_client` — this
//! module holds no HTTP client of its own and no credential.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::billing_client::{self, BillingRefusal};
use crate::entitlements::{
    self, AccountCapabilities, EntitlementStatementClaims, StatementRejection,
    TRUSTED_STATEMENT_KEYS,
};
use crate::error::AppError;

/// The document version. A version this build does not recognise reads as a miss and is left in
/// place: it is not corrupt, and a newer build may still own it.
pub(crate) const CACHE_SCHEMA_VERSION: u32 = 1;

/// How long a revalidation attempt holds, mirroring `ai::hosted_state`'s status TTL so the
/// statement and the quota figures are never more than one window apart (AD-9's "revalidation
/// happens on app start, on sign-in, and on the existing hosted-status cache TTL").
const REVALIDATION_TTL: Duration = Duration::from_secs(300);

/// Where every account's cached statement lives: a sibling of `profiles/`, keyed the same way and
/// written through the same atomic-write helper, so there is one on-disk persistence mechanism in
/// the crate rather than a second one invented here.
pub(crate) fn entitlements_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("entitlements")
}

/// Resolved once at startup, because the gate this feeds — `entitlements::account_capabilities` —
/// has no `AppHandle` to resolve it from and must keep its exact signature so `sync/gate.rs`'s
/// `CapabilitySource` is unchanged. Same shape as `credentials::install_store`.
static CACHE_ROOT: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn install_root(app_data_dir: &Path) {
    let _ = CACHE_ROOT.set(entitlements_dir(app_data_dir));
}

/// `None` before `install_root` has run, which is the only state in which the capability source
/// cannot answer. Denying is correct for it: an unresolvable cache grants nothing.
pub(crate) fn installed_dir() -> Option<&'static Path> {
    CACHE_ROOT.get().map(PathBuf::as_path)
}

fn statement_path(dir: &Path, sub: &str) -> PathBuf {
    dir.join(format!("{sub}.json"))
}

/// The cached document.
///
/// `statement` is `Option` rather than the file being deleted on sign-out, which is the whole
/// mechanism behind property 2 in this module's header: the document survives so the high-water
/// mark survives with it.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedDocument {
    schema_version: u32,
    subject_sub: String,
    statement: Option<String>,
    iat_high_water_mark: i64,
}

impl CachedDocument {
    fn empty_for(sub: &str) -> Self {
        Self {
            schema_version: CACHE_SCHEMA_VERSION,
            subject_sub: sub.to_string(),
            statement: None,
            iat_high_water_mark: 0,
        }
    }
}

/// What the cache can say about an account's entitlement right now.
///
/// Three variants rather than `Option`, because the difference between the last two is a product
/// decision, not a detail: a `Refused` statement is a *verifiable answer this device holds* and a
/// `Missing` one is the absence of any answer. Only `Verified` authorizes anything, and only a
/// `Verified` statement with an empty grant may invite an upgrade — "could not reach the server"
/// never may (AD-9).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum CachedEntitlement {
    Verified(EntitlementStatementClaims),
    /// Never fetched, cleared on sign-out, unreadable, or written for a different subject.
    Missing,
    Refused(StatementRejection),
}

impl CachedEntitlement {
    /// The grant, which is `empty()` for everything but a verified statement.
    pub(crate) fn capabilities(&self) -> AccountCapabilities {
        match self {
            Self::Verified(claims) => AccountCapabilities::from_verified_statement(claims),
            Self::Missing | Self::Refused(_) => AccountCapabilities::empty(),
        }
    }

    /// Whether this answer came from the server and is trustworthy enough to offer an upgrade
    /// against. A verified statement is, whatever it grants; an unreachable server is not, and an
    /// unverifiable one is not either.
    pub(crate) fn is_server_answer(&self) -> bool {
        match self {
            Self::Verified(_) => true,
            // An ordinary lapse of a statement that *was* genuine: it may be displayed as
            // last-known status, but it is no longer a current answer to act on.
            Self::Missing | Self::Refused(_) => false,
        }
    }

    /// The opaque tier label a current verified statement carried, for display and support only
    /// (AD-13). `None` for every other answer, because there is no current answer to label.
    pub(crate) fn tier(&self) -> Option<String> {
        match self {
            Self::Verified(claims) => Some(claims.tier.clone()),
            Self::Missing | Self::Refused(_) => None,
        }
    }
}

/// Reads the document, mutating nothing. A document that cannot be parsed, carries an unknown
/// `schema_version`, or names a different subject than its own filename reads as absent and is
/// **left in place**: it is not this path's business to delete the only copy of anything.
fn load(dir: &Path, sub: &str) -> Option<CachedDocument> {
    let raw = std::fs::read_to_string(statement_path(dir, sub)).ok()?;

    // The document body is never interpolated into a log or an error: it carries the signed
    // statement, which AD-14 forbids logging.
    let document: CachedDocument = match serde_json::from_str(&raw) {
        Ok(document) => document,
        Err(_) => {
            warn!("An entitlement statement document could not be parsed; ignoring it");
            return None;
        }
    };

    if document.schema_version != CACHE_SCHEMA_VERSION {
        warn!(
            "An entitlement statement document has unrecognized schema_version {}; ignoring it",
            document.schema_version
        );
        return None;
    }

    if document.subject_sub != sub {
        warn!("An entitlement statement document is bound to another account; ignoring it");
        return None;
    }

    Some(document)
}

fn write(dir: &Path, sub: &str, document: &CachedDocument) -> Result<(), AppError> {
    crate::profile_store::validate_sub(sub)?;

    crate::json_store::write_json_atomic(&statement_path(dir, sub), document)
}

/// The persisted high-water mark, which is `0` for an account this device has never verified one
/// for. Read separately from the statement because a cleared cache still has one.
fn high_water_mark(dir: &Path, sub: &str) -> i64 {
    load(dir, sub)
        .map(|document| document.iat_high_water_mark)
        .unwrap_or(0)
}

/// The cache's answer for `sub` at `now_unix_seconds`, verified against `trusted_keys`.
///
/// The trusted set is a parameter so the whole of AD-9's refusal surface is exercised at this
/// boundary — not only at the verifier's — under both the empty set this build ships and a
/// populated one. Production always passes `TRUSTED_STATEMENT_KEYS`.
pub(crate) fn read_with(
    dir: &Path,
    sub: &str,
    trusted_keys: &[entitlements::TrustedKey],
    now_unix_seconds: i64,
) -> CachedEntitlement {
    if crate::profile_store::validate_sub(sub).is_err() {
        return CachedEntitlement::Missing;
    }

    let Some(document) = load(dir, sub) else {
        return CachedEntitlement::Missing;
    };
    let Some(statement) = document.statement.as_deref() else {
        return CachedEntitlement::Missing;
    };

    match entitlements::verify_entitlement_statement(
        statement,
        sub,
        trusted_keys,
        now_unix_seconds,
        document.iat_high_water_mark,
    ) {
        Ok(claims) => CachedEntitlement::Verified(claims),
        Err(rejection) => CachedEntitlement::Refused(rejection),
    }
}

pub(crate) fn read(dir: &Path, sub: &str, now_unix_seconds: i64) -> CachedEntitlement {
    read_with(dir, sub, TRUSTED_STATEMENT_KEYS, now_unix_seconds)
}

/// Stores a statement the billing API answered with, and advances the high-water mark **only**
/// when it verifies.
///
/// The two halves are deliberately independent. The bytes are kept whatever they are, so a
/// surface can display last-known status and so the shipped empty-key-set build still records the
/// server's answer. The mark moves only on a statement this device actually verified, so nothing
/// an attacker can write to the file can raise the floor a later statement has to clear.
///
/// Returns the answer the stored statement now yields, so a caller never has to re-read.
pub(crate) fn store_with(
    dir: &Path,
    sub: &str,
    statement: &str,
    trusted_keys: &[entitlements::TrustedKey],
    now_unix_seconds: i64,
) -> CachedEntitlement {
    if crate::profile_store::validate_sub(sub).is_err() {
        return CachedEntitlement::Missing;
    }

    let previous_mark = high_water_mark(dir, sub);
    let verified = entitlements::verify_entitlement_statement(
        statement,
        sub,
        trusted_keys,
        now_unix_seconds,
        previous_mark,
    );

    let mark = match &verified {
        // `max` rather than assignment: the verifier already refuses an `iat` below the mark, so
        // this cannot lower it, and saying so here means a future verifier change cannot either.
        Ok(claims) => previous_mark.max(claims.iat),
        Err(_) => previous_mark,
    };

    let document = CachedDocument {
        schema_version: CACHE_SCHEMA_VERSION,
        subject_sub: sub.to_string(),
        statement: Some(statement.to_string()),
        iat_high_water_mark: mark,
    };

    if let Err(error) = write(dir, sub, &document) {
        warn!("The entitlement statement could not be cached: {}", error);
    }

    match verified {
        Ok(claims) => CachedEntitlement::Verified(claims),
        Err(rejection) => CachedEntitlement::Refused(rejection),
    }
}

pub(crate) fn store(
    dir: &Path,
    sub: &str,
    statement: &str,
    now_unix_seconds: i64,
) -> CachedEntitlement {
    store_with(
        dir,
        sub,
        statement,
        TRUSTED_STATEMENT_KEYS,
        now_unix_seconds,
    )
}

/// Drops the statement on sign-out, on session expiry, and on a subject mismatch — and KEEPS the
/// high-water mark, which is what stops the clear from being a reset an attacker can ask for.
///
/// An absent document is success: the clear may be a retry, or the account may never have had one.
pub(crate) fn clear(dir: &Path, sub: &str) {
    if crate::profile_store::validate_sub(sub).is_err() {
        return;
    }

    let mut document = load(dir, sub).unwrap_or_else(|| CachedDocument::empty_for(sub));
    if document.statement.is_none() && !statement_path(dir, sub).exists() {
        return;
    }

    document.statement = None;
    if let Err(error) = write(dir, sub, &document) {
        warn!(
            "The cached entitlement statement could not be cleared: {}",
            error
        );
    }
}

/// When each subject was last asked. Process-global, so the first call of a process is always due
/// — which is what makes "revalidate on app start" and "revalidate on sign-in" fall out of the
/// same rule as the TTL rather than needing three separate triggers.
static LAST_ATTEMPT: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn take_attempt_slot(sub: &str, now: Instant) -> bool {
    let mut guard = match LAST_ATTEMPT.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let due = match guard.as_ref() {
        // A different subject is always due: this is the sign-in trigger.
        Some((subject, _)) if subject != sub => true,
        Some((_, attempted_at)) => now.saturating_duration_since(*attempted_at) >= REVALIDATION_TTL,
        None => true,
    };

    if due {
        // Marked BEFORE the request, so a server that is down is asked once per window rather
        // than once per capability check.
        *guard = Some((sub.to_string(), now));
    }

    due
}

#[cfg(test)]
fn forget_attempts() {
    let mut guard = match LAST_ATTEMPT.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = None;
}

/// Fetches a fresh statement and caches it, mapping the refusals that mean "this device holds no
/// usable session" onto a clear.
///
/// A forced upgrade and a transient failure both LEAVE the cache alone: the first is a statement
/// about this build, not about the account, and the second is a statement about the network.
/// Clearing on either would turn an outage into a capability loss.
pub(crate) async fn revalidate(dir: &Path, sub: &str) -> CachedEntitlement {
    let now = chrono::Utc::now().timestamp();

    match billing_client::get_entitlement(sub).await {
        Ok(wire) => {
            let answer = store(dir, sub, &wire.statement, now);
            info!(
                "Revalidated the entitlement statement (verified={})",
                matches!(answer, CachedEntitlement::Verified(_))
            );
            answer
        }
        Err(BillingRefusal::SignedOut | BillingRefusal::ReauthenticationRequired) => {
            clear(dir, sub);
            info!("The entitlement statement was dropped with its session");
            CachedEntitlement::Missing
        }
        Err(refusal) => {
            info!(
                "An entitlement revalidation did not complete ({:?})",
                refusal
            );
            read(dir, sub, now)
        }
    }
}

/// AD-9's revalidation schedule, as one rule: the first call of a process, the first call for a
/// newly signed-in subject, and then once per TTL.
pub(crate) async fn revalidate_if_due(dir: &Path, sub: &str) {
    if take_attempt_slot(sub, Instant::now()) {
        revalidate(dir, sub).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine as _;
    use p256::ecdsa::signature::Signer as _;
    use p256::ecdsa::{Signature, SigningKey};
    use p256::pkcs8::EncodePublicKey as _;
    use tempfile::TempDir;

    use crate::entitlements::{
        TrustedKey, ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS, ENTITLEMENT_STATEMENT_PREFIX,
        ENTITLEMENT_STATEMENT_TTL_SECONDS, HOSTED_AI, HOUSEHOLD_NET_WORTH, MULTI_DEVICE_SYNC,
    };

    const NOW: i64 = 1_800_000_000;
    const TEST_KEY_ID: &str = "test-key-1";
    const SUBJECT_A: &str = "11111111-2222-3333-4444-555555555555";
    const SUBJECT_B: &str = "99999999-2222-3333-4444-555555555555";

    fn dir(root: &TempDir) -> PathBuf {
        entitlements_dir(root.path())
    }

    fn signing_key() -> SigningKey {
        SigningKey::from_slice(&[0x11; 32]).expect("the fixed scalar is a valid P-256 key")
    }

    fn trusted_key(key: &SigningKey, key_id: &'static str, not_after: i64) -> TrustedKey {
        let der = key
            .verifying_key()
            .to_public_key_der()
            .expect("the verifying key encodes as SPKI")
            .as_bytes()
            .to_vec();

        TrustedKey {
            key_id,
            public_key_der: Box::leak(der.into_boxed_slice()),
            not_after,
        }
    }

    fn trusted_set() -> Vec<TrustedKey> {
        vec![trusted_key(&signing_key(), TEST_KEY_ID, NOW + 86_400)]
    }

    /// A claim set as JSON, so a test can state a malformed one the Rust struct could not hold.
    fn claims_json(sub: &str, capabilities: &[&str], iat: i64, exp: i64, key_id: &str) -> String {
        serde_json::json!({
            "sub": sub,
            "tier": "advance",
            "capabilities": capabilities,
            "monthly_request_limit": 500,
            "iat": iat,
            "exp": exp,
            "key_id": key_id,
        })
        .to_string()
    }

    fn sign(key: &SigningKey, claims: &str) -> String {
        let payload = URL_SAFE_NO_PAD.encode(claims);
        let signing_input = format!("{ENTITLEMENT_STATEMENT_PREFIX}.{payload}");
        let signature: Signature = key.sign(signing_input.as_bytes());

        format!(
            "{signing_input}.{}",
            URL_SAFE_NO_PAD.encode(signature.to_der().as_bytes())
        )
    }

    /// The ordinary genuine statement these tests vary one field of at a time.
    fn statement_for(sub: &str, capabilities: &[&str]) -> String {
        sign(
            &signing_key(),
            &claims_json(
                sub,
                capabilities,
                NOW - 60,
                NOW - 60 + ENTITLEMENT_STATEMENT_TTL_SECONDS,
                TEST_KEY_ID,
            ),
        )
    }

    fn advance_statement() -> String {
        statement_for(
            SUBJECT_A,
            &["hosted_ai", "household_net_worth", "multi_device_sync"],
        )
    }

    /// Classic: sync and household net worth, and deliberately NOT hosted AI.
    fn classic_statement() -> String {
        statement_for(SUBJECT_A, &["household_net_worth", "multi_device_sync"])
    }

    fn store_trusted(dir: &Path, sub: &str, statement: &str) -> CachedEntitlement {
        store_with(dir, sub, statement, &trusted_set(), NOW)
    }

    fn read_trusted(dir: &Path, sub: &str) -> CachedEntitlement {
        read_with(dir, sub, &trusted_set(), NOW)
    }

    fn stored_document(dir: &Path, sub: &str) -> CachedDocument {
        let raw = std::fs::read_to_string(statement_path(dir, sub)).expect("the document exists");
        serde_json::from_str(&raw).expect("the document parses")
    }

    // ----- the happy path and the location/format claims -----

    #[test]
    fn the_cache_lives_beside_the_profile_copies_as_one_json_document_per_subject() {
        let root = TempDir::new().expect("temp dir");

        assert_eq!(dir(&root), root.path().join("entitlements"));
        assert_ne!(
            dir(&root),
            crate::profile_store::profiles_dir(root.path()),
            "the two families are keyed by the same thing and must not share a namespace"
        );

        store_trusted(&dir(&root), SUBJECT_A, &advance_statement());

        let document = stored_document(&dir(&root), SUBJECT_A);
        assert_eq!(document.schema_version, CACHE_SCHEMA_VERSION);
        assert_eq!(document.subject_sub, SUBJECT_A);
        assert_eq!(document.iat_high_water_mark, NOW - 60);
        assert!(
            !dir(&root).join(format!("{SUBJECT_A}.json.tmp")).exists(),
            "the atomic-write temp file must not survive"
        );
    }

    #[test]
    fn a_verified_statement_grants_exactly_the_capabilities_it_carries() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);

        assert_eq!(
            store_trusted(&dir, SUBJECT_A, &advance_statement()),
            read_trusted(&dir, SUBJECT_A),
            "storing answers with exactly what a later read answers with"
        );

        let granted = read_trusted(&dir, SUBJECT_A).capabilities();
        for capability in [HOSTED_AI, HOUSEHOLD_NET_WORTH, MULTI_DEVICE_SYNC] {
            assert!(granted.grants(capability), "{}", capability.name());
        }
    }

    /// AD-16's tier-model gate, driven entirely through capabilities: no test here compares a
    /// label, because the whole point is that no code may.
    #[test]
    fn a_classic_entitlement_grants_sync_and_withholds_hosted_ai() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);

        store_trusted(&dir, SUBJECT_A, &classic_statement());
        let classic = read_trusted(&dir, SUBJECT_A).capabilities();

        assert!(classic.grants(MULTI_DEVICE_SYNC), "sync accepts Classic");
        assert!(classic.grants(HOUSEHOLD_NET_WORTH));
        assert!(
            !classic.grants(HOSTED_AI),
            "hosted AI refuses Classic, and that refusal is capability-derived"
        );

        store_trusted(&dir, SUBJECT_A, &advance_statement());
        let advance = read_trusted(&dir, SUBJECT_A).capabilities();

        assert!(advance.grants(MULTI_DEVICE_SYNC));
        assert!(advance.grants(HOSTED_AI), "Advance is accepted by both");
    }

    /// The distinction a free account's upgrade prompt depends on: a verifiable empty grant is a
    /// server answer, and an unreachable server is not.
    #[test]
    fn a_verified_free_statement_is_told_apart_from_an_unreachable_server() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);

        let free = store_trusted(&dir, SUBJECT_A, &statement_for(SUBJECT_A, &[]));

        assert!(matches!(free, CachedEntitlement::Verified(_)));
        assert!(
            free.is_server_answer(),
            "a verified free statement is what invites an upgrade"
        );
        for capability in [HOSTED_AI, HOUSEHOLD_NET_WORTH, MULTI_DEVICE_SYNC] {
            assert!(!free.capabilities().grants(capability));
        }

        let unreachable = read_trusted(&dir, SUBJECT_B);
        assert_eq!(unreachable, CachedEntitlement::Missing);
        assert!(
            !unreachable.is_server_answer(),
            "no answer must never read as a verified free account"
        );
    }

    #[test]
    fn an_account_with_no_document_at_all_grants_nothing_and_creates_no_directory() {
        let root = TempDir::new().expect("temp dir");

        assert_eq!(
            read_trusted(&dir(&root), SUBJECT_A),
            CachedEntitlement::Missing
        );
        assert!(!dir(&root).exists(), "a read must not create the directory");
    }

    // ----- the full rejection matrix, at the CACHE boundary -----

    /// Each row grants nothing, and each is reported as its own reason so a surface can tell an
    /// ordinary lapse from a token that never was genuine.
    #[test]
    fn every_rejection_at_the_cache_boundary_grants_nothing() {
        let key = signing_key();
        let other_key = SigningKey::from_slice(&[0x22; 32]).expect("a second valid key");
        let genuine = advance_statement();

        let rows: Vec<(&str, String, Option<i64>, StatementRejection)> = vec![
            (
                "expired",
                sign(
                    &key,
                    &claims_json(
                        SUBJECT_A,
                        &["multi_device_sync"],
                        NOW - ENTITLEMENT_STATEMENT_TTL_SECONDS - 1,
                        NOW - 1,
                        TEST_KEY_ID,
                    ),
                ),
                None,
                StatementRejection::Expired,
            ),
            (
                "tampered payload under an honest signature",
                {
                    let (_, honest_signature) = genuine.rsplit_once('.').expect("a signature part");
                    let forged = URL_SAFE_NO_PAD.encode(claims_json(
                        SUBJECT_A,
                        &["multi_device_sync"],
                        NOW - 60,
                        NOW + 60,
                        TEST_KEY_ID,
                    ));
                    format!("{ENTITLEMENT_STATEMENT_PREFIX}.{forged}.{honest_signature}")
                },
                None,
                StatementRejection::SignatureInvalid,
            ),
            (
                "signed by a key this build does not hold",
                sign(
                    &other_key,
                    &claims_json(
                        SUBJECT_A,
                        &["multi_device_sync"],
                        NOW - 60,
                        NOW + 60,
                        TEST_KEY_ID,
                    ),
                ),
                None,
                StatementRejection::SignatureInvalid,
            ),
            (
                "bound to another subject",
                statement_for(SUBJECT_B, &["multi_device_sync"]),
                None,
                StatementRejection::SubjectMismatch,
            ),
            (
                "an unknown key_id",
                sign(
                    &key,
                    &claims_json(
                        SUBJECT_A,
                        &["multi_device_sync"],
                        NOW - 60,
                        NOW + 60,
                        "a-key-this-build-never-heard-of",
                    ),
                ),
                None,
                StatementRejection::UnknownKeyId,
            ),
            (
                "an iat beyond the permitted skew",
                sign(
                    &key,
                    &claims_json(
                        SUBJECT_A,
                        &["multi_device_sync"],
                        NOW + ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS + 1,
                        NOW + ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS
                            + 1
                            + ENTITLEMENT_STATEMENT_TTL_SECONDS,
                        TEST_KEY_ID,
                    ),
                ),
                None,
                StatementRejection::IssuedInFuture,
            ),
            (
                "an inverted window",
                sign(
                    &key,
                    &claims_json(SUBJECT_A, &["multi_device_sync"], NOW, NOW - 1, TEST_KEY_ID),
                ),
                None,
                StatementRejection::WindowInvalid,
            ),
            (
                "an iat below the recorded high-water mark",
                genuine.clone(),
                Some(NOW - 59),
                StatementRejection::IssuedBeforeHighWaterMark,
            ),
            (
                "a structurally malformed statement",
                "not-even-a-token".to_string(),
                None,
                StatementRejection::Malformed,
            ),
        ];

        for (label, statement, planted_mark, expected) in rows {
            let root = TempDir::new().expect("temp dir");
            let dir = dir(&root);

            write(
                &dir,
                SUBJECT_A,
                &CachedDocument {
                    schema_version: CACHE_SCHEMA_VERSION,
                    subject_sub: SUBJECT_A.to_string(),
                    statement: Some(statement),
                    iat_high_water_mark: planted_mark.unwrap_or(0),
                },
            )
            .expect("the document is written");

            let answer = read_trusted(&dir, SUBJECT_A);

            assert_eq!(answer, CachedEntitlement::Refused(expected), "{label}");
            for capability in [HOSTED_AI, HOUSEHOLD_NET_WORTH, MULTI_DEVICE_SYNC] {
                assert!(
                    !answer.capabilities().grants(capability),
                    "{label} must grant nothing"
                );
            }
            assert!(
                !answer.is_server_answer(),
                "{label} is not an answer an upgrade may be offered against"
            );
        }
    }

    /// A trusted entry past its `not_after` is the other half of AD-9's revocation path, and is
    /// its own row because it depends on the key set rather than on the statement.
    #[test]
    fn a_key_past_its_not_after_grants_nothing_at_the_cache_boundary() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);
        store_trusted(&dir, SUBJECT_A, &advance_statement());

        let retired = vec![trusted_key(&signing_key(), TEST_KEY_ID, NOW)];
        let answer = read_with(&dir, SUBJECT_A, &retired, NOW);

        assert_eq!(
            answer,
            CachedEntitlement::Refused(StatementRejection::KeyNoLongerTrusted)
        );
        assert!(!answer.capabilities().grants(MULTI_DEVICE_SYNC));
    }

    /// The shipped configuration. A statement signed by anything other than an embedded
    /// production key is refused at the cache boundary, grants nothing, and does not move the
    /// high-water mark — so a forged document cannot raise the mark and lock a genuine one out.
    #[test]
    fn the_shipped_trusted_set_refuses_a_foreign_statement_and_grants_nothing() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);

        assert!(
            !TRUSTED_STATEMENT_KEYS.is_empty(),
            "an empty set would make every test below vacuous"
        );

        let answer = store(&dir, SUBJECT_A, &advance_statement(), NOW);

        assert_eq!(
            answer,
            CachedEntitlement::Refused(StatementRejection::UnknownKeyId)
        );
        assert_eq!(read(&dir, SUBJECT_A, NOW), answer);
        for capability in [HOSTED_AI, HOUSEHOLD_NET_WORTH, MULTI_DEVICE_SYNC] {
            assert!(!read(&dir, SUBJECT_A, NOW).capabilities().grants(capability));
        }
        assert_eq!(
            stored_document(&dir, SUBJECT_A).iat_high_water_mark,
            0,
            "a statement that did not verify must not move the mark"
        );
    }

    // ----- subject binding -----

    #[test]
    fn a_document_written_for_one_subject_grants_nothing_to_another() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);

        store_trusted(&dir, SUBJECT_A, &advance_statement());

        assert_eq!(read_trusted(&dir, SUBJECT_B), CachedEntitlement::Missing);
        assert!(!read_trusted(&dir, SUBJECT_B)
            .capabilities()
            .grants(MULTI_DEVICE_SYNC));
        assert!(
            read_trusted(&dir, SUBJECT_A)
                .capabilities()
                .grants(MULTI_DEVICE_SYNC),
            "the rightful owner still reads its own grant"
        );
    }

    /// A document whose recorded subject disagrees with its filename is a miss, so renaming one
    /// account's file onto another's name grants nothing.
    #[test]
    fn a_document_renamed_onto_another_subjects_filename_is_a_miss() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);
        store_trusted(&dir, SUBJECT_A, &advance_statement());

        std::fs::rename(
            statement_path(&dir, SUBJECT_A),
            statement_path(&dir, SUBJECT_B),
        )
        .expect("the document is renamed");

        assert_eq!(read_trusted(&dir, SUBJECT_B), CachedEntitlement::Missing);
        assert!(
            statement_path(&dir, SUBJECT_B).exists(),
            "a mismatched document is ignored, never deleted"
        );
    }

    #[test]
    fn an_invalid_subject_never_reads_or_writes_a_file() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);

        for invalid in ["", "a/b", "../etc", "a.b", &"x".repeat(129)] {
            assert_eq!(read_trusted(&dir, invalid), CachedEntitlement::Missing);
            assert_eq!(
                store_trusted(&dir, invalid, &advance_statement()),
                CachedEntitlement::Missing
            );
            clear(&dir, invalid);
        }

        assert!(!dir.exists(), "a rejected subject must touch no file");
    }

    // ----- sign-out, and the mark that outlives it -----

    #[test]
    fn signing_out_drops_the_statement_and_keeps_the_high_water_mark() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);
        store_trusted(&dir, SUBJECT_A, &advance_statement());

        clear(&dir, SUBJECT_A);

        assert_eq!(read_trusted(&dir, SUBJECT_A), CachedEntitlement::Missing);
        assert!(!read(&dir, SUBJECT_A, NOW)
            .capabilities()
            .grants(MULTI_DEVICE_SYNC));
        assert_eq!(
            stored_document(&dir, SUBJECT_A).iat_high_water_mark,
            NOW - 60,
            "clearing the statement must not reset the floor a later one has to clear"
        );
    }

    #[test]
    fn clearing_an_account_that_has_no_document_creates_nothing() {
        let root = TempDir::new().expect("temp dir");

        clear(&dir(&root), SUBJECT_A);

        assert!(!dir(&root).exists());
    }

    /// The whole point of the mark: the document is re-read from disk every time, so a process
    /// restart cannot lose it, and a clock rolled back below it cannot re-admit the superseded
    /// statement the mark was set from.
    #[test]
    fn the_high_water_mark_survives_a_restart_and_a_rolled_back_clock() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);
        let keys = trusted_set();

        let newer_iat = NOW - 10;
        let newer = sign(
            &signing_key(),
            &claims_json(
                SUBJECT_A,
                &["multi_device_sync"],
                newer_iat,
                newer_iat + ENTITLEMENT_STATEMENT_TTL_SECONDS,
                TEST_KEY_ID,
            ),
        );
        let older = advance_statement();

        store_with(&dir, SUBJECT_A, &newer, &keys, NOW);
        assert_eq!(high_water_mark(&dir, SUBJECT_A), newer_iat);

        // The attack: sign out, put the earlier (genuine, unexpired) statement back, and rewind
        // the device clock to when it was current. Every read goes through the stored mark, so
        // there is no in-memory state a restart could drop.
        clear(&dir, SUBJECT_A);
        let replayed = store_with(&dir, SUBJECT_A, &older, &keys, NOW - 30);

        assert_eq!(
            replayed,
            CachedEntitlement::Refused(StatementRejection::IssuedBeforeHighWaterMark)
        );
        assert_eq!(
            read_with(&dir, SUBJECT_A, &keys, NOW - 30),
            CachedEntitlement::Refused(StatementRejection::IssuedBeforeHighWaterMark)
        );
        assert_eq!(
            high_water_mark(&dir, SUBJECT_A),
            newer_iat,
            "a refused statement must not lower the mark either"
        );
        assert!(!read_with(&dir, SUBJECT_A, &trusted_set(), NOW - 30)
            .capabilities()
            .grants(MULTI_DEVICE_SYNC));
    }

    /// A hand-edited document cannot lower the floor by editing the statement, and cannot raise
    /// it either: the mark only ever moves to the `iat` of a statement that verified.
    #[test]
    fn a_planted_mark_is_never_lowered_by_a_later_store() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);

        write(
            &dir,
            SUBJECT_A,
            &CachedDocument {
                schema_version: CACHE_SCHEMA_VERSION,
                subject_sub: SUBJECT_A.to_string(),
                statement: None,
                iat_high_water_mark: NOW,
            },
        )
        .expect("the document is written");

        assert_eq!(
            store_trusted(&dir, SUBJECT_A, &advance_statement()),
            CachedEntitlement::Refused(StatementRejection::IssuedBeforeHighWaterMark)
        );
        assert_eq!(high_water_mark(&dir, SUBJECT_A), NOW);
    }

    // ----- document hygiene -----

    #[test]
    fn an_unparseable_or_future_versioned_document_reads_as_a_miss_and_is_left_alone() {
        for body in [
            "{ not json".to_string(),
            serde_json::json!({
                "schema_version": 99,
                "subject_sub": SUBJECT_A,
                "statement": null,
                "iat_high_water_mark": 0,
            })
            .to_string(),
        ] {
            let root = TempDir::new().expect("temp dir");
            let dir = dir(&root);
            std::fs::create_dir_all(&dir).expect("dir created");
            std::fs::write(statement_path(&dir, SUBJECT_A), &body).expect("written");

            assert_eq!(read_trusted(&dir, SUBJECT_A), CachedEntitlement::Missing);
            assert_eq!(
                std::fs::read_to_string(statement_path(&dir, SUBJECT_A)).expect("still there"),
                body,
                "an unreadable document is ignored, never rewritten or deleted"
            );
        }
    }

    #[test]
    fn the_revalidation_window_matches_the_hosted_status_cache_ttl() {
        assert_eq!(REVALIDATION_TTL, Duration::from_secs(300));
    }

    /// The three triggers AD-9 names, as the one rule that produces them: the first call of a
    /// process, the first call for a newly signed-in subject, then once per window.
    #[test]
    fn revalidation_is_due_on_first_use_on_a_subject_change_and_once_per_window() {
        let _guard = crate::credentials::test_keyring_guard();
        forget_attempts();

        let start = Instant::now();

        assert!(
            take_attempt_slot(SUBJECT_A, start),
            "the first call of a process is app start"
        );
        assert!(
            !take_attempt_slot(SUBJECT_A, start + Duration::from_secs(1)),
            "a capability check inside the window must not issue a request"
        );
        let signed_in_at = start + Duration::from_secs(2);
        assert!(
            take_attempt_slot(SUBJECT_B, signed_in_at),
            "a different subject is a sign-in"
        );
        assert!(!take_attempt_slot(
            SUBJECT_B,
            signed_in_at + REVALIDATION_TTL - Duration::from_millis(1)
        ));
        assert!(take_attempt_slot(
            SUBJECT_B,
            signed_in_at + REVALIDATION_TTL
        ));

        forget_attempts();
    }
}
