# Review — Adversarial Divergence Lens (AD-Compliant-but-Incompatible Pairs)

- **Reviewed:** `ARCHITECTURE-SPINE.md` (Local Profiles & Nixus Cloud, Step 1, status: draft, 2026-08-18)
- **Grounding:** `_bmad-output/specs/spec-local-profiles-nixus-cloud/SPEC.md`, `.../brownfield.md`
- **Lens:** Attack the spine as an adversary. Construct two units one level down (independent stories) that each obey **every AD to the letter** yet still build **incompatibly** — clashing shared-data shapes, two owners of one entity, conflicting state-mutation paths. Every constructible pair is a hole to close with a new or tightened AD.
- **Adversary model:** competent, well-intentioned, independent implementers. Each reads the spine, obeys it literally, does not consult the other, and makes the locally-sensible choice where the spine is silent. No malice, no laziness, no AD violations.
- **Date:** 2026-08-18
- **Verdict:** **CHANGES REQUESTED (blocking).** The spine's *paradigm* is sound — single-active-dataset, directory-scoped isolation, one path authority — and it is unusually disciplined about naming and inheritance. But the spine is **not yet build-safe for parallel story execution.** Ten constructible divergence pairs were found. Three are catastrophic (**H1** destroys every dataset; **H3** silently and permanently orphans a dataset's data; **H9** silently produces a lossy migration copy), one is a **direct AD-vs-AD contradiction** over a single call site (**H6**), and one is a **self-contradiction inside a single AD** (**H8**). The remainder are deadlocks, split-brain state, and shared-data-shape clashes. Do not shard this into parallel stories until H1, H2, H3, H6, H8, H9 are closed.

**Why this lens fires so hard on this particular spine:** two structural choices multiply the divergence surface. (1) AD-2 makes the Default dataset's directory *identical to* `app_data_dir`, so the Default dataset's directory is a strict **superset** containing the registry and every other dataset — every "scope this to the active dataset" rule becomes dangerous when the active dataset is Default. (2) AD-5 centralizes path resolution but the spine keeps **two** in-memory records of "which dataset is active" (AD-6 Rust-side, AD-14 frontend-side) and **two** write paths into one registry file (AD-3 create vs. AD-12 append), without an ownership or ordering rule for either. Centralizing the *path* while leaving the *state* and the *writer* uncoordinated is the root pattern behind H1–H5.

---

## Severity key

| Sev | Meaning |
| --- | --- |
| **S1** | Silent data loss or destruction of another dataset. Ship-blocking. |
| **S2** | Functional break, deadlock, or split-brain state a user can reach. Ship-blocking. |
| **S3** | Integration break caught at compile/first-integration time, or a correctness gap that degrades a stated capability. Fix before sharding. |

---

## H1 — "Wipe the active dataset" against Default destroys every other dataset *and* the registry — S1

**The hole:** AD-2 states the Default dataset's directory **is** `app_data_dir` itself. AD-3 puts the registry at `app_data_dir/datasets.json`. AD-2 puts every other dataset at `app_data_dir/datasets/<uuid>/`. Therefore **the Default dataset's directory recursively contains the registry and all other datasets.** AD-5 then instructs `danger_zone.rs` to resolve its directory via `datasets::active_dataset_dir(&app)` and calls this "a structural consequence of this rule, not separate code." No AD anywhere forbids directory-level destruction, and no AD says which files inside a dataset directory are off-limits to a dataset-scoped destructive path.

**Unit A — "Danger-zone path resolution" story (table-level reading).** Obeys AD-1 ("`db/danger_zone.rs`'s wipe-coverage test runs completely unmodified"; "must never become dataset-aware internally") and AD-5. Implements `delete_all_data` as: resolve dir via `active_dataset_dir`, open/lock the connection, call the unchanged `wipe_all(conn)` on the table allow-list, plus today's `remove_dir_all(dir.join("profiles"))`. Blast radius: tables only.

**Unit B — same story, different competent implementer (directory-level reading).** Also obeys AD-1 and AD-5 to the letter. Reasons: "AD-1 says isolation *is* the directory; the SPEC assumption says danger-zone becomes scoped to the active profile; the cleanest, most complete 'delete all my data for this profile' is to remove the dataset's directory contents and let AD-6's reopen path recreate a fresh DB via `init_db`." Implements `delete_all_data` as: `active_dataset_dir(&app)` → remove the dataset's files. **Nothing in the spine prohibits this.** Blast radius when the active dataset is Default: `datasets.json` and the entire `datasets/` tree — i.e. **every local profile, every cloud-linked profile, and the registry that is the sole source of truth for them (AD-3 explicitly forbids reconstructing the list by directory scan).** Unrecoverable; deletion/recovery is Deferred so there is no repair path.

Both units pass every AD. Unit B is not a strawman — it is the *more* faithful reading of "isolation is achieved by which directory you are pointed at," and it is what an implementer who never sees Default's superset problem would naturally write.

**Same hole, second blast radius (Migrate).** AD-12's Migrate branch reuses `export_backup`'s `fs::copy` sequence. A Unit-B-style implementer who reads "copy the source dataset's data" as "copy the source dataset's *directory*" will, when the source is Default, recursively copy `datasets.json` and every other dataset's directory into the new cloud-linked dataset. Not destructive, but it embeds a stale registry inside a dataset directory and duplicates every other dataset's financial data into a directory the user believes is a fresh cloud profile — a real isolation violation against AD-1's stated intent.

**AD to tighten — AD-2 and AD-5 (both; this is one hole with two enforcement points):**
1. **AD-2** must state explicitly that because the Default dataset's directory is `app_data_dir` itself, `app_data_dir/datasets.json` and `app_data_dir/datasets/` are **not** part of any dataset's data set, and name the exact file/dir allow-list that constitutes "a dataset's data" (`nkbaz-finance.db` + `-wal`/`-shm`, `config`, and nothing else).
2. **AD-5** must state that no dataset-scoped operation — destructive or copying — may enumerate, recurse into, remove, or copy a dataset directory wholesale; destruction is table-level via the unchanged `wipe_all(conn)` plus the named allow-list only, and copying is the named-file copy AD-12 already specifies.

---

## H2 — Two owners of "which dataset is active," with no authority rule, and no failure semantics — S2

**The hole:** the spine stores the same fact twice and never says which is authoritative or how they are kept consistent.
- **AD-6** (Rust): "updates the in-memory active-dataset-id." The structural seed also lists a `get_active_dataset` command, implying the Rust value is queryable and therefore usable as an authority.
- **AD-14** (frontend): "an **in-memory-only** 'dataset selected this run' flag is checked; unset → redirect to `/picker`."

Neither AD states that one is derived from the other, nor which wins on disagreement. Worse, **AD-6 specifies an ordered mutation sequence with no atomicity, no exclusion, and no failure/rollback rule**, despite `brownfield.md` explicitly documenting that the proven pattern to reuse (`restore_from_file`) already includes "rollback to a safety copy on failure."

**Unit A — "Switch dataset" story (`datasets.rs` / `commands/datasets.rs`).** Implements AD-6's sequence literally and in the stated order: drop connection → resolve dir → `init_db` (runs migrations) → swap `Mutex<Connection>` → update active-dataset-id → emit `dataset:switched`. On migration failure it returns `Err(AppError::File)`. Because the id is updated *last* per AD-6's own ordering, and the connection was already dropped/swapped, a failure leaves: **connection dropped or pointing at the new dir, active-dataset-id still naming the old dataset, no rollback.** Fully AD-6-compliant — AD-6 says nothing about failure.

**Unit B — "Picker + launch gate" story (`__root.tsx`, `useDatasets.ts`).** Implements AD-14's flag as a frontend module-scoped variable, sets it optimistically when the user clicks a profile, and navigates on `dataset:switched` per AD-6/AD-7. On the `Err` from Unit A it surfaces a toast — but the flag is already set, so the launch gate no longer redirects to `/picker`. Result: **the app renders the dashboard with a dropped or wrong-dataset connection, the frontend believes dataset X is active, Rust believes dataset Y is, and the only route back to the picker is gated by the flag that is now wrongly set.** Both units are compliant; neither is unreasonable.

**Second, sharper construction from the same hole (the mid-switch path/connection split-brain).** Because AD-6 updates the id **after** the connection swap, there is a real window where `active_dataset_dir(&app)` returns the **old** dataset's directory while the `Mutex<Connection>` already points at the **new** dataset's DB. AD-5 requires `backup.rs` and `danger_zone.rs` to resolve their directory through `active_dataset_dir`, and **no AD makes a switch mutually exclusive with those commands.** So:
- Unit A (switch) holds no lock spanning the whole sequence — AD-6 doesn't ask for one.
- Unit C ("Backup / danger-zone path resolution" story) implements `export_backup` as `active_dataset_dir(&app)` then `db_state.lock()` — two independent acquisitions, exactly as AD-5 describes, with no cross-command coordination.

A user who triggers a backup (or an impatient second click, or danger-zone) during the switch window gets a backup written into the **old** dataset's directory containing the **new** dataset's checkpointed data — or `delete_all_data` operating on the new dataset's connection while pathing at the old dataset's directory. This is precisely the "conflicting state-mutation paths" this lens hunts, and it is reachable with zero AD violations.

**AD to tighten — AD-6 (new sub-rules), plus a new AD:**
1. **AD-6** must declare `select_dataset` a **single atomic critical section under one process-wide guard** that also excludes every other command resolving `active_dataset_dir` (i.e. the active-dataset context and the connection are swapped under the *same* lock, so the pair `(active_dataset_dir, DbState)` is never observable in a mismatched state). State explicitly what `active_dataset_dir` does if called mid-switch: block on the guard — never return the old value.
2. **AD-6** must state failure semantics: `select_dataset` is **all-or-nothing** — on any failure (dir resolution, `init_db`, migration) the previous dataset's connection and active-dataset-id are restored, no event is emitted, and the command returns `Err`; reuse `restore_from_file`'s documented rollback posture rather than inventing one.
3. **New AD (or an AD-14 sub-rule): the Rust active-dataset-id is the single source of truth.** AD-14's frontend flag must be *derived* from it (set only on the `Ok` return of `select_dataset`, cleared on any failure) and must never be set optimistically. Name `get_active_dataset` as the authority and forbid a second independent frontend record of the same fact.

---

## H3 — Two writers, one registry: `create_dataset` vs. `handle_auth_callback` lose each other's entries — S1

**The hole:** AD-3 says the registry is "written only through `datasets.rs`'s atomic-write helper." **`write_json_atomic` makes the *write* atomic; it does not make the *read-modify-write* atomic.** Every registry mutation in this spine is a read-modify-write of the whole file: AD-12's Login and Migrate branches both "append to the registry," and AD-3/CAP-6's `create_dataset` appends too. No AD states a single-writer rule, a mutex, or a compare-and-swap. AD-3's stated prevention is only about *readers* ("the picker reconstructing the list by scanning directories") — the writer side is unguarded.

**This is not a theoretical race.** `brownfield.md` establishes that the OAuth callback arrives on a **separate short-lived local HTTP listener thread** (loopback `http://127.0.0.1:52847/callback`), not on the UI's invoke thread. So two genuinely concurrent registry mutators exist by construction.

**Unit A — "Picker + create_dataset" story (CAP-6).** `create_dataset`: read registry (N entries) → create `datasets/<uuid>/` → `init_db` → push new entry → `write_json_atomic`. Compliant with AD-2, AD-3.

**Unit B — "Login / migrate branching" story (CAP-4/CAP-5, AD-12).** `handle_auth_callback`: read registry (N entries) → create dataset dir → push new cloud-linked entry → `write_json_atomic`. Compliant with AD-3, AD-11, AD-12.

Interleave them (user clicks "+ New local profile" while the browser tab is finishing the Cognito round-trip — an entirely ordinary sequence, since the picker stays interactive during the round-trip and nothing in AD-11/AD-14 disables it): both read N, both write N+1, **last writer wins, the other dataset's entry is silently gone.** Its directory and fully-migrated SQLite file remain on disk. Because AD-3 makes the registry the *sole* source of truth and explicitly forbids directory-scan reconstruction, that dataset is **permanently invisible** — and because deletion/repair is Deferred, permanently unreclaimable. For the Migrate case the lost entry is the one holding the *only* copy of migrated financial data plus its `linked_from` provenance. No error is surfaced to anyone.

**Corollary — orphaned directory on partial failure.** Both units create the directory + DB *before* the registry write. If the registry write fails, the directory is orphaned and invisible. Unit A might reverse the order (registry first, then dir) to avoid orphans; Unit B keeps dir-first. Now the two units disagree on whether a registry entry may reference a directory that does not yet exist — so a picker rendering the list (AD-3) must tolerate entries with no directory in one unit's world and not the other's. A second, smaller shared-state clash from the same unguarded seam.

**AD to tighten — AD-3:**
1. State that **all registry mutation happens inside a single process-wide guard held across the entire read-modify-write**, and that `datasets.rs` exposes only *intent-level* mutators (`append_entry`, `update_entry`) — never a public read-registry / write-registry pair that callers compose themselves. "Atomic write" is explicitly declared **insufficient**; name the read-modify-write critical section as the actual invariant.
2. State the creation ordering invariant and the failure rule: directory + migrated DB first, registry append last, and a failed append must remove the just-created directory (or the registry is repaired) so no orphan and no dangling entry can exist. Pin which of the two states readers must tolerate — ideally neither.

---

## H4 — `dataset_id` has no pinned generation scheme, canonical form, or id↔directory mapping rule — S2/S3

**The hole (three distinct sub-clashes, one root cause).** AD-2 says new datasets get `app_data_dir/datasets/<uuid>/`. AD-3's entry shape is `{ id, label, kind, cognito_sub?, linked_from?, is_default, created_at }` and the Consistency table says only "`id`/`cognito_sub`/`linked_from` are plain strings." **The spine never states that `id` *is* the directory name, and AD-3's entry shape has no `dir`/`path` field.** So the directory *must* be derivable from `id` — but nothing says so, and nothing pins the generation scheme or canonical form.

**H4a — id ≠ directory name, with nowhere to record the directory.**
- *Unit A ("Picker + create_dataset", CAP-6):* `id = Uuid::new_v4().to_string()`, directory `datasets/{id}/`, and `active_dataset_dir` computes `app_data_dir/datasets/{id}` (or `app_data_dir` when `id == "default"`). Clean, compliant with AD-2/AD-3.
- *Unit B ("Login/migrate", AD-12 "create a new dataset (AD-2 shape)"):* wants human-debuggable, support-friendly ids, so `id = format!("cloud-{}", cognito_sub)` (a "plain string" — compliant with the Consistency table; and note `brownfield.md` establishes `sub` is already validated `^[A-Za-z0-9_-]{1,128}$` and used verbatim as a filename, so this is the *precedented* pattern in this codebase, not an odd choice), while the directory is a separately-generated `datasets/<uuid>/` exactly as AD-2's literal text demands.

Unit B is compliant and **structurally broken**: with `id != dirname` and no `dir` field in AD-3's shape, the id→directory mapping has nowhere to live, so `active_dataset_dir` — the AD-5 authority every other module depends on — **cannot resolve Unit B's datasets at all.** Two compliant units, one of which silently breaks the spine's central authority.

**H4b — no canonical form → keyring keys become invisible.** AD-8 derives the keyring **service** name as the literal `"nkbaz-finance-<dataset_id>"`. With no canonical-form rule: Unit A emits lowercase-hyphenated UUIDs; a second implementer emits `to_string().to_uppercase()` or braced/`simple` (unhyphenated) UUID form — all "plain strings," all AD-2/AD-3-compliant. On macOS and Windows the filesystem is case-insensitive, so **directory resolution keeps working** and the divergence is invisible in testing — but keyring service names are compared byte-exact, so any normalization difference between the write path and the read path means **the dataset's stored AI-provider keys become permanently unreadable.** CAP-3's isolation still holds; the user's configured key just vanishes with no error. This is the nastiest kind of divergence: it passes every isolation test and fails only in the field.

**H4c — id collision with the reserved literal `"default"`.** AD-2 reserves `"default"` and binds it to `app_data_dir` itself. **No AD requires ids to be unique, opaque, or non-reserved.** A Unit-B-style slug/label-derived id can produce exactly `"default"` (e.g. a CAP-6 profile the user thinks of as their default, or any label-slugging scheme). That dataset then resolves — via AD-5's own authority — to `app_data_dir`, i.e. **the Default dataset's directory.** Two datasets, one directory: CAP-3's isolation guarantee is destroyed, and combined with H1 a "wipe this profile" against it wipes Default.

**AD to tighten — AD-2 and AD-3:**
1. **AD-2** must pin the exact scheme and its canonical form: `dataset_id` is an **opaque, lowercase, hyphenated UUID v4** (or one named alternative) generated by exactly one function in `datasets.rs`, never derived from a label, email, or `cognito_sub`; `"default"` is the sole non-UUID id and is **reserved** — no other dataset may ever hold it.
2. **AD-2** must state the mapping as an invariant, not a coincidence: **`dataset_id` *is* the directory name.** `active_dataset_dir(id)` = `app_data_dir` if `id == "default"` else `app_data_dir/datasets/{id}`, with no stored path anywhere and no second mapping.
3. **AD-3** must state that `id` is unique across the registry, is written in canonical form exactly once at creation, and is never re-derived, re-cased, or normalized by any consumer — explicitly including AD-8's service-name construction.

---

## H5 — `dataset:switched` has no payload contract, and no rule on whether the first selection of a run emits it — S2/S3

**The hole:** AD-6 says `select_dataset` "emits a `dataset:switched` Tauri event." AD-7 makes that event the trigger for `queryClient.clear()`. Neither AD specifies the **payload shape**, nor whether the event fires on the **initial** selection of a run (when there is no previous dataset to switch *from*), nor whether the event or the command's `Result` is the completion signal the frontend may act on.

**H5a — the picker deadlocks on first launch.**
- *Unit A ("Switch dataset" story):* reads AD-6 as describing *switching*. The initial selection at launch is not a switch (no previous connection to drop, nothing to swap out), so it emits nothing — a defensible, compliant reading, and the AD's own framing ("Switching datasets is an in-process hot-swap") invites it.
- *Unit B ("Picker + hooks" story):* `dataset:switched` is the only completion signal the spine names, so `useDatasets.ts` listens for it to clear the cache (AD-7, mandatory) and navigate out of `/picker`.

On the very first launch — the *only* path CAP-1 guarantees exists — the event never fires: **the picker never navigates, the app is unusable, and no error is raised.** Both units are compliant.

**H5b — clashing payload shape, made worse by AD-7's mandatory ordering.**
- *Unit A:* emits `dataset:switched` with no payload (AD-6 doesn't ask for one) — the frontend can just refetch.
- *Unit B:* its listener needs the new dataset's `id` and `kind` to navigate and to render the cloud-linked badge (AD-10), so it types the event as `{ dataset_id, kind }`.

A bare-payload emit against a payload-expecting listener is a runtime break. And Unit B **cannot fall back to a query**, because AD-7 mandates a full `queryClient.clear()` in that same handler: clearing wipes the `useDatasets()`/`get_active_dataset` cache, so the navigation target must arrive *in the payload* or be re-fetched after the clear in a strictly ordered sequence the spine never states. This is a textbook clashing shared-data shape on the one new cross-boundary contract the spine introduces.

**AD to tighten — AD-6 and AD-7:**
1. **AD-6** must pin the event contract exactly: `dataset:switched` carries `{ dataset_id, kind }` (snake_case per the Consistency table), and is emitted on **every** successful `select_dataset` — **including the first selection of a run** — and **never** on failure.
2. **AD-6/AD-7** must name the completion signal unambiguously: the `Ok` result of `select_dataset` is what the caller acts on; the event is the **broadcast** that drives AD-7's cache clear and any non-caller listener. State the handler ordering: `queryClient.clear()` first, then navigate using the **event payload** — never a query read that the clear just invalidated.
3. **AD-6** must state whether `select_dataset(already_active_id)` is a no-op or a full re-swap, and — if a no-op is allowed — that it **still emits**, so AD-7's invariant ("every existing query key is now implicitly dataset-scoped") cannot be silently skipped.

---

## H6 — Direct AD-5 ↔ AD-13 contradiction over `commands/profile.rs`, and no authority for the global root — S2

**The hole — two ADs give opposite orders about the same call site.**
- **AD-5:** "`backup.rs`, `danger_zone.rs`, **`commands/*.rs`**, and `credentials.rs`'s per-dataset key resolution MUST obtain the active dataset's directory via `datasets::active_dataset_dir(&app)`, **never** by calling `app.path().app_data_dir()` themselves." Its stated purpose is to eliminate the 5 independent call sites `brownfield.md` enumerates — and that list **explicitly includes `commands/profile.rs::resolve_profiles_dir`.**
- **AD-13:** `profile_store.rs`, its `/profile` route, and its `sub`-keyed documents "stay anchored at the **global** `app_data_dir` root regardless of which dataset is active."

`commands/profile.rs` is a `commands/*.rs` file, and it is one of the five sites AD-5 names as the smell it exists to kill. Obeying AD-5 makes the demographic profile dataset-scoped, which **violates AD-13**. Obeying AD-13 leaves a live `app.path().app_data_dir()` call site, which **violates AD-5**.

**Unit A ("Path-resolution sweep" / AD-5 story):** mechanically converts all five enumerated call sites — including `resolve_profiles_dir` — to `active_dataset_dir`. Fully AD-5-compliant. Effect: on any non-default dataset, `/profile` reads/writes `datasets/<uuid>/profiles/<sub>.json`, so the user's demographic profile appears empty in every profile except Default, and gets re-entered per dataset. Silently breaks AD-13 and the SPEC constraint that the two concepts are orthogonal.

**Unit B ("Demographic profile untouched" / AD-13 story):** leaves `commands/profile.rs` alone. Fully AD-13-compliant, and leaves AD-5's central invariant factually false — so the *next* story, told "AD-5 guarantees all path resolution flows through `datasets.rs`," reasons from a premise the codebase does not satisfy.

**Compounding gap — there is no named authority for the global root, yet three things need it.** AD-3's registry lives at `app_data_dir/datasets.json`; AD-13's `profiles/` lives at the global root; AD-4's bootstrap reads/writes the registry. All three need the **global** `app_data_dir`, but AD-5 offers only `active_dataset_dir` and otherwise forbids `app.path().app_data_dir()`. Every implementer needing the global root must therefore either violate AD-5 or invent their own accessor — and two units will invent two.

**AD to tighten — AD-5 (and one clarifying line in AD-13):**
1. **AD-5** must expose **two** named accessors from `datasets.rs` and declare them the only two: `datasets::active_dataset_dir(&app)` (dataset-scoped consumers) and `datasets::global_app_data_dir(&app)` (the registry per AD-3, the bootstrap per AD-4, and `profiles/` per AD-13). The prohibition on direct `app.path().app_data_dir()` then holds with **zero exceptions**, because every legitimate need has a named authority.
2. **AD-5** must **explicitly carve out `commands/profile.rs` / `profile_store.rs` by name** as global-root consumers routed through `global_app_data_dir`, so the sweep story cannot mechanically convert them and AD-5's claim stays literally true.
3. **AD-13** should add the reciprocal line: the demographic profile is resolved via `global_app_data_dir`, never `active_dataset_dir`.

---

## H7 — "Delete all data" and the globally-shared `profiles/` directory: no rule, two opposite defensible answers — S2

**The hole:** `brownfield.md` records that `delete_all_data` today removes the **entire** `profiles/` directory (every Cognito `sub`'s demographic document), and that `profile_store::delete_all_profiles` has the same whole-directory semantics. AD-13 makes `profiles/` **global and shared by every dataset**. AD-5 makes `danger_zone.rs` dataset-scoped. **No AD says what a dataset-scoped `delete_all_data` does about a globally-shared directory** — and once H6 is fixed, the contradiction becomes fully visible rather than accidentally hidden.

**Unit A ("Danger-zone" story, isolation-first):** reasons that `profiles/` is global per AD-13, so a per-dataset destructive action must not touch it. Preserves it always. Consequence: `delete_all_data` **silently stops deleting demographic data**, a regression in today's shipped behavior and arguably in the user's "delete all my data" expectation — with no AD acknowledging the change.

**Unit B ("Danger-zone" story, parity-first):** reasons that AD-13 says `profile_store.rs` is untouched, so danger-zone's existing whole-directory delete stays as-is. Consequence: invoking "delete all data" **from inside any one dataset destroys the demographic profile documents shared by every other dataset** — a cross-dataset destructive leak that directly contradicts CAP-3's isolation guarantee, and one AD-1's "Prevents" clause claims to rule out.

Both readings are compliant. They are *opposite*. And they differ again between Default and non-default datasets under a naive `active_dataset_dir.join("profiles")` implementation: destructive for Default (it resolves to the global `profiles/`), a silent no-op for every other dataset (the path doesn't exist) — so the same user-facing button has three different behaviors depending on which unit built it and which dataset is active.

**AD to tighten — AD-13 (with a pointer from AD-5):** state explicitly that **`profiles/` is out of scope for every dataset-scoped destructive or backup path.** `danger_zone.rs` and `backup.rs` must never read, write, delete, or copy it — for **any** dataset, Default included — precisely because it is global. If losing today's "delete-all also clears demographic profiles" behavior is a product regression, that must be surfaced as a separate, explicitly global action, not left to an implementer's inference.

---

## H8 — AD-12 contradicts its own "Prevents": Migrate manufactures duplicate `cognito_sub`s that Login then cannot disambiguate — S2

**The hole — a self-contradiction inside one AD.** AD-12's "Prevents" claims to prevent "**duplicate cloud-linked datasets for the same Cognito account**." But its own two branches guarantee they can exist:
- `LoginIntent::Login` → find-or-create **by `cognito_sub`** (assumes at most one match).
- `LoginIntent::Migrate` → "**always** create a new dataset," tagged `kind: "cloud-linked"` + that same `cognito_sub`.

Nothing forbids migrating twice to the same account (from two different local datasets — a completely natural user action, and CAP-5 places the entry point inside *every* non-cloud-linked profile). After two migrations to account X, the registry holds **two** `kind: "cloud-linked"` entries with `cognito_sub == X`. AD-12's Login branch then says "look up an entry with matching `cognito_sub`" — **with no tie-break rule for multiple matches.**

**Unit A ("Login" story, CAP-4):** `entries.iter().find(...)` → first match in file order. Compliant.
**Unit B (same story, different implementer):** picks the newest by `created_at` (AD-3 provides it, so this is the obvious "most recent wins" choice). Also compliant.

Same registry, same user, same login: **two different datasets opened, non-deterministically from the user's point of view.** A user who migrates, keeps working in the migrated profile, then migrates a second local profile to the same account, will — depending on which unit built the lookup — silently land in the *other* cloud-linked profile on next login and see a dataset they believe is stale or wrong. Worse, CAP-5's success criterion ("signing back in with the same account reattaches **it** rather than creating a duplicate") is unsatisfiable when "it" is ambiguous.

**Additional silent divergence from the same unpinned field set:** AD-12 tells Migrate to set `linked_from: source_dataset_id`, but AD-3 marks `linked_from?` optional and no AD says whether Login's freshly-created dataset must **omit** the field or set it to `null`. Two units, two JSON shapes for the same logical "not migrated" state — see H10.

**AD to tighten — AD-12:**
1. State the uniqueness invariant plainly: **at most one `kind: "cloud-linked"` entry per `cognito_sub`.** Then make Migrate enforce it — if a cloud-linked dataset for that `sub` already exists, Migrate must **not** create a second one; specify the actual behavior (reject with a clear error, or offer to select the existing one), because "always create a new dataset" as written is what breaks the invariant AD-12 claims to protect.
2. If duplicates are genuinely intended to be legal, then AD-12 must instead specify a **deterministic tie-break** for the Login lookup and reconcile it with CAP-5's "reattaches it, not a duplicate" success criterion — one or the other, never left open.

---

## H9 — Migrate's checkpoint-and-copy is only valid while the source dataset is active, and nothing enforces that — S1

**The hole:** AD-12 mandates that Migrate copy the source dataset's SQLite file "by reusing `export_backup`'s proven `PRAGMA wal_checkpoint(TRUNCATE)` + `std::fs::copy` sequence." That sequence is only correct **when you hold an open connection to the source database** — the checkpoint is what folds the `-wal` contents into the main file so the `fs::copy` is complete. But:
- **AD-6** guarantees exactly **one** connection process-wide, pointing at the **active** dataset, and explicitly prevents "two datasets' connections open simultaneously."
- **AD-11** holds `LoginIntent::Migrate(source_dataset_id)` in-process "across the redirect round-trip" — a round trip through the **system browser**, lasting seconds to minutes, during which the user is interacting with an app whose picker and profile switching remain fully live.
- **No AD forbids `select_dataset` while a Migrate round-trip is pending.**

**Unit A ("Login/migrate branching" story):** at callback time, resolves the source directory from the carried id (correctly, per AD-11), then runs AD-12's mandated sequence: `PRAGMA wal_checkpoint(TRUNCATE)` on **the connection it has** — which AD-6 says is the *active* dataset's — then `fs::copy` from the **source** directory. Every AD obeyed.

**Unit B ("Switch dataset" story):** lets the user switch datasets at any time, because AD-6 describes switching as always available and no AD says otherwise.

Interleave them (user clicks "Migrate to Nixus Cloud," the browser opens, and while waiting they return to the picker and open a different profile — behavior AD-6 itself encourages by framing switching as "log out of profile A / log into profile B"): the callback fires with the active dataset now ≠ the source dataset. Unit A checkpoints **the wrong database** and then byte-copies the source's main DB file **with its `-wal` contents unmerged and its `-shm` absent from the copy.** The migrated cloud-linked dataset comes up with a structurally valid SQLite file that is **missing the source's most recent committed transactions** — and AD-12's `init_db`-on-open path will happily migrate and open it. Silent, partial data loss in the exact operation AD-12's "Prevents" clause promises will not lose data, presented to the user as a successful migration.

Note the genuine architectural tension here, which is why this needs an explicit decision rather than an implementer's judgement: the obvious fix — open a temporary connection to the source dataset just to checkpoint it — **is itself an AD-6 violation** ("two datasets' connections open simultaneously"). The spine as written leaves no compliant way to do this correctly.

**AD to tighten — AD-12 and AD-6:**
1. **AD-12** must state the precondition explicitly: Migrate requires the source dataset to be the **active** dataset at callback time, with its connection held; if the active dataset has changed, Migrate **aborts** with a clear error and creates nothing (no partial dataset, no registry entry). Name the check — do not leave it to inference.
2. **AD-6** must forbid `select_dataset` while a Migrate round-trip is pending (or state that initiating a switch **cancels** the pending `LoginIntent::Migrate`), so the precondition in (1) cannot be violated rather than merely detected.
3. **AD-12** must also state that the copy covers the checkpointed main DB file only, and explicitly that `-wal`/`-shm` sidecars are **not** copied (post-`TRUNCATE` they are empty/irrelevant) — otherwise one unit copies all three and another copies one, producing two different on-disk shapes for the same operation and a possible mismatched-sidecar corruption on first open.

---

## H10 — Registry schema has no required/optional contract, no corrupt-file rule, and two ways to identify Default — S2/S3

Three small, independently-constructible clashes on one shared data structure. Grouped because one tightening of AD-3/AD-4 closes all three.

**H10a — required vs. optional fields.** AD-3's entry shape marks only `cognito_sub?` and `linked_from?` optional, implying `id`, `label`, `kind`, `is_default`, `created_at` are all required. But AD-4 specifies the bootstrap entry as "(`id: "default"`, `kind: "local"`, `is_default: true`)" — **omitting `label` and `created_at`.** *Unit A* (bootstrap story) writes exactly the three fields AD-4 names. *Unit B* (registry/`serde` story) derives the struct from AD-3 with those five fields non-optional. Unit B's deserializer then **fails on the file Unit A wrote** — a hard `AppError::File` on the very first launch of the upgrade path, i.e. the exact path CAP-2 promises is invisible and automatic. Conversely, a unit that adds `#[serde(default)]` liberally silently accepts entries with an empty `label`, which the picker (AD-3's sole source of truth) then renders as a blank, unidentifiable profile row.

**H10b — no corrupt-registry rule, and the two answers differ by total data loss.** AD-4 says: missing → create with exactly one entry; already exists → "a no-op read." **It says nothing about a file that exists but does not parse** (interrupted write pre-`write_json_atomic`, disk issue, a stale file from a divergent build, or H10a's own mismatch). *Unit A* treats unparseable as equivalent to missing — the AD's own binary framing invites this — and **recreates the registry with only the Default entry, permanently orphaning every other dataset** (AD-3 forbids directory-scan recovery; deletion/repair is Deferred). *Unit B* treats it as a hard error and refuses to launch. Both compliant; one is silent total loss of every non-Default profile, the other is a bricked app. The correct behavior (fail loudly, never auto-truncate, preserve the file for recovery) is stated nowhere.

**H10c — two ways to identify Default.** AD-2 makes `id == "default"` the identifying literal; AD-3 adds an `is_default` boolean. *Unit A* branches path resolution on `id == "default"`; *Unit B* branches on `is_default`. They agree only while the registry is perfectly consistent — and nothing enforces that, since no AD says `is_default` must be true **iff** `id == "default"`, nor that creation paths must set `is_default: false` (AD-12's and CAP-6's create paths never mention the field at all). A single entry with `id: "default", is_default: false` — or a second entry with `is_default: true` — makes the two units resolve **different directories for the same dataset**, which is H1's blast radius reachable by one bad boolean.

**AD to tighten — AD-3 and AD-4:**
1. **AD-3** must give the entry a precise schema contract: exactly which fields are required, which are optional, the `serde` defaulting behavior for each, and that **all** creation paths (AD-4 bootstrap, CAP-6 `create_dataset`, AD-12 Login, AD-12 Migrate) write the **complete** field set — then fix AD-4's abbreviated entry to match, including `label` and `created_at`.
2. **AD-3** must make `is_default` **derived, not stored** (`id == "default"`), or state the biconditional invariant and that only AD-4's bootstrap may ever set it true. One rule for identifying Default, not two.
3. **AD-4** must state the corrupt/unparseable-registry rule explicitly: **never** treat unparseable as missing, never auto-recreate over it, fail loudly with the file preserved. "Missing → create / exists → no-op read" is an incomplete state machine for a file this consequential.

---

## Summary table

| # | Constructible incompatible pair (both fully AD-compliant) | Sev | AD to add / tighten |
| --- | --- | --- | --- |
| **H1** | Danger-zone wipe implemented at **table level** vs. at **directory level**; the latter, run against Default (whose dir *is* `app_data_dir`), deletes `datasets.json` + all of `datasets/`. Same hole lets Migrate deep-copy every other dataset. | **S1** | **AD-2** (registry + `datasets/` are not part of any dataset; name the file allow-list) + **AD-5** (no wholesale dir enumeration/removal/copy) |
| **H2** | `select_dataset` with **no atomic guard / no rollback** vs. backup & danger-zone independently resolving `active_dataset_dir` then locking `DbState`; plus frontend flag set **optimistically** vs. Rust id as truth → mid-switch path/connection split-brain and an unreachable picker after a failed switch. | **S2** | **AD-6** (one guard spanning the whole swap + all-or-nothing rollback) + **new AD / AD-14** (Rust id is sole authority; frontend flag derived) |
| **H3** | `create_dataset` and `handle_auth_callback` (separate loopback-listener thread) both **read-modify-write** the registry; `write_json_atomic` makes only the write atomic → last writer wins, other dataset permanently orphaned and invisible (no directory-scan fallback, deletion Deferred). | **S1** | **AD-3** (process-wide guard across the whole read-modify-write; intent-level mutators only; creation ordering + failure rule) |
| **H4** | **(a)** `id` = UUID **and** dirname vs. `id` = `cloud-<sub>` with a separate UUID dirname — AD-3 has no `dir` field, so `active_dataset_dir` cannot resolve the latter. **(b)** lowercase-hyphenated vs. uppercase/simple UUID → dirs still match (case-insensitive fs) but AD-8's keyring service name doesn't → keys silently unreadable. **(c)** a label-derived id can collide with reserved `"default"` → two datasets, one directory. | **S2/S3** | **AD-2** (pin scheme + canonical form; reserve `"default"`; `dataset_id` **is** the dirname) + **AD-3** (id unique, canonical, never re-derived) |
| **H5** | `dataset:switched` **not emitted** on the first selection of a run (not a "switch") vs. picker using it as its only completion signal → first-launch deadlock. Plus **bare payload** vs. listener expecting `{dataset_id, kind}`, unusable-by-query because AD-7 mandates `queryClient.clear()` in the same handler. | **S2/S3** | **AD-6** (pin payload; emit on **every** success incl. first; never on failure; define no-op-reselect) + **AD-7** (handler ordering: clear, then navigate from payload) |
| **H6** | AD-5 orders **all `commands/*.rs`** (a list that names `profile.rs::resolve_profiles_dir`) onto `active_dataset_dir`; AD-13 orders the demographic profile to stay at the **global** root. Sweep story converts it (breaks AD-13); profile story doesn't (breaks AD-5). No named authority exists for the global root that AD-3/AD-4/AD-13 all require. | **S2** | **AD-5** (add `global_app_data_dir`; carve out `profile.rs`/`profile_store.rs` **by name**) + **AD-13** (reciprocal line) |
| **H7** | Dataset-scoped `delete_all_data` **preserves** the globally-shared `profiles/` (silent regression of today's behavior) vs. **keeps today's whole-directory delete** (one dataset destroys every dataset's demographic docs); naive `active_dataset_dir.join("profiles")` yields a **third** behavior — destructive for Default, no-op elsewhere. | **S2** | **AD-13** (`profiles/` is out of scope for every dataset-scoped destructive/backup path, Default included) |
| **H8** | AD-12 Migrate "**always** creates a new" cloud-linked dataset tagged with the same `cognito_sub`, so two can share a `sub`; Login's find-by-`sub` has **no tie-break** → first-in-file-order vs. newest-`created_at` open **different datasets** for the same login. Contradicts AD-12's own "Prevents" and CAP-5's success criterion. | **S2** | **AD-12** (at most one cloud-linked entry per `sub`, enforced in Migrate — or a deterministic tie-break, explicitly chosen) |
| **H9** | Migrate runs AD-12's mandated `wal_checkpoint(TRUNCATE)` on the **only** connection AD-6 permits (the *active* dataset's) then `fs::copy`s the **source** dir; nothing forbids switching datasets during the browser round-trip → checkpoints the wrong DB, copies the source with `-wal` unmerged → migrated copy silently missing recent commits. The obvious fix (temp second connection) would itself violate AD-6. | **S1** | **AD-12** (source must be active at callback; else abort creating nothing; pin sidecar handling) + **AD-6** (forbid/cancel switching while a Migrate round-trip is pending) |
| **H10** | **(a)** AD-4's 3-field bootstrap entry vs. AD-3's 5-required-field struct → deserialize failure on the upgrade path. **(b)** unparseable registry treated as **missing** (recreate → every non-Default dataset orphaned) vs. **hard error** (app won't launch). **(c)** Default identified by `id == "default"` vs. `is_default` → one bad boolean resolves two different directories. | **S2/S3** | **AD-3** (required/optional + `serde` defaults; all four creation paths write the full set; `is_default` derived) + **AD-4** (corrupt ≠ missing: fail loudly, preserve file) |

---

## What the spine got right (recorded so the findings read as localized, not systemic)

These are genuinely well-defended against this lens and need no change:

- **AD-1's "never dataset-aware internally."** Refusing to let `db/*` learn about datasets is what keeps the divergence surface small enough that this review has ten findings instead of fifty. The wipe-coverage test staying unmodified is a real, machine-checked guarantee carried forward per-dataset.
- **AD-8's Default-keeps-the-unscoped-name rule.** The literal `"nkbaz-finance"` for `default` and `"nkbaz-finance-<dataset_id>"` otherwise is pinned tightly enough that two units cannot diverge on the *shape* — the only gap is `dataset_id`'s canonical form (H4b) and the unenumerated key set for Migrate's copy, not the naming scheme.
- **AD-9's explicit non-scoping of the Cognito session.** Naming what is *not* being built, with the deferral recorded, removes an entire class of "did we scope sessions?" divergence. Two units cannot disagree about a session model neither is allowed to touch.
- **AD-11's single OAuth mechanism.** Branching post-callback rather than forking the flow makes a PKCE/state divergence between CAP-4 and CAP-5 structurally impossible. This is the single highest-leverage decision in the spine.
- **AD-13's deliberate `datasets/` vs. `profiles/` naming split**, and the Consistency table's "never 'profile' in code identifiers." This closes the terminology collision `brownfield.md` flags as the top confusion risk — the remaining profile-related findings (H6, H7) are about *path authority and destructive scope*, not naming.
- **AD-14's in-memory-only selection flag.** Correctly makes "no last-used-profile shortcut" a structural property rather than a behavior someone must remember not to add. The defect is only that the flag is a *second* copy of state (H2), not that it is in-memory.
- **The Deferred section's specificity.** Naming per-account sessions, deletion/rename, the layout-route reorg, and the `/profile`-copy question — with reasons — prevents a unit from opportunistically building any of them. The `/profile`-copy item is flagged rather than silently assumed correct, which is exactly the right posture.

---

## Recommended disposition

**Blocking before sharding into parallel stories:** H1, H2, H3, H6, H8, H9. Each is either silent data destruction or a contradiction that guarantees two independently-built units cannot integrate.

**Fix before the affected story starts (cheap, mechanical once decided):** H4, H5, H7, H10. These are pinning exercises — id scheme and canonical form, event payload and emission rule, destructive scope for `profiles/`, registry schema and corrupt-file semantics.

**Structural observation worth one explicit AD, independent of the ten findings.** Two root causes generate most of this review, and both deserve to be named in the spine rather than fixed only at their symptom sites:

1. **AD-2's "Default's directory *is* `app_data_dir`"** is the right call for CAP-2's zero-touch upgrade guarantee — do not change it — but it makes one dataset's directory a superset of the registry and every other dataset. That asymmetry needs to be stated **as a hazard with explicit rules attached** (H1, H4c, H7, H10c all trace to it), not left as an implication readers are expected to derive.
2. **The spine centralizes the *path* (AD-5) but not the *state* (AD-6/AD-14) or the *writer* (AD-3/AD-12).** A single path authority over two uncoordinated state records and two uncoordinated registry writers is what makes H2, H3, and H5 constructible. The cleanest closure is one AD stating that `datasets.rs` owns **all three** — path resolution, the active-dataset record, and registry mutation — behind a single guard, with every other module a read-only consumer through named accessors.

