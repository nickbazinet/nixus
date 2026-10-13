# Story 7 — Lazy project images (implementation spec)

Intent: rebuild `project_images` so `image_bytes` is nullable with an `image_sha256` column and a
relaxed size CHECK, then store/fetch full images as content-addressed blobs with a placeholder until
fetched. Thumbnails stay in the table. AD-10 (+ AD-6 `blob/<sha256>`, AD-8 header, AD-9 blanking),
project-context rule 12, migration 026/027 conventions.

## 1. Migration 030, tripwire 29 -> 30

026's full CREATE + 027's two columns in ONE table (so the rules 027 could only enforce in Rust
become named CHECKs): `CREATE project_images_rebuilt` -> `INSERT ... SELECT` -> `DROP` -> `RENAME`.
Every column, the PK, the `ON DELETE CASCADE` FK and the column order are preserved; the table has no
index and no trigger and nothing references it, so there is nothing else to re-create. No `VACUUM`,
no `VACUUM INTO` (rule 12, AD-9).

- `image_bytes BLOB` nullable = not yet fetched / blanked out of a snapshot.
- `image_sha256 TEXT NOT NULL`, lowercase hex of the full bytes (key material for `blob/<sha256>`).
  Backfilled in the same statement by `nixus_sha256_hex(blob)`, a scalar function `run_migrations`
  registers and removes around the run: that is what makes the rebuild one atomic migration and the
  column `NOT NULL` instead of nullable-then-fixed. Needs the rusqlite `functions` feature.
- Relaxed `project_images_byte_size_matches_payload` -> `image_bytes IS NULL OR byte_size = length()`.
  `byte_size`, `mime_type`, `original_filename`, `uploaded_at` stay NOT NULL, so metadata is complete
  while the payload is absent. New named guards: `_image_sha256_is_hex`,
  `_thumbnail_is_whole_or_absent`, `_thumbnail_mime_allowed`, `_thumbnail_byte_ceiling`.
- The copy NORMALISES a half-written / oversized / unknown-mime thumbnail to NULL so legacy data can
  never fail a new CHECK and brick a launch; the derivative is regenerable and the existing lazy
  backfill re-derives it. Full bytes are copied verbatim. `WIPE_TABLES` unchanged (same table name).

## 2. Content-addressed blobs

- `sync/object.rs`: the AD-8 header every immutable object carries (magic, format version,
  `enc_scheme` 0 with unknown refused, `schema_version`, content sha256) + `hex_lower`. Written here
  because the blob is the first object kind; Story 8 reuses it for segments/snapshots.
- `sync/blob.rs`: `blob_key(hex)` = `blob/<sha256>` relative to the account prefix,
  `put_image_blob` (create-only, `AlreadyStored` -> `AlreadyDeduplicated`), `fetch_image_blob` which
  parses the header and RE-HASHES the payload, refusing on mismatch. Both go through `GatedStore`
  (Story 6), so AD-14 and inherited AD-12 hold. Nothing in `db/` names `sync`.

## 3. Placeholder semantics

`models::ProjectImage` gains `image_sha256`, `full_image_available`, `thumbnail_base64`,
`thumbnail_mime`; `image_base64` becomes `Option<String>`. `get_project_image` answers a
not-yet-fetched row with the thumbnail plus the explicit flag instead of failing. No production
component reads this command today (`useProjectImage` has no caller), so this is types plus the two
mock/fixture sites: no new UI, no new i18n string, no new Tauri command (Story 10 wires fetching).
`get_project_ids_needing_thumbnails` gains `AND image_bytes IS NOT NULL` so a blanked row is not an
infinite backfill candidate. `db::projects` gains `set_project_image_bytes` (hash-checked write-back,
Story 10) and `blank_project_image_bytes` (AD-9 stripping, Story 8).

## 4. Tests / gates

`db/tests_migration_030.rs` seeds schema 29 with real-size deterministic images (4 194 303 B, 2 MB,
1 B, plus no-thumbnail / half-written / oversized / gif-thumbnail rows) and asserts: bytes identical,
sha256 correct, usable thumbnails kept and only unusable ones dropped, table shape and PK, absent
payload accepted, every guard refusing BY NAME, FK + cascade intact, re-open a no-op, and the timed
rewrite. Plus header, blob-key, dedup, verified-fetch, mismatch and gate-refusal unit tests.
Gates: cargo build / test (1425) / clippy -D warnings; tsc, vitest (638), desktop:build, projects +
profile Playwright (165).

## Decisions

- Unattended per rules section 6: spec self-approved, all goals kept, no HALT, no review subagents.
- `image_sha256` is hex TEXT, not BLOB: AD-6 uses it verbatim as an object key and hex is CHECK-able.
- rusqlite `functions` feature added rather than a nullable column plus a post-migration Rust pass.
- Legacy thumbnails normalised, never refused: a CHECK that can fail on disk data bricks a launch.
- MEASURED: rewriting 2 x 4 MB images took 490 ms locally (debug, macOS); the test ceiling is a loose
  10 s regression guard, not a benchmark.
- `hex_lower` moved from `sync/s3.rs` to `sync/object.rs` so the blob path imports no helper from the
  transport adapter.
