---
name: 'Forward-compatibility review — spine vs. mobile/cloud addendum'
type: architecture-review
lens: forward-compatibility (strategic input reconciliation)
target: _bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-18/ARCHITECTURE-SPINE.md
input: _bmad-output/planning-artifacts/product-brief-addendum-mobile-cloud-differentiation-2026-08-12.md
input_focus: '§3 Data Model: Local Core + Optional Nixus Cloud (also §1.1, §2.2, §3.3)'
status: complete
created: '2026-08-18'
---

# Forward-Compatibility Review — Spine vs. Mobile/Cloud Addendum

## Remit

Does anything in the newly-drafted spine **foreclose or make materially harder** the addendum's future vision?
Four claims from the addendum were checked against the spine:

1. **Mobile companion as capture/notification bridge** (§2.2) — phone captures queue, desktop stays canonical, AI-processes on next sync.
2. **"Reminder ticket, not record" cloud pattern** (§3.2) — desktop computes locally, pushes an opaque push-notification instruction; cloud never holds the ledger; capture queue is transient.
3. **`cognito_sub` as the future sync join key** (§3.3).
4. **Cross-module intelligence requires zero cloud** (§1.1, §3.2) — pure local synthesis across `maintenance/evaluator.rs` + `financial_health/evaluator.rs`.

This is **not** a scope-creep check. The spine is *correct* to build none of the above; §3 features are explicitly non-goals of `SPEC-local-profiles-nixus-cloud`, and the spine's Deferred list already names "Cloud data sync/persistence of any kind" as out of scope. The only question asked here is whether the dataset/registry model just introduced (AD-1, AD-2, AD-3) leaves a clean path for a *later* real cloud-sync feature **without an architectural rewrite**.

---

## Verdict

**No foreclosure. The spine is forward-compatible with the addendum's §3 model, and in two places actively strengthens it.**

The per-dataset local-only model is, if anything, the right substrate for the addendum's eventual cloud: it establishes a stable, addressable unit of user data (a directory + one complete SQLite file) and a registry that *already* carries `cognito_sub` — the exact join key §3.3 anticipates. A future sync feature would attach to this model rather than replace it.

Three findings are recorded below. **None is a blocker and none asks for any addendum feature to be built now.** Finding 1 is a real structural asymmetry worth recording in the spine's own terms; Findings 2 and 3 are cheap wording/shape hedges that cost nothing now and save a re-litigation later.

---

## Where the spine actively *helps* the future vision (non-findings, stated for the record)

These were checked and found clean. They are listed so a later reader does not re-open them.

- **`cognito_sub` join key is already load-bearing and unique.** AD-3's registry entry shape records `cognito_sub`, and AD-12's `LoginIntent::Login` is explicitly *find-or-create-by-sub*. That combination yields a 1:1 `sub` ↔ cloud-linked-dataset mapping enforced at link time — precisely what §3.3 needs to route a capture or a reminder ticket to the right local ledger. The addendum's hope that "less net-new identity architecture is needed than it would first appear" is *validated* by this spine, not undermined.
- **Cross-module intelligence stays zero-cloud, and the spine reinforces it.** AD-1 puts **one complete SQLite file per dataset** — not one file per module. Finance and Car tables therefore remain co-resident in a single connection, so the §1.1 synthesis ("timing belt is $800 → emergency fund 2.4 → 1.6 months") stays a plain local join with no cross-store coordination. Had the spine sharded per module or per domain, §1.1 would have gotten harder. It did the opposite.
- **The capture queue and reminder tickets have an obvious, non-disruptive home.** AD-1's rule that `db/*` and the `MIGRATIONS` runner "must never become dataset-aware internally" is exactly right for this: a future `captures` / `reminder_tickets` table is an ordinary migration in the per-dataset DB, inheriting isolation for free from the directory-scoping mechanism. No part of AD-1 needs to change to accommodate it. The transience §3.2 requires (cleared once synced) is a row-lifecycle concern, not an architectural one.
- **AD-9's global Cognito session is correctly deferred, and the escape hatch already exists.** A single machine-wide session is sufficient for one cloud account, which is all the addendum's opt-in model implies. If per-account session isolation is ever needed, AD-8 has *already established the exact pattern* to extend — a per-dataset keyring **service-name suffix**, with `"default"` keeping the unscoped literal. Applying that same shape to the `nixus-auth`/`cognito-session` entry later is a localized change inside `credentials.rs`, which AD-8/AD-9 keep as the sole `keyring_core::Entry` accessor. Deferring this is a deferral, not a foreclosure.
- **AD-12 `Migrate` producing a *copy* (fork) is not a sync foreclosure.** Migrate creates a new dataset and byte-copies the source DB, leaving the original untouched, so two datasets can hold the same ledger history and then diverge. Under the §3.2 model this is benign: the cloud never holds the ledger and never has to reconcile two ledgers, so there is no merge semantics to get wrong. Captures simply land in the cloud-linked dataset; the stale local original just never receives any. `linked_from` preserves the provenance needed for a future "this local copy predates your cloud profile — archive it?" prompt. No action.
- **AD-14's deliberately non-persisted "selected this run" flag does not block proactive alerts.** A future notification/sync path is a process-level or background concern keyed off the registry, not off which route resolved; the picker gate sits above the UI, not above the data. No action.

---

## Findings

### Finding 1 — `AD-2` makes "a dataset" a non-uniform unit: Default is the *parent* of its own siblings

**Severity:** low-moderate. Structural, worth recording now; no rewrite required later, but a permanent special case.

AD-2 sets the Default dataset's directory to **be `app_data_dir` itself**, while every other dataset lives at `app_data_dir/datasets/<uuid>/`. Consequently the Default dataset's directory *contains* `datasets/` (every other dataset) and `datasets.json` (the registry, AD-3) and the global `profiles/` dir (AD-13).

This is the right call for the stated goal — AD-2 exists to guarantee nothing moves or rewrites the pre-existing `nkbaz-finance.db` on upgrade, and it achieves that with zero migration risk. **Today it is harmless**, which I verified rather than assumed: both consumers named in AD-5 address a *single file path*, not a directory tree — `backup.rs` builds `app_data_dir.join("nkbaz-finance.db")` and `std::fs::copy`s that one file (`backup.rs:36`, `backup.rs:60`, `backup.rs:99`), and `danger_zone.rs` touches only a targeted `profile_store::profiles_dir(&app_data_dir)` (`danger_zone.rs:26`, `danger_zone.rs:32`). No recursive directory operation exists, so nothing nests today.

The forward-compat cost lands on any *future* feature that treats "a dataset directory" as a uniform, self-contained unit — which a cloud-sync feature naturally will:

- upload / snapshot / restore a dataset directory,
- per-dataset "reset cloud copy" or drain-and-clear of a capture queue holding attachments (§2.2's receipt photos, glovebox documents — these are *files*, not rows, so a photo store will likely be directory-shaped),
- the already-deferred dataset deletion/rename,
- per-dataset disk accounting.

Each of those must special-case Default forever, and for deletion the naive implementation is destructive (recursing the Default dir would take the registry and every other dataset with it).

**This does not require rewriting the dataset/registry model** — the registry stays the source of truth and `id: "default"` is already a distinguishable literal, so a single `dataset_dir_contents()`-style helper in `datasets.rs` (the sole path authority per AD-5) can encapsulate "which entries belong to *this* dataset" once, for all future consumers. That is the clean path, and it exists.

**Suggested (documentation-only, this pass):** state explicitly in AD-2 or AD-5 that a dataset's directory is **not** a safe recursive unit for the Default dataset, and that any future whole-directory operation must go through `datasets.rs` rather than walking the resolved dir. Recording the asymmetry now is much cheaper than having a future sync story discover it.

### Finding 2 — `AD-6`'s invariant is worded at process scope; a future background sync needs it at `DbState` scope

**Severity:** low. Wording, not structure.

AD-6/the paradigm section assert the app is "**single-active-dataset, never concurrent-multi-tenant** … it never serves two datasets at once," backed by exactly one `Mutex<Connection>` and one in-memory active-dataset-id.

As an invariant over the *shared application state*, this is sound and worth keeping — it is what makes AD-7's blunt `queryClient.clear()` sufficient and prevents cross-dataset leakage. But two of the addendum's future behaviours want to touch a dataset that is **not** the active one:

- draining a capture queue into the cloud-linked dataset the captures belong to, when the user currently has a different profile open;
- firing §3.2 reminder tickets for a cloud-linked dataset regardless of which profile is open (a maintenance alert that only fires when you happen to have that profile selected is not a "proactive alert").

Read literally, "never serves two datasets at once" forbids these, and a future story would have to re-litigate a stated invariant — which is exactly the kind of friction this pass should pre-empt.

**Mechanically the spine already makes the fix trivial**, which is why this is wording and not structure: AD-1 gives every dataset a complete, independently-migrated SQLite file with an identical schema, and `init_db` already takes a directory (`db/` "UNCHANGED internally — init_db still takes a directory"). Opening a short-lived, scoped second connection to another dataset's directory therefore needs no schema change, no registry change, and no change to any `db/*` query. Nothing in AD-1/AD-2/AD-3 blocks it.

**Suggested (wording-only, this pass):** scope the invariant to what it actually protects — "exactly one dataset is bound to the shared `DbState`/UI at a time" — rather than "the process never opens two datasets." Same guarantee against the leakage class AD-6/AD-7 target, without pre-forbidding a future background writer.

### Finding 3 — `AD-3` pins the registry entry shape with no version or extension marker

**Severity:** minor / optional. Cheap hedge.

AD-3 designates `datasets.json` the single source of truth and fixes the entry shape (`{ id, label, kind, cognito_sub?, linked_from?, is_default, created_at }`) with `datasets.rs` as the sole writer — a good, well-bounded rule.

A future sync feature will want to hang per-dataset sync metadata off exactly this record: device identifiers (§3.2's "fire a push notification for **device X**"), `last_synced_at`, cloud endpoint/region, or a per-dataset sync-enabled flag. Purely *additive* optional fields are already safe (serde tolerates unknown fields by default, and `cognito_sub?`/`linked_from?` establish the optional-field precedent), so **the common case is fine and this is not a foreclosure.** The gap is only that a later *non-additive* change (e.g. `kind` gaining variants that older builds must not silently misread, or promoting sync state into a nested object) has no version marker to branch on and must resort to shape-sniffing — and because the registry is written by an atomic whole-file write, a downgrade-after-upgrade path can drop fields it did not know about.

**Suggested (optional, one field):** consider a `schema_version` (or equivalent) on the registry envelope while it is being created for the first time anyway. This is not a request to build anything from the addendum — it is a zero-cost hedge on a file whose format is about to become load-bearing for the picker on every launch.

---

## Adjacent observation (explicitly outside this review's remit — no verdict impact)

Not a forward-compatibility matter, so it does not affect the verdict above, but it surfaced while verifying Finding 1 and is cheap to pass along to whoever owns spine-internal consistency: AD-5 directs `danger_zone.rs` to resolve its directory via `datasets::active_dataset_dir(&app)`, and today that module uses `app_data_dir` solely to reach `profile_store::profiles_dir(&app_data_dir)` (`danger_zone.rs:26`, `danger_zone.rs:32`). But AD-13 keeps the demographic `profiles/` dir **globally anchored at the `app_data_dir` root**, deliberately *not* dataset-scoped. For a non-default active dataset, the AD-5 swap would therefore point `profiles_dir` at a per-dataset path that AD-13 says must not exist. Worth a look during story-writing to decide whether the AD-5 path swap applies to that one call or whether the profiles lookup stays explicitly global. Flagging only; no recommendation here.

---

## Bottom line

The addendum's §3 model — local core holds the ledger, optional cloud carries only transient captures and opaque reminder tickets, `cognito_sub` as the join key, intelligence computed locally — is **compatible with this spine as drafted**. The spine builds none of it, which is correct and explicitly in-scope-as-out-of-scope, and it does not close the door on any of it. A future cloud-sync feature would extend the dataset/registry model (new optional registry fields, new per-dataset tables, a scoped background connection) rather than rewrite it.

The one item genuinely worth recording in the spine before the reviewer gate is **Finding 1** — the Default-dataset directory asymmetry — because it is a permanent special case that every future per-dataset operation inherits, and documenting it costs one sentence now versus a surprise in a later sync story. Findings 2 and 3 are wording/shape hedges, take-or-leave.
