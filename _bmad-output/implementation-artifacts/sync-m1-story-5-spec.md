# Story 5 — Identity-pool credentials and account pinning (implementation spec)

Binding: AD-7 (prefix-scoped vended credentials, identity pinned), inherited AD-10
(`credentials.rs` is the sole OS-credential-store accessor; `sync/auth.rs` gets the ID token
only from `commands/auth.rs`, 120 s skew), inherited Bedrock AD-1 amendment (sync credentials
unreachable from `ai/`), AD-15 (pin persistence is the dataset DB — Story 6, not here),
AD-16 (typed faults, no values in diagnostics).

## What ships

1. `commands/auth.rs`: `sync_id_token()` -> `SyncIdToken::{Ready{id_token, subject_sub}, SignedOut}`,
   built on the existing `resolve_session()` (so the 120 s `SESSION_EXPIRY_SKEW_SECS` refresh is
   reused, not re-implemented) plus the pure `sync_id_token_from_resolved()` for unit tests.
2. `sync/config.rs`: `IdentityPoolConfig { identity_pool_id, region, user_pool_id }`, the single
   place for pool coordinates, with `logins_provider_name()` =
   `cognito-idp.<region>.amazonaws.com/<user pool id>` and `production()`. The deployed stack's
   outputs are not in the repo yet, so `production()` returns `AuthError::Unconfigured` and the
   struct is injectable. No invented ids are committed; Story 10 fills the constants in.
3. `sync/auth.rs` (only file naming `aws_sdk_cognitoidentity`):
   - `IdToken { token, sub }` (redacted `Debug`), `trait IdTokenProvider` (narrow seam, injected),
     `CommandAuthIdTokenProvider` forwarding to `commands::auth::sync_id_token()`.
   - `CognitoIdentityVendor`: enhanced flow `GetId` then `GetCredentialsForIdentity`, both with the
     same `Logins` map. Both operations resolve to the SDK's **no-auth** scheme, so the client is
     built from `aws_sdk_cognitoidentity::Config::builder()` with region + behavior version and
     **no credentials provider at all** — the default chain, env and machine profile are never
     consulted (never `aws_config::load_*`). Bounded: 2 attempts max, operation timeouts.
   - `VendedCredentials` / `SyncCredentials<V, P, C>` at `pub(in crate::sync)` visibility: memory
     only, no `Serialize`, redacted `Debug`, never logged, never written to disk/DB/OS store.
     Refresh when `now + 5 min >= expires_at`; injectable `Clock`; the refresh runs while the
     single `tokio::sync::Mutex` is held, so concurrent callers coalesce onto one vend.
   - `AccountPin { identity_id, owner_sub }`, `verify_account_pin(stored, observed)` ->
     `PinOutcome::{Matches, FirstPin}` | `PinMismatch{field}`; refuses on either field.
     `trait AccountPinStore` is the load/store seam (Story 6 implements it over `sync_state`);
     no SQL here. Owner object: relative key `owner` (absolute `acct/<identity-id>/owner`), body =
     the UTF-8 `sub`, create-only; `owner_object_body` / `owner_sub_from_body`.
   - `AuthError`: `Unconfigured | SignedOut | Session | TokenRejected | IdentityPoolUnreachable
     {code, retryable} | CredentialsExpired | IncompleteVendedCredentials | PinMismatch`.
4. Fitness tests: `sync/tests_port_boundary.rs` gains the `aws-sdk-cognitoidentity` guard
   (allowlist `sync/auth.rs`); new `sync/tests_auth_boundary.rs` asserts `sync/auth.rs` names no
   OS-credential-store/`credentials::` path and that no `ai/` source can reach the vended types.

## Tests (no network, no real AWS, no OS credential store)

aws-smithy-mocks with `create_mock_http_client()` (Story 4's trap): happy path (GetId + vend,
Logins key asserted), token rejected (`NotAuthorizedException`), unreachable pool
(`InternalErrorException`, retryable), incomplete credentials. Fake vendor + fake clock:
cached hit, expiry triggers one refresh, margin boundary, concurrent coalescing (one vend for N
callers). Pure: pin first-pin, match, mismatch on identity id, mismatch on sub, owner body
round-trip, config provider name + unconfigured, `sync_id_token_from_resolved` branches.

## Decisions (auto-taken, unattended)

- Spec self-approved, all goals kept, no review sub-agents (rules §6); one self-review pass.
- Pin types live in `sync/auth.rs` rather than a new module: one story, one concern (identity).
- Refresh margin 5 min (300 s) for the 1 h credentials; the 120 s skew stays the ID-token margin.
- No `[story 2] OUTPUTS` / `[story 3]` ledger lines existed at build time → injectable config and
  a self-defined owner-object shape, both recorded in the ledger for Stories 6/10.
