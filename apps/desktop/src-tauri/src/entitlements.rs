//! Which capabilities an account's entitlement grants (billing AD-1, AD-9, AD-10).
//!
//! This is the seam the rest of the app asks "may this account do X?" through, and it exists
//! so that no feature has to know what the account *is*. A feature names a **capability**;
//! nothing here, and nothing anywhere else, maps a product label onto a capability. That is
//! what makes selling a new plan a server-side change with no desktop release: the server
//! sends the capability list it decided on, and this module only parses the names it
//! recognises. There is deliberately no projection table in Rust at all.
//!
//! The authority is the server-signed **entitlement statement** (AD-9): a compact
//! `NXS1.<payload>.<signature>` token bound to one Cognito `sub`, carrying the granted
//! capabilities and a 24-hour window, signed with a KMS `ECC_NIST_P256` key whose public half
//! is embedded in this binary. `verify_entitlement_statement` is a pure function over
//! (statement, expected subject, trusted keys, clock, high-water mark) and **fails closed**:
//! anything malformed, unsigned, mis-signed, misbound, expired, future-dated or clock-rewound
//! grants nothing. Last-known status may be *displayed*; it never authorizes.
//!
//! The capability union mirrors `BILLING_CAPABILITIES` in
//! `packages/shared/src/types/billing.ts` and the tests below read that file, so a drift on
//! either side fails here (AD-13).

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use p256::ecdsa::signature::Verifier as _;
use p256::ecdsa::{DerSignature, VerifyingKey};
use p256::pkcs8::DecodePublicKey as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// A named capability. Opaque so a caller cannot build one from a runtime string: the set is
/// fixed at compile time, which is what makes a gate that tests one an exhaustive answer
/// rather than a lookup that can miss (AD-1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capability(&'static str);

impl Capability {
    /// The stable diagnostic name. Stable because sync AD-16's diagnostics report it and SPEC
    /// CAP-1 names it; it is not a user-facing string.
    ///
    /// Not yet read outside tests: `sync_diagnostics` is Story 10, and this is the value it
    /// reports. Narrowly scoped rather than module-wide so the next unused item here still
    /// fails the gate.
    #[allow(dead_code)]
    pub fn name(self) -> &'static str {
        self.0
    }

    /// The one place in the codebase a capability name string is compared.
    ///
    /// Returns `None` for a name this build does not know, which is how a client ignores a
    /// capability a newer server granted (AD-13) without treating it as an error.
    pub fn parse(name: &str) -> Option<Capability> {
        CAPABILITIES.iter().copied().find(|known| known.0 == name)
    }

    /// Where this capability sits in the union, which is how a grant is stored as a fixed-size
    /// value rather than a heap list.
    fn slot(self) -> Option<usize> {
        CAPABILITIES.iter().position(|known| *known == self)
    }
}

impl Serialize for Capability {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.0)
    }
}

/// Hosted AI through Nixus infrastructure.
pub const HOSTED_AI: Capability = Capability("hosted_ai");
/// Household net worth. Granted today with no consumer yet, which the contract permits.
pub const HOUSEHOLD_NET_WORTH: Capability = Capability("household_net_worth");
/// Multi-device sync (SPEC CAP-1, sync AD-14).
pub const MULTI_DEVICE_SYNC: Capability = Capability("multi_device_sync");

pub const CAPABILITY_COUNT: usize = 3;

/// The closed union, mirroring `BILLING_CAPABILITIES`. Sorted, and pinned sorted by a test so
/// two representations of the same grant cannot differ by ordering.
pub const CAPABILITIES: [Capability; CAPABILITY_COUNT] =
    [HOSTED_AI, HOUSEHOLD_NET_WORTH, MULTI_DEVICE_SYNC];

/// The statement's format marker. Not a JWT on purpose: there is no negotiable algorithm, so
/// there is no algorithm-confusion surface and no JOSE stack to carry (AD-9).
pub const ENTITLEMENT_STATEMENT_PREFIX: &str = "NXS1";

/// The offline window. 24 hours, because every paid capability needs the network anyway, so a
/// cancellation cannot be outlived by more than one window.
///
/// Not read by the desktop: `exp` is set by the authority and the statement carries it, so a
/// second derivation here could only disagree with the one that was signed. It exists to be
/// pinned against the shared contract by the test below, and to document the window a cached
/// statement's life is bounded by.
#[allow(dead_code)]
pub const ENTITLEMENT_STATEMENT_TTL_SECONDS: i64 = 24 * 60 * 60;

/// Remaining-life fraction below which the authority mints a fresh statement on a read. Same
/// reason as the TTL above: the threshold is the server's, and this is its contract mirror.
#[allow(dead_code)]
pub const ENTITLEMENT_STATEMENT_REFRESH_FRACTION: f64 = 0.5;

/// How far ahead of this device's clock an `iat` may sit before the statement is refused.
pub const ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS: i64 = 300;

/// One signing key this build trusts, and until when.
///
/// `public_key_der` is DER **SPKI** (`SubjectPublicKeyInfo`) — the shape AWS KMS `GetPublicKey`
/// returns — and is decoded as SPKI everywhere in this module. `not_after` makes trust expire
/// by data rather than only by shipping a new binary, which is half of AD-9's revocation path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedKey {
    pub key_id: &'static str,
    pub public_key_der: &'static [u8],
    pub not_after: i64,
}

/// The keys this build trusts to sign a statement.
///
/// The production signing key, read from the deployed `nixus-billing` stack's KMS key
/// (`ECC_NIST_P256` / `SIGN_VERIFY`, `ECDSA_SHA_256` only). `public_key_der` is the 91-byte SPKI
/// document `kms:GetPublicKey` returns verbatim.
///
/// `not_after` is what makes trust expire by DATA rather than only by a new release: a build that
/// is never updated stops accepting statements from this key on that instant, which is half of
/// AD-9's revocation path (the server-side minimum client version is the other half).
///
/// AD-9's rotation is ordered, and this set holds more than one entry during it: one release adds
/// a key, a later release signs with it, a third stops trusting the old one. A statement naming a
/// key absent from this set never grants anything.
pub const TRUSTED_STATEMENT_KEYS: &[TrustedKey] = &[TrustedKey {
    key_id: "59db75bf-801f-4ac9-bc30-33e354582db8",
    public_key_der: &[
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
        0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04, 0xed, 0x38, 0x80,
        0x0a, 0x49, 0xfa, 0x8c, 0x4f, 0x8f, 0x0d, 0x47, 0x98, 0x4b, 0xba, 0x43, 0x34, 0x19, 0x51,
        0xde, 0x81, 0x6b, 0x2c, 0x33, 0xbc, 0x63, 0x5b, 0x0d, 0x17, 0xb8, 0x2d, 0x49, 0x06, 0x35,
        0x51, 0x28, 0x51, 0x05, 0x76, 0xd1, 0xfd, 0xa9, 0x28, 0xa5, 0xf7, 0x15, 0x84, 0x25, 0x64,
        0xbf, 0x1b, 0xfc, 0x8c, 0x5c, 0xd0, 0x72, 0xcd, 0xd0, 0x5a, 0xcc, 0x16, 0x9b, 0x9b, 0xf6,
        0x61,
    ],
    not_after: 1_858_118_400,
}];

/// The claim set, mirroring `EntitlementStatementClaims` in the shared contract. Field order
/// matches the TypeScript declaration order because the serialised bytes are what gets signed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntitlementStatementClaims {
    pub sub: String,
    /// An opaque label, carried for display and for support. Never read by a gate (AD-1).
    pub tier: String,
    #[serde(deserialize_with = "capabilities_from_names")]
    pub capabilities: Vec<Capability>,
    pub monthly_request_limit: Option<i64>,
    pub iat: i64,
    pub exp: i64,
    pub key_id: String,
}

/// Drops any name this build does not recognise instead of failing the whole statement
/// (AD-13): a newer server granting a capability an older client has never heard of must not
/// cost that client the capabilities it *does* understand.
fn capabilities_from_names<'de, D>(deserializer: D) -> Result<Vec<Capability>, D::Error>
where
    D: Deserializer<'de>,
{
    let names = Vec::<String>::deserialize(deserializer)?;

    Ok(names
        .iter()
        .filter_map(|name| Capability::parse(name))
        .collect())
}

/// Why a statement granted nothing.
///
/// Distinct variants rather than a boolean because a caller treats two of these differently:
/// `Expired` is an ordinary lapse of a statement that *was* genuine, so the surface may show
/// last-known status while granting nothing; every other variant means the token never was
/// genuine, so there is no last-known status to show. Neither authorizes anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementRejection {
    /// Not three dot-separated parts, not the `NXS1` prefix, not decodable base64url, or not
    /// parseable claims JSON.
    Malformed,
    /// The claimed `key_id` is not in the trusted set — including the case where the set is
    /// empty, which is what this build ships with.
    UnknownKeyId,
    /// The trusted entry for that `key_id` is past its `not_after`.
    KeyNoLongerTrusted,
    /// The signature does not verify against the named key, or that key's embedded bytes
    /// cannot be used to verify at all. Either way the statement is unverifiable.
    SignatureInvalid,
    /// Signed for a different Cognito `sub`.
    SubjectMismatch,
    /// Past its `exp` against this device's clock.
    Expired,
    /// Issued further into the future than the permitted skew.
    IssuedInFuture,
    /// Issued before the latest `iat` this device has already verified, so a rewound clock
    /// cannot re-admit a statement that was already superseded.
    IssuedBeforeHighWaterMark,
    /// `exp` at or before `iat`: a window that never contained a valid instant.
    WindowInvalid,
}

/// Verifies a statement offline and returns its claims, or the reason it granted nothing.
///
/// Pure: every input is a parameter, including the clock and the persisted high-water mark, so
/// the whole of AD-9's refusal surface is testable without a filesystem, a network or a real
/// clock. On success the caller advances its persisted high-water mark to `claims.iat`.
///
/// Order is load-bearing, not cosmetic:
///
/// 1. Structure and decoding first, because they are the cheapest and need no key.
/// 2. The key is located and its `not_after` checked next — both are facts about *this build's*
///    embedded data, not claims, so they are safe to act on and cheaper than a curve operation.
/// 3. **The signature is verified before any claim is acted on.** `key_id` is read before this
///    point because the signature cannot be checked without knowing which key to check it
///    against, but nothing it says is trusted: an attacker choosing a `key_id` only chooses
///    which key refuses them.
/// 4. The claim checks last. `WindowInvalid` is tested before `Expired` so a nonsensical window
///    is never reported as an ordinary lapse, which would let a tampered statement earn the
///    display allowance that only a genuine expired one gets.
///
/// Signature verification is delegated to `p256`, whose scalar comparison is constant-time; no
/// byte comparison of signature or key material is performed here.
pub fn verify_entitlement_statement(
    statement: &str,
    expected_sub: &str,
    trusted_keys: &[TrustedKey],
    now_unix_seconds: i64,
    iat_high_water_mark: i64,
) -> Result<EntitlementStatementClaims, StatementRejection> {
    let mut parts = statement.split('.');
    let (Some(prefix), Some(payload), Some(signature), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(StatementRejection::Malformed);
    };

    if prefix != ENTITLEMENT_STATEMENT_PREFIX {
        return Err(StatementRejection::Malformed);
    }

    let claims_json = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| StatementRejection::Malformed)?;
    let signature_der = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| StatementRejection::Malformed)?;
    let claims: EntitlementStatementClaims =
        serde_json::from_slice(&claims_json).map_err(|_| StatementRejection::Malformed)?;

    let key = trusted_keys
        .iter()
        .find(|candidate| candidate.key_id == claims.key_id)
        .ok_or(StatementRejection::UnknownKeyId)?;

    if key.not_after <= now_unix_seconds {
        return Err(StatementRejection::KeyNoLongerTrusted);
    }

    // The bytes the server signed: the first two parts joined by a dot, taken as a slice of
    // the original string so no re-encoding can change them.
    let signed = &statement.as_bytes()[..prefix.len() + 1 + payload.len()];
    let verifying_key = VerifyingKey::from_public_key_der(key.public_key_der)
        .map_err(|_| StatementRejection::SignatureInvalid)?;
    let parsed_signature = DerSignature::from_bytes(&signature_der)
        .map_err(|_| StatementRejection::SignatureInvalid)?;

    verifying_key
        .verify(signed, &parsed_signature)
        .map_err(|_| StatementRejection::SignatureInvalid)?;

    if claims.sub != expected_sub {
        return Err(StatementRejection::SubjectMismatch);
    }

    if claims.exp <= claims.iat {
        return Err(StatementRejection::WindowInvalid);
    }

    if claims.exp <= now_unix_seconds {
        return Err(StatementRejection::Expired);
    }

    if claims.iat > now_unix_seconds + ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS {
        return Err(StatementRejection::IssuedInFuture);
    }

    if claims.iat < iat_high_water_mark {
        return Err(StatementRejection::IssuedBeforeHighWaterMark);
    }

    Ok(claims)
}

/// The capability set of the account currently signed in.
///
/// A plain value rather than a live reader, so a caller cannot accidentally make a second
/// network round trip per check and a test can state an account's capabilities without standing
/// up a server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountCapabilities {
    granted: [bool; CAPABILITY_COUNT],
}

impl AccountCapabilities {
    /// Grants nothing. The answer for a signed-out account, a verified free account, and an
    /// account whose entitlement could not be established — denying is correct for all three,
    /// because sync AD-14 makes an absent capability the Frozen state, which leaves the local
    /// app fully working.
    pub fn empty() -> Self {
        Self {
            granted: [false; CAPABILITY_COUNT],
        }
    }

    pub fn from_capabilities(capabilities: &[Capability]) -> Self {
        let mut granted = [false; CAPABILITY_COUNT];
        for capability in capabilities {
            if let Some(slot) = capability.slot() {
                granted[slot] = true;
            }
        }

        Self { granted }
    }

    /// The only constructor a statement may reach: it takes *verified* claims, so a caller
    /// physically cannot turn an unverified token into a grant.
    pub fn from_verified_statement(claims: &EntitlementStatementClaims) -> Self {
        Self::from_capabilities(&claims.capabilities)
    }

    pub fn grants(&self, capability: Capability) -> bool {
        capability.slot().is_some_and(|slot| self.granted[slot])
    }
}

/// The account's grant, and whether it came from a verified statement at all.
///
/// A gate needs only the grant, which is why `account_capabilities` exists and keeps its shape. A
/// *surface* needs one thing more, and conflating the two is a product defect rather than an
/// imprecision: a verified statement that grants nothing is a free or lower plan, which an upgrade
/// fixes, while an entitlement that could not be established is a transient problem an upgrade
/// cannot fix. Selling a plan to a user with a flaky connection is exactly what AD-9's "a free
/// account receives a signed statement" exists to prevent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntitlementAnswer {
    Verified(AccountCapabilities),
    /// No statement, an unverifiable one, no session, or an unreachable billing API.
    Unestablished,
}

/// Reads the account's entitlement and projects it onto capabilities.
///
/// Cheap to call repeatedly, which is what lets sync AD-14's "check before every network
/// operation" be literal rather than aspirational. Never fails: an unreachable or unreadable
/// entitlement is no capability, not an error the caller has to handle.
pub async fn account_capabilities() -> AccountCapabilities {
    match entitlement_answer().await {
        EntitlementAnswer::Verified(capabilities) => capabilities,
        EntitlementAnswer::Unestablished => AccountCapabilities::empty(),
    }
}

/// The same read, keeping the one distinction a surface needs and a gate must ignore.
pub async fn entitlement_answer() -> EntitlementAnswer {
    #[cfg(test)]
    if let Some(stated) = test_entitlement() {
        return stated;
    }

    current_entitlement_source().await
}

/// Lets a test state an account's entitlement without a billing API, a cache root, a keyring or
/// a trusted key.
///
/// Mandatory rather than convenient: `TRUSTED_STATEMENT_KEYS` ships EMPTY, so no statement can
/// verify in this build and an integration test driving the real code could otherwise only ever
/// observe the un-entitled branch — the entitled half of every routing and gating behaviour would
/// be untestable. `#[cfg(test)]`, so no shipped binary contains a way to set it, asserted by
/// `the_entitlement_source_has_no_override_in_a_release_build` below.
#[cfg(test)]
static TEST_ENTITLEMENT: std::sync::Mutex<Option<EntitlementAnswer>> = std::sync::Mutex::new(None);

#[cfg(test)]
fn test_entitlement() -> Option<EntitlementAnswer> {
    match TEST_ENTITLEMENT.lock() {
        Ok(guard) => *guard,
        Err(poisoned) => *poisoned.into_inner(),
    }
}

#[cfg(test)]
pub(crate) fn set_test_entitlement(answer: Option<EntitlementAnswer>) {
    let mut guard = match TEST_ENTITLEMENT.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = answer;
}

#[cfg(test)]
pub(crate) fn set_test_capabilities(capabilities: Option<&[Capability]>) {
    set_test_entitlement(capabilities.map(|granted| {
        EntitlementAnswer::Verified(AccountCapabilities::from_capabilities(granted))
    }));
}

/// The one place the entitlement is obtained.
///
/// Reads the cached statement for the account currently signed in, verifies it offline against
/// `TRUSTED_STATEMENT_KEYS`, this device's clock and the persisted `iat` high-water mark, and
/// projects the *verified* claims onto capabilities. A cache miss, an unresolvable subject, an
/// unreachable cache root and every rejection in AD-9's matrix all yield `Unestablished`, and
/// therefore no capability — fail-closed, with no error channel, because an absent capability is
/// sync AD-14's Frozen state and a perfectly ordinary product state rather than a fault to
/// report.
///
/// The revalidation attempt is the one network cost here, and it is bounded rather than per-call:
/// `revalidate_if_due` fetches at most once per subject per hosted-status window, so the first
/// check of a process (app start) and the first after a sign-in both refresh, and the hundreds of
/// checks sync AD-14 makes in between all read the same cached bytes. A failed fetch leaves the
/// cache as it was: an outage must not look like a capability loss.
async fn current_entitlement_source() -> EntitlementAnswer {
    let Some(dir) = crate::statement_cache::installed_dir() else {
        return EntitlementAnswer::Unestablished;
    };
    let Ok(sub) = crate::commands::auth::current_subject().await else {
        return EntitlementAnswer::Unestablished;
    };

    crate::statement_cache::revalidate_if_due(dir, &sub).await;

    let cached = crate::statement_cache::read(dir, &sub, chrono::Utc::now().timestamp());
    if cached.is_server_answer() {
        EntitlementAnswer::Verified(cached.capabilities())
    } else {
        EntitlementAnswer::Unestablished
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Signer as _;
    use p256::ecdsa::{Signature, SigningKey};
    use p256::pkcs8::EncodePublicKey as _;
    use std::path::{Path, PathBuf};

    const NOW: i64 = 1_800_000_000;
    const TEST_KEY_ID: &str = "test-key-1";
    const SUBJECT: &str = "11111111-2222-3333-4444-555555555555";

    /// A fixed scalar rather than a random one, so every signature in this module is
    /// reproducible and a failure is never a flake.
    fn signing_key() -> SigningKey {
        SigningKey::from_slice(&[0x11; 32]).expect("the fixed scalar is a valid P-256 key")
    }

    /// Leaked so a runtime-generated fixture satisfies the embedded set's `'static` shape
    /// without a hard-coded DER blob in this source.
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

    fn claims() -> EntitlementStatementClaims {
        EntitlementStatementClaims {
            sub: SUBJECT.to_string(),
            tier: "advance".to_string(),
            capabilities: vec![HOSTED_AI, HOUSEHOLD_NET_WORTH, MULTI_DEVICE_SYNC],
            monthly_request_limit: Some(500),
            iat: NOW - 60,
            exp: NOW - 60 + ENTITLEMENT_STATEMENT_TTL_SECONDS,
            key_id: TEST_KEY_ID.to_string(),
        }
    }

    fn sign_payload(key: &SigningKey, payload: &str) -> String {
        let signing_input = format!("{ENTITLEMENT_STATEMENT_PREFIX}.{payload}");
        let signature: Signature = key.sign(signing_input.as_bytes());

        format!(
            "{signing_input}.{}",
            URL_SAFE_NO_PAD.encode(signature.to_der().as_bytes())
        )
    }

    fn statement_signed_by(key: &SigningKey, claims: &EntitlementStatementClaims) -> String {
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims).expect("claims serialize"));

        sign_payload(key, &payload)
    }

    fn statement(claims: &EntitlementStatementClaims) -> String {
        statement_signed_by(&signing_key(), claims)
    }

    fn verify(statement: &str) -> Result<EntitlementStatementClaims, StatementRejection> {
        verify_entitlement_statement(statement, SUBJECT, &trusted_set(), NOW, 0)
    }

    #[test]
    fn a_genuine_statement_grants_exactly_the_capabilities_it_carries() {
        let verified = verify(&statement(&claims())).expect("the statement verifies");
        let granted = AccountCapabilities::from_verified_statement(&verified);

        assert_eq!(verified.sub, SUBJECT);
        assert_eq!(verified.tier, "advance");
        assert_eq!(verified.monthly_request_limit, Some(500));
        for capability in CAPABILITIES {
            assert!(
                granted.grants(capability),
                "{} is granted",
                capability.name()
            );
        }
    }

    #[test]
    fn a_statement_carrying_one_capability_grants_only_that_one() {
        let mut claims = claims();
        claims.capabilities = vec![MULTI_DEVICE_SYNC];

        let granted =
            AccountCapabilities::from_verified_statement(&verify(&statement(&claims)).unwrap());

        assert!(granted.grants(MULTI_DEVICE_SYNC));
        assert!(!granted.grants(HOSTED_AI));
        assert!(!granted.grants(HOUSEHOLD_NET_WORTH));
    }

    /// A signed-in account with no subscription receives a normal, verifiable statement with an
    /// empty grant. That is what lets a client tell verified free from unreachable server.
    #[test]
    fn a_verified_free_statement_verifies_and_grants_nothing() {
        let mut claims = claims();
        claims.tier = "free".to_string();
        claims.capabilities = Vec::new();
        claims.monthly_request_limit = None;

        let verified = verify(&statement(&claims)).expect("a free statement still verifies");
        let granted = AccountCapabilities::from_verified_statement(&verified);

        assert!(verified.capabilities.is_empty());
        for capability in CAPABILITIES {
            assert!(!granted.grants(capability));
        }
    }

    /// AD-13: a newer server's capability is ignored, and must not cost this client the ones it
    /// does understand.
    #[test]
    fn an_unrecognised_capability_name_is_dropped_rather_than_rejected() {
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::json!({
                "sub": SUBJECT,
                "tier": "something_new",
                "capabilities": ["multi_device_sync", "teleportation", "hosted_ai"],
                "monthly_request_limit": null,
                "iat": NOW - 60,
                "exp": NOW + 60,
                "key_id": TEST_KEY_ID,
            })
            .to_string(),
        );

        let verified = verify(&sign_payload(&signing_key(), &payload)).expect("verifies");

        assert_eq!(verified.capabilities, vec![MULTI_DEVICE_SYNC, HOSTED_AI]);
        assert!(AccountCapabilities::from_verified_statement(&verified).grants(MULTI_DEVICE_SYNC));
    }

    // Rejection 1: structure.
    #[test]
    fn a_statement_without_the_prefix_or_three_parts_is_malformed() {
        let genuine = statement(&claims());
        let (_, rest) = genuine
            .split_once('.')
            .expect("the genuine token has parts");

        for broken in [
            String::new(),
            "NXS1".to_string(),
            format!("NXS2.{rest}"),
            format!("nxs1.{rest}"),
            format!("{genuine}.extra"),
            genuine.rsplit_once('.').expect("two parts").0.to_string(),
        ] {
            assert_eq!(
                verify(&broken).err(),
                Some(StatementRejection::Malformed),
                "{broken:?} must be refused on its shape alone"
            );
        }
    }

    // Rejection 2: decoding.
    #[test]
    fn an_undecodable_part_or_unparseable_claim_set_is_malformed() {
        let not_base64 = format!("{ENTITLEMENT_STATEMENT_PREFIX}.not base64!.also not base64!");
        let bad_signature_encoding = {
            let genuine = statement(&claims());
            let (head, _) = genuine.rsplit_once('.').expect("a signature part");
            format!("{head}.%%%%")
        };
        let not_json = sign_payload(&signing_key(), &URL_SAFE_NO_PAD.encode("{ not json"));
        let wrong_json_shape =
            sign_payload(&signing_key(), &URL_SAFE_NO_PAD.encode(r#"{"sub":1}"#));

        for broken in [
            not_base64,
            bad_signature_encoding,
            not_json,
            wrong_json_shape,
        ] {
            assert_eq!(verify(&broken).err(), Some(StatementRejection::Malformed));
        }
    }

    // Rejection 3: the signature.
    #[test]
    fn a_tampered_payload_or_foreign_signature_does_not_verify() {
        let mut claims = claims();
        claims.capabilities = Vec::new();
        let unentitled = statement(&claims);
        let (_, honest_signature) = unentitled.rsplit_once('.').expect("a signature");

        let mut forged = claims;
        forged.capabilities = vec![MULTI_DEVICE_SYNC];
        let forged_payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&forged).unwrap());

        let swapped_payload =
            format!("{ENTITLEMENT_STATEMENT_PREFIX}.{forged_payload}.{honest_signature}");
        let other_key = SigningKey::from_slice(&[0x22; 32]).expect("a second valid key");
        let foreign = statement_signed_by(&other_key, &forged);

        for broken in [swapped_payload, foreign] {
            assert_eq!(
                verify(&broken).err(),
                Some(StatementRejection::SignatureInvalid)
            );
        }
    }

    // Rejection 4: an unknown key, including the empty set this build ships with.
    #[test]
    fn a_statement_naming_an_untrusted_key_grants_nothing() {
        let mut claims = claims();
        claims.key_id = "a-key-this-build-never-heard-of".to_string();

        assert_eq!(
            verify(&statement(&claims)).err(),
            Some(StatementRejection::UnknownKeyId)
        );
    }

    /// The shipped set is an allowlist, so what matters is that it holds EXACTLY the keys it is
    /// meant to and that each entry is well-formed: a 91-byte SPKI document the verifier can
    /// decode, a non-empty `key_id`, and a `not_after` that has not already passed. A statement
    /// naming any key outside the set grants nothing.
    #[test]
    fn the_embedded_trusted_key_set_holds_only_well_formed_production_keys() {
        assert_eq!(
            TRUSTED_STATEMENT_KEYS.len(),
            1,
            "rotation adds a second entry deliberately; an unexplained one is an attack"
        );

        for key in TRUSTED_STATEMENT_KEYS {
            assert!(!key.key_id.is_empty());
            assert_eq!(key.public_key_der.len(), 91, "an SPKI P-256 public key");
            assert!(
                VerifyingKey::from_public_key_der(key.public_key_der).is_ok(),
                "an embedded key the verifier cannot decode refuses every statement silently"
            );
            assert!(
                key.not_after > NOW,
                "a key shipped already past its not_after would grant nothing from day one"
            );
        }

        assert_eq!(
            verify_entitlement_statement(
                &statement(&claims()),
                SUBJECT,
                TRUSTED_STATEMENT_KEYS,
                NOW,
                0
            )
            .err(),
            Some(StatementRejection::UnknownKeyId),
            "the test key is not a production key"
        );
    }

    // Rejection 5: trust expiring by data.
    #[test]
    fn a_key_past_its_not_after_is_no_longer_trusted() {
        let key = signing_key();
        let statement = statement(&claims());

        for not_after in [NOW - 1, NOW] {
            assert_eq!(
                verify_entitlement_statement(
                    &statement,
                    SUBJECT,
                    &[trusted_key(&key, TEST_KEY_ID, not_after)],
                    NOW,
                    0
                )
                .err(),
                Some(StatementRejection::KeyNoLongerTrusted)
            );
        }

        assert!(verify_entitlement_statement(
            &statement,
            SUBJECT,
            &[trusted_key(&key, TEST_KEY_ID, NOW + 1)],
            NOW,
            0
        )
        .is_ok());
    }

    // Rejection 6: binding.
    #[test]
    fn a_statement_signed_for_another_subject_grants_nothing() {
        assert_eq!(
            verify_entitlement_statement(
                &statement(&claims()),
                "99999999-2222-3333-4444-555555555555",
                &trusted_set(),
                NOW,
                0
            )
            .err(),
            Some(StatementRejection::SubjectMismatch)
        );
    }

    // Rejection 7: expiry.
    #[test]
    fn an_expired_statement_grants_nothing_and_says_so_distinctly() {
        for exp in [NOW - 1, NOW] {
            let mut claims = claims();
            claims.iat = exp - ENTITLEMENT_STATEMENT_TTL_SECONDS;
            claims.exp = exp;

            let rejection = verify(&statement(&claims)).expect_err("an expired statement");

            assert_eq!(rejection, StatementRejection::Expired);
            assert_ne!(
                rejection,
                StatementRejection::SignatureInvalid,
                "an ordinary lapse must stay distinguishable from tampering, because only the \
                 former lets a surface show last-known status"
            );
        }
    }

    // Rejection 8: a clock skewed forward.
    #[test]
    fn an_iat_beyond_the_permitted_skew_is_refused_and_one_within_it_is_not() {
        let at_the_edge = NOW + ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS;

        let mut beyond = claims();
        beyond.iat = at_the_edge + 1;
        beyond.exp = beyond.iat + ENTITLEMENT_STATEMENT_TTL_SECONDS;
        assert_eq!(
            verify(&statement(&beyond)).err(),
            Some(StatementRejection::IssuedInFuture)
        );

        let mut within = claims();
        within.iat = at_the_edge;
        within.exp = within.iat + ENTITLEMENT_STATEMENT_TTL_SECONDS;
        assert!(verify(&statement(&within)).is_ok());
    }

    // Rejection 9: a clock rolled back.
    #[test]
    fn a_rolled_back_clock_cannot_re_admit_a_superseded_statement() {
        let claims = claims();
        let statement = statement(&claims);
        let keys = trusted_set();

        assert_eq!(
            verify_entitlement_statement(&statement, SUBJECT, &keys, NOW, claims.iat + 1).err(),
            Some(StatementRejection::IssuedBeforeHighWaterMark)
        );
        assert!(
            verify_entitlement_statement(&statement, SUBJECT, &keys, NOW, claims.iat).is_ok(),
            "the mark is advanced TO iat on success, so re-verifying the same statement holds"
        );
    }

    // Rejection 10: a window that never contained a valid instant.
    #[test]
    fn a_statement_whose_window_is_inverted_is_refused_as_tampering_not_as_expiry() {
        for (iat, exp) in [(NOW, NOW), (NOW, NOW - 1)] {
            let mut claims = claims();
            claims.iat = iat;
            claims.exp = exp;

            assert_eq!(
                verify(&statement(&claims)).err(),
                Some(StatementRejection::WindowInvalid)
            );
        }
    }

    #[test]
    fn the_capability_names_are_the_ones_the_spec_pins() {
        assert_eq!(HOSTED_AI.name(), "hosted_ai");
        assert_eq!(HOUSEHOLD_NET_WORTH.name(), "household_net_worth");
        assert_eq!(MULTI_DEVICE_SYNC.name(), "multi_device_sync");
    }

    #[test]
    fn only_a_known_capability_name_parses() {
        for capability in CAPABILITIES {
            assert_eq!(Capability::parse(capability.name()), Some(capability));
        }
        for unknown in [
            "",
            "premium",
            "Hosted_AI",
            "hosted_ai ",
            "multi-device-sync",
        ] {
            assert_eq!(Capability::parse(unknown), None);
        }
    }

    #[test]
    fn an_empty_capability_set_grants_nothing_and_a_full_one_grants_everything() {
        let empty = AccountCapabilities::empty();
        let full = AccountCapabilities::from_capabilities(&CAPABILITIES);

        for capability in CAPABILITIES {
            assert!(!empty.grants(capability));
            assert!(full.grants(capability));
        }
    }

    // ----- The shared contract, read from its source -----

    fn repo_file(relative: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
    }

    fn billing_contract() -> String {
        std::fs::read_to_string(repo_file("../../../packages/shared/src/types/billing.ts"))
            .expect("billing.ts is readable")
    }

    /// The quoted members of `export const <name> = [ ... ] as const`, comments skipped.
    /// Mirrors `account_contract`'s reader so both contract tests parse the same way.
    fn ts_array(source: &str, name: &str) -> Vec<String> {
        let start_marker = format!("export const {name} = [");
        let start = source
            .find(&start_marker)
            .unwrap_or_else(|| panic!("{name} is declared in billing.ts"))
            + start_marker.len();
        let end = start + source[start..].find("] as const").expect("array is closed");

        source[start..end]
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with("/**") && !line.starts_with('*'))
            .flat_map(|line| line.split(','))
            .filter_map(|item| {
                let item = item.trim();
                item.strip_prefix('"')
                    .and_then(|rest| rest.strip_suffix('"'))
                    .map(str::to_string)
            })
            .collect()
    }

    /// The raw right-hand side of `export const <name> = <value>;`, so an expression such as
    /// `24 * 60 * 60` is compared as written rather than silently re-derived here.
    fn ts_value(source: &str, name: &str) -> String {
        let marker = format!("export const {name} = ");
        let start = source
            .find(&marker)
            .unwrap_or_else(|| panic!("{name} is declared in billing.ts"))
            + marker.len();
        let end = start + source[start..].find(';').expect("the statement ends");

        source[start..end].trim().to_string()
    }

    /// AD-1 and AD-13: the union is closed on both sides, so a member on one side and not the
    /// other must fail here rather than at runtime. Asserted in both directions explicitly, so
    /// the failure message names the member rather than printing two lists.
    #[test]
    fn the_capability_union_matches_the_shared_contract_exactly() {
        let shared = ts_array(&billing_contract(), "BILLING_CAPABILITIES");
        let rust: Vec<String> = CAPABILITIES
            .iter()
            .map(|capability| capability.name().to_string())
            .collect();

        assert!(!shared.is_empty(), "billing.ts declares capabilities");

        for name in &shared {
            assert!(
                rust.contains(name),
                "billing.ts grants {name} and entitlements.rs cannot parse it"
            );
            assert!(
                Capability::parse(name).is_some(),
                "{name} must be parseable, or a granted capability would be silently dropped"
            );
        }
        for name in &rust {
            assert!(
                shared.contains(name),
                "entitlements.rs knows {name} and billing.ts does not declare it"
            );
        }

        assert_eq!(rust, shared, "the order must match too");

        let mut sorted = rust.clone();
        sorted.sort();
        assert_eq!(rust, sorted, "the union is declared sorted on both sides");
        assert_eq!(rust.len(), CAPABILITY_COUNT);
    }

    #[test]
    fn the_statement_constants_match_the_shared_contract() {
        let source = billing_contract();

        assert_eq!(
            ts_value(&source, "ENTITLEMENT_STATEMENT_PREFIX"),
            format!("\"{ENTITLEMENT_STATEMENT_PREFIX}\"")
        );
        assert_eq!(
            ts_value(&source, "ENTITLEMENT_STATEMENT_TTL_SECONDS"),
            "24 * 60 * 60"
        );
        assert_eq!(ENTITLEMENT_STATEMENT_TTL_SECONDS, 86_400);
        assert_eq!(
            ts_value(&source, "ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS"),
            ENTITLEMENT_STATEMENT_MAX_CLOCK_SKEW_SECONDS.to_string()
        );
        assert_eq!(
            ts_value(&source, "ENTITLEMENT_STATEMENT_REFRESH_FRACTION")
                .parse::<f64>()
                .expect("the refresh fraction is a number"),
            ENTITLEMENT_STATEMENT_REFRESH_FRACTION
        );
        assert_eq!(
            ts_value(&source, "ENTITLEMENT_STATEMENT_KEY_SPEC"),
            "\"ECC_NIST_P256\"",
            "the verifier is built for exactly this curve"
        );
        assert_eq!(
            ts_value(&source, "ENTITLEMENT_STATEMENT_SIGNING_ALGORITHM"),
            "\"ECDSA_SHA_256\"",
            "and exactly this algorithm, which is why there is no `alg` to negotiate"
        );
    }

    // ----- The AD-1 source guard -----

    fn src_root() -> PathBuf {
        repo_file("src")
    }

    fn suffix_after_src(path: &Path) -> String {
        let full = path.to_string_lossy().replace('\\', "/");
        match full.split_once("/src/") {
            Some((_, suffix)) => suffix.to_string(),
            None => full,
        }
    }

    /// Where every file's test block starts, and the reason this guard can audit itself: the
    /// assertions below quote the very needles they search for, so a whole-file scan would
    /// always match this file. Cutting on the module header keeps the shipped half of every
    /// file, which is the half the claim is about. Same mechanism as
    /// `commands::cloud_link`'s network-client guard.
    const TEST_MODULE_HEADER: &str = "mod tests {";

    fn production_source(source: &str) -> &str {
        match source.split_once(TEST_MODULE_HEADER) {
            Some((production, _)) => production,
            None => source,
        }
    }

    fn rust_sources(dir: &Path, found: &mut Vec<(String, String, String)>) {
        for entry in std::fs::read_dir(dir).expect("source directory is readable") {
            let path = entry.expect("directory entry").path();
            if path.is_dir() {
                rust_sources(&path, found);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                let whole = std::fs::read_to_string(&path).expect("source is readable");
                found.push((
                    suffix_after_src(&path),
                    production_source(&whole).to_string(),
                    whole,
                ));
            }
        }
    }

    /// The shapes a gate takes when it branches on a product label instead of a capability.
    /// Textual rather than syntactic on purpose: the cost of the check has to be near zero so
    /// it runs on every build, and a label comparison is a lexical pattern.
    const LABEL_COMPARISON_PATTERNS: [&str; 8] = [
        "tier ==",
        "tier !=",
        "tier.as_str()",
        "matches!(tier",
        "match tier",
        "== \"advance\"",
        "== \"classic\"",
        "== \"premium\"",
    ];

    /// The one file permitted to compare a capability *name*, which is the parser's whole job.
    /// Named rather than implied, and asserted to exist below so the exemption cannot outlive
    /// the file it exempts.
    const CAPABILITY_NAME_PARSER: &str = "entitlements.rs";

    /// Assembled at runtime so this guard's own source does not contain the needle and the
    /// whole-file scan below cannot trip over itself.
    fn retired_projection_table() -> String {
        format!("PREMIUM_{}_CAPABILITIES", "CLOUD")
    }

    /// AD-1's CI guard, and AD-16's release gate: no file outside the capability-name parser
    /// compares a product label, and the old projection table is gone rather than extended.
    #[test]
    fn no_file_outside_the_capability_name_parser_compares_a_product_label() {
        let mut sources = Vec::new();
        rust_sources(&src_root(), &mut sources);
        assert!(
            sources.len() > 20,
            "the sweep found only {} files, so it is not scanning the crate",
            sources.len()
        );
        assert!(
            sources
                .iter()
                .any(|(relative, _, _)| relative == CAPABILITY_NAME_PARSER),
            "{CAPABILITY_NAME_PARSER} is exempted here but is not being scanned"
        );

        let offenders: Vec<String> = sources
            .iter()
            .filter(|(relative, _, _)| relative != CAPABILITY_NAME_PARSER)
            .flat_map(|(relative, production, _)| {
                production
                    .lines()
                    .enumerate()
                    .filter(|(_, line)| {
                        LABEL_COMPARISON_PATTERNS
                            .iter()
                            .any(|pattern| line.contains(pattern))
                    })
                    .map(|(index, line)| format!("{relative}:{}: {}", index + 1, line.trim()))
                    .collect::<Vec<String>>()
            })
            .collect();

        assert!(
            offenders.is_empty(),
            "a gate may test only a capability; a product label is for display and support and \
             is never compared (AD-1):\n{}",
            offenders.join("\n")
        );

        let retired = retired_projection_table();
        let survivors: Vec<&String> = sources
            .iter()
            .filter(|(_, _, whole)| whole.contains(&retired))
            .map(|(relative, _, _)| relative)
            .collect();

        assert!(
            survivors.is_empty(),
            "{retired} was deleted, not extended: the capability list now arrives from the \
             server and no label is projected onto one in Rust (AD-1). Found in: {survivors:?}"
        );
    }

    /// GATE: the test override above is the only way to state a capability set without a
    /// verified statement, and a release build must not contain it.
    ///
    /// Asserted on the source for the same reason `profile_client`'s base-URL guard is: a single
    /// un-gated line here would be a way to grant every paid capability from outside the
    /// statement, which is precisely what AD-9 exists to make impossible.
    #[test]
    fn the_entitlement_source_has_no_override_in_a_release_build() {
        let whole = std::fs::read_to_string(repo_file("src").join(CAPABILITY_NAME_PARSER))
            .expect("this module is readable");
        let production = production_source(&whole);

        let overrides: Vec<(usize, &str)> = production
            .lines()
            .enumerate()
            .filter(|(_, line)| line.contains("TEST_ENTITLEMENT"))
            .collect();
        assert!(
            !overrides.is_empty(),
            "the override is named here but is no longer in this module"
        );

        let lines: Vec<&str> = production.lines().collect();
        for (index, line) in overrides {
            let gate = lines[..index]
                .iter()
                .rev()
                .find(|candidate| !candidate.trim().is_empty())
                .map(|candidate| candidate.trim())
                .unwrap_or("");
            assert!(
                gate == "#[cfg(test)]" || gate.starts_with("//") || gate.ends_with('{'),
                "every mention of the override must sit inside a cfg(test) item, but line {} \
                 reads {} under {}",
                index + 1,
                line.trim(),
                gate
            );
        }

        for item in [
            "static TEST_ENTITLEMENT",
            "fn test_entitlement()",
            "pub(crate) fn set_test_entitlement",
            "pub(crate) fn set_test_capabilities",
        ] {
            let declaration = production
                .find(item)
                .unwrap_or_else(|| panic!("{item} is declared"));
            assert!(
                production[..declaration]
                    .trim_end()
                    .ends_with("#[cfg(test)]"),
                "{item} must be declared directly under a cfg(test) gate"
            );
        }
    }

    /// The projection the replaced bridge used to perform, now driven by the statement alone.
    #[test]
    fn only_a_verified_statement_contributes_a_capability_to_the_gate() {
        let verified = verify(&statement(&claims())).expect("the statement verifies");

        assert_eq!(
            AccountCapabilities::from_verified_statement(&verified),
            AccountCapabilities::from_capabilities(&CAPABILITIES)
        );
        assert_eq!(
            AccountCapabilities::from_capabilities(&[]),
            AccountCapabilities::empty(),
            "a verified statement carrying nothing is the same grant as no statement at all"
        );
    }

    /// The seam `sync/gate.rs`'s `CapabilitySource` is built on must not move: its production
    /// implementation calls this exact function, with this exact shape.
    #[tokio::test]
    async fn the_capability_source_keeps_the_signature_the_sync_gate_depends_on() {
        set_test_capabilities(Some(&[MULTI_DEVICE_SYNC]));

        let granted: AccountCapabilities = account_capabilities().await;

        assert!(granted.grants(MULTI_DEVICE_SYNC));
        assert!(!granted.grants(HOSTED_AI));

        set_test_capabilities(None);
    }

    /// The distinction a gate must ignore and a surface must not: both answers grant nothing,
    /// and only one of them is something an upgrade can fix (AD-9).
    #[tokio::test]
    async fn a_verified_empty_grant_is_told_apart_from_an_unestablished_entitlement() {
        set_test_entitlement(Some(EntitlementAnswer::Verified(
            AccountCapabilities::empty(),
        )));
        assert_eq!(
            entitlement_answer().await,
            EntitlementAnswer::Verified(AccountCapabilities::empty())
        );
        assert_eq!(account_capabilities().await, AccountCapabilities::empty());

        set_test_entitlement(Some(EntitlementAnswer::Unestablished));
        assert_eq!(entitlement_answer().await, EntitlementAnswer::Unestablished);
        assert_eq!(
            account_capabilities().await,
            AccountCapabilities::empty(),
            "the gate reads the same nothing from both, which is why it keeps one signature"
        );
        assert_ne!(
            EntitlementAnswer::Verified(AccountCapabilities::empty()),
            EntitlementAnswer::Unestablished,
            "a surface must be able to tell them apart"
        );

        set_test_entitlement(None);
    }
}
