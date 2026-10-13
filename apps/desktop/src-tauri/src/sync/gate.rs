//! The one gate every network operation passes (AD-14, inherited AD-12).
//!
//! Four conditions have to hold before a byte moves: the dataset is cloud-linked, the
//! account is granted the `multi_device_sync` capability, the state is not Frozen, and the
//! account this dataset is pinned to is the account being used. They are checked in that
//! order, which is load-bearing rather than cosmetic: a local-only dataset must run **no**
//! sync code at all, so it has to short-circuit before anything that would read an
//! entitlement, open a connection to the identity pool or build a transport client.
//!
//! Gating holds by construction, not by discipline. `GatedStore` is the only way to reach
//! an `ObjectStore` from outside this file — `S3ObjectStore`'s constructor is
//! `pub(in crate::sync)` and `GatedStore` hands out no reference to the store it wraps —
//! and `tests_gate_boundary.rs` fails the build if a port method ships without a gate or
//! if any module outside `sync` learns the transport's name.

use crate::db::sync_state::FrozenReason;
use crate::entitlements::{AccountCapabilities, Capability, MULTI_DEVICE_SYNC};

use super::auth::{
    verify_account_pin, AccountPin, AccountPinStore, AuthError, Clock, CredentialVendor,
    IdTokenProvider, PinField, SyncCredentials, VendedCredentials,
};
use super::store::{
    ConditionalGet, ETag, ImmutablePut, ObjectMeta, ObjectStore, StoreError, StoredObject,
};

/// Why a transfer may not happen. Distinct outcomes rather than a boolean, because the
/// four causes are reported differently, cleared differently, and counted separately by
/// AD-16's diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncBlocked {
    /// The dataset is not cloud-linked (inherited AD-12). Not an error anywhere in the
    /// product: it is the state of every local profile, and the reason sync is inert.
    LocalOnlyDataset,
    /// The account is not granted the capability (AD-14, CAP-8).
    CapabilityMissing { capability: Capability },
    /// Transfers are stopped. The local app is unaffected, and the cloud copy is kept.
    Frozen { reason: FrozenReason },
    /// The account now in use is not the account this dataset is pinned to (AD-7).
    PinMismatch { field: PinField },
    /// The dataset's sync state could not be read, so no condition can be proven. Denying
    /// is the only safe answer: AD-14's prevention is sync running when it must not.
    StateUnavailable,
}

/// Whether this dataset is eligible to sync at all (inherited AD-12).
pub trait DatasetLink {
    fn is_cloud_linked(&self) -> bool;
}

/// The account's capability set. A port so a test can state an entitlement without the
/// status endpoint, and so the gate never learns what a tier is.
pub trait CapabilitySource {
    async fn capabilities(&self) -> AccountCapabilities;
}

/// The frozen reason and the recorded pin, read as one value.
pub trait GateStateSource {
    fn gate_state(&self) -> Result<super::state::GateState, AuthError>;
}

impl DatasetLink for crate::models::DatasetKind {
    fn is_cloud_linked(&self) -> bool {
        matches!(self, crate::models::DatasetKind::CloudLinked)
    }
}

impl GateStateSource for super::state::SyncStateStore {
    fn gate_state(&self) -> Result<super::state::GateState, AuthError> {
        super::state::SyncStateStore::gate_state(self)
    }
}

/// Reads the live account entitlement. The production `CapabilitySource`.
pub struct AccountEntitlement;

impl CapabilitySource for AccountEntitlement {
    async fn capabilities(&self) -> AccountCapabilities {
        crate::entitlements::account_capabilities().await
    }
}

/// The gate itself.
pub struct SyncGate<L, C, S> {
    link: L,
    capabilities: C,
    state: S,
}

impl<L: DatasetLink, C: CapabilitySource, S: GateStateSource> SyncGate<L, C, S> {
    pub fn new(link: L, capabilities: C, state: S) -> Self {
        Self {
            link,
            capabilities,
            state,
        }
    }

    /// Whether a network operation may proceed right now.
    ///
    /// `observed` is the account the caller is about to act as, when it knows one. `None`
    /// is the pre-vend check, where only the first three conditions are decidable; the
    /// fourth is then enforced by `SyncCredentials::current_pinned`, which cannot be
    /// bypassed because it is the only constructor of a usable credential.
    pub async fn check(&self, observed: Option<&AccountPin>) -> Result<(), SyncBlocked> {
        if !self.link.is_cloud_linked() {
            return Err(SyncBlocked::LocalOnlyDataset);
        }

        if !self
            .capabilities
            .capabilities()
            .await
            .grants(MULTI_DEVICE_SYNC)
        {
            return Err(SyncBlocked::CapabilityMissing {
                capability: MULTI_DEVICE_SYNC,
            });
        }

        let state = self
            .state
            .gate_state()
            .map_err(|_| SyncBlocked::StateUnavailable)?;

        if let Some(reason) = state.frozen_reason {
            return Err(SyncBlocked::Frozen { reason });
        }

        if let Some(observed) = observed {
            verify_account_pin(state.pin.as_ref(), observed)
                .map_err(|mismatch| SyncBlocked::PinMismatch {
                    field: mismatch.field,
                })?;
        }

        Ok(())
    }

    /// Credentials, behind the same gate.
    ///
    /// Vending is itself two network calls to the identity pool, so AD-14's "no uploads
    /// or downloads" has to cover it: a Frozen or un-entitled dataset must not reach
    /// Cognito either. This is also why the gate owns the call rather than the manager —
    /// `tests_gate_boundary.rs` asserts that `current_pinned` is named nowhere but
    /// `auth.rs` and this file, so there is one gated path to a usable credential.
    pub(in crate::sync) async fn vend<V, P, K, Pins>(
        &self,
        credentials: &SyncCredentials<V, P, K>,
        pins: &Pins,
    ) -> Result<VendedCredentials, GatedError>
    where
        V: CredentialVendor,
        P: IdTokenProvider,
        K: Clock,
        Pins: AccountPinStore,
    {
        self.check(None).await?;

        credentials
            .current_pinned(pins)
            .await
            .map_err(GatedError::Auth)
    }
}

/// A gate refusal or a transport fault. Separate variants because the first is a state of
/// the product and the second is a fault: nothing retries a refusal, and nothing reports a
/// local profile as an error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatedError {
    Blocked(SyncBlocked),
    Store(StoreError),
    /// Obtaining or pinning credentials failed. Distinct from `Blocked` because the gate
    /// passed: the fault is in the vend, not in this dataset's eligibility.
    Auth(AuthError),
}

impl From<StoreError> for GatedError {
    fn from(error: StoreError) -> Self {
        GatedError::Store(error)
    }
}

impl From<SyncBlocked> for GatedError {
    fn from(blocked: SyncBlocked) -> Self {
        GatedError::Blocked(blocked)
    }
}

/// Every `ObjectStore` operation, each behind the gate.
///
/// Deliberately **not** an `impl ObjectStore`: implementing the port would force the
/// refusal into `StoreError`, which would put gate vocabulary into the transport
/// vocabulary and let a caller that only handles `StoreError` treat "this account is not
/// entitled" as a transport fault to retry.
pub struct GatedStore<S, G> {
    store: S,
    gate: G,
}

impl<S, L, C, T> GatedStore<S, SyncGate<L, C, T>>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    pub fn new(store: S, gate: SyncGate<L, C, T>) -> Self {
        Self { store, gate }
    }

    /// The gate, and the only path to the wrapped store. Private, and returning the store
    /// rather than `()` so a method physically cannot touch the transport without having
    /// passed the check first.
    async fn pass(&self) -> Result<&S, GatedError> {
        self.gate.check(None).await?;
        Ok(&self.store)
    }

    pub async fn put_immutable(&self, key: &str, body: Vec<u8>) -> Result<ImmutablePut, GatedError> {
        Ok(self.pass().await?.put_immutable(key, body).await?)
    }

    pub async fn put_if_absent(&self, key: &str, body: Vec<u8>) -> Result<ETag, GatedError> {
        Ok(self.pass().await?.put_if_absent(key, body).await?)
    }

    pub async fn put_if_match(
        &self,
        key: &str,
        expected: &ETag,
        body: Vec<u8>,
    ) -> Result<ETag, GatedError> {
        Ok(self
            .pass()
            .await?
            .put_if_match(key, expected, body)
            .await?)
    }

    pub async fn get(&self, key: &str) -> Result<StoredObject, GatedError> {
        Ok(self.pass().await?.get(key).await?)
    }

    #[allow(dead_code)] // Milestone 2 Story 16 polls with it; the wrapper has to exist now
    // because `tests_gate_boundary` fails the build on a port method without a gate.
    pub async fn get_if_none_match(
        &self,
        key: &str,
        known: &ETag,
    ) -> Result<ConditionalGet, GatedError> {
        Ok(self.pass().await?.get_if_none_match(key, known).await?)
    }

    #[allow(dead_code)] // Same: gated now, first called by Milestone 2's polling.
    pub async fn head(&self, key: &str) -> Result<ObjectMeta, GatedError> {
        Ok(self.pass().await?.head(key).await?)
    }

    #[allow(dead_code)] // Same: AD-6's repair path is Milestone 2 Story 23.
    pub async fn exists(&self, key: &str) -> Result<bool, GatedError> {
        Ok(self.pass().await?.exists(key).await?)
    }

    /// The account prefix is behind the gate too: it names the account, which AD-16 keeps
    /// out of anything a blocked dataset can reach.
    #[allow(dead_code)] // Same: a diagnostic nothing in Milestone 1 reads.
    pub async fn account_prefix(&self) -> Result<&str, GatedError> {
        Ok(self.pass().await?.account_prefix())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DatasetKind;
    use crate::sync::auth::IdToken;
    use crate::sync::state::GateState;
    use chrono::{DateTime, TimeDelta, Utc};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// Counts every call that reaches the transport. The whole point of the Frozen and
    /// local-only tests is that this stays at zero, which only a counting fake can prove —
    /// an assertion on the returned error would pass even if the request had been sent.
    #[derive(Default)]
    struct CountingStore {
        calls: AtomicUsize,
    }

    impl CountingStore {
        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }

        fn record(&self) {
            self.calls.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl ObjectStore for CountingStore {
        fn account_prefix(&self) -> &str {
            self.record();
            "acct/us-east-1:abc/"
        }

        async fn put_immutable(
            &self,
            _key: &str,
            _body: Vec<u8>,
        ) -> Result<ImmutablePut, StoreError> {
            self.record();
            Ok(ImmutablePut::Created {
                etag: ETag::new("etag"),
            })
        }

        async fn put_if_absent(&self, _key: &str, _body: Vec<u8>) -> Result<ETag, StoreError> {
            self.record();
            Ok(ETag::new("etag"))
        }

        async fn put_if_match(
            &self,
            _key: &str,
            _expected: &ETag,
            _body: Vec<u8>,
        ) -> Result<ETag, StoreError> {
            self.record();
            Ok(ETag::new("etag"))
        }

        async fn get(&self, _key: &str) -> Result<StoredObject, StoreError> {
            self.record();
            Ok(StoredObject {
                meta: ObjectMeta {
                    etag: ETag::new("etag"),
                    content_sha256: None,
                },
                bytes: Vec::new(),
            })
        }

        async fn get_if_none_match(
            &self,
            _key: &str,
            _known: &ETag,
        ) -> Result<ConditionalGet, StoreError> {
            self.record();
            Ok(ConditionalGet::NotModified)
        }

        async fn head(&self, _key: &str) -> Result<ObjectMeta, StoreError> {
            self.record();
            Ok(ObjectMeta {
                etag: ETag::new("etag"),
                content_sha256: None,
            })
        }

        async fn exists(&self, _key: &str) -> Result<bool, StoreError> {
            self.record();
            Ok(true)
        }
    }

    struct FixedCapabilities(bool);

    impl CapabilitySource for FixedCapabilities {
        async fn capabilities(&self) -> AccountCapabilities {
            AccountCapabilities::from_cloud_entitlement(self.0)
        }
    }

    struct FixedState(Result<GateState, AuthError>);

    impl GateStateSource for FixedState {
        fn gate_state(&self) -> Result<GateState, AuthError> {
            self.0.clone()
        }
    }

    fn linked_state() -> FixedState {
        FixedState(Ok(GateState {
            pin: Some(AccountPin::new("us-east-1:abc", "sub-1")),
            frozen_reason: None,
        }))
    }

    fn gate(
        kind: DatasetKind,
        entitled: bool,
        state: FixedState,
    ) -> SyncGate<DatasetKind, FixedCapabilities, FixedState> {
        SyncGate::new(kind, FixedCapabilities(entitled), state)
    }

    /// Calls every gated method and reports how many reached the transport.
    async fn exercise_every_method(
        gated: &GatedStore<CountingStore, SyncGate<DatasetKind, FixedCapabilities, FixedState>>,
    ) -> Vec<GatedError> {
        let etag = ETag::new("etag");
        let mut refusals = Vec::new();

        macro_rules! attempt {
            ($call:expr) => {
                if let Err(error) = $call.await {
                    refusals.push(error);
                }
            };
        }

        attempt!(gated.put_immutable("log/a/1", Vec::new()));
        attempt!(gated.put_if_absent("owner", Vec::new()));
        attempt!(gated.put_if_match("snap/LATEST", &etag, Vec::new()));
        attempt!(gated.get("owner"));
        attempt!(gated.get_if_none_match("snap/LATEST", &etag));
        attempt!(gated.head("owner"));
        attempt!(gated.exists("owner"));
        attempt!(gated.account_prefix());

        refusals
    }

    /// The number of port operations `exercise_every_method` covers. A method added to the
    /// port without a gate is caught by `tests_gate_boundary`; this keeps the behavioural
    /// proof honest about how much it actually calls.
    const GATED_METHOD_COUNT: usize = 8;

    #[tokio::test]
    async fn a_local_only_dataset_sends_nothing() {
        let gated = GatedStore::new(
            CountingStore::default(),
            gate(DatasetKind::Local, true, linked_state()),
        );

        let refusals = exercise_every_method(&gated).await;

        assert_eq!(refusals.len(), GATED_METHOD_COUNT);
        assert!(refusals
            .iter()
            .all(|error| *error == GatedError::Blocked(SyncBlocked::LocalOnlyDataset)));
        assert_eq!(
            gated.store.calls(),
            0,
            "a local-only dataset must run no sync code"
        );
    }

    #[tokio::test]
    async fn an_account_without_the_capability_sends_nothing() {
        let gated = GatedStore::new(
            CountingStore::default(),
            gate(DatasetKind::CloudLinked, false, linked_state()),
        );

        let refusals = exercise_every_method(&gated).await;

        assert_eq!(refusals.len(), GATED_METHOD_COUNT);
        assert!(refusals.iter().all(|error| *error
            == GatedError::Blocked(SyncBlocked::CapabilityMissing {
                capability: MULTI_DEVICE_SYNC
            })));
        assert_eq!(gated.store.calls(), 0);
    }

    #[tokio::test]
    async fn a_frozen_dataset_sends_nothing() {
        for reason in [
            FrozenReason::EntitlementLapsed,
            FrozenReason::OwnerMismatch,
            FrozenReason::Support,
        ] {
            let gated = GatedStore::new(
                CountingStore::default(),
                gate(
                    DatasetKind::CloudLinked,
                    true,
                    FixedState(Ok(GateState {
                        pin: Some(AccountPin::new("us-east-1:abc", "sub-1")),
                        frozen_reason: Some(reason),
                    })),
                ),
            );

            let refusals = exercise_every_method(&gated).await;

            assert_eq!(refusals.len(), GATED_METHOD_COUNT);
            assert!(refusals
                .iter()
                .all(|error| *error == GatedError::Blocked(SyncBlocked::Frozen { reason })));
            assert_eq!(
                gated.store.calls(),
                0,
                "Frozen must stop uploads and downloads alike"
            );
        }
    }

    #[tokio::test]
    async fn an_unreadable_state_sends_nothing() {
        let gated = GatedStore::new(
            CountingStore::default(),
            gate(
                DatasetKind::CloudLinked,
                true,
                FixedState(Err(AuthError::StateUnavailable)),
            ),
        );

        let refusals = exercise_every_method(&gated).await;

        assert_eq!(refusals.len(), GATED_METHOD_COUNT);
        assert!(refusals
            .iter()
            .all(|error| *error == GatedError::Blocked(SyncBlocked::StateUnavailable)));
        assert_eq!(gated.store.calls(), 0);
    }

    #[tokio::test]
    async fn leaving_frozen_resumes_every_operation() {
        let gated = GatedStore::new(
            CountingStore::default(),
            gate(DatasetKind::CloudLinked, true, linked_state()),
        );

        let refusals = exercise_every_method(&gated).await;

        assert!(refusals.is_empty(), "unexpected refusals: {refusals:?}");
        assert_eq!(
            gated.store.calls(),
            GATED_METHOD_COUNT,
            "every port operation must reach the transport once the gate passes"
        );
    }

    #[tokio::test]
    async fn a_different_account_is_refused_before_any_request() {
        let gate = gate(DatasetKind::CloudLinked, true, linked_state());

        assert_eq!(
            gate.check(Some(&AccountPin::new("us-east-1:other", "sub-1")))
                .await,
            Err(SyncBlocked::PinMismatch {
                field: PinField::IdentityId
            })
        );
        assert_eq!(
            gate.check(Some(&AccountPin::new("us-east-1:abc", "sub-2")))
                .await,
            Err(SyncBlocked::PinMismatch {
                field: PinField::OwnerSub
            })
        );
        assert_eq!(
            gate.check(Some(&AccountPin::new("us-east-1:abc", "sub-1")))
                .await,
            Ok(())
        );
    }

    /// A dataset that has never synced has no pin, so the first account to arrive becomes
    /// the pin rather than being refused as a mismatch.
    #[tokio::test]
    async fn a_first_sync_passes_with_nothing_pinned_yet() {
        let gate = gate(
            DatasetKind::CloudLinked,
            true,
            FixedState(Ok(GateState {
                pin: None,
                frozen_reason: None,
            })),
        );

        assert_eq!(
            gate.check(Some(&AccountPin::new("us-east-1:abc", "sub-1")))
                .await,
            Ok(())
        );
    }

    /// The order the conditions are checked in is itself a requirement: a local-only
    /// dataset must not reach the capability source, because that is what would read an
    /// entitlement and open a network connection for a dataset that never syncs.
    #[tokio::test]
    async fn a_local_only_dataset_never_reaches_the_capability_source() {
        struct PanickingCapabilities;

        impl CapabilitySource for PanickingCapabilities {
            async fn capabilities(&self) -> AccountCapabilities {
                panic!("a local-only dataset must not read an entitlement");
            }
        }

        struct PanickingState;

        impl GateStateSource for PanickingState {
            fn gate_state(&self) -> Result<GateState, AuthError> {
                panic!("a local-only dataset must not read sync state");
            }
        }

        let gate = SyncGate::new(DatasetKind::Local, PanickingCapabilities, PanickingState);

        assert_eq!(
            gate.check(None).await,
            Err(SyncBlocked::LocalOnlyDataset)
        );
    }

    #[test]
    fn the_blocked_reason_names_the_capability_the_spec_pins() {
        let blocked = SyncBlocked::CapabilityMissing {
            capability: MULTI_DEVICE_SYNC,
        };

        let SyncBlocked::CapabilityMissing { capability } = blocked else {
            panic!("expected a capability refusal");
        };
        assert_eq!(capability.name(), "multi_device_sync");
    }

    /// Counts vends for the same reason `CountingStore` counts requests: AD-14 stops the
    /// identity-pool call too, and only a counter can show it was never made.
    struct CountingVendor(Arc<AtomicUsize>);

    impl CredentialVendor for CountingVendor {
        async fn vend(&self, _token: &IdToken) -> Result<VendedCredentials, AuthError> {
            self.0.fetch_add(1, Ordering::SeqCst);

            Ok(VendedCredentials {
                identity_id: "us-east-1:abc".to_string(),
                owner_sub: "sub-1".to_string(),
                access_key_id: "ak".to_string(),
                secret_access_key: "sk".to_string(),
                session_token: "st".to_string(),
                expires_at: Utc::now() + TimeDelta::hours(1),
            })
        }
    }

    struct FixedProvider;

    impl IdTokenProvider for FixedProvider {
        async fn id_token(&self) -> Result<IdToken, AuthError> {
            IdToken::new("token", "sub-1")
        }
    }

    struct RealClock;

    impl Clock for RealClock {
        fn now(&self) -> DateTime<Utc> {
            Utc::now()
        }
    }

    #[derive(Default)]
    struct MemoryPins(std::sync::Mutex<Option<AccountPin>>);

    impl AccountPinStore for MemoryPins {
        fn load(&self) -> Result<Option<AccountPin>, AuthError> {
            Ok(self.0.lock().expect("lock").clone())
        }

        fn store(&self, pin: &AccountPin) -> Result<(), AuthError> {
            *self.0.lock().expect("lock") = Some(pin.clone());
            Ok(())
        }
    }

    async fn vend_through(
        gate: SyncGate<DatasetKind, FixedCapabilities, FixedState>,
    ) -> (Result<VendedCredentials, GatedError>, usize) {
        let vends = Arc::new(AtomicUsize::new(0));
        let credentials = SyncCredentials::new(
            CountingVendor(Arc::clone(&vends)),
            FixedProvider,
            RealClock,
        );

        let outcome = gate.vend(&credentials, &MemoryPins::default()).await;

        (outcome, vends.load(Ordering::SeqCst))
    }

    #[tokio::test]
    async fn a_frozen_dataset_vends_no_credentials() {
        let (outcome, vends) = vend_through(gate(
            DatasetKind::CloudLinked,
            true,
            FixedState(Ok(GateState {
                pin: Some(AccountPin::new("us-east-1:abc", "sub-1")),
                frozen_reason: Some(FrozenReason::EntitlementLapsed),
            })),
        ))
        .await;

        assert_eq!(
            outcome.err(),
            Some(GatedError::Blocked(SyncBlocked::Frozen {
                reason: FrozenReason::EntitlementLapsed
            }))
        );
        assert_eq!(vends, 0, "Frozen must stop credential vending too");
    }

    #[tokio::test]
    async fn a_local_only_or_unentitled_dataset_vends_no_credentials() {
        for (kind, entitled, expected) in [
            (DatasetKind::Local, true, SyncBlocked::LocalOnlyDataset),
            (
                DatasetKind::CloudLinked,
                false,
                SyncBlocked::CapabilityMissing {
                    capability: MULTI_DEVICE_SYNC,
                },
            ),
        ] {
            let (outcome, vends) = vend_through(gate(kind, entitled, linked_state())).await;

            assert_eq!(outcome.err(), Some(GatedError::Blocked(expected)));
            assert_eq!(vends, 0);
        }
    }

    #[tokio::test]
    async fn an_entitled_unfrozen_dataset_vends_once() {
        let (outcome, vends) =
            vend_through(gate(DatasetKind::CloudLinked, true, linked_state())).await;

        assert_eq!(
            outcome.expect("the vend succeeds").identity_id,
            "us-east-1:abc"
        );
        assert_eq!(vends, 1);
    }
}
