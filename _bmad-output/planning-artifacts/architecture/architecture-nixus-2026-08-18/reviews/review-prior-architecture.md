# Review — Spine vs. Prior Architecture Decision Record

- **Reviewed:** `ARCHITECTURE-SPINE.md` (Local Profiles & Nixus Cloud, Step 1, status: draft, 2026-08-18)
- **Against:** `architecture-login.md` (status: complete, 2026-08-09 + amendment 2026-08-15), `architecture-user-profile.md` (status: complete, 2026-08-10 + amendments 2026-08-10 / 2026-08-11 ×2)
- **Lens:** inheritance consistency only. Prior decisions are binding; the spine may extend them, but a divergence must be surfaced as a conflict, never applied silently.
- **Date:** 2026-08-18
- **Verdict:** **CHANGES REQUESTED** — the spine is directionally sound and inherits most prior decisions faithfully, but two findings (F1, F2) would silently break an already-shipped invariant, and three (F3–F5) are silent drift from established naming/copy/function contracts.

---

## 1. Confirmed inheritances (correct, no action)

These are recorded briefly to establish that the spine's core posture is consistent, so the findings below can be read as localized defects rather than a systemic mismatch.

### Against `architecture-login.md`

| Prior decision | Spine treatment | Status |
| --- | --- | --- |
| Single keyring entry, `service = "nixus-auth"` / `account = "cognito-session"`, one JSON blob | AD-9 leaves it untouched, explicitly and by name | ✅ Confirmed |
| `credentials.rs` is the **sole** module touching `keyring_core::Entry` (inherited from `architecture-credentials.md`, restated as a Correction in the login doc) | Restated verbatim in the Dependency rule and again in AD-8 ("remains the sole module … inherited, unweakened") | ✅ Confirmed, explicitly unweakened |
| `store_cognito_session` / `load_cognito_session` / `clear_cognito_session` are the only session persistence path | AD-9 declares Cognito session fns UNCHANGED; structural seed repeats it in the `credentials.rs` comment | ✅ Confirmed |
| `sign_out` clears the keyring entry; no `/oauth2/revoke` | AD-10: "existing `sign_out` works unchanged" — no new sign-out semantics introduced for datasets | ✅ Confirmed |
| PKCE + `state` CSRF check + Rust-only token exchange are the single auth mechanism | AD-11 keeps them "100% unchanged" and refuses a second parallel flow — this is the right shape and directly prevents the drift risk the login doc worried about | ✅ Confirmed (but see F5 on which function names) |
| `AuthState` = `LoggedOut \| LoggedIn { email, name } \| SessionExpired`, session read via `get_auth_session` | AD-10 derives cloud-linked badge state from `get_auth_session` rather than storing it | ⚠️ Right instinct, wrong mechanism — see **F2** |
| Session refresh checked once on launch, not polled | Unchanged; the spine adds no polling and no per-dataset refresh | ✅ Confirmed |
| One Cognito session per machine | AD-9 states it plainly and pushes per-account isolation to Deferred with a rationale | ✅ Confirmed — correctly scoped, not silently assumed |

Note on `SESSION_CACHE`: AD-9 names an in-process `SESSION_CACHE` singleton as something it is "not touching." No prior architecture document in this record establishes `SESSION_CACHE` — it is an implementation artifact (presumably surfaced via `brownfield.md`), not a recorded decision. Leaving it untouched is the correct call and is consistent with the login doc's launch-check-only refresh posture, so this is not a conflict; it is flagged only so the citation is not mistaken for an inherited decision.

### Against `architecture-user-profile.md`

| Prior decision | Spine treatment | Status |
| --- | --- | --- |
| **D2** — profile lives in `app_data_dir/profiles/<sub>.json`, one document per `sub`, outside SQLite | AD-2 keeps the `profiles/` dir where it is; AD-13 anchors it at the global root regardless of active dataset | ✅ Confirmed in intent (see **F1** for the mechanism that undermines it) |
| **D2 / Naming** — `profile_store.rs` is the sole accessor of the profiles directory, a top-level sibling to `credentials.rs` | Dependency rule restates it: "`profile_store.rs` remains the only accessor of the demographic-profile directory (inherited)"; structural seed marks it UNCHANGED | ✅ Confirmed |
| **D5** — `removeQueries` (never `invalidateQueries`) for `queryKeys.profile` on session transitions | Consistency Conventions row explicitly preserves this: full `queryClient.clear()` for dataset change, "never a scoped `removeQueries` (that convention stays reserved for auth-session-only changes per the existing `architecture-user-profile.md` D5)" | ✅ Confirmed, and correctly reasoned |
| **D5** — the risk class is "one account's data rendered to another" | AD-7 generalizes it to every key with a full `clear()` — strictly stronger than D5, so no weakening | ✅ Confirmed, strengthened not weakened |
| **D9** — backup exclusion is *structural*: `export_backup` copies only `nkbaz-finance.db`, so `profiles/` is excluded with no code change | Preserved: AD-1 keeps `db/backup.rs` copying the db file only; because AD-2 makes the Default dataset dir *be* `app_data_dir`, `profiles/` still sits outside the copied artifact | ✅ Confirmed — the structural property survives the re-pointing |
| **D9** — restore swaps the db file; profiles survive a restore untouched ("restoring a financial backup should not change who you are") | Not contradicted; the spine adds no profile-touching restore logic | ✅ Confirmed |
| **D10** — no audit logging for profile mutations | Untouched; the spine adds no audit call and no SQLite involvement for `datasets.json` | ✅ Confirmed |
| **D13** — errors are reused, not extended: `AppError::Auth` / `Validation` / `File`, no new variant | Consistency Conventions: "no new `AppError` variant needed beyond what `AppError::File`/`AppError::Validation` already cover" | ✅ Confirmed, explicitly |
| **D2 / Structure** — `write_json_atomic` promoted into `json_store.rs`, shared, never hand-rolled | AD-3 routes all registry writes through "the same `write_json_atomic` pattern promoted into `json_store.rs`"; structural seed marks `json_store.rs` "EXISTING … reused as-is" | ✅ Confirmed — reuse, not a second implementation |
| **D1 / rule D8** — `/profile` sits outside the four-destination IA, not in `AppSidebar`/`DestinationNav` | AD-14's `/picker` follows the same posture (chrome-free, outside the IA); no fifth destination is introduced | ✅ Confirmed |
| **D11** — `ProfileMenu` adds no new `invoke()`; no always-mounted component gains IPC | The spine adds its gate to `__root.tsx` and a new `useDatasets.ts`, not to `ProfileMenu`/`TopBar`. `ProfileMenu.tsx` is absent from the structural seed, i.e. untouched | ✅ Confirmed |
| **D3** — `sub` resolved in Rust via `current_subject()`, never over IPC, never in `AuthState` | AD-12's `Login` branch matching on `cognito_sub` is Rust-side and compatible | ⚠️ Partially — see **F2** |
| Tenancy asymmetry (profile account-scoped, financial data device-scoped) recorded as accepted, not a bug | AD-13 restates the boundary crisply ("who is signed in", not "which dataset is open") and the Deferred item on whether Migrate should copy the `/profile` document flags the residual question instead of assuming it away | ✅ Confirmed — good practice; that Deferred entry is exactly the right handling |
| **D9 constraint** — `export_backup` = `PRAGMA wal_checkpoint(TRUNCATE)` + `std::fs::copy` | AD-12 reuses precisely this sequence for Migrate rather than a fresh `init_db`, and states the reason (byte-identical data, not an empty schema). This is the correct primitive and the correct rationale | ✅ Confirmed in substance (see **F5** note on module placement) |

---

## 2. Findings

Ordered by severity. F1 and F2 are conflicts that would break a shipped invariant if implemented as written; F3–F5 are silent drift from an established contract.

---

### F1 — AD-5's blanket path-resolution rule has no global-root carve-out, and would silently break D9's delete-all PII coverage (NFR4) and contradict AD-13

**Severity:** High — regresses an already-shipped, machine-checked data-retention guarantee.
**Cites:** AD-5, AD-13 vs. **D9**, **NFR4**, and `architecture-user-profile.md`'s `profile_store.rs` naming/communication patterns.

**The prior decision.** D9 mandates that delete-all removes the *entire* `app_data_dir/profiles/` directory recursively (hardened further by G2, which rejected a `*.json` glob because `.corrupt` and `.json.tmp` siblings would survive and leave PII on disk). Because this store is invisible to the `WIPE_TABLES`/`PRESERVED_TABLES` coverage test, the doc states the dedicated test asserting the profiles directory is gone is **"required, not optional."** The Communication Patterns section further requires that `danger_zone` call `profile_store::delete_all_profiles` rather than removing the directory itself, and the delta tree shows `commands/danger_zone.rs` gaining `app: AppHandle` specifically to resolve that path.

**What the spine says.** AD-5 states: "`backup.rs`, `danger_zone.rs`, `commands/*.rs`, and `credentials.rs`'s per-dataset key resolution **MUST** obtain the active dataset's directory via `datasets::active_dataset_dir(&app)` … never by calling `app.path().app_data_dir()` themselves." The structural seed reinforces this: `danger_zone.rs # MODIFIED — same path-resolution swap`.

**The conflict.** `commands/danger_zone.rs` has two path consumers, not one:

1. the SQLite wipe — correctly dataset-scoped, `active_dataset_dir` is right;
2. `profile_store::delete_all_profiles(dir)` — must receive the **global** `app_data_dir`, because AD-13 itself insists the demographic profile stays "anchored at the global `app_data_dir` root regardless of which dataset is active."

Applied mechanically as AD-5 is written, a delete-all executed while a non-default dataset is active would pass `app_data_dir/datasets/<uuid>/` to `delete_all_profiles`, target a `profiles/` directory that does not exist, treat "already absent" as success (exactly as G2 specified), report success, and leave every account's PII intact at the global root. The failure is silent, and the D9-mandated test would still pass if written against the active dataset dir — so the required safety net does not catch it either.

This is also an internal contradiction: AD-5 (all `app_data_dir` resolution flows through `active_dataset_dir`) and AD-13 (`profile_store.rs` stays at the global root, untouched) cannot both hold as stated.

**Secondary consequence — no sanctioned way to resolve the global root at all.** `profile_store.rs`'s functions are free functions taking an explicit `dir` and deliberately never resolve `app_data_dir` themselves (so they stay unit-testable against a `tempfile` dir). Under AD-5, only `datasets.rs` may call `app.path().app_data_dir()`, but the structural seed's `datasets.rs` surface is `active_dataset_dir()`, `list_datasets()`, `create_dataset()`, `select_dataset()`, and registry read/write — there is **no global-root accessor**. AD-13's "stays anchored at the global root" therefore has no legal implementation path. The same hole applies to `datasets.json` itself (AD-3 puts it at `app_data_dir/datasets.json`, i.e. the global root, not the active dataset dir).

**Surface as a conflict, do not resolve silently.** AD-5 needs an explicit two-accessor distinction — a global-root resolver alongside `active_dataset_dir()` — plus a named carve-out list stating which callers get which. `profile_store` (per AD-13/D9) and the `datasets.json` registry (per AD-3) are both global-root consumers, and the D9 test must be re-specified to assert against the global root while a non-default dataset is active.

---

### F2 — AD-10's derived signed-in badge cannot be built without violating D3, and the spine names no mechanism

**Severity:** High — as written, the most likely implementation is the exact anti-pattern D3 exists to forbid.
**Cites:** AD-10 (and AD-12's `Login` lookup) vs. **D3**, **NFR3**, and `architecture-login.md`'s `AuthState` naming pattern.

**The prior decision.** D3 is unambiguous and is restated three times in `architecture-user-profile.md` (decision, Enforcement Guidelines, Anti-pattern examples): the `sub` is resolved in Rust via `pub(crate) async fn current_subject()`, it is **"not added to `AuthState`"**, and it is **"never a command parameter."** The stated reason is that if the frontend could supply or observe a `sub`, NFR3 account isolation "would be a convention rather than an invariant." `architecture-login.md` independently fixes `AuthState` as `LoggedOut | LoggedIn { email, name } | SessionExpired` — no `sub` field.

**What the spine says.** AD-10: a cloud-linked dataset's "signed in / signed out" state "is computed at read time by comparing that stored `sub` to whatever `get_auth_session` currently reports globally: match → rendered as signed-in … **No new Rust state.**"

**The conflict.** `get_auth_session` returns `AuthState`, which by prior decision does not and must not carry `sub`. The comparison AD-10 describes is therefore not performable by the consumer of `get_auth_session`. An implementer has three routes and the spine points at none of them:

1. **Add `sub` to `AuthState`** — the most direct reading of AD-10's wording, and a head-on violation of D3's explicit prohibition.
2. **Compare `label` (email) instead of `sub`** — the registry stores both, and email is already in `AuthState`. But email is mutable in Cognito and is not the durable identity key; `architecture-login.md` designates `sub` as "the durable identity key," and D2's in-document `cognito_sub` mismatch guard exists precisely because identity comparisons must use `sub`. This would silently downgrade an identity check to a display-name check.
3. **Do the comparison in Rust** via `auth::current_subject()`, returning a per-entry derived flag to the frontend — the only route consistent with D3. But this contradicts AD-10's own "No new Rust state" framing (it is new Rust *logic*, though no new stored state) and the spine never names `current_subject()` anywhere in the document.

**Related gap in the same family.** `current_subject()` is designated by `architecture-user-profile.md` as **"the single resolution point"** for identity (Cross-Cutting Concerns). AD-12's `Login` branch needs a `sub` to match registry entries and needs the email for `label`, and describes this only as "`label: <email from id_token>`" — implying fresh in-line claim extraction inside the callback rather than routing through the established resolver. Inside `handle_auth_callback` the freshly-exchanged `id_token` is genuinely at hand, so a local extraction is defensible; but the spine should say so explicitly and state that every *later* read (AD-10's badge, and any re-entry into `Login` matching) goes through `current_subject()`. As written, the spine leaves the door open to a second, parallel identity-resolution path — which is the specific outcome D3's "single resolution point" language forbids.

**Surface as a conflict, do not resolve silently.** AD-10 must name its mechanism, and must state whether D3's "`sub` never crosses IPC / never in `AuthState`" rule is being upheld (Rust-side comparison, derived boolean crossing IPC) or overturned (deliberate reversal, recorded as such). It must not be left to the implementer, because the path of least resistance is option 1.

---

### F3 — AD-14 introduces "Log in with Nixus Cloud" against D14's mandated "Sign In with Nixus Cloud", and deletes the component carrying D14's other relabelled key with no locale plan

**Severity:** Medium — user-visible copy inconsistency plus a likely CI failure on the locale-parity suite.
**Cites:** AD-14 vs. **D14**, **FR7**, **FR8**, **NFR5**, **NFR8**.

**The prior decision.** D14 fixes exact strings: `profile.signIn` → "Sign In with Nixus Cloud" / "Se connecter avec Nixus Cloud", and `auth.createAccount` → "Create Nixus Cloud Account" / "Créer un compte Nixus Cloud". NFR8 goes further than reserving the noun — it mandates brand-term consistency and states that **no synonym may be introduced** anywhere in desktop, web, or Cognito Managed Login branding. FR8 requires the copy to stay literally accurate about what an account does, and notes existing `auth.promptBody` copy already satisfies this and "must not drift out of alignment with the new label." NFR5 + the Technical Constraints section note a locale-parity unit suite in `src/locales/__tests__/` that **fails CI** if a key exists in `en.json` without an `fr.json` counterpart.

**What the spine says.** AD-14 and the structural seed both specify the picker's action as **"Log in with Nixus Cloud"**; CAP-4 is titled "Log in with Nixus Cloud (from picker)". AD-14 also states `AccountPromptDialog` is **deleted** — "fully superseded by the picker's own 'Log in with Nixus Cloud' action, not left dormant."

**The drift.**

1. **Verb divergence.** The shipped `ProfileMenu` affordance reads "Sign In with Nixus Cloud" (D14). The new picker would read "Log in with Nixus Cloud." Two verbs for the same action on two surfaces of the same app is precisely the inconsistency NFR8 was written to prevent; the FR translation is worse, since "Se connecter" is already the mandated FR verb and has no distinct "log in" form, so EN would diverge while FR silently collapsed back. Either the spine adopts "Sign In with Nixus Cloud" verbatim, or it proposes a deliberate, recorded relabel of D14 — not a third variant appearing only in the new surface.
2. **Orphaned keys from the deletion.** `AccountPromptDialog` is the carrier of `auth.createAccount` (relabelled by D14) and `auth.promptBody` (load-bearing for FR8's accuracy claim). `architecture-user-profile.md`'s "Not touched, deliberately" list explicitly preserves that component, changing only its i18n *values*. Deleting it orphans both keys in `en.json` and `fr.json`. That is a defensible product call — the picker genuinely supersedes the dialog — but it must be surfaced as an amendment to D14/FR7/FR8, not as a side effect of AD-14.
3. **No locale files in the delta at all.** The structural seed adds `routes/picker.tsx` with at least three new user-facing strings (dataset list, "Log in with Nixus Cloud", "+ New local profile") and lists no `locales/en.json` / `locales/fr.json` modification. `architecture-user-profile.md`'s Enforcement Guidelines require every new key in both files in the same change; the parity suite fails CI otherwise. Also unaddressed: user-facing copy says "profile" while code says `Dataset` (correctly per the spine's own naming row) — meaning the picker's EN/FR strings must be authored in the *user* vocabulary, which is worth stating so an implementer does not surface "dataset" to users.

---

### F4 — `datasets.rs` + `commands/datasets.rs` duplicates a module name, contradicting the very `profile_store.rs` precedent the spine cites for the decision

**Severity:** Medium — silent divergence from an established naming convention, with real ambiguity cost.
**Cites:** Spine Consistency Conventions / structural seed vs. `architecture-user-profile.md` Naming Patterns (`profile_store.rs`).

**The prior decision.** `architecture-user-profile.md` names the store `src-tauri/src/profile_store.rs` — explicitly **"a top-level sibling to `credentials.rs`, *not* `db/profile.rs`"** and not a new `stores/` directory — while the command layer is `commands/profile.rs`. The `_store` suffix is what keeps the sole-accessor store and its orchestrating command layer distinguishable: `profile_store.rs` vs `commands/profile.rs`, mirroring `credentials.rs` vs `commands/settings.rs`. In every prior instance, the top-level store and its command file have **different** names.

**What the spine says.** The structural seed creates both a top-level `datasets.rs` (the sole `app_data_dir`/registry authority) **and** `commands/datasets.rs` (thin orchestration). The Consistency Conventions row justifies the command-layer placement by citing "`profile_store.rs`'s top-level, non-SQLite precedent."

**The drift.** The spine invokes the `profile_store.rs` precedent while breaking the part of it that matters. Two modules named `datasets` in the same crate is legal Rust but produces exactly the ambiguity the `_store` suffix was introduced to avoid: `crate::datasets::select_dataset` and `crate::commands::datasets::select_dataset` are different functions with the same name in same-named modules, and AD-6 refers to "`select_dataset(id)` (in `commands/datasets.rs`, delegating to `datasets.rs`)" — i.e. the collision is already live in the spine's own prose, and AD-12's three bare `select_dataset(...)` references are ambiguous as to which one they mean. Following the established convention gives `dataset_store.rs` (top-level, sole authority) + `commands/datasets.rs` (orchestration).

**Naming collisions correctly avoided (the rest of check 2 passes).** For completeness, the spine does successfully dodge every other collision the two prior documents' code creates:

- `profile_store.rs` (prior) vs `datasets.rs` / `dataset_store.rs` (new) — distinct modules, distinct concerns. ✅
- `app_data_dir/profiles/` (prior, D2) vs `app_data_dir/datasets/` (new, AD-2) — AD-13 calls out the deliberate distinction explicitly. ✅
- `ProfileMenu.tsx` (prior) vs `picker.tsx` / `useDatasets.ts` (new) — no overlap, and `ProfileMenu` is correctly left untouched, preserving D11. ✅
- `queryKeys.profile` (prior, D5) vs the new dataset cache handling — no key shadowing; AD-7 uses a whole-cache `clear()` and explicitly reserves `removeQueries` for D5's use. ✅
- `/profile` route (prior, D1) vs `/picker` route (new, AD-14) — distinct paths, both outside the four-destination IA per rule D8. ✅
- `cognito_sub` as the registry's identity field name matches `UserProfile.cognito_sub` — consistent vocabulary rather than a synonym. ✅
- "Nixus Cloud" as the brand noun is used consistently and no synonym ("Nixus Sync"/"Nixus Account"/"Nixus Online") appears, satisfying NFR8's noun requirement. ✅ (The *verb* is the problem — see F3.)

**One omission in the same area:** no `queryKeys.datasets` entry is specified, and `lib/constants.ts` / `lib/types.ts` are absent from the structural seed. Both prior documents carry a hard enforcement rule against inline query keys (`architecture-login.md`: "Use `queryKeys.auth.session` from `lib/constants.ts` — never hardcode `["auth", "session"]` inline"), and `architecture-user-profile.md` fixes the flat top-level shape (`profile: ["profile"] as const`). `useDatasets.ts` needs a key declared in `constants.ts` and mirrored types in `types.ts`; as drafted, an implementer would plausibly hardcode it.

---

### F5 — AD-11/AD-12 build on `start_login`/`handle_auth_callback`, but `architecture-login.md`'s 2026-08-15 amendment superseded that entry point

**Severity:** Medium — the spine anchors its most delicate new mechanics to a function name the decision record has already replaced.
**Cites:** AD-11, AD-12 vs. `architecture-login.md` **Amendment (2026-08-15)**.

**The prior decision.** The original login doc specified `start_login` → `handle_auth_callback`. The 2026-08-15 amendment (driven by production Windows reports) replaced the custom-scheme redirect with a loopback HTTP redirect at `http://127.0.0.1:52847/callback`, and moved the callback entry point: `commands/auth_listener.rs` binds a **short-lived, single-request** local HTTP listener during `start_login`, **torn down after one request or a 5-minute timeout**, and hands the captured `code`/`state` to **`complete_auth_callback`** via the **`dispatch_deep_link_url`** entry point. The amendment is explicit that PKCE, the `state` check, the token exchange, and `credentials.rs` storage are unaffected — only "how the authorization code reaches the app."

**What the spine says.** AD-11: "`start_login` gains a `LoginIntent` enum … held in-process alongside the existing PKCE `state`/verifier across the redirect round-trip … Only `handle_auth_callback`'s post-token-exchange branch differs (AD-12)." The structural seed lists `commands/auth.rs # MODIFIED — start_login(intent: LoginIntent), handle_auth_callback branches per AD-12`. Neither `commands/auth_listener.rs`, `complete_auth_callback`, nor `dispatch_deep_link_url` appears anywhere in the spine, and the 2026-08-15 amendment is not referenced.

**The drift.** The spine's *substance* is right and its "one unchanged OAuth mechanism, branched post-callback" instinct is exactly the correct inheritance — AD-11's refusal to fork the flow is the single best decision in this cluster. But it names the pre-amendment function, so an implementer following the spine literally would look for a branch point that has been superseded. Three concrete consequences:

1. **Wrong branch site.** The post-token-exchange branch belongs at `complete_auth_callback`, reached via `dispatch_deep_link_url`, not at `handle_auth_callback`.
2. **`LoginIntent` lifetime is under-specified against the real transport.** "Held in-process alongside the existing PKCE `state`/verifier" is correct in spirit, but the amendment introduces a listener with a **5-minute timeout** and single-request teardown. `LoginIntent::Migrate(source_dataset_id)` must survive exactly that window and must be discarded on timeout — otherwise a stale `Migrate` intent could pair with a later, unrelated login and copy the wrong dataset. The spine should state that the intent's lifetime is bound to the same round-trip as the PKCE verifier, including the timeout path.
3. **The deep-link fallback still exists.** The amendment notes `nixus://auth/callback` remains recognized by `is_auth_callback_url` as a fallback shape. If `LoginIntent` is only threaded through the loopback path, the fallback path branches with no intent. Worth one sentence.

**Also in this area (minor, not a separate finding).** AD-12's reuse of `export_backup`'s `PRAGMA wal_checkpoint(TRUNCATE)` + `std::fs::copy` sequence identifies the correct primitive for the correct reason. But AD-1 simultaneously requires `db/backup.rs` to "run completely unmodified," and `architecture-user-profile.md` notes that sequence is covered by `test_backup_copy_produces_identical_file` in `db/backup.rs`, while the spine's capability map points Migrate at `commands/backup.rs`. Whether Migrate *calls* an existing `db/backup.rs` function, *extracts* a shared helper from it (which is a modification, against AD-1's letter), or duplicates the two steps is unresolved — and AD-1 explicitly forbids the third by spirit ("never a second implementation" is the standing posture, cf. `json_store.rs`). One sentence naming the exact function to call would close this.

**Also unspecified (minor):** `architecture-user-profile.md`'s Confidentiality section rejected keyring storage for profiles partly because **"keyring entries cannot be enumerated."** AD-12 requires copying "the source dataset's per-dataset AI-provider keyring entries" into the new dataset's slot. That is only possible against an explicit, known list of key names — not by enumeration. Almost certainly fine in practice (the AI/AWS key set is fixed), but the spine should say "by explicit key list" so an implementer does not attempt enumeration and quietly copy a subset.

---

## 3. Summary table

| # | Finding | Prior decision at risk | Spine locus | Severity |
| --- | --- | --- | --- | --- |
| F1 | No global-root carve-out; delete-all would silently miss `profiles/` when a non-default dataset is active | **D9**, **NFR4**, G2 | AD-5 vs AD-13 (+ AD-3) | High |
| F2 | Derived signed-in badge requires a `sub` comparison the frontend cannot legally make | **D3**, NFR3, `AuthState` shape | AD-10 (+ AD-12) | High |
| F3 | "Log in with Nixus Cloud" ≠ D14's "Sign In with Nixus Cloud"; deleted dialog orphans `auth.createAccount`/`auth.promptBody`; no locale delta | **D14**, FR7, FR8, NFR5, NFR8 | AD-14 | Medium |
| F4 | `datasets.rs` + `commands/datasets.rs` duplicate a module name, breaking the cited `profile_store.rs` precedent; `queryKeys.datasets` unspecified | `profile_store.rs` naming pattern; inline-query-key prohibition | Consistency Conventions, structural seed, AD-6/AD-12 | Medium |
| F5 | Branch point anchored to superseded `handle_auth_callback`; `LoginIntent` lifetime not bound to the loopback listener's 5-min window | `architecture-login.md` **Amendment 2026-08-15** | AD-11, AD-12 | Medium |

---

## 4. Answers to the three review questions

**(1) Do AD-9 and AD-13 match every relevant prior decision?**
AD-9 — **yes**, cleanly. The `nixus-auth`/`cognito-session` entry, the `store`/`load`/`clear_cognito_session` functions, and `sign_out` are all left untouched by name, one-session-per-machine is restated rather than assumed, and per-account isolation is pushed to Deferred with a rationale instead of being half-built. Nothing in `architecture-login.md` is weakened.
AD-13 — **in intent yes, in mechanism no.** D2's storage medium, D10's no-audit posture, D13's error reuse, and D5's `removeQueries` reservation are all correctly and explicitly inherited; D9's backup exclusion survives as a structural property. But AD-5's blanket path rule undercuts AD-13's own "stays anchored at the global root" claim and would break D9's delete-all coverage (**F1**), and AD-10 needs a `sub` comparison that D3 forbids the frontend from making (**F2**).

**(2) Does the naming avoid every collision the prior code already uses?**
**Yes for all six named surfaces** — `profile_store.rs`, `ProfileMenu.tsx`, `queryKeys.profile`, the `/profile` route, and the "Nixus Cloud" brand noun are each distinct from `Dataset`/`datasets.rs`/`datasets/`/`datasets.json`, and AD-13 calls out the `profiles/` vs `datasets/` distinction deliberately. Two exceptions: the **"Sign In" vs "Log in" verb** divergence on the "Sign In with Nixus Cloud" label (**F3**, an NFR8 consistency break rather than a hard collision), and a **self-inflicted** collision the prior docs' convention was designed to prevent — `datasets.rs` alongside `commands/datasets.rs` (**F4**).

**(3) Does AD-12's Migrate build on the exact established commands/functions?**
**Mostly yes, with one stale anchor.** AD-11's refusal to fork the OAuth flow is the correct inheritance, `credentials.rs`'s store/load/clear are correctly declared unchanged, and reusing `export_backup`'s `wal_checkpoint`+`fs::copy` instead of a fresh `init_db` is both the right primitive and the right reason. But the branch point is named `handle_auth_callback`, which the 2026-08-15 amendment superseded with `complete_auth_callback`/`dispatch_deep_link_url`/`auth_listener.rs` (**F5**), `current_subject()` — the designated single identity resolver — is never named (**F2**), and the exact backup function to call is left ambiguous against AD-1's "unmodified `db/backup.rs`" rule.

---

## 5. Scope note

This review reports drift against the existing decision record only. It proposes no alternative architecture, and every item above is framed as a conflict to surface for an explicit accept/amend decision — per the inheritance rule that a prior `status: complete` decision may be overturned deliberately and recorded (as D1 overturned Story 27.3), but never weakened silently.
