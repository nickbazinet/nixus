---
name: version-bump
description: 'Bump the app version across all required files when releasing or updating the version. Use when the user says "bump version", "update version", "release", or "update release number".'
---

# Version Bump — Nixus

When bumping the version, **all three files** must be updated to the same version:

1. `apps/desktop/package.json` — `"version": "X.Y.Z"`
2. `apps/desktop/src-tauri/tauri.conf.json` — `"version": "X.Y.Z"` (CI uses this to name the GitHub release)
3. `apps/desktop/src-tauri/Cargo.toml` — `version = "X.Y.Z"`

`apps/desktop/src-tauri/Cargo.lock` updates automatically from Cargo.toml on the next build — do not edit it manually, but it **must** be committed alongside the version bump.

## Release workflow (automated)

Use the release script instead of doing this by hand — it bumps all three files, shows a preview of the generated release notes, commits, tags, and pushes in one flow:

```
pnpm release              # patch bump (default): 0.3.16 -> 0.3.17
pnpm release minor        # 0.3.16 -> 0.4.0
pnpm release major        # 0.3.16 -> 1.0.0
pnpm release 0.4.5        # explicit version
pnpm release:dry-run      # preview version + notes, no changes committed
```

`scripts/release.mjs` handles: updating `package.json`, `tauri.conf.json`, `Cargo.toml`, refreshing `Cargo.lock`, committing (`chore: bump version to X.Y.Z`), tagging `vX.Y.Z`, and pushing the commit + tag.

### Manual equivalent (if not using the script)

1. Update all three files above to the new version
2. `git add apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock`
3. `git commit -m "chore: bump version to X.Y.Z"`
4. `git tag vX.Y.Z`
5. `git push && git push --tags`

## Release notes

The CI (`.github/workflows/release.yml`) triggers on `v*` tags and uses `tauri-action` to create a **draft** GitHub release with built packages. Before building, a "Generate release notes" step runs `scripts/generate-release-notes.mjs <previous-tag> <new-tag>` to produce categorized notes (Features, Bug Fixes, Refactors, Documentation, etc.) from **every conventional commit since the last release** — not just the bump commit — and passes them as `releaseBody` to `tauri-action`.

- Commits must follow conventional-commit style (`feat(scope): ...`, `fix: ...`, etc.) to be categorized correctly; anything that doesn't match falls into "Other Changes".
- `chore: bump version to X.Y.Z` commits are automatically excluded from the notes.
- To preview notes for any range locally: `node scripts/generate-release-notes.mjs v0.3.15 v0.3.16`.

## Important

- The tag version and the version in `tauri.conf.json` **must match** or CI will look for the wrong draft release and fail silently.
- Releases are created as **drafts** — the user publishes them manually after verifying the build artifacts.
