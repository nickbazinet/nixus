---
title: 'Rubric Review — Architecture Spine: Nixus Cloud Profile & Web Account'
reviewed: 'ARCHITECTURE-SPINE.md (2026-11-17, status: draft)'
date: 2026-11-17
reviewer: good-spine checklist + input reconciliation
verdict: 'NOT READY — 4 critical, 12 high'
---

# Rubric Review — Nixus Cloud Profile & Web Account spine

**Verdict:** A structurally sound spine with a correct paradigm and an unusually honest Deferred section, but it is not yet a safe build substrate: four blocking defects (delete-everything no longer erases profile PII; AD-7's launch refresh contradicts inherited D11; the local-document schema change silently quarantines every existing profile; the web form has no source for the ISO location catalog) plus twelve high findings, most of them inherited invariants weakened without declaration.

Sources used as authority: `.memlog.md` (user decisions), `INVESTIGATION.md` (baseline), the three listed input docs, the three parent spines, `docs/project-context.md`, and live code under `apps/`.

Line references of the form `spine:NN` are `ARCHITECTURE-SPINE.md` in this folder. All other references are `path:line`.

---

## 1. Scorecard

| # | Checklist item | Verdict |
| --- | --- | --- |
| 1 | Fixes the real divergence points, misses none | **Partial** — the storage/ownership/auth divergences are nailed; six surface-level divergences are undecided (C2, C4, H6, H11, M7, M8) |
| 2 | Every AD Rule enforceable and prevents its stated divergence | **Partial** — AD-8 violates its own "Prevents"; AD-4's reservation is unenforceable (H9); AD-6's "sole accessor" and "deleted with that dataset" are not enforceable as written (H3, H4) |
| 3 | Nothing under Deferred lets two units diverge | **Fail** — deferring the source-document supersession notes (spine:343) leaves four contradictory canonical rules live (L3); the billing deferral collides with AD-4/AD-11 (H9) |
| 4 | Ratifies rather than contradicts the brownfield | **Partial** — AD-9, AD-14's bootstrap finding and the throttle/runtime precedents are exact; AD-6 ("sole accessor"), AD-8 (`version` field), AD-17 (server-only gating) contradict shipped code |
| 5 | No AD weakens an inherited invariant without saying so | **Fail** — eight undeclared: user-profile D11, D13, FR4/D1, FR8, NFR4, D10; Bedrock AD-13 and its log conventions; login's `state` requirement |
| 6 | Every dimension the altitude owns is decided/deferred/open | **Partial** — deployment, environments, provider strategy and cost are complete; secrets management is absent (H7), observability is thin (M5), upgrade/downgrade is absent (C3, M13) |
| 7 | RECONCILE: memlog + input requirements landed | **Partial** — 38 of 40 memlog decisions landed faithfully; one memlog question was closed without being answered (C1) and one unconfirmed assumption was promoted to an invariant (H1). Ten input requirements landed wrong or not at all |

### Dimension coverage (checklist 6)

| Dimension | State | Finding |
| --- | --- | --- |
| Deployment / environments | Decided — AD-14 (one prod env, no staging, local default-off) | — |
| Infra & provider strategy | Decided — AD-14 + Stack table | M12 (cross-stack domain dependency unmanaged) |
| Operations | Thin — budget alert only | M5 (no log groups/retention/alarms, no budget amount, no IAM action list) |
| Secrets management | **Absent** | H7 |
| Identity & authorization | Decided — AD-2, AD-3, AD-9, AD-10 | H12 (`state`), M10 (gateway error mapping) |
| Data model & concurrency | Decided — AD-4 | M2 (missing attributes), M3 (local avatar version) |
| Wire contract | Decided — AD-13 | M1 (error mapping), M13 (no forward-compat rule) |
| On-device lifecycle | **Incomplete** | C1, H2, H3, H5 |
| Upgrade / migration | **Absent** | C3 |
| i18n | Referenced, not decided | M7 |
| Legal / disclosure | Decided — AD-16 | H1 |
| Verification gates | Decided — AD-15 | C2, M12 (uncovered regressions) |
| Build / repo ownership | Ambiguous | M8 |

---

## 2. Critical

### C1 — Delete-everything no longer erases profile PII; the cloud copy returns on the next launch

AD-7 (spine:146) says the on-disk copy is "removed by delete-all", and AD-7 (spine:142) says the copy is refreshed "on signed-in launch". Nothing in the spine says what delete-all does to the cloud `PROFILE`/`AVATAR` items. The composition is a regression of a machine-checked guarantee: `delete_all_data` wipes `profiles/` recursively (`apps/desktop/src-tauri/src/commands/danger_zone.rs:92-99`, whose own comment reads *"a failure here means profile PII is still on disk after the user asked for everything to be deleted (NFR4)"*), and the very next signed-in launch re-downloads name, date of birth, income bracket, location and avatar and rewrites the file. The existing NFR4 test still passes because it only asserts the directory is gone (`profile_store.rs:449-457`, `avatar_store.rs:428-439`).

This is also a memlog question closed without an answer: `.memlog.md:43` asks *"Does delete-all on a cloud-linked dataset delete the cloud profile, or only the local copy?"*; `.memlog.md:44` answers only the adjacent question (account deletion out of scope). `architecture-user-profile.md:57` (NFR4) states "No PII survives a full wipe"; Deferred (spine:336) defers account deletion but says nothing about delete-all. The sync spine shows the required shape: its AD-15 states the cloud consequence explicitly (*"it never touches the cloud or other computers"*).

**Fix.** Add an AD that decides this on the record, with both halves:
1. **Server route.** Add `DELETE /v1/profile` (deletes `PROFILE` and `AVATAR`) to AD-3's route set and make `delete_all_data`, on a cloud-linked dataset, call it. Per AD-1 (no queues) a failure must be surfaced, not swallowed: block the wipe with an explicit "deleting everything needs a connection" state, the same posture AD-7 already takes for Save.
2. **If the owner prefers the cloud profile to survive** (defensible — it is account data, and account deletion is deferred), say so explicitly in AD-7, require the danger-zone confirmation copy to state it (which the Local Profiles spine already asked for, `architecture-nixus-2026-08-18/ARCHITECTURE-SPINE.md:232`), add it to AD-16's legal gate, and add a release gate asserting the local copy is gone **and** no refresh re-creates it until the user re-opts. Also declare `architecture-user-profile.md` NFR4 superseded for Nixus Cloud profiles, next to the NFR2 supersession already recorded.

### C2 — AD-7's launch and post-sign-in refresh contradicts inherited D11 and the always-mounted-component E2E rule

AD-7 (spine:142) requires the copy to be refreshed "on signed-in launch, after sign-in, when the Profile page opens, and after every successful save". The Inherited table (spine:69) simultaneously binds D11 as "no new `invoke()` in always-mounted components" with the gloss "Profile fetches stay inside `/profile` and its consumers". A launch refresh and a post-sign-in refresh cannot live inside `/profile` — the user may never open it, and the post-sign-in hook is `useAuth.ts`, reached from the always-mounted shell (`architecture-user-profile.md:335`, `apps/desktop/src/routes/__root.tsx` mounts `ProfileMenu`/`AccountPromptDialog`).

The cost of getting this wrong is repo-wide and documented twice: `docs/project-context.md:361-365` (*"When adding any always-mounted root-level component that calls `invoke()` on load … every existing spec's Tauri mock must add a case for the new command(s), or that spec's mock falls through to `Promise.reject("Unknown command")`"*) and the Local Profiles spine at `architecture-nixus-2026-08-18/ARCHITECTURE-SPINE.md:142` (*"today's ~30 spec files each inline their own mock with no shared helper"*). Two implementers will split: one adds a root-level effect and breaks ~30 specs; the other drops the launch refresh and AD-7's "instant render at launch" rationale (`.memlog.md:67`) evaporates.

**Fix.** Decide the trigger site in AD-7. Recommended: run the launch and post-sign-in refresh **in Rust**, inside the existing session-resolution path (`commands/auth.rs::resolve_session`/`current_subject`, already on every launch), so no new IPC and no new always-mounted `invoke()` exists; the frontend keeps reading only through the `/profile` route's commands. State the D11 preservation as an explicit sentence in AD-7. If a frontend trigger is chosen instead, AD-7 must say that auditing and updating every existing Playwright spec's mock switch is in scope, and AD-15 must gate on it.

### C3 — Adding a `version` field to the local document quarantines every existing profile and destroys AD-8's own trigger

AD-8 (spine:154) defines the legacy class as "a `profiles/<sub>.json` without a `version` field". No such field exists; the shipped struct is `UserProfile { schema_version: u32, cognito_sub, … }` with `PROFILE_SCHEMA_VERSION = 1` (`apps/desktop/src-tauri/src/models/mod.rs:1037-1049`, `profile_store.rs:10`). Two upgrade paths both fail as written:

- Add `version: u32` as a required field at `schema_version: 1` → today's files fail to deserialize → `load_profile` calls `quarantine_corrupt_document` and renames the file to `<sub>.json.corrupt`, returning `Ok(None)` (`profile_store.rs:139-156`, `:175`). AD-8's detection then never fires, because the legacy document no longer exists at the path it scans. The user's date of birth and income bracket are silently orphaned in a `.corrupt` file and the cloud profile starts empty — a data-loss path on first launch after upgrade.
- Bump to `schema_version: 2` without a compatibility rule → an older binary (or a downgrade) reads the file as "no profile" and leaves it in place (`profile_store.rs:180-186`; test `a_future_schema_version_reads_as_no_profile_without_renaming`, `profile_store.rs:847-861`).

**Fix.** AD-4/AD-6/AD-8 must pin the on-disk document's evolution explicitly: keep `schema_version: 1`, add `#[serde(default)] version: Option<u32>` and `#[serde(default)] upload_declined: bool` so pre-upgrade files still deserialize; define the AD-8 legacy class as "`schema_version == 1` with `version == None`"; and add to AD-15 a gate asserting a pre-upgrade `profiles/<sub>.json` is **not** quarantined and **is** offered for upload. If a `schema_version` bump is preferred instead, state the downgrade semantics (older binary blanks the Profile page) and accept it on the record.

### C4 — The web account app has no source for the ISO 3166 catalog, so CAP-5 cannot render country/subdivision

AD-5 (spine:120) says "The ISO dataset is a single checked-in file consumed by Rust (`include_str!`) and bundled into the Lambda" — the account app is not in that list, and AD-3's route set (spine:99) is exactly `GET /`, `PUT /`, `GET /avatar`, `PUT /avatar`, with no catalog route. Today the desktop obtains the lists through Tauri-only commands `get_countries`/`get_subdivisions` (`apps/desktop/src-tauri/src/commands/profile.rs:133-145`) over a ~570 KB embedded file (`profile_store.rs:15-18`). The browser can reach neither. Since the Lambda is the final validation authority (AD-5), free-text entry is rejected server-side, so the web profile form cannot offer a valid location at all — and the display-name fallback rule (`architecture-user-profile.md:678`, `name_en` required / `name_fr` optional) has nowhere to live on the web.

The obvious workaround is the one AD-5 and its parent explicitly forbid: a second copy of the dataset in `apps/account` (`architecture-user-profile.md:406`, *"The dataset is embedded in the Rust binary only. The frontend must not ship or import its own copy"*).

**Fix.** Add `GET /v1/profile/locations` (unauthenticated or scope-authorized, immutable `Cache-Control`, served from the Lambda's bundled copy) to AD-3's route set and to the `account.ts` contract in AD-13. In AD-5 and the Structural Seed, name the dataset's single canonical home (e.g. `packages/shared/data/iso3166.json`, consumed by Rust via `include_str!` and bundled into the Lambda) and state that neither `apps/account` nor any frontend ships a copy; add the no-second-copy check to AD-15 beside the allow-list parity test.

---

## 3. High

### H1 — In-app copy that states profile data never leaves the machine is outside AD-16's gate, and AD-16 forbids adding any other in-app disclosure

AD-16 (spine:230) gates rollout on the README, Privacy Policy and Terms, then narrows in-app disclosure to the AD-8 prompt only (spine:231). Two shipped strings become false the moment a cloud profile exists, in both locales:

- `apps/desktop/src/locales/en.json:53` — `profile.signInRequiredBody`: *"Your profile is tied to your Nixus account. Nothing else in Nixus needs one, and no profile data leaves this machine."* (`fr.json:53` same claim)
- `apps/desktop/src/locales/en.json:86` — `profile.avatar.hint`: *"PNG or JPEG, up to 4 MB. Kept on this machine, with your account."* (`fr.json:86` same claim)

`architecture-user-profile.md:50` (FR8) makes this a requirement, not a nicety: *"Copy must remain literally accurate for the current state … must not drift out of alignment."* AD-16 inherits none of it. Separately, AD-8 introduces an in-app consent gate while inherited Bedrock AD-13 states disclosure is Terms/Privacy with *"no in-app consent gate is built"* (`architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md:111-114`) — a deliberate and correct departure that the Inherited table never records. Finally, AD-16's narrowing rests on an assumption the memlog flags as unconfirmed: `.memlog.md:78` — *"Not explicitly confirmed by user."*

**Fix.** Extend AD-16 to name the in-app strings that must change as release-blocking (`profile.signInRequiredBody`, `profile.avatar.hint`, EN and FR in the same change per the parity suite), add FR8 to the superseded-requirements list beside NFR2, add a row to the Inherited table declaring the departure from Bedrock AD-13, and mark AD-16's "consent prompt only" clause as resting on `.memlog.md:78` pending confirmation rather than as a settled invariant.

### H2 — Delete-all destroys other datasets' local demographics, which now have no cloud copy to restore from

`delete_all_data` resolves `datasets::global_root` and wipes the whole `profiles/` directory (`commands/danger_zone.rs:92-99`), so a wipe from *any one* dataset erases every document in it. The Local Profiles spine accepted that deliberately and flagged it (`architecture-nixus-2026-08-18/ARCHITECTURE-SPINE.md:232`: *"a real, user-visible consequence worth calling out explicitly (and possibly surfacing in the danger-zone confirmation copy)"*) — acceptable when every document was a `sub`-keyed account profile. AD-6 (spine:131) changes the stakes: `profiles/local-<dataset-id>.json` is the **only** copy of that data, by design ("never uploaded"). AD-7 (spine:146) addresses only the cloud copy and the avatar cache. So wiping cloud-linked dataset A irreversibly destroys local dataset B's demographics, with no cloud to re-fetch from and no statement anywhere that it happens.

**Fix.** AD-6 must decide and state the delete-all scope for `local-*` documents — either keep the machine-wide wipe and require the danger-zone confirmation copy to say "this also clears the demographics of your other local profiles" (EN/FR), or scope the local-document removal to the active dataset and leave the `<sub>.json` wipe machine-wide. Either way add the assertion to AD-15 so the existing directory-emptiness test cannot pass vacuously.

### H3 — AD-6's "deleted with that dataset" depends on a code path that does not exist

AD-6 (spine:131) says the local document is "deleted with that dataset". The Local Profiles spine deferred exactly that capability: *"Dataset deletion / rename from the picker. Confirmed future work per the SPEC's own non-goals; no directory-removal or registry-mutation path is built now"* (`architecture-nixus-2026-08-18/ARCHITECTURE-SPINE.md:229`). The rule is therefore unenforceable at build time and silently becomes a dangling obligation on a future spine.

**Fix.** Restate AD-6 as a forward obligation plus a present rule: "dataset deletion does not exist yet; when it lands it must delete `profiles/local-<dataset-id>.json` through `profile_store`. Until then, orphaned `local-*` documents are tolerated, and a startup reconciliation against `datasets.json` removes documents whose dataset id is no longer registered." Name the reconciliation owner so the orphan sweep is not re-invented per story. This also closes the backup/restore orphan case, which the spine never mentions: the demographics of a local dataset live outside the SQLite file that backup copies, so a restore cannot move them with the data.

### H4 — AD-6's "sole accessor" claim contradicts shipped code

AD-6 (spine:129) states "`profile_store.rs` remains the sole accessor of `app_data_dir/profiles/`". It is not: `avatar_store.rs` opens its own SQLite file in the same directory (`apps/desktop/src-tauri/src/avatar_store.rs:28` `DB_FILE_NAME = "avatars.db"`, `:49-51` `avatars_db_path`, doc comment `:3-9` *"It lives beside the demographic profile documents instead, under the same `profiles/` directory"*), and `profile_store.rs:106-116` says so in a comment: *"Crate-visible because `avatar_store` writes under the same `profiles/` directory and must not carry a second charset rule."* As written, the AD either reads as false or as an instruction to collapse `avatar_store` into `profile_store`.

**Fix.** Restate AD-6 precisely: "`profile_store.rs` owns the demographic documents and is the single authority for the `sub` / dataset-id charset rule (`validate_sub`); `avatar_store.rs` is the only other permitted accessor of `profiles/`, for `avatars.db`; no third accessor exists, including `danger_zone`, which calls `profile_store::delete_all_profiles`."

### H5 — `local-<dataset-id>.json` shares a filename namespace with `<sub>.json` with no guard

Paths are built as `{sub}.json` (`profile_store.rs:92-94`), and `validate_sub` accepts `^[A-Za-z0-9_-]{1,128}$` (`profile_store.rs:110-116`) — so a subject literally named `local-…` is charset-legal, while dataset ids are alphanumeric + `-` (`apps/desktop/src-tauri/src/datasets.rs:156-160`). Nothing in AD-6 prevents a collision, and AD-8's legacy scan ("a `profiles/<sub>.json` without a `version` field", spine:154) would happily classify a local-dataset document as a legacy cloud document and offer to upload it — the single thing AD-6 exists to prevent ("A local profile's demographics leaking into the cloud", spine:127).

**Fix.** Add a structural guard to AD-6: reject any `sub` matching `^local-` in `validate_sub`, **or** put local documents in their own subdirectory (`profiles/local/<dataset-id>.json`). State that AD-8's scan reads only cloud-keyed paths. Add a unit test for the collision.

### H6 — The avatar has two derivative pipelines and two mime allow-lists; the desktop will reject avatars the server accepts

AD-4 (spine:109) pins the stored avatar to "the bounded avatar derivative (256 px, ≤ 64 KiB, same contract as `avatar_store.rs`)" and AD-5 (spine:119) sets a 64 KiB wire ceiling. The shipped contract is narrower than either states: the table enforces `CHECK (length(image_bytes) <= 65536)` and `CHECK (mime_type IN ('image/png', 'image/jpeg'))` (`avatar_store.rs:98-99`), with 256 px and 64 KiB coming from `projects/image.rs:38,42`, and user-facing input ceilings of 4 MB and 12 MP (`en.json:91`, `:94`). `docs/project-context.md:188` requires ceilings enforced "in Rust *and* as separately-named SQLite `CHECK` constraints".

Consequence: the account app must reproduce the same 256 px / ≤64 KiB derivative in a browser or in Node. If it accepts WEBP or HEIC (the natural browser default), the Lambda stores it, and the desktop's `CHECK` constraint then refuses to cache it — a cloud avatar the desktop can never display, surfaced as a generic write failure. Who resizes is undecided, so two stories will build two pipelines, which is the drift AD-5 exists to prevent for validation and omits for image processing.

**Fix.** Name **one** resizing authority in AD-5 — recommended: the profile Lambda produces the derivative on `PUT /avatar` from a bounded original (4 MiB / 12 MP, `image/png` or `image/jpeg` only), so desktop and web both send the original and neither owns a second pipeline. Put the allowed input mime set and both input ceilings in `account.ts` (AD-13) so `unsupported_media` and `payload_too_large` are the same on every surface, and state that `avatar_store`'s `CHECK` constraints stay the server-contract mirror.

### H7 — No secret-management decision for the confidential Cognito client secret

AD-10 (spine:173) requires "a confidential Cognito app client (secret only in the account server)" and says nothing about where that secret lives or how it gets there. AD-14's deploy-role grant list (spine:207) covers Cognito user-pool-client, API mapping, CloudFront, S3 and Lambda URL actions — no SSM or Secrets Manager. The repo has a precedent the spine does not cite (`architecture-entitlements-licensing.md:147`: SSM Parameter Store SecureString), and the Bedrock spine requires exact IAM actions rather than prose (`architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md:214`). Left open, one story puts the secret in a Lambda environment variable (visible to anyone with `lambda:GetFunctionConfiguration`, and printed by `sam deploy` output) and another in SSM.

**Fix.** AD-10 must pin the store and AD-14 the grants: SSM Parameter Store `SecureString` at one named path, read once at cold start, `ssm:GetParameter` + `kms:Decrypt` scoped to that exact ARN on the account-app role, the matching `ssm:PutParameter` on the deploy role (or a documented one-time manual seed, consistent with the console-managed-pool posture), and an explicit prohibition on the secret appearing in a Lambda env var, the template, or the repo. Add it to AD-12's "never log" list.

### H8 — AD-17 [ADOPTED] contradicts the shipped sync entitlement, which is enforced on the client only

AD-17 (spine:239) states "Cloud-run premium features are gated on the server only." The baseline says otherwise for the one cloud-run premium feature that exists besides hosted AI: `INVESTIGATION.md:23` — *"Sync … Entitlement is enforced only on the client"* — with `entitlements.rs` mapping a single `/v1/ai/status` boolean onto `MULTI_DEVICE_SYNC` (`INVESTIGATION.md:22`, `.memlog.md:12`), and the sync spine's own AD-14 treating entitlement as one client-side capability flag. As an [ADOPTED] present-tense invariant, AD-17 is false on arrival; as a forward-looking principle it is fine but unlabelled, so a story could read it as an instruction to re-architect sync gating inside this scope.

**Fix.** Split AD-17 into the principle and its current exception, in the style the sync spine used for its Bedrock AD-12 deviation: state that sync's gate is client-side today, that moving it server-side is owned by the billing spine, and that no new premium capability may ship with a client-side gate. Note the manual `put-item` runbook as the current authority so the exception has an end condition.

### H9 — AD-4's reserved billing sort keys are unwritable under AD-11, and a second `USER#<sub>` entitlement home already exists

AD-4 (spine:112) reserves `sk = ENTITLEMENT` and `BILLING_CUSTOMER` on the profile table. AD-11 (spine:184) then gives the profile Lambda sole write access and the account-app role *no* access to that table, with a CI guard; AD-2 (spine:90) forbids the profile API from touching entitlement state. The billing spine is told to write `ENTITLEMENT` (spine:334) — but every writer it could use is prohibited by AD-11 or AD-2, so the reservation is nominal rather than enforceable. Compounding it, `USER#<sub>` entitlement state already lives in a different table in a different stack (`HostedAiTable … USER#<sub>/CONFIG {premium, monthly_request_limit}`, `INVESTIGATION.md:21`, `.memlog.md:11`), which is exactly the "two sources of is this user premium" the investigation warned about (`INVESTIGATION.md:33`).

**Fix.** AD-4 must say who may write the reserved keys and how the prohibition is expressed: a billing Lambda inside `nixus-account` whose IAM policy carries a `dynamodb:LeadingKeys`/condition-scoped grant limited to those sort keys, with the profile Lambda's own policy `sk`-scoped to `PROFILE`/`AVATAR` so AD-11's single-writer rule survives the addition. Add a sentence noting the pre-existing `HostedAiTable` record so the billing spine inherits one decision point, not two silent homes.

### H10 — Audit logging is never addressed, and the project's mandatory rule would re-introduce profile PII into the backed-up database

`docs/project-context.md:400` lists "skipping audit log on mutations" as an anti-pattern — *"every create/update/delete must call `audit_db::insert_audit_log`"* — and `:122-126` makes it part of the command template. `architecture-user-profile.md:243-247` (D10) resolved this for the file-backed store and recorded the consequence: *"profile values never enter `nkbaz-finance.db` at all, so they cannot leak into a backup through the audit trail."* The spine mentions audit logging nowhere, while AD-12 (spine:190) forbids profile field values in logs. An implementer following `project-context.md` adds an audit row for the save path, which simultaneously violates AD-12 and reverses the structural backup-exclusion property of D9/D10.

**Fix.** Add one clause to AD-12 (or AD-6): cloud-profile and local-profile mutations write no `audit_log` row, inheriting `architecture-user-profile.md` D10; no profile field value, avatar byte or base64 string may appear in an audit row; `project-context.md`'s mandatory-audit rule governs SQLite domain mutations, which these are not.

### H11 — CAP-3 has no UI rule: `/profile` is session-gated, so a local dataset cannot reach its own demographics

AD-6 gives local datasets editable demographics (spine:131) and a resolver (spine:133), and the Capability map sends both CAP-2 and CAP-3 to the same Profile page (spine:325-326). That page is session-gated by inheritance: a four-way branch where `LoggedOut` and `SessionExpired` both render `SignInRequired` (`architecture-user-profile.md:674`, D1 at `:325`), the entry point is hidden without a session (`architecture-user-profile.md:46`, FR4: *"When no session exists, the Profile entry point is not shown and no profile data is readable"*), and the signed-out copy is the string flagged in H1 (`en.json:52-53`). No AD says what replaces that branch for a local dataset, whether the menu item appears, or whether `SignInRequired` still exists. Two stories will diverge on the primary surface of a whole capability.

**Fix.** Extend AD-6 with the surface rule: `/profile` branches on the **active dataset kind first** — local → the local document, editable with no session requirement; cloud-linked → today's session-gated cloud path with `SignInRequired`. State that the Profile menu entry is visible for a local dataset, and declare `architecture-user-profile.md` FR4 and D1's guard superseded for local datasets in the Deferred source-document list.

### H12 — AD-10 drops the OAuth `state` CSRF check that the login spine made mandatory

`architecture-login.md:107` is explicit and gives the reason: *"A random `state` parameter is also generated per login attempt and verified on callback, as standard CSRF protection independent of PKCE (PKCE protects the code exchange; `state` protects the redirect itself)."* AD-10 (spine:173-176) lists PKCE, the single callback, cookie attributes, the session table and `Origin` verification on non-GET server functions — no `state`, no `nonce`, and its "Prevents" list (spine:171) omits login CSRF entirely. The web redirect flow is the one place where the attack `state` prevents is live.

**Fix.** AD-10 must require a per-attempt `state` and an id_token `nonce`, stored in a short-lived pre-session cookie and verified at `/auth/callback`, mirroring the desktop rule; and a sign-out that also ends the Managed Login session (hosted `/logout` redirect) so "sign out" is not undone by the next sign-in click. Add the `state`-mismatch rejection to AD-15's gates.

---

## 4. Medium

### M1 — `AppError::CloudProfile` overturns D13 silently, and the wire-code → variant mapping is undecided

AD-13 (spine:199) adds one new desktop error variant. `architecture-user-profile.md:277` (D13) says the opposite — *"Errors: reuse, don't extend … No new `AppError` variant is introduced"* — and `:447` repeats it as an enforcement rule. The change is defensible; the silence is not. Separately, two of the eight wire codes (`validation`, `unavailable`) already exist as `AppError` types (`docs/project-context.md:135-140`), so one implementer maps wire `validation` to `AppError::Validation { field }` (which the form's `setError(field)` path already consumes, `architecture-user-profile.md:431`) and another nests it inside `CloudProfile.code`.

**Fix.** Add D13 to the superseded list in Deferred, and put the full mapping table in AD-13: which wire codes stay inside `CloudProfile.code` and which (if any) map onto existing variants — recommended, all eight stay inside `CloudProfile` so the closed union has exactly one representation, with a note that `field` still feeds `setError`.

### M2 — AD-4 omits `cognito_sub`, `schema_version` and `created_at`, breaking the mismatch guard and `created_at` preservation

AD-4 (spine:109) says `sk = PROFILE` holds "the `UserProfile` fields plus an integer `version` and `updated_at`". Two shipped invariants depend on fields the wire contract never names. The in-document `cognito_sub` mismatch guard treats a mismatched document as "no profile" (`architecture-user-profile.md:208`; test at `profile_store.rs:871-877`), so a copy written from a server response that omits `cognito_sub` reads back as absent. And `created_at` must be carried forward verbatim and set only at creation (`architecture-user-profile.md:676`, G5) — AD-4 mentions only `updated_at`, so a server that regenerates `created_at` on every `PUT` destroys it silently.

**Fix.** AD-4 and AD-13 must list the exact `PROFILE` attributes and the exact `GET`/`PUT` response body, including server-owned `created_at` (set once, never overwritten), and state whether the desktop re-stamps `cognito_sub`/`schema_version` locally when writing the copy or the server returns them.

### M3 — The local avatar cache has no version column, so AD-4's concurrency cannot be mirrored on device

AD-4 (spine:109) gives the `AVATAR` item a `version`, and the `PUT` rule (spine:110) applies `expected_version` generally. The shipped table is `cognito_sub TEXT PRIMARY KEY, image_bytes BLOB, mime_type TEXT, uploaded_at TEXT` (`avatar_store.rs:92-100`) — no version column. AD-7 also never says when the avatar is refreshed, while AD-4's "Prevents" explicitly separates avatar bytes from profile reads.

**Fix.** AD-7 must state the avatar refresh trigger (recommended: with the profile refresh, conditional on a version returned by `GET /` so the 64 KiB body is not fetched every launch), and AD-4 must say that `avatar_store` gains a `version` column with its named `CHECK` constraints retained — or that avatar writes are unconditional and the `AVATAR` version is server-only.

### M4 — AD-9 understates a real refactor of the token path

AD-9 (spine:164) describes "one call-time access-token accessor parameterized by required scope (120 s skew, one refresh-and-retry on `401`)" as if it exists. Today it is hardcoded to a single scope and the retry lives elsewhere: `HOSTED_AI_SCOPE` is a const (`commands/auth.rs:54`), `access_token_has_hosted_scope` checks only it (`:1167-1171`), `hosted_ai_token()` takes no parameter (`:1185-1190`), `refresh_hosted_ai_token()` exists for "the single 401 retry the closed fallback table allows" (`:1192-1211`), and the retry loop itself is in `ai/hosted_bedrock.rs:268-301` and `:425`, entangled with `HostedOutcome`/`StatusRead`. `COGNITO_SCOPES` is `"openid email profile nixus-api/ai.invoke"` (`:56`).

**Fix.** AD-9 should name the refactor target and its boundary: a scope-parameterized accessor returning a scope-agnostic result, the single refresh-and-retry moved into that shared layer, `HostedAiAuth` retained as a hosted-AI adapter, and an explicit statement that `ai/hosted_bedrock.rs`'s closed fallback table is behaviourally unchanged (it is the one place a regression would be invisible).

### M5 — The operational envelope drops three things the Bedrock spine already settled

AD-14 (spine:210) offers "an AWS Budget alert" with no threshold and no alarms; AD-12 covers log *content* only. The inherited posture is more specific: *"Structured CloudWatch JSON logs, no request/response bodies, 14-day retention, explicit log group (CloudFormation-created; not `logs:*`)"* and exact IAM actions "no broad prose" (`architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md:213-214`), plus a $50/month budget at 80%/100% and separate CloudWatch alarms (its AD-14). Lambda log groups created implicitly never expire, which is both a cost and an AD-12 exposure surface.

**Fix.** AD-14 should carry all three forward: CloudFormation-created log groups with 14-day retention for both Lambdas, a named budget threshold, at least one 5xx/throttle alarm, and the exact IAM action list for each role. Add the inherited log convention to the Inherited table so the omission cannot recur.

### M6 — Two inherited invariants are mis-attributed

Both rows in the Inherited table misstate their source:

- spine:70 attributes "a Nixus Cloud dataset opens only with a valid session" to Local Profiles AD-10. That AD (`architecture-nixus-2026-08-18/ARCHITECTURE-SPINE.md:112-116`) governs only how the signed-in/out **badge** is computed. The real gate is code: `select_dataset`/`authorize_selection` refuse a cloud-linked dataset unless `current_subject()` succeeds (`.memlog.md:66`). AD-7's whole offline story rests on this, so an implementer "preserving AD-10" preserves the wrong thing.
- spine:76 labels profile and avatar `LocalOnly`. The sync spine reserves `LocalOnly` for tables **inside** the dataset DB (its AD-5, AD-15); profile and avatar are excluded as non-DB files and are never run through that registry (`architecture-multi-device-sync-2026-10-13/ARCHITECTURE-SPINE.md:286`).

**Fix.** Cite the code gate directly (or promote it to its own AD, since AD-7 depends on it); replace `LocalOnly` with "not part of the dataset DB or its sync registry". Also add the sync spine to the Deferred source-document list: this spine resolves its deferred *"Syncing them needs a separate decision and mechanism"* for cloud profiles, and that resolution should be recorded there.

### M7 — The account app's i18n mechanism is referenced but not decided

The Consistency Conventions row (spine:250) asks for "EN/FR for every user-visible string (locale parity tests)" without saying how. The two existing mechanisms differ: `apps/web` uses `src/locales/{en,fr}.json` with `/fr/*` routes (`docs/project-context.md:294-296`, `:346-347`), the desktop uses flat dotted keys with a parity suite in `src/locales/__tests__/`. The account app also needs the same profile field, bracket, avatar-error and validation labels the desktop already owns under `profile.*` (`en.json:54-95`), so without a decision they get forked and drift. And `architecture-user-profile.md:61` (NFR8) is a live constraint the spine never carries: "Nixus Cloud" is untranslated in FR, no synonym may be introduced, and the term spans desktop, web and Cognito Managed Login branding.

**Fix.** Pin the mechanism in AD-10 or a new AD: reuse `apps/web`'s locale-file + `/fr/*` route convention, copy its parity test into `apps/account`, state where the shared profile labels live (recommended: label keys stay per-app, but the bracket/currency/error **code** vocabulary comes from `account.ts` so only display strings are duplicated), and restate NFR8's brand-term rule as binding on the account app and the web Cognito client's Managed Login branding.

### M8 — The `apps/api-account` / `apps/account` build and ownership split is unstated

The Structural Seed (spine:270-272) gives `apps/api-account` the stack template and `apps/account` the nitro BFF, while AD-14 (spine:206-211) puts both Lambdas, CloudFront, S3 and both tables in the single `nixus-account` stack with one `account-ci.yml`. Nothing says which package builds the nitro bundle, that the account-app build must run before `sam deploy`, or whether the two can release independently — against a precedent of "three independently deployable units … none share a cadence" (`architecture-entitlements-licensing.md:336`).

**Fix.** State in AD-14: `account-ci.yml` builds `apps/account` (nitro `aws_lambda` preset) and `apps/api-account`'s Lambda, then `sam deploy`s the single `nixus-account` stack; one stack means one cadence, so a web-only change still deploys the profile Lambda's current artifact. Note the account app's Node version explicitly (see L2).

### M9 — AD-5's "bracket↔currency pairing" is directionally ambiguous

AD-5 (spine:119) says "currency allow-list with bracket↔currency pairing". The resolved rule is asymmetric: *"setting `income_bracket` without `income_bracket_currency` is rejected … A currency without a bracket is permitted and inert"* (`architecture-user-profile.md:668`, G3), with its own user-facing string (`en.json:71`). Read symmetrically, the Lambda rejects a currency-only document the desktop accepts today — the exact "desktop accepting a value the server rejects" AD-5 exists to prevent.

**Fix.** Quote the asymmetry verbatim in AD-5, naming `income_bracket_currency` as the `validation` error's `field`.

### M10 — Throttle and insufficient-scope responses are not mapped to the error envelope

AD-13 (spine:197-198) closes the error union with `rate_limited` and `reauthentication_required` and says "API Gateway authorizer `GatewayResponses` emit the same envelope" without naming which responses map to which code. AD-14 adds a stage throttle (spine:210), whose 429 comes from the gateway, not the Lambda. And a token missing `nixus-api/profile` yields a gateway 403, while inherited Bedrock AD-3 classifies missing scope *locally on the desktop* (`architecture-nixus-2026-08-25/ARCHITECTURE-SPINE.md:61-64`).

**Fix.** AD-13 should name the `GatewayResponse` types to override (`UNAUTHORIZED`, `ACCESS_DENIED`, `THROTTLED`, `DEFAULT_4XX`, `DEFAULT_5XX`) and the wire code each emits, and state that an insufficient-scope 403 is reclassified as `reauthentication_required` by the client (matching Bedrock AD-3) rather than by the gateway — which matters because a Cognito refresh returns the originally granted scopes, so AD-9's refresh-and-retry can never recover from it.

### M11 — The new OIDC bootstrap has no deployment path, and the only precedent used the static keys this spine defers removing

AD-14 (spine:207) correctly identifies that `github-oidc-deploy.yaml` cannot deploy `nixus-account` — verified: every permission is scoped to `${ApplicationStackName}`, default `nixus-bedrock-api` (`infra/bootstrap/github-oidc-deploy.yaml:65-72`, resource patterns at `:221-222`, `:288`, `:295`, `:452-458`, `:473-474`), with the trust policy pinned to `environment:production` (`:188-195`). What it does not say is how the new bootstrap stack itself gets deployed. The documented precedent points at a workflow that is not in the repo — `.github/workflows/api-bedrock-oidc-bootstrap.yml` is referenced at `github-oidc-deploy.yaml:12` but `.github/workflows/` contains only `release.yml`, `api-bedrock-ci.yml`, `desktop-ci.yml`, `web-ci.yml`, `sync-infra.yml` — and that bootstrap was deployed "using the repository's pre-existing static web-deploy keys" (`:13-14`), the same keys still live in `sync-infra.yml:79-82` and `web-ci.yml:172-175` and whose removal this spine defers (spine:341).

**Fix.** AD-14 should state how the bootstrap is applied (recommended: a one-time owner-run `aws cloudformation deploy` from a workstation, recorded in a runbook, so no static key is involved) and that `account-ci.yml` uses only the new OIDC role. Note that the referenced bootstrap workflow no longer exists, so the stale pointer is not treated as a live pipeline.

### M12 — The cross-stack custom-domain dependency is unmanaged, and the regression it risks is not gated

AD-3 (spine:98) attaches the profile API by an `AWS::ApiGatewayV2::ApiMapping` with key `v1/profile` and says `nixus-account` "never edits the domain or the Bedrock mapping". The domain is owned by SAM's `Domain` shorthand on an `AWS::Serverless::Api`, with `BasePath: [/]` and a Route53 record (`apps/api-bedrock/template.yaml:133-141`) — i.e. a v1 `BasePathMapping` managed by a template this spine does not control. The longest-match behaviour was verified (`.memlog.md:56`), but the spine records no deploy ordering, no indication that the domain is referenced by name with no CloudFormation export, nothing about what happens if `api-bedrock` is replaced, and — most importantly — no gate on the thing that would break: hosted AI routing through the catch-all.

**Fix.** AD-3/AD-14 should record the ordering (the `api-bedrock` domain must exist before `nixus-account` deploys), the by-name reference with no export, the consequence of an `api-bedrock` domain replacement, and add to AD-15 a post-deploy assertion that `GET https://api.nixusapp.com/v1/ai/status` still reaches the Bedrock API after the mapping lands.

### M13 — No wire forward-compatibility or downgrade rule

AD-4 adds a server-owned `version`, AD-13 a closed error union. Neither says how an older desktop reacts to a new response field or an unknown error code, and the local store's existing behaviour makes the failure silent rather than loud: an unrecognized `schema_version` reads as "no profile" and blanks the page (`profile_store.rs:180-186`).

**Fix.** Add to AD-13: wire changes are additive only; clients ignore unknown response fields; an unknown error code maps to `unavailable` with the generic recoverable message. State the server-ahead-of-client posture explicitly, since the desktop ships on its own cadence.

---

## 5. Low

- **L1** — The 64 KiB avatar ceiling is `MAX_PROJECT_THUMBNAIL_BYTES` (`apps/desktop/src-tauri/src/projects/image.rs:38`), a project-thumbnail constant reused for avatars, and AD-5 now pins the same number a third time in `account.ts`. Name one authority, or state the coupling so a thumbnail-size change does not silently move the avatar contract.
- **L2** — `web-ci.yml:56,162` runs Node 20 while every other workflow and both Lambdas run 22 (`apps/api-bedrock/template.yaml:112-118`, `apps/api-bedrock/package.json:6-8`). Since `apps/account` reuses `apps/web`'s TanStack Start line (spine:260), state the account app's Node version in the Stack table so CI does not inherit 20.
- **L3** — Deferred "Source-document updates" (spine:343) names only `architecture-entitlements-licensing.md` and `architecture-user-profile.md` NFR2. It omits user-profile FR8 (H1), D13 (M1), NFR4 (C1), FR4/D1 (H11) and D10 (H10); the sync spine's deferred profile/avatar item (M6); and `architecture-web.md`'s planned `/account`, `/account/billing`, `/login` routes (`INVESTIGATION.md:24`), which this spine supersedes by moving the account surface to a separate app and subdomain. Deferring the notes is what makes checklist 3 fail: until they land, an implementer reading the canonical input docs builds against rules this spine reversed.
- **L4** — The revisit condition recorded with the cache-lifecycle decision (`.memlog.md:40`, *"Revisit when the cache becomes the only on-device copy of PII for multiple accounts"*) is dropped from AD-7 and from Deferred. Carry it into the Deferred bullet on purging the copy, so the trigger survives.

---

## 6. RECONCILE (checklist 7)

38 of the 40 `.memlog.md` decisions landed faithfully, including every fork resolution (F2→AD-1, F3→AD-2, F4→AD-10, F7→AD-3/AD-14, F9→AD-8), the full ops batch (`.memlog.md:77`→AD-14/AD-15/AD-16), the nitro pin and version set (`:49`, `:80`→Stack), the bootstrap correction (`:73`→AD-14), the no-WAF decision (`:76`), and the migrate-copies-nothing rule (`:68`→AD-6). The gaps:

| # | Source | Requirement | Landed? | Finding |
| --- | --- | --- | --- | --- |
| R1 | `.memlog.md:43` | "Does delete-all on a cloud-linked dataset delete the cloud profile, or only the local copy?" | **No** — `:44` answered only the adjacent account-deletion question; the spine is silent | C1 |
| R2 | `.memlog.md:77` | "account app v1 = sign in, view/edit profile, avatar, sign out, EN/FR" | **Partial** — no AD scopes the v1 surface; EN/FR unpinned, avatar path and location catalog unbuildable | C4, H6, M7 |
| R3 | `.memlog.md:78` | "In-app disclosure = the consent prompt only … **Not explicitly confirmed by user**" | **Wrong** — promoted to an AD-16 invariant without the unconfirmed flag, and it is what leaves `en.json:53` false | H1 |
| R4 | `.memlog.md:83`, `:84`, `:85` | Legacy-upload detection, session parameters, avatars Nixus-Cloud-only — all recorded as `(assumption)` | **Wrong register** — AD-8, AD-10 and AD-6 present them as settled; only AD-1/AD-2/AD-17 carry `[ADOPTED]`, so a reader cannot tell confirmed from assumed | C3 (detection), H1 (register) |
| R5 | `.memlog.md:40` | Revisit condition on the cache lifecycle | **No** — condition dropped | L4 |
| R6 | `.memlog.md:8`, `:12` | Profile excluded from backup; `entitlements.rs` maps one boolean to `MULTI_DEVICE_SYNC` | **Partial** — backup posture cited only by reference (D6/D9) and never stated for the new local documents, which are the only copy; the entitlement mapping is contradicted by AD-17 | H2, H3, H8 |
| R7 | `architecture-user-profile.md:57` (NFR4) | "No PII survives a full wipe" | **No** | C1 |
| R8 | `architecture-user-profile.md:50` (FR8) | In-app copy must stay literally accurate | **No** | H1 |
| R9 | `architecture-user-profile.md:243-247` (D10) | No audit logging for profile mutations; values never enter `nkbaz-finance.db` | **No** | H10 |
| R10 | `architecture-user-profile.md:46`, `:325`, `:674` (FR4, D1, G4) | Session guard and four-way branch on `/profile` | **No** — CAP-3 needs the opposite and the spine never says so | H11 |
| R11 | `architecture-user-profile.md:277`, `:447` (D13) | "No new `AppError` variant is introduced" | **Reversed silently** | M1 |
| R12 | `architecture-user-profile.md:61` (NFR8) | "Nixus Cloud" untranslated in FR; term reserved across desktop, web and Managed Login | **No** | M7 |
| R13 | `architecture-user-profile.md:668` (G3), `:676` (G5), `:208` (mismatch guard), `:406` (single dataset copy) | Currency asymmetry, `created_at` preservation, in-document `cognito_sub` guard, no second dataset copy | **Partial / No** | M9, M2, C4 |
| R14 | `architecture-login.md:107` | Per-attempt OAuth `state`, verified on callback | **No** | H12 |
| R15 | `architecture-nixus-2026-08-25` AD-13, Conventions `:213-214` | Disclosure via Terms/Privacy with no in-app gate; explicit log groups, 14-day retention, exact IAM actions | **Departed / dropped without declaration** | H1, M5 |
| R16 | `architecture-nixus-2026-08-18` Deferred `:229`, `:232` | Dataset deletion does not exist; the `profiles/` wipe is machine-wide | **No** | H3, H2 |
| R17 | `architecture-multi-device-sync-2026-10-13` Deferred `:286` | Profile/avatar excluded as non-DB files; syncing them "needs a separate decision and mechanism" | **Mislabelled** as `LocalOnly`; the resolution is not recorded back in the sync spine | M6 |
| R18 | `docs/project-context.md:361-365`, `:400`, `:188` | Always-mounted-component mock audit; mandatory audit logging; ceilings in Rust *and* named `CHECK` constraints | **No / No / Partial** | C2, H10, H6 |

### What the spine gets right, and should not be loosened in a revision

Recorded so a fix pass does not regress them: AD-9's network-client allow-list is exact — the mechanism is a const array plus an equality-asserting test (`apps/desktop/src-tauri/src/commands/cloud_link.rs:157-162`, `:180-190`, test at `:204-242`), so "explicitly added to the allow-list" is genuinely enforceable. AD-14's bootstrap finding is verified correct down to the parameter (`infra/bootstrap/github-oidc-deploy.yaml:65-72`). AD-3's separate-stack rationale matches the Bedrock template exactly — one Lambda, two routes, `AuthorizationScopes: [nixus-api/ai.invoke]`, Regional REST, 10 RPS/20 burst throttle (`apps/api-bedrock/template.yaml:124-159`, `:350-394`). The Stack table's runtime and SDK pins match the repo (`nodejs22.x`/arm64 at `template.yaml:112-118`; `@aws-sdk/client-dynamodb ^3.1118.0` at `apps/api-bedrock/package.json:19`; `@tanstack/react-start ^1.167.0` and the `nitro-nightly@latest` risk at `apps/web/package.json:31,35`). AD-11's IAM-plus-CI-guard construction, AD-4's separate `AVATAR` item, and AD-1's no-queues rule are the right answers to the hardest divergences in this scope.

---

## 7. Suggested resolution order

1. **C1, C3** — both are data-loss paths on a shipping upgrade; decide before any story is written.
2. **C2, H11** — both change which files stories touch and whether ~30 Playwright specs are in scope.
3. **C4, H6, M7** — the account app is currently unbuildable for the location and avatar fields and has no i18n mechanism.
4. **H1, H10, H12, H7** — legal copy, audit/PII, web CSRF, secret storage: each is a one-paragraph addition with a release gate.
5. **H2, H3, H4, H5** — the `profiles/` directory contract; fix as one edit to AD-6.
6. **H8, H9** — label AD-17's exception and make AD-4's reservation enforceable so the billing spine inherits one decision.
7. **M1–M13, L1–L4** — contract and ops precision; L3's supersession notes should land with the same commit as the spine revision, not after it.
