---
review_lens: rubric-walker
target: _bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-18/ARCHITECTURE-SPINE.md
spec: _bmad-output/specs/spec-local-profiles-nixus-cloud/SPEC.md
date: '2026-08-18'
verdict: CHANGES REQUIRED
counts: { critical: 4, high: 7, medium: 7, low: 5 }
---

# Rubric Walker Review — Architecture Spine "Local Profiles & Nixus Cloud (Step 1)"

## Overall verdict

**CHANGES REQUIRED.** The spine's core isolation thesis (one directory + one independent SQLite file, one path authority, one unchanged OAuth mechanism branched post-callback) is sound, well-grounded in `brownfield.md`, and correctly introduces zero new tech — but four keystone invariants are either self-contradictory, unimplementable as written against documented brownfield facts, or silently undecided, and each one is a place where two independently-built stories will diverge in a way that breaks CAP-2, CAP-3, or CAP-5.

## Rubric scorecard

| # | Rubric item | Verdict |
| --- | --- | --- |
| 1 | Fixes the real divergence points for story-writing/implementation, misses none | **FAIL** — C4, H1, H3, H4, H5, H6 are all unaddressed forks |
| 2 | Every AD's Rule is enforceable and prevents its stated divergence | **PARTIAL FAIL** — AD-5 has an un-grep-able escape hatch (H2); AD-6 and AD-14 mix unfalsifiable product prose into their Rules |
| 3 | Nothing under Deferred lets two units diverge and break CAP-1..CAP-6 | **FAIL** — "Dataset deletion / rename" is deferred, but the *existing* danger-zone delete path is not, and it collides catastrophically with AD-2 (C1) |
| 4 | Named tech verified-current against `docs/project-context.md`, no new tech | **PASS** — see verification below |
| 5 | Ratifies rather than contradicts the brownfield codebase | **PARTIAL FAIL** — C2, C3, H1, H4, M5 each contradict or ignore a stated brownfield fact |
| 6 | Covers all of CAP-1..CAP-6 | **PARTIAL** — all six are mapped, but CAP-5's sole entry point and CAP-6's label derivation are not actually decided |
| 7 | Every structural dimension decided / deferred / open — incl. operational envelope | **FAIL for structure, PASS for envelope** — no Open Questions section exists at all; i18n, frontend-persisted state, and the test-harness contract are silently skipped. The operational/infra envelope **is** correctly and explicitly handled as unaffected |
| 8 | No placeholder ADs, no unenforceable-prose Rules | **MOSTLY PASS** — no AD is a stub; but see H2 and M2 |

### Item 4 detail — Stack table verified against `docs/project-context.md`

Confirmed, quick pass, no drift and no new dependencies:

- `rusqlite 0.38 (bundled SQLite)` — matches project-context.md L42. ✅
- `keyring / keyring-core 4 / 1` — matches L49, and AD-8/AD-9 correctly say `keyring_core::Entry` semantics per that same line. ✅
- `Tauri 2.x` — matches L31/L41. ✅
- `TanStack Router 1.167.0` — matches L30. ✅
- `TanStack Query 5.90.21` — matches L32. ✅

The Stack section's claim "No new dependencies" holds. Only gap is an omission, not an error: `i18next 26.0.3 / react-i18next 17.0.2` and `Playwright 1.58.2` are load-bearing for this feature (see H3, H4) and are absent from the table (L8, low).

### Item 7 detail — operational/environmental envelope

The final Deferred bullet ("**Deployment/environments/infra.** Unaffected by this feature — no new AWS resources, no new build/release step beyond the existing Tauri build") is exactly the right treatment: the dimension is named, judged unaffected, and pointed at the standing posture doc rather than silently skipped. This is corroborated by SPEC's assumption L81 ("Target platforms ... unchanged — this feature introduces no new platform") and non-goal L62 (no cloud persistence). **This item passes.** Only nit: filing an *unaffected* envelope under a heading named "Deferred" implies future work where there is none (L5, low).

---

## CRITICAL findings

### C1 — AD-2 + AD-5 collide: "delete all data" on the Default profile destroys the registry and every other profile

AD-2 fixes the Default dataset's directory as **`app_data_dir` itself**. AD-3 puts the registry at **`app_data_dir/datasets.json`**, and AD-2 puts every other dataset at **`app_data_dir/datasets/<uuid>/`**. So the Default dataset's directory *contains* the registry and *contains every other dataset*.

AD-5 then mandates that `danger_zone.rs` obtain "the active dataset's directory via `datasets::active_dataset_dir(&app)`", and asserts this makes danger-zone "automatically scope to the active dataset with no per-feature rewrite — a structural consequence of this rule, not separate code." That structural consequence is **false for Default**. `brownfield.md` L19 records that `commands/danger_zone.rs::delete_all_data` deletes the *entire* `profiles/` directory today, i.e. it does directory-level destruction, not just table wipes. Point that at `app_data_dir` and a Default-profile "delete all my data" nukes `datasets.json` and `datasets/<uuid>/` for every sibling profile.

No AD states an exclusion rule. This directly breaks:
- **CAP-3** ("switching profiles never mixes or leaks data ... never appears in, or alters, the Default (or any other) profile") — the strongest possible violation: total loss.
- **CAP-5** ("the original local profile is left untouched and remains in the picker as a fallback, never deleted or converted") — the fallback profile is destroyable from inside the migrated one, and vice versa.
- **CAP-2**'s lossless guarantee, transitively.

AD-1's framing is the root cause: it treats "one dataset = one directory" as an invariant, but Default's directory is *not* exclusively its own. Any code written against the belief that the active dataset directory is an exclusive, safe-to-enumerate, safe-to-wipe unit will be wrong exactly once — for Default — which is the only profile every upgrading user has.

**Also unresolved in the same collision:** AD-5 sends `backup.rs` through `active_dataset_dir` too. Does `export_backup` on Default now sweep in `datasets/` and `datasets.json`? Does `import_backup`/`restore_from_file` overwrite them? AD-13 says "wipe coverage untouched" but says nothing about the global `profiles/` directory's fate under a per-dataset delete-all, which `brownfield.md` L19 flags as whole-directory today.

**Required:** an explicit invariant naming the non-dataset-owned entries at the `app_data_dir` root (`datasets.json`, `datasets/`, `profiles/`) as excluded from any dataset-scoped enumeration, backup, restore, or wipe — plus a decision on what per-dataset delete-all does to the global `profiles/` dir. Cheapest structural alternative: give Default its own `datasets/default/` directory and make AD-2's zero-movement promise a *symlink/legacy-path* concern instead — but that trades a data-loss cliff for file movement, so the exclusion-list route is likely correct. Either way it must be an AD, not left to a story.

### C2 — AD-10 and AD-12 depend on a Cognito `sub` that brownfield says does not exist on the wire, while AD-11 forbids the change that would produce it

AD-12's `LoginIntent::Login` branch requires "an entry with `kind: "cloud-linked"` and matching `cognito_sub`", and creating one with `label: <email from id_token>`. AD-10 requires computing signed-in state "by comparing that stored `sub` to whatever `get_auth_session` currently reports globally."

`brownfield.md` L29 is explicit: `AuthState` in `lib/types.ts` is `{status:"LoggedOut"} | {status:"LoggedIn", email, name} | {status:"SessionExpired"}` — "**no `sub` on the wire type**." So `get_auth_session` cannot report a `sub`, and AD-10's Rule is **not implementable as written**. Meanwhile AD-11's Rule asserts "PKCE, the `state` CSRF check, the token exchange, and `credentials.rs` storage are **100% unchanged**" — but obtaining `sub` (and, for the label, `email`) as first-class values requires either decoding id_token claims at exchange time or extending what `credentials.rs` persists and what `get_auth_session` returns. At least one of AD-10, AD-11, AD-12 is wrong.

This is a divergence point with three plausible independent resolutions a story-writer could pick: (a) widen `AuthState` with `sub` (frontend-visible, changes the wire type and every consumer), (b) add a Rust-only `get_active_sub()` accessor that reads the keyring blob (keeps the wire type stable), (c) decode the id_token JWT on demand at each comparison. These produce materially different code and different test surfaces, and (a) contradicts AD-11's letter.

Compounding: it is not established anywhere in `brownfield.md` that the persisted session blob even *contains* `sub`. If it does not, AD-11's "100% unchanged" is definitively broken and must be amended, not asserted.

**Affects:** CAP-4 ("signing in again with the same account reopens that same profile rather than duplicating it" — the dedup key *is* `sub`) and CAP-5 ("signing back in with the same account reattaches it rather than creating a duplicate", plus the cloud-linked-but-signed-out badge).

### C3 — AD-5 contradicts AD-13 and omits two of the five brownfield call sites; there is no "global root" path authority

The Dependency rule states `commands/*.rs` and `db/*` "never call `app.path().app_data_dir()` directly except inside `datasets.rs` (AD-5)", and AD-5's Rule names "`commands/*.rs`" as bound.

But `brownfield.md` L7 enumerates five call sites, two of which **must keep resolving the global root**:
- `commands/profile.rs::resolve_profiles_dir` — AD-13's Rule requires `profile_store.rs` and its directory to "stay anchored at the global `app_data_dir` root regardless of which dataset is active." `commands/profile.rs` *is* a `commands/*.rs`, so AD-5 forbids exactly what AD-13 mandates. The memlog carries the same contradiction internally: L16 lists `profile.rs` among modules that MUST go through the helper, while L23 says the demographic Profile feature is UNCHANGED and global.
- `lib.rs` (setup) — not mentioned by AD-5 at all, and it is where `init_db` runs today (`brownfield.md` L10: `DbState` "set up once at startup").

Additionally, `datasets.json` itself (AD-3) lives at the global root, not inside any dataset directory — so `datasets.rs` needs *two* resolution concepts and the spine names only one (`active_dataset_dir`).

As written, the keystone invariant is literally unsatisfiable by its own design, which means a reviewer cannot enforce it and a story-writer will pick a resolution arbitrarily. Resolving it in AD-5's favour makes the demographic Profile dataset-scoped — silently violating AD-13, SPEC constraint L52 (the two concepts must not be confusable), and SPEC assumption L77 (that feature's data model is unaffected).

**Required:** AD-5 must expose two named authorities — e.g. `datasets::active_dataset_dir(&app)` and `datasets::global_root(&app)` — with an explicit allow-list of what may use the latter (`profile_store.rs`/`commands/profile.rs`, the registry, `lib.rs` bootstrap), so the "zero direct `app_data_dir()` calls outside `datasets.rs`" rule becomes a grep-able truth instead of a violated aspiration.

### C4 — The `DbState` lifecycle during the "no dataset selected yet" window is completely undecided

AD-4 requires the bootstrap state machine to run "before the picker or anything else mounts." AD-14 requires the picker to render before any other route resolves. AD-6 says `select_dataset(id)` "**drops the current `DbState` connection**" — presupposing a connection already exists. `brownfield.md` L10 confirms today's reality: a single global `Mutex<Connection>` "set up once at startup."

So: **while the picker is on screen and no dataset has been chosen, which database is open?** The spine never says. Two mutually incompatible implementations both satisfy every AD as written:

1. **Eager-on-Default:** `lib.rs` keeps calling `init_db(app_data_dir)` at startup, so Default's DB is always opened whether or not the user picks Default. Consequence: any command invoked from the picker (or any stray always-mounted component — see H4) silently reads/writes **Default's** data even when the user intends profile X. That is a CAP-3 isolation breach and a CAP-1 "no launch path bypasses the picker" breach in spirit.
2. **Lazy/optional:** `DbState` becomes `Mutex<Option<Connection>>` (or is registered only after selection). Consequence: every existing `state: State<DbState>` consumer must handle the un-initialized case, and project-context.md L82's mandated lock-and-map_err pattern changes shape — a wide, cross-cutting refactor that is invisible in the current Structural Seed (which marks `db/` as "UNCHANGED internally").

These differ by roughly an order of magnitude in blast radius and are load-bearing for the very first story anyone writes. Related and equally undecided: AD-14's "in-memory-only 'dataset selected this run' flag" does not say **which process owns it**. If it is the Rust-side active-dataset-id from AD-6, then a frontend reload (dev HMR, or any window reload) leaves the Rust flag set and skips the picker — contradicting CAP-1's "no launch path bypasses the picker" and SPEC constraint L58. If it is frontend-only, then `get_active_dataset` (Structural Seed) is a second source of truth for the same fact, which is exactly the divergence AD-3 and AD-5 exist to prevent elsewhere.

---

## HIGH findings

### H1 — CAP-5's only entry point has no AD and no Structural Seed entry

SPEC CAP-5 L41: "the top-right account menu offers 'Migrate to Nixus Cloud' **in place of** today's 'Sign In with Nixus Cloud' entry point." `brownfield.md` L28 names the file and the exact string: `components/auth/ProfileMenu.tsx`, label literal "Sign In with Nixus Cloud" (`profile.signIn`), states `loading | logged-out | logged-in | session-expired | unavailable`, "this is the exact entry point CAP-5 replaces."

`ProfileMenu.tsx` appears **nowhere** in the spine — not in an AD, not in the Structural Seed (which does bother to mark `AccountPromptDialog.tsx` as DELETED), not in the Capability → Architecture Map row for CAP-5 (which lists only `commands/auth.rs` and `commands/backup.rs`). The one UI surface CAP-5 is defined in terms of is unaddressed.

Undecided as a result: what the menu shows when the active dataset is `kind: "cloud-linked"` and signed in (presumably today's logged-in dropdown), cloud-linked and signed out (AD-10 defines a *picker* badge, not a menu state — and SPEC CAP-5 says it "never reverts to a plain local profile", so it must **not** offer "Migrate"), and local-but-a-session-happens-to-exist-globally (possible under AD-9's single global session — a local profile while signed into Cognito: "Migrate", "Sign out", or both?). AD-9's global-session decision makes this matrix strictly harder, and no AD walks it.

### H2 — AD-5's "(or equivalent injected state)" escape hatch makes the keystone rule unreviewable

AD-5's Rule: modules "MUST obtain the active dataset's directory via `datasets::active_dataset_dir(&app)` **(or equivalent injected state)**, never by calling `app.path().app_data_dir()` themselves."

The parenthetical guts the rule. "Equivalent injected state" is unbounded: a `PathBuf` threaded through a struct field, a `String` captured at startup, a second `tauri::State` holding a stale directory, or a value cached across a `dataset:switched` event all qualify as "equivalent injected state" to a defending author — and the *stale-cache* variants are precisely the failure AD-5 exists to prevent (AD-5's own Prevents clause: "silently reading/writing the wrong dataset's data"). A reviewer cannot reject a PR against this Rule as written.

Fix: either delete the parenthetical, or name the exact permitted alternative (e.g. "or a `&Path` received as a function parameter from a caller that itself obtained it from `active_dataset_dir` within the same command invocation — never a value cached across invocations or across a `dataset:switched` event"). Without that, the one AD that binds all of CAP-1..CAP-6 is advisory.

### H3 — The i18n dimension is silently skipped, and it has a machine-enforced gate

`brownfield.md` L30: existing keys `profile.signIn`, `auth.promptTitle`, `auth.promptBody`, `auth.promptFutureFeatures`, `auth.createAccount`, `auth.continueOffline` — "All have French parity counterparts **enforced by a locale-parity test suite**." project-context.md L231/L283: "All user-visible strings go through i18next — no hardcoded English strings in JSX," and L291 confirms the parity specs live in `src/locales/__tests__/*.test.ts` and run under Vitest.

The spine's Consistency Conventions table has rows for Naming, Data & formats, and State & cross-cutting — and **no row for i18n**, despite this feature adding an entire new user-facing screen (picker: title, per-profile labels, kind badges, "Log in with Nixus Cloud", "+ New local profile", signed-in/signed-out badge from AD-10) plus a replacement menu label (CAP-5's "Migrate to Nixus Cloud"). Nothing decides the key namespace (`picker.*`? `datasets.*`? `profiles.*`? — and the last would reopen the SPEC L52 terminology collision in the *user-facing* layer where the SPEC says the word "profile" is correct but must be unconfusable). Nothing decides the fate of the five `auth.prompt*`/`auth.createAccount`/`auth.continueOffline` keys orphaned by AD-14's deletion of `AccountPromptDialog`, nor whether `profile.signIn` is repurposed or retired.

Two story-writers will pick two namespaces, and leftover orphan keys will either linger as dead strings (violating project-context.md's dead-code stance) or be deleted asymmetrically and trip the parity suite. This is a concrete divergence point on a machine-checked gate.

### H4 — AD-14 triggers a documented, repo-specific test-harness failure mode that the spine never mentions

project-context.md L295 states this as an explicit standing pitfall: "**When adding any always-mounted root-level component that calls `invoke()` on load** ... every existing spec's Tauri mock must add a case for the new command(s), or that spec's mock falls through to `Promise.reject("Unknown command")` and the new component renders in its error state. **Audit all existing specs' mock switch statements before merging, not after.**" L294 adds that the whole E2E suite runs against the Vite dev server with `window.__TAURI_INTERNALS__.invoke` stubbed per-spec — there is no real IPC.

AD-14 adds exactly that: a launch gate in `__root.tsx` that runs before every route and must consult dataset state (`get_active_dataset` / `list_datasets` per the Structural Seed). AD-7 adds a second always-live root-level concern (the `dataset:switched` listener). Every existing Playwright spec's mock will fall through, and every existing spec will additionally now be blocked behind a picker redirect it does not know how to satisfy.

The spine names no convention for this — no shared mock helper, no default-mock contract, no acknowledgement that the E2E suite is a blast-radius surface. This is a structural dimension of the change (the test-harness contract) left silently unaddressed, and the project's own context file flags it as a known repeat mistake.

### H5 — CAP-6's label derivation is undecided, and the Structural Seed contradicts a SPEC non-goal

SPEC non-goal L69: "**No profile renaming or custom display labels in this pass** — confirmed future work; profiles show a **fixed label** (e.g. 'Default', or the linked Nixus Cloud account's email) for now."

The Structural Seed specifies `create_dataset(label?)` (and the memlog L25 records the same), i.e. a caller-supplied optional label — which is a custom display label, the thing the SPEC rules out. Meanwhile AD-3's entry shape includes `label` and **no AD decides how a CAP-6-created local profile's label is derived**: auto-generated ("Profile 2", "Local 2", the uuid prefix?), user-typed at creation (a text input in the picker — contradicting L69), or blank. AD-2 and AD-3 are the only ADs bound to CAP-6 and neither addresses it.

Story-writers will diverge visibly here (a picker with a name field vs. a one-click "+ New local profile"), and one of the two options violates the SPEC. Label uniqueness/collision behaviour is likewise undecided (two profiles both labelled "Profile 2" after a deletion — deletion is deferred, so low urgency, but the naming scheme should be collision-free by construction).

### H6 — CAP-3's "settings" isolation is asserted as a free consequence without enumerating the persistence surfaces

CAP-3 L33 requires each profile to have "a completely isolated dataset (finance, car, **settings**, onboarding state, and its own AI-provider/keyring credentials)." The spine covers exactly three persistence surfaces: the SQLite file (AD-1/AD-2), the AI/AWS keyring service name (AD-8), and the query cache (AD-7). The memlog L17 handles `onboarding_completed` by noting `db/config.rs` lives inside each dataset's DB — correct, and a genuinely elegant consequence.

But no AD enumerates the *other* places desktop state persists, so no one can verify the claim is complete. Frontend-persisted preferences in particular (theme and locale are shipped features per the README; project-context.md discusses inline theme scripts for the web app and a `useFormatCurrency` display layer for desktop) are outside SQLite if they live in `localStorage` or a Tauri store — and AD-7's `queryClient.clear()` explicitly does **not** touch those. Tauri window state (size/position) is another. AD-5's authority covers only Rust-side `app_data_dir` resolution; there is no equivalent statement for the frontend.

The spine should either state the invariant ("all per-dataset state lives in that dataset's SQLite `config` table or its keyring scope; frontend-persisted preferences X, Y are deliberately machine-global") or record it as an open question. Right now CAP-3's success criterion ("verified by switching back and forth") is not testable because the list of things to check is undefined.

### H7 — No AD governs registry↔filesystem drift, `dataset_id` validation, or the `is_default` uniqueness invariant

AD-3 makes `datasets.json` "the single source of truth for the picker" and forbids directory scanning — good, and the right call for CAP-1's render cost. But it makes the registry authoritative without any integrity story:

- **Drift:** if a registry entry's `datasets/<uuid>/` directory is missing, unreadable, or holds a corrupt/failed-migration DB, AD-3 guarantees the picker lists it anyway, and AD-6 gives no failure semantics for selecting it (see also M4). Given AD-2's Default-at-root nesting (C1), a partially-completed wipe is a reachable state, not a hypothetical.
- **`dataset_id` validation:** `brownfield.md` L18 records the precedent explicitly — `sub` is validated against `^[A-Za-z0-9_-]{1,128}$` "and used verbatim as a filename (never slugged, to avoid collisions) — **the same pattern a 'local profile id' would need**." The spine adopts the uuid-as-directory-name shape (AD-2) and the fixed literal `"default"`, but no AD carries the validation invariant forward, even though `dataset_id` now flows from `datasets.json` into a filesystem path (AD-2) **and** into a keyring service name (AD-8, `"nkbaz-finance-<dataset_id>"`). Two sinks, no validated source.
- **`is_default` uniqueness:** AD-3's shape has `is_default` as a plain boolean field with no stated invariant that exactly one entry carries it, and AD-4 only guarantees it on first creation. Nothing prevents zero or two.
- **Corrupt/unparseable `datasets.json`:** AD-4 branches on missing-vs-exists only. Unparseable is a third state with no rule, and its wrong resolution (recreate the registry) would orphan every non-Default profile.

---

## MEDIUM findings

### M1 — No Open Questions section; one unconfirmed assumption has been promoted to a binding Rule

The spine has Invariants & Rules, Consistency Conventions, Stack, Structural Seed, a capability map, and Deferred — but **no Open Questions section**, so genuine unknowns have nowhere to live and end up mislabelled:

- The memlog L22 records "(assumption) Migrate (CAP-5) copies the source dataset's AI-provider keyring credentials ... **Flagged for user confirmation during review** rather than blocking." In the spine this appears inside **AD-12's Rule** as an unqualified MUST ("copy the source dataset's per-dataset AI-provider keyring entries (AD-8) into the new dataset's keyring slot") with no assumption marker. An unratified inference has become an invariant, and its provenance is now invisible to anyone reading only the spine. It is also arguably in tension with CAP-3's isolation framing ("AI-provider credentials configured in one profile never appear in another" — the copy is a deliberate exception that deserves to be named as one).
- The Deferred bullet "Whether Migrate (CAP-5) should also copy the demographic `/profile` document ... worth a sanity check against user expectation during story-writing" is, by its own wording, an **open question**, not deferred work. Its reasoning is sound *conditional on AD-9 holding*, which the spine should state.

### M2 — AD-9 is the only AD carrying a status marker, implying the other thirteen are unratified

AD-9's heading ends in `[ADOPTED]`. No other AD (AD-1..AD-8, AD-10..AD-14) carries any status tag. Either the marker is meaningless noise or it implies the other thirteen ADs are *not* adopted. For a document whose stated purpose is `build-substrate` for story-writing, that ambiguity is worth one minute of cleanup: tag all or tag none.

### M3 — AD-12's Migrate sequence does not pin the checkpoint/copy ordering against the live connection it depends on

AD-12 reuses "`export_backup`'s proven `PRAGMA wal_checkpoint(TRUNCATE)` + `std::fs::copy` sequence" against the **source** dataset — which is the currently-active dataset, whose connection is live — and then ends with `select_dataset(new_id)`, which per AD-6 **drops that connection**. The ordering is implied but never stated, and the failure modes differ sharply: checkpoint-then-copy-then-swap is correct; swap-then-copy copies an un-checkpointed file and silently loses whatever sat in the `-wal` sidecar, producing a migrated profile that is *quietly* missing recent data — the exact failure CAP-5's "containing a copy of the local profile's data as of that moment" forbids, and one that no test will catch unless someone knew to write it.

Relatedly, `brownfield.md` L11 documents the fuller proven pattern (`restore_from_file`: drop connection → remove `-wal`/`-shm` sidecars → copy → reopen → rollback on failure) and calls it "the proven pattern to reuse for 'switch active profile'". AD-6 reuses only the drop/reopen halves and never mentions sidecar handling; AD-12 reuses only the checkpoint/copy halves. Neither AD acknowledges it is taking half of a documented pattern.

### M4 — AD-6 has no failure or rollback semantics for a hot-swap that fails mid-flight

AD-6's sequence is: drop current connection → resolve target dir → open + migrate → swap `Mutex<Connection>` contents → update active-dataset-id → emit `dataset:switched`. If the open-or-migrate step fails (corrupt DB, failed migration, missing directory per H7, permissions), the old connection is already dropped and there is no new one: the process is left with no valid `DbState` and no defined recovery. `brownfield.md` L11 explicitly notes the existing restore path "rollback[s] to a safety copy on failure" — the precedent exists and AD-6 does not inherit it. Nothing states whether the app returns to the picker, retries against the previous dataset, or surfaces an `AppError` and stays broken.

### M5 — The duplicated `"nkbaz-finance.db"` literal and the already-misleading `get_db_status` are not addressed

`brownfield.md` L8: the filename is a hardcoded literal duplicated across `db/mod.rs::init_db`, `commands/backup.rs` (×2), and `commands/mod.rs::get_db_status` — "which returns the bare literal, not a real path — **already misleading today**"; "No `const DB_FILENAME` exists."

This feature makes that literal multi-instance: the same filename now exists in N directories, and `get_db_status`'s return value goes from misleading to actively wrong (it cannot tell you which dataset you are looking at). AD-1 and AD-2 both depend on the filename being identical across datasets, which is precisely the case where a shared constant stops being a style preference. Neither an AD nor the Consistency Conventions table mentions it, and the Structural Seed marks `db/` "UNCHANGED internally".

### M6 — AD-7's listener ownership is stated as an "or", inviting duplicate registrations

AD-7's Rule: "`useAuth.ts`/a new `useDatasets.ts` listener on `dataset:switched` MUST call `queryClient.clear()`". The Structural Seed assigns it to `useDatasets.ts`. The slash-or leaves ownership genuinely ambiguous, and the failure mode is real for Tauri event listeners: two modules each registering a listener (or one registering without cleanup across remounts) yields multiple `queryClient.clear()` calls per switch, and no rule states where the listener is mounted or that it must be registered exactly once with teardown. Pick one file and say "exactly one listener, registered at `__root.tsx` mount."

### M7 — No convention binds the picker to the shared UI layer, despite an explicit SPEC constraint

SPEC constraint L53 requires the picker's style to "match the existing app's design system (dark theme, **existing shared UI primitives**, per the attached reference) — not a generic OS-native or unstyled dialog." project-context.md rule 8 is emphatic: "Check `@nixus/shared/ui` FIRST before creating any new UI component ... Never duplicate a component that exists in `packages/shared/src/ui/`." `brownfield.md` L25 supplies the exact precedents available (`OnboardingWizard.tsx`'s centered-column convention with logo mark, `text-h1`, `Card` tiles) and the exact anti-precedent (the shared `Dialog` primitive is "explicitly documented in-repo as reserved for destructive confirms only, not full flows").

AD-14 decides the *routing/shell* mechanics well but says nothing about composition, and the Consistency Conventions table has no UI row. A story-writer could satisfy AD-14 with a hand-rolled unstyled page, or reach for `Dialog` (explicitly wrong per brownfield), and neither would violate any stated rule.

---

## LOW findings

### L1 — The Naming convention as written is falsifiably wrong for existing code

Consistency Conventions: "Code entity/module/dir/id: `Dataset` / `datasets.rs` / `datasets/` / `dataset_id` — **never "profile" in code identifiers**." Taken literally this condemns `profile_store.rs`, `commands/profile.rs`, `resolve_profiles_dir`, the `/profile` route, and the `profile.signIn` i18n key — all of which AD-13 mandates be left untouched. Scope the rule to *new* identifiers introduced by this feature, or a reviewer applying it verbatim will demand changes AD-13 forbids.

### L2 — AD-3's registry entry shape has no version field

`{ id, label, kind, cognito_sub?, linked_from?, is_default, created_at }` has no `schema_version`. `datasets.json` is now the durable root index for all user data, and AD-3 forbids reconstructing it from the filesystem — so a future shape change has no migration hook and no way to distinguish "old format" from "corrupt" (H7). One field, added now, is far cheaper than the alternative later.

### L3 — Stack table omits two dependencies this feature actually leans on

`i18next 26.0.3` / `react-i18next 17.0.2` (per H3, an entire new screen of copy under a machine-enforced parity suite) and `Playwright 1.58.2` (per H4, a suite-wide blast radius) are load-bearing here but absent from the Stack table. Both are already in project-context.md, so this costs two rows and no new dependency.

### L4 — `linked_from`'s purpose is recorded but never specified

AD-3 and AD-12 both write `linked_from: source_dataset_id`, but no AD says what reads it or what it means if the source is later removed. Deletion is deferred, so this is genuinely low — but a field written by an invariant and read by nothing is either premature or under-specified, and the spine should say which.

### L5 — An unaffected envelope is filed under a heading named "Deferred"

The "Deployment/environments/infra" bullet correctly judges the operational envelope unaffected (see rubric item 7 — this is a pass), but placing it under **Deferred** alongside four items that genuinely *are* future work implies pending infra work where there is none. A one-line "Unaffected / out of envelope" sub-heading (or moving it into the Design Paradigm's boundary statement) removes the false signal.

---

## What the spine gets right (so it is not lost in revision)

Called out because these are load-bearing and a revision should not weaken them:

- **AD-1's isolation unit.** One directory + one complete independent SQLite file, rather than a shared file with per-dataset rows or schemas, is the decision that lets `db/mod.rs`'s `MIGRATIONS`, `db/backup.rs`, and `db/danger_zone.rs`'s machine-checked `wipe_list_covers_every_table_in_the_schema` guarantee (`brownfield.md` L12) survive verbatim. It converts CAP-3 from "rewrite every query with a tenant filter" into "point `init_db` somewhere else", and it makes the memlog L17 onboarding-state consequence free. This is the single highest-leverage call in the document.
- **AD-2's zero-file-movement Default.** Pinning Default's directory to the existing `app_data_dir` root satisfies CAP-2's lossless/no-user-action requirement without touching the highest-stakes file in the app, and AD-8's matching "Default keeps the literal `nkbaz-finance` keyring service name" extends the same zero-migration property to credentials. CAP-2 becomes near-unbreakable. (C1 is the cost of this choice, not a reason to abandon it.)
- **AD-11's single OAuth mechanism.** Branching *after* the token exchange on a `LoginIntent` — rather than forking the flow — is exactly right against SPEC constraint L51, and its Prevents clause names the real risk (two flows drifting on PKCE/state correctness). C2 is a gap in its supporting data plumbing, not a flaw in the branch point.
- **AD-10's derived sign-in state.** Deriving the cloud-linked badge from a stored `sub` compared against the global session, instead of building per-dataset session plumbing, is the correct minimal answer to CAP-5's "cloud-linked-but-signed-out" requirement under AD-9. It needs C2 resolved to be implementable, but the shape is right.
- **AD-5's intent.** Even with H2's escape hatch and C3's contradiction, collapsing five independently-computed `app_data_dir` call sites into one authority is the correct structural move and directly retires a smell `brownfield.md` L7 documents. It needs tightening, not replacing.
- **The operational envelope.** Explicitly judged unaffected rather than skipped (rubric item 7).

## Recommended disposition

Block story-writing on **C1**, **C2**, **C3**, and **C4** — each requires an AD amendment or a new AD, and each will otherwise be resolved arbitrarily and differently by whoever writes the first story that touches it. **H1** and **H5** should be resolved before their respective capability's stories are drafted (CAP-5, CAP-6). **H2**, **H3**, **H4**, **H6**, and **H7** are cheap to fix now and expensive to retrofit: one tightened parenthetical, two Consistency Conventions rows (i18n, UI/test-harness), one enumeration of persistence surfaces, and one registry-integrity AD. Add an **Open Questions** section (M1) so the two items currently mislabelled as Deferred, and AD-12's promoted assumption, have somewhere honest to sit.
