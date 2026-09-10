---
title: 'Edit project images from the row thumbnail'
type: 'feature'
created: '2026-09-09'
status: 'done'
baseline_commit: '42992535b73457ab2e0c132a488036412f193302'
review_loop_iteration: 0
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The expanded project detail renders a large image card that consumes substantial space and duplicates the row thumbnail. Uploading or replacing an image requires expanding the row and using controls in that card.

**Approach:** Remove the expanded image card and make the compact project thumbnail the direct upload/replace control. Preserve image removal in the project's existing overflow menu so the capability is not lost.

## Boundaries & Constraints

**Always:** Use the existing Tauri picker, validator, mutations, thumbnail batch query, translations, confirmation dialog, and design-system focus treatment. Keep the thumbnail at its current row size and preserve the rule that list rendering never reads full-size image payloads.

**Ask First:** Any change to image storage, validation limits, thumbnail generation, or destructive confirmation behavior.

**Never:** Add a second upload mechanism, fetch full-size images for list rows, keep any large image preview in expanded details, place Remove beside the thumbnail as a peer action, or overwrite unrelated uncommitted test work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add | Project has no image; user clicks placeholder and selects a valid file | Image is stored and the placeholder becomes the new thumbnail | Existing picker/write errors remain visible without storing invalid data |
| Replace | Project has an image; user clicks thumbnail and selects a valid file | Existing image is replaced and thumbnail refreshes | Failed replacement leaves the prior thumbnail unchanged |
| Cancel | User dismisses the native picker | No write occurs and the thumbnail state is unchanged | No error is shown |
| Remove | Project has an image; user chooses Remove image from the row menu and confirms | Image is removed and the row shows the empty thumbnail | Failed removal leaves the thumbnail unchanged and surfaces the existing error copy |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/components/projects/ProjectRowThumbnail.tsx` -- current presentational thumbnail; reuse `useProjectImagePicker` and `useSetProjectImage` here to make it the direct add/replace control without full-image reads.
- `apps/desktop/src/components/projects/ProjectRow.tsx` -- owns the existing row overflow menu; add conditional image removal and confirmation while keeping edit/archive behavior.
- `apps/desktop/src/components/projects/ProjectDetail.tsx` -- remove the `ProjectImageCard` mount so expansion shows financial detail only.
- `apps/desktop/src/components/projects/ProjectImageCard.tsx` -- obsolete after interaction relocation; delete only after all behavior is represented elsewhere.
- `apps/desktop/tests/projects.spec.ts` -- replace card-centric assertions with thumbnail add/replace/cancel/error/removal coverage; preserve and adapt the existing uncommitted visual-evidence test.
- `apps/desktop/src/hooks/useProjectImagePicker.ts` and `apps/desktop/src/hooks/useProjects.ts` -- read-only reuse points for picker, thumbnail, set, and remove behavior.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/tests/projects.spec.ts` -- first rewrite the focused image tests to describe the compact-only interaction and confirm the new assertions fail against current UI.
- [x] `apps/desktop/src/components/projects/ProjectRowThumbnail.tsx` -- render an accessible button and connect selection to the existing set-image mutation.
- [x] `apps/desktop/src/components/projects/ProjectRow.tsx` -- retain conditional image removal in the existing row menu behind the existing confirmation dialog.
- [x] `apps/desktop/src/components/projects/ProjectDetail.tsx` and `ProjectImageCard.tsx` -- remove the expanded image panel and obsolete component.

**Acceptance Criteria:**
- Given any project row, when it is expanded, then no large project image panel or full-size image payload read appears.
- Given an empty or populated thumbnail, when it is activated by pointer or keyboard, then the native image picker opens for add or replace respectively.
- Given a populated thumbnail, when Remove image is selected from the row menu, then deletion occurs only after confirmation.
- Given multiple rows, when the project screen settles, then thumbnails use one batch query and no full-size image query.

## Spec Change Log

## Design Notes

The thumbnail is a real button with an accessible name describing Add or Replace according to state. Its visible geometry remains unchanged; hover and focus only communicate interactivity. Removal remains demoted in the row's existing overflow menu rather than becoming a second control beside the image.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec playwright test tests/projects.spec.ts` -- expected: all project scenarios pass.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero TypeScript errors.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: full desktop suite passes.
- `pnpm --filter @nixus/desktop build` -- expected: production build exits successfully.

**Manual checks (if no CLI):**
- At 1024×680, verify both filled and empty thumbnails are visibly clickable, keyboard focus is clear, row expansion contains no image panel, and add/replace/remove work without horizontal overflow.
