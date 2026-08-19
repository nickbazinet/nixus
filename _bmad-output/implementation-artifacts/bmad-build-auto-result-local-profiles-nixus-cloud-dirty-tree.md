---
status: blocked
---

# BMad Build Auto Result

Status: blocked
Blocking condition: dirty working tree

## Details

Invocation intent: build the epic/story breakdown in `_bmad-output/planning-artifacts/epics-local-profiles-nixus-cloud.md` (as tracked in `sprint-status.yaml`). That file now has `stepsCompleted: [1, 2, 3]` (fully decomposed — Epics 33, 34, 35), and `sprint-status.yaml` lists the first actionable story as:

- `epic-33: backlog`
- `33-1-dataset-path-authority-replaces-every-independent-app_data_d: backlog` ("Dataset path authority replaces every independent `app_data_dir` call site")

Per the `bmad-build-auto` workflow's Step 1 version-control sanity check (INSTRUCTIONS item 3): a clean working tree is required before routing/planning proceeds; `git add --refresh -- .` was run and did not itself change the diff (no metadata-writability issue), but the tree was already dirty beforehand:

```
 M _bmad-output/implementation-artifacts/sprint-status.yaml
?? _bmad-output/implementation-artifacts/bmad-build-auto-result-local-profiles-nixus-cloud-no-epics.md
?? _bmad-output/planning-artifacts/epics-local-profiles-nixus-cloud.md
```

- `sprint-status.yaml` — modified in place (adds the Epic 33/34/35 backlog rows shown above; no unrelated changes)
- `epics-local-profiles-nixus-cloud.md` — new, untracked (the fully-decomposed epic/story breakdown this invocation would plan from)
- `bmad-build-auto-result-local-profiles-nixus-cloud-no-epics.md` — new, untracked (a stale halt artifact from an earlier `bmad-build-auto` attempt made before the epics were decomposed; safe to remove or keep as history)

Branch: `master`. No obvious branch/epic mismatch was found — the block is strictly the dirty-tree condition, not a branch issue.

Per this agent's own operating constraints, committing is never done without an explicit user request, so this halt could not self-resolve by committing on the user's behalf.

## Recommended next step

Commit (or otherwise settle) the sprint-planning output, then re-invoke `bmad-build-auto`:

```
git add _bmad-output/implementation-artifacts/sprint-status.yaml _bmad-output/planning-artifacts/epics-local-profiles-nixus-cloud.md
git commit -m "docs(bmad): epic breakdown for local profiles & Nixus Cloud (epics 33-35)"
```

The stale `bmad-build-auto-result-local-profiles-nixus-cloud-no-epics.md` can be deleted or committed alongside — it is no longer accurate now that the epics exist.

Once the tree is clean, re-run `bmad-build-auto`. With no story-specific id supplied, it should resolve to the first backlog story in the newly decomposed epics: **Epic 33 / Story 33.1 — "Dataset path authority replaces every independent `app_data_dir` call site."**
