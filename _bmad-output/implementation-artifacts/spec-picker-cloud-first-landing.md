---
title: 'Cloud-first professional landing page'
type: 'feature'
created: '2026-08-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'ed5e851420aca9f454452511f0112cfa2081e90c'
context:
  - 'docs/project-context.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The launch-time profile picker preserves the right behavior but reads as a utility list rather than a polished Nixus welcome surface. Local profiles also compete visually with the intended primary entry point, Nixus Cloud login.

**Approach:** Redesign the picker as an asymmetric, responsive two-column landing composition inspired by the supplied Slack reference: a clear Nixus value statement and primary “Log in with Nixus Cloud” action, supported by browser-return guidance and a restrained brand visual. Put the unchanged local-profile experience behind a default-collapsed “Working locally” disclosure.

## Boundaries & Constraints

**Always:** Preserve the launch gate, Cognito `LoginIntent::Login` payload, callback navigation, and all select/create/rename/delete behavior. Reuse `@nixus/shared` primitives and the Quiet Ledger tokens; support EN/FR, light/dark themes, keyboard operation, reduced motion, forced colors, and the 1024×680 minimum. Keep all existing behavior-bearing test IDs.

**Ask First:** Any need for backend/Rust changes, new auth states, changes to profile CRUD semantics, or a new shared primitive.

**Never:** Copy Slack branding or artwork; add cloud sync claims, avatars, remembered disclosure state, auto-selection, free-text profile creation, raw palette values, non-logo gradients, card shadows, unrelated refactors, or changes to the untracked research folder.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Cloud entry | User activates primary CTA | Existing `start_login` call runs with `{ intent: { kind: "Login" } }`; picker remains until callback | Existing localized toast on launch failure |
| Local entry | User activates “Working locally” | Disclosure expands in place; focus remains on trigger; existing rows and create action appear | No persisted state; re-collapsed on each mount |
| Registry pending | Query unresolved | Local panel reveals accessible skeleton content | Cloud CTA remains available |
| Registry failed | Query rejected | Failure is visible without requiring disclosure expansion | Existing alert copy; Cloud CTA remains available |
| Narrow/scaled UI | Content cannot sustain two columns | Composition stacks without clipping or horizontal overflow | Page remains scrollable |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/components/picker/DatasetPicker.tsx:39` -- sole redesign target; handlers at 90–124 and modal mounts at 294–315 remain behaviorally unchanged.
- `apps/desktop/src/routes/__root.tsx:40` -- read-only launch gate and chrome-free arrangement.
- `apps/desktop/src/hooks/useDatasets.ts` / `useAuth.ts` -- read-only IPC and mutation contracts.
- `apps/desktop/src/locales/{en,fr}.json` -- landing statement, browser-return helper, and disclosure copy.
- `apps/desktop/src/locales/__tests__/picker-i18n.test.ts:19` -- closed EN/FR key and user-facing terminology contract.
- `apps/desktop/tests/picker.spec.ts:469` -- gate, layout, login payload, profile CRUD, loading/error, keyboard, and selector regression coverage.
- `_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/{DESIGN,EXPERIENCE}.md` -- record the launch composition and reconcile optional Cloud identity with the older no-account statement.

## Tasks & Acceptance

**Execution:**
- [x] UX spines -- document the launch-screen visual/behavior contract using existing tokens; add no unnecessary token.
- [x] Locale files and parity test -- add concise EN/FR statement, browser helper, and “Working locally” copy; retire superseded picker copy only when no caller remains.
- [x] `apps/desktop/tests/picker.spec.ts` -- first add failing coverage for hierarchy, collapsed disclosure, accessibility, re-mount reset, and responsive overflow while retaining existing behavior assertions.
- [x] `apps/desktop/src/components/picker/DatasetPicker.tsx` -- implement the responsive two-column composition and accessible disclosure without changing handlers or profile panels.
- [x] Visual QA -- inspect collapsed/expanded, empty/error, light/dark, and 1024×680 states in Chromium.

**Acceptance Criteria:**
- Given the picker loads, when no local action has been taken, then Cloud login is the only primary action and local rows/create are hidden behind a collapsed disclosure.
- Given the disclosure is keyboard-activated, when it expands, then `aria-expanded`/`aria-controls` are correct, focus stays on the trigger, and every existing local action works unchanged.
- Given login is activated, when IPC is inspected, then the existing login payload is unchanged and no dataset is selected by the click.
- Given 1024×680 or constrained effective width, when the page renders in either theme, then content reflows without overlap or horizontal scrolling.
- Given loading, empty, or failed registry states, when rendered, then each remains distinguishable and Cloud login remains usable.

## Design Notes

Use the reference’s hierarchy, not its brand: strong statement, dominant CTA, browser-return helper, low-emphasis alternative, and an illustrative second column. The Nixus visual is flat, token-based, decorative/`aria-hidden`, and built from the existing logo geometry, lines, and soft brand surfaces; it must not become a generic SaaS gradient panel. Stack the visual below the action content when two columns no longer hold.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop test` -- locale/unit suite passes.
- `pnpm --filter @nixus/desktop exec playwright test tests/picker.spec.ts` -- picker behavior passes.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- zero TypeScript errors or warnings.
- `pnpm --filter @nixus/desktop build` -- production build succeeds.

**Manual checks:**
- Playwright screenshots at 1280×800 and 1024×680 for light/dark, collapsed/expanded, and registry error states show no clipping, overflow, token drift, or copied Slack branding.

## Suggested Review Order

**Landing Composition**

- Start with the cloud-first hierarchy, disclosure state, and preserved action handlers.
  [`DatasetPicker.tsx:62`](../../apps/desktop/src/components/picker/DatasetPicker.tsx#L62)

- Review the connected local modules and optional Cloud illustration.
  [`PickerBrandVisual.tsx:22`](../../apps/desktop/src/components/picker/PickerBrandVisual.tsx#L22)

- Confirm profile-row extraction preserved selection and management behavior.
  [`ProfileRow.tsx:32`](../../apps/desktop/src/components/picker/ProfileRow.tsx#L32)

**UX Contract**

- Verify the launch surface visual rules and deliberate two-column gutter.
  [`DESIGN.md:467`](../planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md#L467)

- Verify optional identity remains distinct from required local functionality.
  [`EXPERIENCE.md:71`](../planning-artifacts/ux-designs/ux-nixus-2026-08-01/EXPERIENCE.md#L71)

- Review the recorded no-account-required identity amendment.
  [`.decision-log.md:277`](../planning-artifacts/ux-designs/ux-nixus-2026-08-01/.decision-log.md#L277)

**Shared Identity**

- Confirm multiple logo instances receive hydration-safe unique gradient IDs.
  [`nixus-logo.tsx:13`](../../packages/shared/src/ui/nixus-logo.tsx#L13)

**Copy And Verification**

- Review the English landing and disclosure copy before its French peer.
  [`en.json:86`](../../apps/desktop/src/locales/en.json#L86)

- Review the mirrored French copy and expansion behavior.
  [`fr.json:86`](../../apps/desktop/src/locales/fr.json#L86)

- Finish with hierarchy, accessibility, responsiveness, and regression coverage.
  [`picker.spec.ts:611`](../../apps/desktop/tests/picker.spec.ts#L611)
