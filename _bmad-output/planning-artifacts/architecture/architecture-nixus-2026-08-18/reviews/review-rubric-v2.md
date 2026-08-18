---
review_lens: rubric-walker
pass: re-verification (v2)
target: _bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-18/ARCHITECTURE-SPINE.md
prior_review: _bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-18/reviews/review-rubric.md
spec: _bmad-output/specs/spec-local-profiles-nixus-cloud/SPEC.md
date: '2026-08-18'
verdict: CHANGES REQUIRED
closure: { closed: 6, partially_closed: 5, still_open: 1, of: 11 }
new_findings: { high: 2, medium: 3, low: 2 }
---

# Rubric Walker Re-Verification (v2) — "Local Profiles & Nixus Cloud (Step 1)"

## Overall verdict

**CHANGES REQUIRED — but the revision is substantive, not cosmetic.** All four criticals are genuinely
closed at the level of *contradiction*: AD-5's two-authority split really does dissolve the AD-2/AD-13
collision and the delete-all-nukes-siblings cliff, AD-10's `current_subject()` route is verified to
exist in the codebase (not an invented helper), and AD-6a's `Mutex<Option<Connection>>` is now in the
Structural Seed rather than prose only. Two things block handoff: **(N1)** AD-12's `Login` branch calls
`select_dataset()` while still holding the AD-3 lock that `select_dataset()` itself acquires — a literal
self-deadlock, and provably an oversight because the `Migrate` branch in the same AD explicitly releases
first; and **(C4-residual)** the `Mutex<Option<Connection>>` decision is correct but its consumer-side
contract is undecided against **125 `State<DbState>` sites across 27 files**, while the Structural Seed
still labels `db/` "UNCHANGED internally" and lists only 7 modified command modules. **H6** (per-dataset
persistence surfaces) is the one finding that is *still open as filed*, and it is now materially worse
than at v1: the revision dataset-scoped Rust-side import staging (AD-5) while leaving the
localStorage-persisted import draft global.

> **Note on finding numbers.** The re-verification brief mapped H3→"single lock covers create_dataset and
> the OAuth writer" and H2→AD-6b. In the prior review as filed, **H2 = AD-5's "(or equivalent injected
> state)" escape hatch** and **H3 = the silently-skipped i18n dimension**. This pass uses the numbering in
> `review-rubric.md` (the authoritative artifact) and answers the lock question separately below, so no
> requested check is dropped.

## Closure check

| ID | Prior finding (abbrev.) | Status | Evidence in revised spine |
| --- | --- | --- | --- |
| C1 | Delete-all / backup on Default destroys registry + sibling datasets | **CLOSED** | AD-5 Rule |
| C2 | AD-10/AD-12 need a `sub` that is not on the wire; AD-11 forbids the change | **CLOSED** | AD-10 |
| C3 | AD-5 vs AD-13 contradiction; missing call sites; no global-root authority | **CLOSED** | AD-5 |
| C4 | `DbState` lifecycle in the no-dataset window undecided; flag ownership | **PARTIALLY CLOSED** | AD-6a, AD-14, Seed |
| H1 | CAP-5's entry point (`ProfileMenu.tsx`) has no AD, no Seed entry | **CLOSED** | Conventions "UI surface", Seed, CAP-5 map |
| H2 | AD-5's "(or equivalent injected state)" escape hatch | **PARTIALLY CLOSED** | AD-5 |
| H3 | i18n dimension silently skipped, machine-enforced parity gate | **PARTIALLY CLOSED** | Conventions "i18n" |
| H4 | AD-14 trips the documented Playwright mock-fallthrough pitfall | **PARTIALLY CLOSED** | AD-14 final sentence |
| H5 | CAP-6 label derivation undecided; Seed's `create_dataset(label?)` vs SPEC L69 | **CLOSED** | AD-2, Seed |
| H6 | CAP-3 "settings" isolation asserted without enumerating persistence surfaces | **STILL OPEN** | — |
| H7 | Registry↔fs drift, `dataset_id` validation, `is_default` uniqueness, corrupt registry | **PARTIALLY CLOSED** | AD-2, AD-3, AD-6b |

### C1 — CLOSED (genuine, not cosmetic)

AD-5 now carries a hard scoping clause: "**`active_dataset_dir()`'s result is only ever used to build a
path to a specifically named file — `nkbaz-finance.db` and its `-wal`/`-shm` sidecars — never passed to a
recursive delete, copy, or walk.**" AD-2 restates it from the other side ("no code ever treats 'Default's
directory' as a copyable/deletable unit; only the named files inside it are ever targeted"). The
`danger_zone.rs` bullet resolves the specific data-loss path with the right decomposition: the SQL wipe
runs on the open connection and **needs no path at all**, and the separate `profiles/` directory delete
stays on `global_root()` and stays machine-wide. `backup.rs` is bound to `active_dataset_dir()` **+ literal
filename**, so `export_backup` on Default cannot sweep in `datasets.json` or `datasets/`. The second half
of C1 (what per-dataset delete-all does to the global `profiles/` dir) is now explicitly decided rather
than silent. This is a real structural fix: the invariant is stated as a named-file-only rule, which is
reviewable in a diff.

*Residual (new, low — N7 below):* the decision means "delete all my data" invoked from dataset B wipes the
machine-global `profiles/` document that dataset A's `/profile` route reads. Correct per AD-13's
preserve-today's-behavior stance, but it is a cross-dataset user-visible side effect that deserves one
line under Deferred/Open Questions rather than living only as an inference.

### C2 — CLOSED (verified against the code, not just asserted)

AD-10 no longer routes through `AuthState`/`get_auth_session`. It names
`commands::auth::current_subject()` and states the comparison happens entirely Rust-side, returning only a
boolean. **Verified in the repo:** `apps/desktop/src-tauri/src/commands/auth.rs:768` defines
`pub(crate) async fn current_subject() -> Result<String, AppError>`, backed by
`decode_id_token_claims()` (same file, ~L543) which extracts `sub`, `email`, `name` from the stored
`id_token`; `credentials.rs` persists `id_token` as its own keyring field (L280/L298). So the `sub` and the
email for AD-12's `label` are both obtainable **without** widening `AuthState`, without touching the token
exchange, and without new stored state — AD-11's "100% unchanged" now survives contact with the facts.
`AuthState` is never mentioned as a source. Prior review's three-way fork (widen wire type / new accessor /
decode on demand) is collapsed onto the one option D3 permits, and D3's "single resolution point" is named
verbatim.

*Consistency spot-check that passes:* `current_subject()` may refresh tokens, i.e. it can hit Cognito's
`/oauth2/token`. AD-14's "the only network calls this feature makes are `/oauth2/authorize` and
`/oauth2/token`" therefore still holds — the badge does not introduce a new endpoint.

### C3 — CLOSED

AD-5 now exposes exactly `global_root(&app)` and `active_dataset_dir(&app)`, with `active_dataset_dir() ==
global_root()` when the active id is `"default"`. The allow-list the prior review demanded is present and
per-call-site: `lib.rs`→global, `backup.rs`→active, `danger_zone.rs`→no path + global for `profiles/`,
`profile.rs`→global (AD-13 explicitly reconciled), `import.rs`→active (a call site the brownfield count
missed, correctly added), `maintenance.rs`→global. `datasets.json` lives at `global_root()` (AD-3), so the
registry no longer needs a resolution concept the spine doesn't name. The AD-5-vs-AD-13 contradiction is
structurally gone, not papered over. Arithmetic of "seven existing call sites … not five" checks out
(`backup.rs` contributes two).

*New nit (N5 below):* the spine says "`datasets.rs`" unqualified ~9 times while the Seed introduces **two**
modules with that basename (top-level `datasets.rs` and `commands/datasets.rs`). AD-5's keystone sentence
("`datasets.rs` is the **only** module calling `app.path().app_data_dir()`") should read "top-level
`datasets.rs`" or the rule is ambiguous exactly where it must be grep-able.

### C4 — PARTIALLY CLOSED (the fork is decided; the blast radius is still undeclared)

**Closed:** the lifecycle choice is made and unambiguous — AD-6a picks option 2 (`Mutex<Option<Connection>>`,
`None` until the first successful `select_dataset`, dedicated error rather than Default fallback), and it
**is** now in the Structural Seed, not prose only: the `db/` line reads "DbState becomes
Mutex<Option<Connection>> (AD-6a)". The flag-ownership half is closed too: AD-14 pins the
"selected this run" flag **Rust-side, alongside `DbState`**, explicitly so a frontend reload cannot bypass
it, with `get_active_dataset` as the reader. That retires both sub-findings as *contradictions*.

**Still open:** the exact consequence the prior review named — "every existing `state: State<DbState>`
consumer must handle the un-initialized case … a wide, cross-cutting refactor that is invisible in the
current Structural Seed" — is *still* invisible. Measured in the repo: `db/mod.rs:34` is
`pub struct DbState(pub Mutex<Connection>)` (public tuple field, so consumers do `state.0.lock()`), and
there are **125 `State<'_, DbState>` occurrences across 27 files** (all of `commands/*` plus
`tfsa/calculator.rs`). Every one of them must gain an `Option` unwrap. The Seed still says
`db/ # UNCHANGED internally` and marks only 7 command modules MODIFIED; no AD or Conventions row names a
single accessor (e.g. `db::with_conn(&state, |conn| …)` / `state.conn()?`) that produces AD-6a's dedicated
error once. Left as-is, 27 files will invent 27 unwraps, some of which will be `unwrap()`/`expect()` —
directly against project-context's lock-and-`map_err` mandate. **This is the second blocker.** Fix is one
sentence in AD-6a plus one Seed line; it does not change the decision.

### H1 — CLOSED

`ProfileMenu.tsx` now appears in three places: the Conventions "UI surface" row (modified, not replaced;
`kind == "local"` → "Migrate to Nixus Cloud" replacing "Sign In with Nixus Cloud" and triggering
`LoginIntent::Migrate`; `kind == "cloud-linked"` → AD-10 badge + existing `sign_out`), the Structural Seed
(`MODIFIED`), and the CAP-5 map row. The matrix forks the prior review flagged are decided: cloud-linked
never offers "Migrate" (so SPEC's "never reverts to a plain local profile" holds), and local-while-a-global-
session-exists deterministically shows "Migrate" (AD-9's single global session no longer creates ambiguity).

*Residual nit (not blocking):* a cloud-linked-but-signed-out dataset renders a signed-out badge plus
`sign_out` and no in-menu re-sign-in affordance; the re-attach path exists but only via the picker's "Log in
with Nixus Cloud" (AD-12 Login → find-by-sub). Fine as a product choice, worth one clause so a story-writer
doesn't invent a menu-level sign-in.

### H2 — PARTIALLY CLOSED (escape hatch deleted; stale-cache still permitted by the letter)

The "(or equivalent injected state)" parenthetical is **gone**, and AD-5 is now phrased as a sole-caller
rule with an enumerated call-site list — that genuinely converts the keystone into something a reviewer can
reject a PR against. What is still missing is the clause the prior review offered as the alternative fix:
nothing forbids **caching `active_dataset_dir()`'s result across invocations or across a `dataset:switched`
event**. A `PathBuf` resolved once in `lib.rs` setup and stashed in a `tauri::State` satisfies AD-5's letter
(only `datasets.rs` called `app_data_dir()`) while reintroducing exactly the failure AD-5's Prevents clause
names. Harmless for `global_root()`, wrong for `active_dataset_dir()`. Downgraded to medium; one sentence
closes it.

### H3 — PARTIALLY CLOSED

An i18n row now exists and closes the machine-checked half: parity in `en.json`/`fr.json` in the same
change, and the five orphaned keys (`auth.promptTitle`, `auth.promptBody`, `auth.promptFutureFeatures`,
`auth.createAccount`, `auth.continueOffline`) are named for removal *together with* `AccountPromptDialog` —
"never left orphaned". Verified those five keys exist in `src/locales/en.json` (L87–91).

Still open: the row explicitly defers the **key namespace** ("Exact new key names … are a story-writing
detail, not fixed here"), which was H3's actual divergence point (`picker.*` vs `datasets.*` vs
`profiles.*`, the last reopening the SPEC L52 terminology collision in the user-facing layer). Also
undecided: the fate of `profile.signIn`, whose label the UI row replaces — repurposed or retired? Risk is
now low (the parity suite catches asymmetry; a namespace divergence is cosmetic and confined to one new
screen), so this is a medium, not a blocker. **New, related:** see N4 — a dedicated test file asserts those
five keys.

### H4 — PARTIALLY CLOSED

AD-14 now ends with the acknowledgement: "every existing Playwright spec's Tauri mock switch must add a
case for it — an acknowledged, one-time cost of this AD (per the documented `project-context.md` pitfall),
not optional cleanup." The pitfall is no longer *silently* skipped, which was the finding's core. But no
convention is added: measured in the repo there are **30 `*.spec.ts` files**, each with its own inline
`window.__TAURI_INTERNALS__` mock and **no shared mock helper** anywhere. "Every spec adds a case" without a
shared default-mock contract is 30 hand-edited switch statements that will drift. One Conventions row
("a single shared mock factory owns the `get_active_dataset` default; specs override, never re-declare")
would close it. Medium.

### H5 — CLOSED

AD-2 now derives the label rather than accepting one: `"Local Profile <n>"` where `<n>` = count of existing
non-default, non-cloud-linked datasets + 1, and "no free-text label input exists in this pass" — matching
SPEC non-goal L69. The Seed's signature is now `create_dataset()` with **no** `label?` parameter, so the
contradiction the prior review flagged is gone at both ends. Cloud-linked labels come from the id_token
email (AD-12). Collision-freedom holds while deletion is deferred, which it is; if deletion ever ships,
`<n>` must switch to a monotonic counter — worth one clause in the Deferred bullet, no more.

### H6 — STILL OPEN, and now higher-risk than at v1

Nothing in the revision enumerates non-SQLite, non-keyring per-dataset state. The Conventions
"State & cross-cutting" row still covers only active-dataset uniqueness, `app_data_dir` resolution, cache
clearing, and the registry lock. Measured in `apps/desktop/src`, at least eight frontend surfaces persist
state **outside** SQLite in machine-global `localStorage`, none of which `queryClient.clear()` (AD-7)
touches:

- `components/import/importDraft.ts` — a persisted **in-progress statement-import draft**. This is the
  sharp one: AD-5 deliberately moved Rust-side import staging to `active_dataset_dir()` ("imported
  statements are per-dataset financial data and must be isolated exactly like AI-provider keys"), so the
  revision created an asymmetry — the Rust half is now dataset-scoped and the frontend draft is not. Switch
  datasets mid-import and dataset A's draft transactions are offered for commit into dataset B. That is a
  CAP-3 leak of real financial data, introduced (or at least sharpened) by the fix.
- `components/settings/DangerZone.tsx` (`ONBOARDING_DISMISS_KEY`), `components/dashboard/SetupIncompleteBanner.tsx`,
  `components/maintenance/CarOnboardingChecklist.tsx` — onboarding/setup dismissal flags. AD-13 claims
  onboarding state is "automatically evaluated against whichever dataset was just activated with no code
  change" because `onboarding_completed` lives in `db/config.rs`. True for the gate, **false for these
  dismiss flags**, so a brand-new profile can launch with the returning user's banners already dismissed.
- `contexts/ValuesVisibilityContext.tsx`, `components/shared/AppSidebar.tsx` (rail collapsed),
  `lib/agents.ts` (last-used agent), `lib/i18n.ts` (`localStorage` language detector) — plausibly
  *deliberately* machine-global, but nothing says so, so nobody can verify CAP-3's "verified by switching
  back and forth" criterion.

**Required:** one Conventions row or short AD stating the invariant — "all per-dataset state lives in that
dataset's SQLite `config` table or its keyring scope; these named `localStorage` keys are deliberately
machine-global; the import draft key is dataset-namespaced (or cleared on `dataset:switched`)." Cheap now,
a data-mixing bug report later.

### H7 — PARTIALLY CLOSED (2 of 4 sub-items)

- **Corrupt/unparseable registry — CLOSED.** AD-3 now names the third state explicitly: "**Present but
  unparseable** → a hard `AppError`, surfaced to the user; it is never silently recreated (recreating would
  orphan every non-default dataset on disk)." AD-4's missing-branch defers to it. Exactly the fix asked for.
- **`is_default` uniqueness — CLOSED, thinly.** AD-2 states `is_default: true` "is set only on this one
  entry" and AD-4 writes it once at bootstrap. Adequate given no other writer sets it, though it is stated
  as authorial intent rather than an enforced check.
- **`dataset_id` validation — PARTIALLY.** Generation is now pinned (lowercase UUID v4, byte-identical to
  the directory name and the keyring suffix, "never re-cased or slugged", explicitly mirroring the `sub`
  precedent). But there is still **no validation on read**: the id flows from a user-editable JSON file into
  a filesystem path (AD-2) and a keyring service name (AD-8). A hand-edited or corrupted
  `id: "../../elsewhere"` is unguarded. The brownfield precedent is a regex (`^[A-Za-z0-9_-]{1,128}$`);
  carrying it into AD-3's read path is one clause.
- **Registry↔filesystem drift — PARTIALLY.** AD-6b now gives real failure semantics (open+migrate fails →
  previous connection/id left exactly as-is, error returned, never a partial state), so *selecting* a ghost
  entry is no longer undefined — a meaningful improvement. Still unstated: the picker lists ghost entries
  with no reconciliation or user-visible marking, and nothing decides whether a failed selection returns to
  the picker. Acceptable-if-named; currently unnamed.

### Specifically requested: does AD-3's single lock actually cover `create_dataset` **and** the OAuth-callback writer?

**Yes on coverage — and that coverage is what exposes N1.** AD-3 names the lock owner (`datasets.rs`), the
duration ("held for the full duration of the read-modify-write, not just the final write"), and the
mutators ("`create_dataset`, the Login/Migrate post-callback writer, any future mutator"). AD-6b binds
`select_dataset` to "the **same lock**". AD-12 binds both branches to it (`Login`: "under the AD-3 registry
lock"; `Migrate`: "the **same registry lock** … for the **entire** operation, not just the final write —
this is what prevents a concurrent `select_dataset` from changing the active dataset mid-copy"). The
Conventions row restates it. So the four-way agreement AD-3/AD-6b/AD-12/Conventions is real and
consistent — but see N1: making `select_dataset` a lock *acquirer* while `Login` calls it from *inside* the
lock is a deadlock the `Migrate` branch avoids and the `Login` branch does not.

---

## Fresh 8-item rubric pass (run clean, not merely diffed)

| # | Rubric item | Verdict (v1 → v2) |
| --- | --- | --- |
| 1 | Fixes the real divergence points, misses none | FAIL → **PARTIAL FAIL** — N1, C4-residual, H6 are live forks |
| 2 | Every AD's Rule enforceable, prevents its stated divergence | PARTIAL FAIL → **PARTIAL PASS** — AD-5 is grep-able now; H2-residual + AD-6's product-prose bullet remain |
| 3 | Nothing under Deferred lets two units diverge and break CAP-1..6 | FAIL → **PASS** — the deletion-deferred/danger-zone collision is closed by AD-5's named-file-only rule |
| 4 | Named tech verified-current, no new tech | PASS → **PASS** (re-verified against the repo) |
| 5 | Ratifies rather than contradicts the brownfield codebase | PARTIAL FAIL → **PARTIAL PASS** — `current_subject()` verified real; but "db/ UNCHANGED internally" vs 125 `DbState` sites, and the global import draft, both contradict the code |
| 6 | Covers all of CAP-1..CAP-6 | PARTIAL → **PASS** — CAP-5's entry point and CAP-6's label are now decided |
| 7 | Every structural dimension decided / deferred / open (incl. operational envelope) | FAIL → **PARTIAL** — i18n and test-harness dimensions now named; frontend-persisted state still absent; still **no Open Questions section** (M1 unaddressed) |
| 8 | No placeholder ADs, no unenforceable-prose Rules | MOSTLY PASS → **MOSTLY PASS** — AD-6's final bullet and AD-9's lone `[ADOPTED]` tag persist |

### Item 4 detail — re-verified directly against manifests (not against the prior review)

- `rusqlite = { version = "0.38", features = ["bundled"] }` — `src-tauri/Cargo.toml:25` ✅
- `keyring = "4"` / `keyring-core = "1"` — `Cargo.toml:40-41` ✅
- `tauri = { version = "2.11" }` — `Cargo.toml:21`; spine says "2.x" ✅
- `@tanstack/react-router ^1.167.0` — `package.json:22` ✅
- `@tanstack/react-query ^5.90.21` — `package.json:20` ✅
- `json_store.rs` and `profile_store.rs` both exist as the Seed claims ✅
- No new dependency is introduced anywhere in the revision ✅
- Unchanged low from v1 (L3): `i18next ^26.0.3` / `react-i18next ^17.0.2` (`package.json:33,41`) and
  `@playwright/test ^1.58.2` (`package.json:52`) are load-bearing (H3, H4) and still absent from the Stack
  table. Two rows, no new dependency.

## NEW findings introduced or exposed by the fix

### N1 (HIGH — blocking) — AD-12's `Login` branch self-deadlocks on the AD-3 lock

AD-6b makes `select_dataset(id)` **acquire** the AD-3 registry lock. AD-12's `Login` branch runs "under the
AD-3 registry lock" and then, inside that scope, calls `select_dataset(new_id)` on the create path **and**
`select_dataset` on the "one or more found" path — with no release. A `std::sync::Mutex` is not reentrant,
so this is a hard hang on the primary CAP-4 flow. It is provably an oversight rather than an intended
reentrant design, because the `Migrate` branch in the *same AD* spells out the correct order: "append to
the registry; **release the lock**; `select_dataset(new_id)`." Fix: mirror Migrate's wording in the Login
branch (or state that `datasets.rs` exposes a lock-held `select_dataset_locked()` internal that the public
`select_dataset` wraps). One clause; must land before story-writing, since a story-writer following AD-12
literally will ship a deadlock.

### N2 (HIGH — blocking, = C4 residual) — no accessor contract for `Mutex<Option<Connection>>`

See C4 above: 125 `State<DbState>` sites / 27 files / `pub struct DbState(pub Mutex<Connection>)` with a
public tuple field, against a Seed that says `db/ # UNCHANGED internally` and lists 7 modified command
modules. Name one accessor helper that yields AD-6a's dedicated error, and mark the consumer-wide edit in
the Seed so the story sizing is honest.

### N3 (MEDIUM) — AD-6a's "dedicated `AppError`" vs the Conventions row's "no new `AppError` variant needed"

AD-6a requires "a dedicated `AppError` (e.g. 'no active dataset selected')", while Conventions
"Data & formats" says "no new `AppError` variant needed beyond what `AppError::File`/`AppError::Validation`
already cover". Both can be true (a distinct *message* on an existing variant), but as written two
story-writers will read it two ways — and mapping a state error onto `Validation` is semantically wrong
enough that someone will add a variant. Say which, explicitly.

### N4 (MEDIUM) — a dedicated locale test asserts the five keys AD-14 deletes

`apps/desktop/src/locales/__tests__/auth-i18n.test.ts` exists specifically for the `auth.prompt*` /
`auth.createAccount` / `auth.continueOffline` keys, and its own header comment states
"AccountPromptDialog.tsx is the only consumer of these keys". The i18n row correctly requires the keys be
removed with the component, but the *test* that pins them will fail and is not mentioned anywhere. Name it
alongside the deletion (this is the same machine-checked-gate class as H3/H4, and cheap to state).

### N5 (MEDIUM) — three co-located Rust facts that can disagree, described as three facts

AD-6a (`Option<Connection>`), AD-6b ("updates the in-memory active-dataset-id together, as one step"), and
AD-14 ("a flag tracking 'a dataset has been selected this run' … Rust-side, alongside `DbState`") describe
what is logically **one** fact in three storage locations. AD-6b's atomicity guarantee then has to be
maintained by convention across three fields. Collapsing them into a single
`Mutex<Option<ActiveDataset { id, kind, conn }>>` makes "the path and the connection can never disagree"
structural instead of aspirational — which is AD-6's own stated Prevents.

### N6 (LOW) — `datasets.rs` is ambiguous now that two modules share the basename

AD-5's sole-caller sentence, the Dependency rule, and AD-3's "atomic-write helper … owned by `datasets.rs`"
all say `datasets.rs` unqualified, while the Seed defines both top-level `datasets.rs` and
`commands/datasets.rs`. Qualify the keystone occurrences ("top-level `datasets.rs`").

### N7 (LOW) — cross-dataset side effect of `delete_all_data` on the global `profiles/` dir is decided but unnamed

Correct per AD-13 (preserves today's machine-wide behavior), but "delete all data" from dataset B removing
the demographic document dataset A also reads is a user-visible cross-profile effect. One line under
Deferred/Open Questions, not an AD change.

### Lock-order observation (LOW, no action required)

Two locks now exist: the AD-3 registry lock and `DbState`'s mutex. AD-6b (registry → DbState swap) and
AD-12 Migrate (registry → checkpoint on the live connection) acquire them in the **same** order, so no
inversion is currently reachable. Worth one sentence pinning the order so a future mutator cannot invert it.

## Prior MEDIUM/LOW items still outstanding (informational — not part of the requested closure set)

M1 (no Open Questions section; AD-12's keyring-copy assumption still stated as an unqualified MUST, and the
`/profile`-copy question still filed under Deferred), M2 (AD-9's lone `[ADOPTED]` tag), M6 (now resolved —
AD-7 assigns the listener to `useDatasets.ts` only, though "registered exactly once with teardown" is still
unstated), M7 (now resolved — Conventions "UI surface" binds the picker to `@nixus/shared/ui` and the
dark-theme tokens), M5 (partially — the Seed now fixes `get_db_status`, but no `const DB_FILENAME` is
introduced despite the literal becoming multi-instance), L1 (the "never 'profile' in code identifiers" rule
is still unscoped to *new* identifiers, and still literally condemns `profile_store.rs` / `commands/profile.rs`
that AD-13 mandates be untouched), L2 (no `schema_version` on registry entries), L4 (`linked_from` still
written by an invariant and read by nothing), L5 (unaffected infra envelope still filed under "Deferred").
M3 is now closed: AD-12 pins checkpoint-then-copy-then-select and explicitly forbids copying `-wal`/`-shm`.
M4 is now closed by AD-6b's all-or-nothing rollback semantics.

## Minimum set to reach READY

1. **N1** — release the AD-3 lock before `select_dataset` in AD-12's `Login` branch (or name a
   `*_locked` internal). *Blocking.*
2. **N2 / C4-residual** — name one `DbState` accessor that produces AD-6a's error, and reflect the
   27-file consumer edit in the Structural Seed. *Blocking.*
3. **H6** — one Conventions row enumerating per-dataset vs machine-global frontend persistence, with the
   `importDraft` localStorage key explicitly resolved. *Blocking-adjacent: it is a CAP-3 data-mixing path.*
4. **H7 residual** — carry the `^[A-Za-z0-9_-]{1,128}$` validation onto the registry **read** path.
5. **H2 residual** — forbid caching `active_dataset_dir()`'s result across invocations / across
   `dataset:switched`.
6. **N3, N4, N5, N6** — four one-line clarifications.
7. **H3/H4 residuals** — fix the i18n key namespace and name a shared Playwright mock contract (cheap now,
   30 specs later).

Everything above is a clause-level edit. No AD needs to be rewritten and no decision needs to be reversed —
which is the strongest statement available about this revision: the criticals were closed structurally, and
what remains is contract detail plus one mechanical deadlock.
