---
name: version-bump
description: 'Bump the app version across all required files when releasing or updating the version. Use when the user says "bump version", "update version", "release", or "update release number".'
---

# Version Bump — nkbaz-finance

When bumping the version, **all three files** must be updated to the same version:

1. `apps/desktop/package.json` — `"version": "X.Y.Z"`
2. `apps/desktop/src-tauri/tauri.conf.json` — `"version": "X.Y.Z"` (CI uses this to name the GitHub release)
3. `apps/desktop/src-tauri/Cargo.toml` — `version = "X.Y.Z"`

`apps/desktop/src-tauri/Cargo.lock` updates automatically from Cargo.toml on the next build — do not edit it manually, but it **must** be committed alongside the version bump.

## Release workflow

After updating all three files, **always commit, tag, and push** in a single flow:

1. Update all three files above to the new version
2. `git add apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock`
3. `git commit -m "chore: bump version to X.Y.Z"`
4. `git tag vX.Y.Z`
5. `git push && git push --tags`

The CI (`.github/workflows/release.yml`) triggers on `v*` tags and uses the `tauri-action` which reads the version from `tauri.conf.json` to create a **draft** GitHub release with built packages.

## Important

- The tag version and the version in `tauri.conf.json` **must match** or CI will look for the wrong draft release and fail silently.
- Releases are created as **drafts** — the user publishes them manually after verifying the build artifacts.
