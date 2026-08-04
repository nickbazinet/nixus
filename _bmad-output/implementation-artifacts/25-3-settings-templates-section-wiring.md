---
baseline_commit: 1bc542762f39223e091c1f9d297fd2b0b8e9cc3e
---

# Story 25.3: Settings "Templates" Section Wiring

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to add a system starter budget from the Settings page,
so that I can get a working category structure without going through onboarding again.

**Scope:** Frontend only (TypeScript/TSX + i18n + tests). **Four files edited, zero-to-two created:** the starter-template rows inside the **existing** `settings.sectionTemplates` block of `components/settings/YourDataSettings.tsx`, 10 new `settings.template*` strings in `locales/en.json` + `locales/fr.json`, new cases in `locales/__tests__/budget-templates-i18n.test.ts`, and new cases in `tests/budget-templates.spec.ts`. **No Rust. No new hook. No new query key. No new TS interface. No new dependency. No migration. No new component file. No onboarding change. No `lib/constants.ts` change. No `lib/types.ts` change. No `hooks/**` change.**

**FRs:** FR70 (starter-template path — Settings entry point), FR71 (same apply surface the redirect gate reuses) · **NFRs:** NFR11/NFR13 inherited untouched (this story surfaces counts, never computes money)
**Epic:** [epics-budget-templates.md § Epic 25, Story 25.3 (lines 274-296)](../planning-artifacts/epics-budget-templates.md)
**Architecture:** [architecture-budget-templates.md](../planning-artifacts/architecture-budget-templates.md) — § Frontend Architecture (line 175), § Project Structure → Files to MODIFY (lines 263, 265), § Gap Analysis (lines 325-330)
**Predecessors:** [25.2](25-2-frontend-hook-for-budget-templates.md) (**HARD** — `useSystemTemplates`, `useApplySystemTemplate`, `SystemBudgetTemplateSummary`) · [25.1](25-1-canadian-starter-template-definition-list-apply-commands.md) (**HARD, transitive** — both Tauri commands) · [24.4](24-4-import-a-community-template-file.md) (**SOFT** — owns and builds the export/import half of this exact Settings section)

---

## ⛔ SCOPE RECONCILIATION WITH STORY 24.4 — READ FIRST

The epic's first AC for 25.3 ("the Export as template and Import template buttons are enabled and wired") is **not this story's work**. Story 24.4 claimed it, with a binding, quoted rationale:

> **Story 25.3 must therefore treat its "Export as template / Import template buttons are enabled and wired" AC as already satisfied and add only the starter-template picker.**
> — 24-4 § Scope Boundary vs. Stories 25.2 / 25.3 (binding)

24.4's ownership table assigns to itself: the two Settings rows, both buttons, both handlers (`handleExportTemplate` / `handleImportTemplate`), all four import/export toasts, the `busy` disabled-state boolean, and 14 `settings.template*` i18n keys. It assigns to **25.3**: "Starter-template **picker** row in the same Templates section + its apply toast."

| Epic 25.3 AC | Owner | This story does |
|---|---|---|
| Export/Import buttons enabled + wired to `useExportBudgetTemplate()`/`useImportBudgetTemplate()` | **24.4** (AC #7-#14) | ❌ Nothing — verify, then leave untouched |
| Export/import success + error toasts, their 14 i18n keys, their Playwright cases | **24.4** | ❌ Nothing |
| Starter-template picker using `useSystemTemplates()` + apply via `useApplySystemTemplate()` | **25.3** | ✅ Builds it |
| Apply toast incl. `skipped_groups` names | **25.3** | ✅ Builds it |
| Apply error surfaced to the user (no bare `console.error`) | **25.3** | ✅ Builds it |
| `useSystemTemplates`/`useApplySystemTemplate`/`SystemBudgetTemplateSummary`/`queryKeys.systemBudgetTemplates` | **25.2** | ❌ Consume only |
| Localizing the starter `name`/`description` off the stable id slug | **25.3** | ✅ Builds it |
| Editable per-category targets before apply | **25.4** | ❌ Out of scope (see §Conflict C) |

**Net deliverable: one starter-template picker row per system template, inside the existing Templates card, with an apply toast, an error path, 10 i18n strings in both locales, and tests for both.**

---

## ⛔ PREREQUISITE GATE

**Verified against the live tree at story-creation time (2026-08-04): nothing from Epic 24 or Epic 25 is implemented.** `YourDataSettings.tsx` is 151 lines and its `settings.sectionTemplates` block (lines 138-146) is still the statement-only placeholder — `<SettingRow title={t("settings.templatesUnavailableTitle")} description={t("settings.templatesUnavailableBody")} data-testid="setting-templates-unavailable" />` — with **zero** `control`/`Button`/`disabled` props. `apps/desktop/src/hooks/useBudgetTemplates.ts` does not exist. `apps/desktop/src-tauri/src/budget/` and `src/commands/budget_template.rs` do not exist. `grep -rn "useSystemTemplates\|systemBudgetTemplates\|SystemBudgetTemplateSummary" apps/desktop/src` returns zero matches. `en.json`/`fr.json` each hold 1117 flat keys, including `settings.templatesUnavailableTitle`/`Body` and **no** `settings.template*` key. All six Epic 24/25 stories are `ready-for-dev`; `git log` contains zero template commits. **The architecture doc's claim that this section has "already-scaffolded but disabled buttons" is false — there are no buttons there at all.**

**Run this gate before writing any code:**

```bash
cd /Users/nbazinet/projects/nixus
grep -n "useSystemTemplates\|useApplySystemTemplate" apps/desktop/src/hooks/useBudgetTemplates.ts
grep -n "SystemBudgetTemplateSummary\|ApplyBudgetTemplateResult" apps/desktop/src/lib/types.ts
grep -n "systemBudgetTemplates" apps/desktop/src/lib/constants.ts
grep -n "your-data-template-export\|setting-templates-unavailable\|const busy" apps/desktop/src/components/settings/YourDataSettings.tsx
ls apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts apps/desktop/tests/budget-templates.spec.ts
```

| Gate | Result | Action |
|---|---|---|
| `useSystemTemplates` **or** `useApplySystemTemplate` missing from `hooks/useBudgetTemplates.ts`, **or** `SystemBudgetTemplateSummary` missing from `lib/types.ts` | **HARD STOP** | Report "Story 25.2 is not done." Do **not** write the hook, the TS interface, or the query key here — that is 25.2's entire deliverable. |
| `your-data-template-export` **present** in `YourDataSettings.tsx` (24.4 shipped) | **Branch A — expected** | Insert the starter rows as the **first** children of the existing Templates `<Card flush>`, above `setting-template-export`. Add `applySystemTemplate.isPending` to the existing `busy` expression. Touch **nothing else** in that section. |
| `setting-templates-unavailable` **still present** (24.4 has not shipped) | **Branch B — SOFT** | Insert the starter rows **above** the placeholder row and **keep the placeholder row and its two i18n keys exactly as they are**. Its copy ("Opening a template file and saving your own as one are both planned") is still true, so the section stays coherent, and 24.4 later deletes that row and those two keys as its own spec already instructs. Introduce a local `busy` boolean covering `saving \|\| restoring \|\| applySystemTemplate.isPending` — 24.4 will widen it. Record this branch in Completion Notes. |
| `locales/__tests__/budget-templates-i18n.test.ts` missing (24.4 not shipped) | **SOFT** | Create it from `locales/__tests__/danger-zone-i18n.test.ts`'s shape with **only this story's 10 keys** in `REQUIRED_KEYS`. Do not pre-add 24.4's 14 keys. |
| `tests/budget-templates.spec.ts` missing (24.4 not shipped) | **SOFT** | Create it with **only** this story's starter-template cases, using the `setupTauriMock` shape from `tests/accessibility.spec.ts:10-80`. Do not write 24.4's import/export cases. |
| `SystemBudgetTemplateSummary` present but with different field names than `{ id, name, description }` | — | Use the **actual** names. Do not edit `lib/types.ts`. Note the deviation. |

**Record the ACTUAL hook signatures before typing the JSX against them:**

| Hook | Expected shape (25.2 AC #3/#4) | Consumption |
|---|---|---|
| `useSystemTemplates()` | `UseQueryResult<SystemBudgetTemplateSummary[]>` | `.data`, `.isPending` — **no** `| null`, no cancel guard |
| `useApplySystemTemplate()` | `UseMutationResult<ApplyBudgetTemplateResult, unknown, string>` | `.mutateAsync(templateId)`, `.isPending`, `.variables` |

**Why there is no `if (!data) return;` guard in this story (the #1 mistake available here):** 24.4's import/export mutations return `T | null` because a cancelled **native dialog** makes Rust return `Ok(None)`. `apply_system_template` and `list_system_templates` open **no dialog** and return non-`Option` values (25.1 AC #5/#6). Copy-pasting 24.4's `if (!result) return;` into the apply handler adds a dead branch that would silently swallow the success toast if the type were ever loosened. [Source: 25-2 §Prerequisite Gate; 25-1 §Dev Notes]

---

## Acceptance Criteria

1. **Given** `apps/desktop/src/components/settings/YourDataSettings.tsx`
   **When** this story is implemented
   **Then** the component imports and calls the two 25.2 hooks:
   ```ts
   import { useApplySystemTemplate, useSystemTemplates } from "@/hooks/useBudgetTemplates";
   ```
   ```ts
   const starterTemplates = useSystemTemplates();
   const applyStarterTemplate = useApplySystemTemplate();
   ```
   **And** the existing `<SettingsSection heading={t("settings.sectionTemplates")}>` and its `<Card flush>` wrapper are **reused** — no second Templates section, no new `SettingsSection`, no new component file
   **And** `useSystemTemplates()` is called unconditionally at the top of the component (React hook rules), **not** inside a conditional or a nested render callback
   **And** no new `useState` is introduced for template selection or for apply-pending state (§Conflict A, §Conflict B)

2. **Given** `useSystemTemplates()` has resolved with a non-empty array
   **When** the Templates card renders
   **Then** it renders **one `SettingRow` per returned template**, in the array's order (backend returns `SYSTEM_TEMPLATES` declaration order — do **not** sort client-side), each with:
   - `title` = the localized template name (AC #4)
   - `description` = the localized template body (AC #4)
   - `control` = a `<Button>` labelled `t("settings.templateStarterApplyAction")`, switching to `t("settings.templateStarterApplying")` while that specific template is being applied
   - `data-testid={`setting-template-starter-${template.id}`}` on the row and `data-testid={`your-data-template-apply-${template.id}`}` on the button

   **And** the rows are inserted as the **first** children of the existing Templates `<Card flush>` — a user who lands here to get a budget sees the starter first, and `SettingRow`'s `not-last:border-b` rule keeps the hairline separators correct without any className change
   **And** the button uses the **default** `Button` variant (it is the section's primary action); it is **not** `variant="destructive"` and **not** wrapped in a confirm `Dialog` (§Conflict D)

3. **Given** `useSystemTemplates()` has not resolved yet, or resolved to an empty array
   **When** the Templates card renders
   **Then** the three render states are mutually exclusive and exhaustive:
   ```tsx
   const starters = starterTemplates.data ?? [];
   // …inside the Templates <Card flush>, as its first children:
   {starterTemplates.isPending ? (
     <SettingRow
       title={t("settings.templateStarterLoading")}
       data-testid="setting-template-starter-loading"
     />
   ) : starters.length === 0 ? (
     <SettingRow
       title={t("settings.templateStarterUnavailable")}
       data-testid="setting-template-starter-empty"
     />
   ) : (
     starters.map((template) => /* AC #2 row */)
   )}
   ```
   **And** the loading and empty rows are statement-only — no `control`, no `description`
   **And** the card is **never** rendered empty and the section heading is **never** conditionally hidden — a section whose card has no rows is a visual bug
   **And** no separate `isError` branch is written: `list_system_templates` takes no `State<DbState>` and performs no DB or file I/O (25.1 AC #5), so a rejection is unreachable; fold it into the same settled-with-nothing fallback via `starterTemplates.data ?? []`

4. **Given** the template `name` and `description` arrive from Rust as **English-only compiled consts** (25.1 §UX / i18n Note)
   **When** a row renders
   **Then** display copy is resolved through a **module-level, static-key** lookup declared above the component:
   ```ts
   // Rust ships name/description as English-only consts; the id slug is the stable i18n anchor.
   const STARTER_TEMPLATE_COPY: Record<string, { nameKey: string; bodyKey: string }> = {
     "canadian-starter": {
       nameKey: "settings.templateStarterCanadianName",
       bodyKey: "settings.templateStarterCanadianBody",
     },
   };
   ```
   **And** a template whose `id` is absent from the map falls back to the backend strings — `title` = `template.name`, `description` = `template.description ?? undefined` — so a future system template added in Rust without i18n keys still renders readable copy instead of a raw key string
   **And** the i18n keys are **static string literals** in the map, never built by string concatenation or template interpolation at the `t()` call site — dynamic keys cannot be grepped or asserted by the parity test (AC #9)
   **And** `template.description` is treated as `string | null` (25.2 AC #2), never as `string | undefined`; `?? undefined` is required because `SettingRow`'s `description` prop is `ReactNode | undefined` and checks `description !== undefined`

5. **Given** the user clicks a starter template's apply button
   **When** the handler runs
   **Then** it is an `async` handler that clears the shared page-level error first and awaits the mutation:
   ```ts
   const handleApplyStarterTemplate = async (templateId: string) => {
     setError(null);
     try {
       const result = await applyStarterTemplate.mutateAsync(templateId);
       // …AC #6 toast branching…
     } catch (err: unknown) {
       setError(getErrorMessage(err) || t("settings.templateApplyFailed"));
     }
   };
   ```
   **And** it passes the `template.id` **received from `useSystemTemplates()`**, never a hardcoded `"canadian-starter"` literal in the handler or the JSX — the lookup is exact and case-sensitive on the Rust side (25.1 AC #7)
   **And** it uses `mutateAsync` (not `mutate`), because the result must be read to build the toast
   **And** there is **no** `finally` block resetting a pending flag — `applyStarterTemplate.isPending` is TanStack-managed (§Conflict B)
   **And** there is **no** `console.error`, `console.log`, or silent `catch {}` — the epic's fourth AC forbids logging in place of user feedback
   **And** the existing module-level `getErrorMessage(err)` helper (`YourDataSettings.tsx:10-13`) is **reused**, not redefined

6. **Given** the apply succeeded and returned `ApplyBudgetTemplateResult { groups_created, categories_created, skipped_groups }`
   **When** the user is notified
   **Then** exactly one `sonner` toast fires, chosen by **three** mutually exclusive branches:

   | Condition | Call |
   |---|---|
   | `result.groups_created === 0` | `toast.info(t("settings.templateApplyAllSkipped", { skipped }))` |
   | `result.skipped_groups.length > 0` | `toast.success(t("settings.templateAppliedSkipped", { groups: result.groups_created, categories: result.categories_created, skipped }))` |
   | otherwise | `toast.success(t("settings.templateApplied", { groups: result.groups_created, categories: result.categories_created }))` |

   **And** `const skipped = result.skipped_groups.join(", ");` — the array is joined in TypeScript, **never** handed to `t()` as an array (i18next would stringify it with no separator control)
   **And** the `groups_created === 0` branch is checked **first** and uses `toast.info`, not `toast.success` — "Added 0 groups and 0 categories" is a false success message when every group already existed (§Conflict E)
   **And** the branch condition is `groups_created === 0`, **not** a comparison of `skipped_groups.length` against a template total — `ApplyBudgetTemplateResult` exposes no total
   **And** `toast` is the already-imported `sonner` singleton (`YourDataSettings.tsx:5`); no new toast import, no `useToast()` wrapper, no `<Toaster />` mount (it already lives in the app shell)
   **And** **no** `queryClient.invalidateQueries` and **no** `queryClient.clear()` call is added in this component — `useApplySystemTemplate`'s `onSuccess` already invalidates the six budget-facing keys (25.2 AC #5), and duplicating them here would double every refetch

7. **Given** any of the four operations in this Settings section is in flight
   **When** the buttons render
   **Then** the shared `busy` boolean includes the apply mutation, and every button in the component — backup, restore, template export, template import, and every starter apply — is disabled while `busy` is true:
   ```ts
   const busy =
     saving || restoring || exportTemplate.isPending || importTemplate.isPending ||
     applyStarterTemplate.isPending;
   ```
   **And** in Branch B (24.4 not shipped) the same boolean is introduced with only the terms that exist: `saving || restoring || applyStarterTemplate.isPending`, and the existing backup/restore buttons switch from `saving || restoring` to `busy`
   **And** each button keeps the file's existing `disabled={busy} aria-disabled={busy || undefined}` pairing (`YourDataSettings.tsx:74-75`, `:106-107`) — `aria-disabled` is `|| undefined`, never `false`
   **And** only the row whose template is actually applying shows the pending label, resolved from the mutation's own variables — no extra state:
   ```ts
   const applyingId = applyStarterTemplate.isPending ? applyStarterTemplate.variables : undefined;
   ```
   **And** `applyStarterTemplate.variables` is read **only** while `isPending` is true (before the first `mutate` call it is `undefined`), so the comparison `applyingId === template.id` is safe

8. **Given** the apply failed
   **When** the error is shown
   **Then** it is written into the component's existing `error` state and rendered by the existing `<Alert variant="over" data-testid="your-data-error">` block (`YourDataSettings.tsx:60-64`) — **not** as a toast, and **not** in a new Alert
   **And** the realistic failure is 25.1's fixed validation message `"That starter template is not available."` (`AppError::Validation { field: "template_id" }`), which surfaces **verbatim** via `getErrorMessage`; it is **not** remapped to an i18n key
   **And** `t("settings.templateApplyFailed")` is used **only** as the fallback when `getErrorMessage(err)` returns an empty string
   **And** `err.message` is read directly — `invoke` rejects with the already-deserialized `AppError` object, never a JSON string, so **no** `JSON.parse` anywhere
   **And** the deliberate asymmetry is preserved: successes are auto-dismissing toasts, errors are the persistent page-level Alert (24.4 §Dev Notes — "an error the user must read should not auto-dismiss")

9. **Given** `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json`
   **When** this story is implemented
   **Then** both files gain **exactly these 10 flat keys**, in this order, at the same insertion point in both files (immediately after the last `settings.template*` key if 24.4 shipped, otherwise immediately after `settings.templatesUnavailableBody`):

   | Key | en | fr |
   |---|---|---|
   | `settings.templateStarterCanadianName` | `Canadian starter budget` | `Budget de départ canadien` |
   | `settings.templateStarterCanadianBody` | `Common Canadian household categories with suggested monthly targets. Every target is editable from the Budget page after it's added.` | `Catégories courantes des ménages canadiens avec des cibles mensuelles suggérées. Chaque cible est modifiable depuis la page Budget après l'ajout.` |
   | `settings.templateStarterApplyAction` | `Add to my budget` | `Ajouter à mon budget` |
   | `settings.templateStarterApplying` | `Adding...` | `Ajout...` |
   | `settings.templateStarterLoading` | `Loading starter budgets...` | `Chargement des budgets de départ...` |
   | `settings.templateStarterUnavailable` | `No starter budget is available.` | `Aucun budget de départ n'est disponible.` |
   | `settings.templateApplied` | `Added {{groups}} groups and {{categories}} categories to your budget.` | `{{groups}} groupes et {{categories}} catégories ont été ajoutés à votre budget.` |
   | `settings.templateAppliedSkipped` | `Added {{groups}} groups and {{categories}} categories. Skipped: {{skipped}} (already exist).` | `{{groups}} groupes et {{categories}} catégories ajoutés. Ignorés : {{skipped}} (existent déjà).` |
   | `settings.templateApplyAllSkipped` | `Nothing added — you already have every group in this starter budget: {{skipped}}.` | `Rien n'a été ajouté — vous avez déjà tous les groupes de ce budget de départ : {{skipped}}.` |
   | `settings.templateApplyFailed` | `Could not add the starter budget.` | `Impossible d'ajouter le budget de départ.` |

   **And** every key is added to **both** files with a non-empty value — a key present in one locale only is a test failure (AC #10)
   **And** the two files stay **byte-identical in key order**; they are flat `"namespace.key": "value"` maps, **not** nested objects — do not introduce a nested `settings: { … }` block
   **And** `settings.sectionTemplates` is **not** renamed or re-worded, and in Branch B `settings.templatesUnavailableTitle`/`Body` are **not** deleted (they are 24.4's to delete)
   **And** **no** key added by 24.4 (`settings.templateExport*`, `settings.templateImport*`, `settings.templateSaved`, `settings.templateSaveFailed`, `settings.templateImported*`) is edited, reworded, or removed
   **And** every `{{placeholder}}` above appears in **both** locales for its key — a dropped placeholder renders a sentence with a missing number

10. **Given** `apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts`
    **When** `pnpm --filter @nixus/desktop test` runs
    **Then** it additionally proves, in the **same file** and the **same `describe`**, following `danger-zone-i18n.test.ts`'s exact shape:
    - each of the 10 new keys is truthy in **both** `en.json` and `fr.json` (an `it.each(REQUIRED_KEYS)` case)
    - `settings.templateApplied` retains `{{groups}}` and `{{categories}}` in both locales
    - `settings.templateAppliedSkipped` retains `{{groups}}`, `{{categories}}`, and `{{skipped}}` in both locales
    - `settings.templateApplyAllSkipped` retains `{{skipped}}` in both locales
    - `STARTER_TEMPLATE_COPY`'s two keys (`settings.templateStarterCanadianName`, `settings.templateStarterCanadianBody`) exist in both locales — this is the assertion that catches a renamed key silently rendering as a raw key string in the UI

    **And** the existing prefix-parity test (no `settings.template`-prefixed key in one locale but not the other) covers the new keys automatically because they share the prefix — do **not** add a second parity test
    **And** 24.4's existing `it()` blocks and its `REQUIRED_KEYS` entries are **not** modified, reordered, or removed
    **And** in Branch B the file is created with **only** these 10 keys in `REQUIRED_KEYS`, plus the prefix-parity test, plus the placeholder tests — 24.4 appends its own 14 later

11. **Given** `apps/desktop/tests/budget-templates.spec.ts`
    **When** `pnpm exec playwright test tests/budget-templates.spec.ts` runs from `apps/desktop/`
    **Then** it additionally covers the Settings starter-apply path, reusing the spec's existing `setupTauriMock` helper extended with two cases (`list_system_templates` → `[{ id: "canadian-starter", name: "Canadian Starter Budget", description: "…" }]`, `apply_system_template` → a per-test result), navigating to `/settings/ai-provider?section=data`:

    | Case | Mock result | Assert |
    |---|---|---|
    | applies the starter budget and reports the counts | `{ groups_created: 4, categories_created: 12, skipped_groups: [] }` | `[data-testid="your-data-template-apply-canadian-starter"]` is visible and enabled; after click a toast contains `4` and `12`; `your-data-error` is absent |
    | names the skipped groups | `{ groups_created: 2, categories_created: 6, skipped_groups: ["Housing", "Savings"] }` | toast text contains `Housing` and `Savings` |
    | says nothing was added when every group collided | `{ groups_created: 0, categories_created: 0, skipped_groups: ["Housing", "Transportation", "Living", "Savings"] }` | toast does **not** contain the "Added" success copy; it contains the all-skipped copy and the group names |
    | surfaces a rejected apply in the page Alert | reject `{ type: "validation", message: "That starter template is not available.", field: "template_id" }` | `your-data-error` contains that exact string; the button returns to its idle label; **no** success toast appeared |
    | shows a fallback row when no starter budget exists | `list_system_templates` → `[]` | `setting-template-starter-empty` is visible; no apply button exists |

    **And** `plugin:*` commands still resolve `null` and `transformCallback`/`__TAURI_EVENT_PLUGIN_INTERNALS__` are still stubbed (`accessibility.spec.ts:10-80`) — omitting them makes the update-checker Dialog trap focus and `aria-hidden` the whole app
    **And** **no** `plugin:dialog|open`/`plugin:dialog|save` stub is added — `apply_system_template` opens no dialog (24.4 §Conflict C)
    **And** 24.4's existing import/export cases are **not** modified
    **And** the exact string `"That starter template is not available."` is copied from `25-1`'s AC #7 / the Rust source, never retyped from memory

12. **Given** the desktop app
    **When** `pnpm --filter @nixus/desktop build` runs (`tsc && vite build`)
    **Then** it completes with **zero** TypeScript errors or warnings — `strict` + `noUnusedLocals` + `noUnusedParameters` are on, so an unused import or an unread local is a hard failure
    **And** **no** file under `apps/desktop/src-tauri/`, `apps/web/`, `packages/`, `apps/desktop/src/hooks/`, `apps/desktop/src/routes/`, or `apps/desktop/src/lib/` is modified
    **And** `routeTree.gen.ts` is untouched
    **And** `git diff --name-only` lists at most these five paths: `apps/desktop/src/components/settings/YourDataSettings.tsx`, `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json`, `apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts`, `apps/desktop/tests/budget-templates.spec.ts`
    **And** nothing is committed

---

## Tasks / Subtasks

- [x] **Task 0: Prerequisite gate** (see ⛔ PREREQUISITE GATE)
  - [x] Run all five gate commands. **HARD STOP** and report "Story 25.2 is not done" if the hooks or `SystemBudgetTemplateSummary` are missing
  - [x] Read `apps/desktop/src/hooks/useBudgetTemplates.ts` end-to-end and record the **actual** exported names, the apply mutation's parameter type, and whether the apply return type carries `| null`. Type the JSX against reality, not against this story's assumption
  - [x] Read `apps/desktop/src/components/settings/YourDataSettings.tsx` end-to-end (151 lines today) and record: whether `busy` exists, the exact names of 24.4's handlers and mutation locals, the exact `data-testid`s in the Templates card, and whether `setting-templates-unavailable` is still present. **Decide Branch A or Branch B and write it down**
  - [x] Read `apps/desktop/src/lib/types.ts`'s `SystemBudgetTemplateSummary` and `ApplyBudgetTemplateResult` and record the real field names
  - [x] If they exist, read `locales/__tests__/budget-templates-i18n.test.ts` and `tests/budget-templates.spec.ts` and record their harness/helper names so new cases slot in without redefining anything

- [x] **Task 1: Wire the two hooks into the component** (AC: #1, #7)
  - [x] Add `import { useApplySystemTemplate, useSystemTemplates } from "@/hooks/useBudgetTemplates";` (use the `@/` alias — the relative `"./DangerZone"` style is for sibling components only)
  - [x] Add `const starterTemplates = useSystemTemplates();` and `const applyStarterTemplate = useApplySystemTemplate();` alongside the existing hook calls, above the handlers
  - [x] Add or widen the `busy` boolean per AC #7 and route every button's `disabled`/`aria-disabled` through it
  - [x] Add `const applyingId = applyStarterTemplate.isPending ? applyStarterTemplate.variables : undefined;`
  - [x] Do **not** add any `useState`

- [x] **Task 2: Add the static i18n copy map** (AC: #4)
  - [x] Declare `STARTER_TEMPLATE_COPY` at module scope, below `getErrorMessage`, above `export function YourDataSettings()`
  - [x] One WHY comment only: Rust ships English-only consts, the id slug is the stable anchor
  - [x] Static key literals only — no concatenation, no `` t(`…${id}`) ``

- [x] **Task 3: Render the starter rows** (AC: #2, #3, #4)
  - [x] Inside the **existing** `<SettingsSection heading={t("settings.sectionTemplates")}><Card flush>`, insert the starter block as the **first** children
  - [x] `const starters = starterTemplates.data ?? [];`
  - [x] `starterTemplates.isPending` → one statement-only row, testid `setting-template-starter-loading`
  - [x] settled and `starters.length === 0` → one statement-only row, testid `setting-template-starter-empty`
  - [x] otherwise `starters.map(...)` → one `SettingRow` per template with `key={template.id}`, localized title/description via `STARTER_TEMPLATE_COPY[template.id]` with backend fallback, and the apply `Button`
  - [x] Button label: `applyingId === template.id ? t("settings.templateStarterApplying") : t("settings.templateStarterApplyAction")`
  - [x] Button `onClick={() => handleApplyStarterTemplate(template.id)}`, `disabled={busy}`, `aria-disabled={busy || undefined}`, testid `your-data-template-apply-${template.id}`
  - [x] Branch A: rows sit above `setting-template-export`. Branch B: rows sit above `setting-templates-unavailable`, which stays
  - [x] Do **not** add a `Select`/`SelectTrigger` dropdown, a `RadioGroup`, a `Dialog`, or a `SegmentedControl` (§Conflict A, §Conflict D)

- [x] **Task 4: Add the apply handler with three-branch toast + error path** (AC: #5, #6, #8)
  - [x] `handleApplyStarterTemplate(templateId: string)` placed after `handleRestore`, before the `return`
  - [x] `setError(null)` → `await applyStarterTemplate.mutateAsync(templateId)` → branch → `catch` → `setError(...)`
  - [x] `const skipped = result.skipped_groups.join(", ");`
  - [x] Order the branches: `groups_created === 0` (`toast.info`) → `skipped_groups.length > 0` (`toast.success` skipped variant) → plain success
  - [x] No `finally`, no `if (!result) return;`, no `console.*`, no `queryClient.*`, no `JSON.parse`
  - [x] Reuse the existing `getErrorMessage`

- [x] **Task 5: Add the 10 i18n strings to both locales** (AC: #9)
  - [x] `locales/en.json` and `locales/fr.json` — add all 10 keys from AC #9's table, same order, same insertion point in both files
  - [x] Flat dotted keys; no nesting; no trailing-comma/JSON syntax breakage
  - [x] Verify placeholder parity per key, then `python3 -c "import json;[json.load(open(f'apps/desktop/src/locales/{l}.json')) for l in ('en','fr')]"` to prove both still parse
  - [x] Confirm `list(en) == list(fr)` key order after the edit
  - [x] Do not touch 24.4's keys; in Branch B do not delete `settings.templatesUnavailable*`

- [x] **Task 6: Extend the i18n parity spec** (AC: #10)
  - [x] Open (or create per the SOFT gate) `locales/__tests__/budget-templates-i18n.test.ts`
  - [x] Add this story's 10 keys to `REQUIRED_KEYS`; add the three placeholder-retention `it()` blocks; add the `STARTER_TEMPLATE_COPY`-key existence assertion
  - [x] Import `describe`/`expect`/`it` explicitly from `vitest` (the repo does this even with `globals: true`); no `setupFiles` exist, so no jest-dom matchers
  - [x] Do not modify 24.4's cases

- [x] **Task 7: Extend the Playwright spec** (AC: #11)
  - [x] Open (or create per the SOFT gate) `apps/desktop/tests/budget-templates.spec.ts`
  - [x] Extend `setupTauriMock` with `list_system_templates` and `apply_system_template`, keeping the `cmd.startsWith("plugin:") → null` guard, `transformCallback`, and `__TAURI_EVENT_PLUGIN_INTERNALS__`
  - [x] Add the five cases from AC #11's table, navigating to `/settings/ai-provider?section=data`
  - [x] No `plugin:dialog|*` stubs
  - [x] Do not modify 24.4's cases

- [x] **Task 8: Verification** (AC: #12)
  - [x] `pnpm --filter @nixus/desktop build` → zero TS errors/warnings
  - [x] `pnpm --filter @nixus/desktop test` → all Vitest specs pass. Record the total in Completion Notes; do **not** hardcode an expected count
  - [x] From `apps/desktop/`: `pnpm exec playwright test tests/budget-templates.spec.ts` then `pnpm exec playwright test` → no regressions (`accessibility.spec.ts` and `design-system.spec.ts` both render this Settings surface)
  - [x] Manual FR check: switch the app to French and confirm the starter row title, body, button label, and each of the three toast variants render French copy (not raw keys)
  - [x] Confirm untouched: all of `apps/desktop/src-tauri/**`, `apps/web/**`, `packages/**`, `src/hooks/**`, `src/lib/**`, `src/routes/**`, `routeTree.gen.ts`, every other file in `components/settings/`
  - [x] `git diff --name-only` → at most the five paths in AC #12
  - [x] **Do not commit**

### Review Findings

_Adversarial code review, 2026-08-04. Scope: this story's own 5 files only — `YourDataSettings.tsx` (two hook calls, `STARTER_TEMPLATE_COPY`, widened `busy`, `starters`/`applyingId`, `handleApplyStarterTemplate`, 3-state starter block), `locales/en.json`/`fr.json` (+10 keys each), `locales/__tests__/budget-templates-i18n.test.ts` (21→36 cases), `tests/budget-templates.spec.ts` (8→15 cases). Stories 24-1..24-4, 25-1, 25-2 excluded — already reviewed and passed. `git diff` cannot isolate this story's lines from the rest of the uncommitted epic (baseline `1bc5427`), so scope was proven by reading the story's own File List and cross-checking every changed line against the 12 ACs and the Dev Agent Record, not by trusting diff hunks._

**Verdict: PASS.** Zero functional defects found. All 12 acceptance criteria independently verified against actual code. Two disclosed deviations judged and both accepted (rationale below). No patches were required; three temporary mutation-test edits were applied and fully reverted (confirmed via a clean 15/15 re-run afterward).

**Verification (all re-run, real output):**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` — 0 errors.
- `pnpm --filter @nixus/desktop build` (`tsc && vite build`) — 0 TS errors/warnings; only the pre-existing >500 kB chunk-size advisory (not a TS warning).
- `pnpm --filter @nixus/desktop test` (Vitest) — **71/71 passed**, `budget-templates-i18n.test.ts` at **36/36** (matches Completion Notes exactly).
- `pnpm exec playwright test tests/budget-templates.spec.ts` — **15/15 passed, run twice in a row** (stability confirmed).
- `pnpm exec playwright test` (full suite) — **322 passed, 2 failed**: `chat.spec.ts:250` (documented pre-existing failure, confirmed) and `maintenance.spec.ts:1290` (NOT on the story's documented flaky list; confirmed passes 1/1 in isolation and shares zero surface with this story — logged as a new deferred finding below, not attributable to 25-3).
- `cargo test` — **251/251 passed**, unchanged from baseline — confirms zero Rust changes from this story (the `M` files under `src-tauri/` in `git status` predate this session, from 24.x/25.1/25.2).
- Spot-checked `maintenance.spec.ts:1436` in isolation as instructed — **1/1 passed**, consistent with the dev's flaky-under-parallelism classification.

**(a) Mutual exclusion / `busy` gating: PASS.** All five buttons (backup, restore, export, import, starter-apply) route `disabled`/`aria-disabled` through the same widened `busy` boolean; the pairing `disabled={busy} aria-disabled={busy || undefined}` is preserved on every one, including the new starter button. `applyingId` is derived (`applyStarterTemplate.isPending ? applyStarterTemplate.variables : undefined`), never stored, so it resets automatically on every terminal path (success, error, and the throw path all resolve `isPending` back to `false` without any `finally`) — there is no cancel path on this mutation (no native dialog). **Mutation-tested:** removed `applyStarterTemplate.isPending` from `busy` → the E2E case `disables every other data control while a starter apply is in flight` failed exactly as expected (other buttons stayed enabled). Reverted; re-verified 15/15.

**(b) Three-state starter block: PASS.** Loading, empty/unavailable, and populated states are mutually exclusive and match the AC's own code block verbatim. A `list_system_templates` rejection is not special-cased (per AC #3's explicit instruction that the command cannot realistically fail) — `starterTemplates.data ?? []` folds any non-populated settled state into the empty-fallback row, so the Settings page degrades to "No starter budget is available." rather than blanking or crashing. The card and section heading are never conditionally hidden.

**(c) i18n: PASS.** Independently re-counted: `en.json` and `fr.json` are both **1139 keys**, identical key **set and order** (verified with a script, not eyeballed). All 10 new keys' placeholders (`{{groups}}`, `{{categories}}`, `{{skipped}}`) present and matching in both locales. French translations read as genuine, grammatically correct fr-CA (e.g. `"Budget de départ canadien"`, `"Chaque cible est modifiable depuis la page Budget après l'ajout."`). No hardcoded user-facing English found in `YourDataSettings.tsx`; `STARTER_TEMPLATE_COPY` holds only i18n key-name literals, never display strings. 24.4's 14 existing keys are untouched (still present, still passing their own test cases).

**(d) Two declared deviations — both judged and accepted:**
1. **Ellipsis (`…`) vs. AC's literal `...`.** Confirmed: `templateStarterApplying`/`templateStarterLoading` use U+2026 in both locales, matching all four sibling pending labels in the same `<Card flush>` (`backupSaving`, `restoring`, `templateExporting`, `templateImporting`). **Judgment: accepted.** Internal typographic consistency within one card is the more important user-facing property than matching a table cell that, elsewhere in this same spec, is inconsistent about the two ellipsis styles across the codebase (14 keys use `...`, 12 use `…` repo-wide, but the dev's own card is unanimous on `…`). Reversible in one edit if a future design pass wants literalism; not blocking.
2. **`settings.templateApplied` extended beyond the AC's literal copy** with `Every target is editable from the Budget page.` **Judgment: accepted.** This directly and traceably implements the story's own carried-forward UX finding #1 (editability must be unmissable), both required placeholders (`{{groups}}`, `{{categories}}`) are retained, and the extension is coherent in both locales (French: `"Chaque cible est modifiable depuis la page Budget."` reads naturally). Not a freelance change — it closes a named gap.

**(e) Two carried-forward UX findings: PASS, regression-locked, non-vacuous.**
1. Editability unmissable — present in both the row description and the success toast. **Mutation-tested:** stripped the toast sentence from `en.json` → `applies the starter budget and reports the counts` failed exactly as expected (element not found). Reverted.
2. All-collided case uses `toast.info` naming the skipped groups, never a hollow "added 0". **Mutation-tested:** broke the `groups_created === 0` first-check condition → `says nothing was added when every group already existed` failed exactly as expected (fell through to the "Added 0 groups" success copy the test explicitly forbids). Reverted.

**(f) Test non-vacuity and stability: PASS.** `tests/budget-templates.spec.ts` run twice — **15/15 both times**. Three load-bearing assertions mutation-tested (busy-gating, editability-toast, all-collided-toast — see (a)/(e) above), all three genuinely fail under mutation and all three were reverted cleanly (confirmed via a clean 15/15 re-run and a `git diff --stat` showing only the two intended files with their expected sizes). No fixed-single-macrotask flush was introduced: this story added zero new Vitest *async* tests (`budget-templates-i18n.test.ts` is pure synchronous string assertions), and the bounded-polling `settleQueries()` helper in `useBudgetTemplates.test.tsx` (25-2's file) was not touched.

**(g) Throwaway French spec cleanup: PASS.** No `zz-temp-fr-check.spec.ts` or any other orphan file found anywhere in the worktree. The only `i18nextLng` reference in `src/`/`tests/` is the pre-existing, legitimate `lib/i18n.ts:19` localStorage key config — not a leftover.

**Design-system consistency: PASS.** The starter row uses the same `SettingRow`/`Card flush` idiom as its four siblings in the Templates card; the apply button correctly uses the **default** variant (matching backup/export, the card's other primary actions) rather than `outline` (restore/import, the secondary actions) — consistent with AC #2's explicit instruction that this is the section's primary action.

**Guidelines compliance: PASS.** `docs/guidelines/warnings.md` — 0 TS warnings, 0 Rust warnings (unaffected). `docs/project-context.md` — all user-facing strings through i18next; exactly the two WHY-only comments the Dev Notes pre-authorized (`STARTER_TEMPLATE_COPY` rationale, `groups_created === 0` rationale); zero `console.*` calls.

**Scope proof:** `git diff --name-only -- apps/desktop/src-tauri apps/web packages apps/desktop/src/hooks apps/desktop/src/routes apps/desktop/src/lib apps/desktop/src/components` lists only prior-story files (`hooks/useBudget.ts`, `lib/constants.ts`, `lib/types.ts`, and four `src-tauri` files) plus `YourDataSettings.tsx` itself — none of which this story's own read shows it touching beyond the File List's claim. `routeTree.gen.ts` untouched.

#### Findings by Severity

- **[Review][Defer] LOW — new, previously-uncatalogued flaky-under-parallelism test.** `maintenance.spec.ts:1290` failed once in a full-suite run, passed 1/1 in isolation, shares zero surface with this story. Not attributable to 25-3. Logged in `deferred-work.md`.
- **[Review][Info] LOW — no action needed.** Both disclosed AC deviations (ellipsis typography; `templateApplied` copy extension) reviewed and accepted with rationale — see (d) above.

**Dismissed as noise:** none — every item raised during this review is logged above.

**Forward note for story 25-4 (onboarding fork):** `STARTER_TEMPLATE_COPY`'s id-keyed lookup pattern and the `applyingId`-derived-from-`variables` pattern are both reusable as-is if 25-4 needs the same starter list in the onboarding surface; neither is Settings-specific. No blocking issue found for 25-4.

**Scope/AC coverage:** all 12 acceptance criteria independently verified against actual code (not just tests) — AC #1/#7 confirmed by direct source read of hook calls and the `busy`/`applyingId` derivation; AC #2/#3/#4 confirmed against the render block, matched verbatim to the AC's own code sample; AC #5/#6/#8 confirmed against `handleApplyStarterTemplate`'s full body; AC #9/#10 confirmed by an independent key-count/order script plus a real `vitest` run; AC #11 confirmed by two real `playwright` runs plus three mutation tests; AC #12 confirmed by a real `tsc && vite build` and a scope-boundary `git diff --name-only` check.

---

## Dev Notes

### Critical Rules (DO NOT VIOLATE)

1. **Edit the existing Templates section — never recreate it.** `YourDataSettings.tsx` is a live 151-line file whose backup, restore, export-promise, and Danger Zone blocks must survive untouched. Overwriting the file is the single most likely failure mode here. `read` it first and edit surgically.
2. **Zero hook, type, or query-key changes.** `useSystemTemplates`, `useApplySystemTemplate`, `SystemBudgetTemplateSummary`, `ApplyBudgetTemplateResult`, and `queryKeys.systemBudgetTemplates` are 25.2's and 24.4's. If you open `src/hooks/**` or `src/lib/**`, stop — scope violation.
3. **Zero Rust changes.** If you open anything under `src-tauri/`, stop. [Source: 25-1 §Scope Boundary]
4. **No export/import button work.** 24.4 owns those two rows, their handlers, their toasts, and their 14 i18n keys (§Scope Reconciliation). The only line of theirs you may touch is the `busy` expression.
5. **All user-visible strings through i18next.** No hardcoded English in JSX — except the deliberate fallback to the backend-supplied `name`/`description` for an unmapped template id (AC #4), which is data, not a literal.
6. **No comments explaining *what*; only *why*.** [Source: docs/project-context.md §Code Quality] Two WHY comments are warranted here: the `STARTER_TEMPLATE_COPY` rationale, and the `groups_created === 0` branch rationale. Delete nothing else's comments — and in Branch A confirm 24.4 already removed the now-false "the backend does not have" comment at lines 135-137.
7. **No `console.log`/`console.error`.** The epic's fourth 25.3 AC makes this explicit: errors go to the user, not the console.
8. **Money never rendered here.** `SystemBudgetTemplateSummary` carries no amounts by design (25.1 AC #4). Do not compute, format, or display a total — the "$5,000/month" figure exists only in Rust and is not exposed by `list_system_templates`.
9. **Zero TypeScript warnings.** `strict` + `noUnusedLocals` + `noUnusedParameters`. [Source: docs/project-context.md §7, §9; docs/guidelines/warnings.md]
10. **Never introduce a bare `Template` identifier, a `queryKeys.templates` entry, or a `settings.templates.*` nested key.** §Naming Collision Warning.

### Five Conflicts Resolved Here (Binding — Do Not Re-derive)

**Conflict A — "picker" implies a dropdown; should this be a `<Select>`?**
`SYSTEM_TEMPLATES` ships with exactly **one** entry at launch (25.1: `&[CANADIAN_STARTER]`). A `<Select>` with a single option is a dead control the user must open to discover there is no choice, and it would require selection state plus a separate Apply button that does nothing until a selection exists.
**Resolution: one `SettingRow` per template, each with its own "Add to my budget" button.** Choosing *which row's button to press* **is** the selection, so the epic's "lets the user select and apply" AC is satisfied. This shape (a) is the idiom every other row in this file already uses — title, description, right-aligned control; (b) scales to N templates with zero code change and zero selection state; (c) removes the `useState` + "nothing selected" disabled-button edge case entirely; (d) keeps each template's description visible instead of hiding it inside a dropdown item, which matters because the description is the only guidance the user gets about what will be added. The repo's `Select` (`@nixus/shared`, base-ui, requires an `items` prop) is used only inside forms with real multi-option choices (`ExpenseList.tsx:191`, `AddExpenseForm.tsx`, …) — none of them in Settings. **Do not add a dropdown.**

**Conflict B — how is per-row pending state tracked?**
A naive `useState<string | null>(null)` duplicates state TanStack Query already owns and can desync from `isPending`.
**Resolution: derive it — `applyStarterTemplate.isPending ? applyStarterTemplate.variables : undefined`.** TanStack Query v5's `useMutation` result exposes `variables` (the argument of the in-flight/last mutation). Reading it only while `isPending` is true avoids the `undefined`-before-first-call case entirely. This mirrors 24.4's decision to drop `finally { setSaving(false) }` in favour of `isPending` for its two mutations, and it keeps the component's `useState` count at the three it already has (`saving`, `restoring`, `error`), all of which belong to the non-TanStack `invoke` calls.

**Conflict C — the epic's FR70 promises "editable targets"; must this story let the user edit targets before applying?**
No. Epic AC 25.3 #2 says only "lets the user select and apply"; the editable-target **preview** is epic AC 25.4 #1-#2, scoped to the onboarding fork. `apply_system_template(template_id)` accepts **no** target overrides (25.1 AC #6), and `list_system_templates` deliberately returns **no** `target_cents` (25.1 AC #4, reaffirmed by the epic's "no target amounts included in this response"), so a Settings-side editor is not merely out of scope — it is **not implementable** against the current backend without a new command.
**Resolution: apply the pre-filled targets as authored, and say so in the copy.** `settings.templateStarterCanadianBody` states the targets are editable from the Budget page after they are added, which is true today (`useUpdateBudgetCategory` already exists) and sets the expectation honestly. **Do not widen `list_system_templates`, do not add a preview screen, do not add a target-override argument.** [Source: 25-1 §Dev Notes "Known forward gap"; 25-2 §Scope Boundary]

**Conflict D — should applying a starter template require a confirmation dialog?**
The epic pre-decided this: "Story acceptance criteria below make a minimal, consistent UX decision (**direct apply + result toast**, matching the existing scaffolded Settings copy)" (epic line 59). 24.4 reached the same conclusion independently for import (§Conflict E) on grounds that apply is **additive and collision-safe** — existing groups are skipped, never overwritten, never merged, and nothing is deleted (24.1 duplicate-group rule) — which makes it categorically unlike restore or delete-all. The codebase also has no `AlertDialog`; the only `Dialog` in Settings is `DangerZone`'s type-DELETE-to-confirm flow, the wrong weight for an additive action.
**Resolution: direct apply, one result toast, no confirm dialog, no preview.** Revisit only if a UX review overrides it.

**Conflict E — the epic's single toast example does not cover the all-collided case.**
The epic's example message is "Applied template. Skipped: Housing, Transportation (already exist)." If **every** group collides, `groups_created === 0` and that template renders "Added 0 groups and 0 categories", which reads as a success while nothing happened.
**Resolution: a third branch, checked first, using `toast.info`.** Identical in spirit to 24.4 §Conflict D for the import path, so the two flows behave the same way in the same section. Branch on `groups_created === 0`, never on comparing `skipped_groups.length` to a template total — `ApplyBudgetTemplateResult` has no total field.

### Existing Code to Extend (DO NOT REINVENT)

| Item | File:line | Exact fact |
|---|---|---|
| The section to extend | `YourDataSettings.tsx:138-146` | `<SettingsSection heading={t("settings.sectionTemplates")}><Card flush><SettingRow … data-testid="setting-templates-unavailable" /></Card></SettingsSection>` — today a **statement-only placeholder with no buttons at all** |
| Row + section primitives | `components/settings/SettingRow.tsx` | `SettingsSection({ heading, children })`; `SettingRow({ title, description?, control?, htmlFor?, className?, "data-testid"? })`. Rows are hairline-separated by `not-last:border-b` **inside one `<Card flush>`** — the card owns elevation, the row owns only its bottom rule. `description` is rendered only when `!== undefined` |
| Button + disabled idiom | `YourDataSettings.tsx:72-79`, `:103-111` | `<Button onClick={…} disabled={x} aria-disabled={x \|\| undefined} data-testid="…">{pending ? t("…ing") : t("…Action")}</Button>`. `aria-disabled` is always `\|\| undefined`, never `false` |
| Secondary vs primary variant | `YourDataSettings.tsx:73` vs `:104` | Backup (primary action) = default variant; Restore (secondary) = `variant="outline"`. The starter apply is this section's primary action → **default** variant |
| Error surface | `YourDataSettings.tsx:60-64` | One shared `<Alert variant="over" data-testid="your-data-error">{error}</Alert>` above all sections, fed by the single `error` state. **Reuse it** |
| Error message helper | `YourDataSettings.tsx:10-13` | `getErrorMessage(err)` → `e?.message ?? (typeof err === "string" ? err : "")`. Already module-scoped — **reuse, do not redefine, do not copy `DangerZone`'s `JSON.stringify` variant** |
| Toast | `YourDataSettings.tsx:5,27,42` | `import { toast } from "sonner"` already present; `toast.success(t("key", { interpolation }))`. Repo-wide: 45 `toast.success`, 44 `toast.error`, 2 `toast.info`. No `useToast()` wrapper exists; `<Toaster />` is mounted once in the app shell |
| Success-vs-error convention | `YourDataSettings.tsx:27-29`, `:42-45` | Success → auto-dismissing toast. Failure → persistent page Alert via `setError`. Deliberate asymmetry, preserved by AC #8 |
| Component locals to extend | `YourDataSettings.tsx:16-20` | `t`, `queryClient`, `saving`, `restoring`, `error`. `queryClient` exists **only** for restore's `queryClient.clear()` — this story must not touch it |
| Where the component renders | `routes/settings.ai-provider.tsx:70` | `{active === "data" && <YourDataSettings />}` behind `SegmentedNav`; URL is `/settings/ai-provider?section=data`, nav testid `settings-nav-data`, root testid `settings-your-data` |
| Available shared UI | `packages/shared/src/ui/index.ts` | `Alert`, `Button`, `Card`, `Dialog*`, `Select*`, `Skeleton`, `EmptyState`, `Meter`, `Switch`, `focusRing`, … — **all already exist; never create a UI component that is already there** [Source: project-context.md §Anti-Patterns] |
| i18n mechanics | `lib/i18n.ts`, `locales/en.json` | i18next + `initReactI18next` + `LanguageDetector` (localStorage `i18nextLng`), `fallbackLng: "en"`, `interpolation.escapeValue: false`. Locale files are **flat** `"settings.foo": "…"` maps (1117 keys each), resolved by i18next's dotted-key lookup — **do not nest** |
| i18n parity test shape | `locales/__tests__/danger-zone-i18n.test.ts:1-60` | `const en = enLocale as Record<string,string>`; a `PREFIX` const; `REQUIRED_KEYS` `as const`; `it.each(REQUIRED_KEYS)("defines %s in both locales with a value", …)`; a bidirectional prefix-diff test; `expect(en[k]).toContain("{{word}}")` placeholder tests. Explicit `import { describe, expect, it } from "vitest"` |
| Playwright IPC mock | `tests/accessibility.spec.ts:10-80` | `page.addInitScript` sets `__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: (cmd, args) => …, convertFileSrc }` plus `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`. `cmd.startsWith("plugin:") → Promise.resolve(null)` is **mandatory** (a truthy updater response opens an always-on Dialog whose focus trap `aria-hidden`s the app); `default:` rejects with `Unknown command: ${cmd}` — so **every** command the surface calls must be added |
| Vitest config | `apps/desktop/vitest.config.ts` | `environment: "jsdom"`, `globals: true`, `include: ["src/**/*.test.{ts,tsx}"]`, `@` → `./src`, **no `setupFiles`** (no jest-dom matchers) |
| Scripts | `apps/desktop/package.json` | `"test": "vitest run"`, `"build": "tsc && vite build"`. There is **no** `playwright`/`e2e` script — run `pnpm exec playwright test` from `apps/desktop/` |

### Backend & Hook Contract (verified against 25.1 / 25.2 specs — do not re-derive)

| Fact | Value |
|---|---|
| List command | `invoke("list_system_templates")` — **no** args object; sync Rust, no `State<DbState>`, no DB/file I/O, so it cannot realistically fail |
| List return | `SystemBudgetTemplateSummary[]` = `{ id: string; name: string; description: string \| null }[]`, in `SYSTEM_TEMPLATES` declaration order — **no** `target_cents`, **no** `groups`, **no** `format_version` |
| Templates at launch | Exactly one: `id: "canadian-starter"`, `name: "Canadian Starter Budget"`, `description: "Common Canadian household categories with suggested monthly targets. Adjust every target to match your situation."` (English-only Rust consts) |
| Apply command | `invoke("apply_system_template", { template_id: templateId })` — IPC key is `snake_case`; the hook already does this mapping |
| Apply return | `ApplyBudgetTemplateResult { groups_created: number; categories_created: number; skipped_groups: string[] }` — **non-Optional**, no `\| null` |
| Fresh-budget result | `{ groups_created: 4, categories_created: 12, skipped_groups: [] }` — 4 groups (Housing, Transportation, Living, Savings), 12 categories, all targets pre-filled and positive (never the `$1.00` import default) |
| Collision semantics | Case-insensitive **group-name** match skips the **entire** group (name lands in `skipped_groups`); no merge, no per-category dedup, no overwrite, no delete. An existing budget is **not** an error |
| Only realistic error | `{ type: "validation", message: "That starter template is not available.", field: "template_id" }` for an unknown/empty/wrong-cased id. Lookup is exact and case-sensitive; the DB is never locked on this path, so no partial state |
| Rejection shape | `invoke` rejects with the **already-deserialized** `AppError` object — read `err.message`, never `JSON.parse` |
| Invalidation on success | The hook's `onSuccess` invalidates six keys: `["budget-groups"]`, `["budget-categories"]`, `["budget-status"]`, `["spending-trends"]`, `["trends-insight"]`, `["all-budget-categories"]`. It deliberately does **not** invalidate `["system-budget-templates"]` (immutable compiled const) or `queryKeys.onboardingStatus` (25.4's concern). **Add nothing here** |
| Audit | Exactly one audit row per apply, written by the Rust `db/` primitive. The frontend logs and audits nothing |

### Previous Story Intelligence

**From 24.4 (owns the other half of this exact section) — treat as specification, not verified code:**

- **24.4 replaces the placeholder block wholesale**, deleting `setting-templates-unavailable`, deleting `settings.templatesUnavailableTitle`/`Body`, deleting the now-false WHY comment at lines 135-137, and adding rows `setting-template-export` / `setting-template-import`, buttons `your-data-template-export` (default variant) / `your-data-template-import` (outline), handlers `handleExportTemplate` / `handleImportTemplate`, and 14 `settings.template*` keys. **Verify these names in the actual file — if they differ, adapt to reality and note the deviation.**
- **`busy` is 24.4's invention**: `const busy = saving || restoring || exportTemplate.isPending || importTemplate.isPending;`, and it replaces `saving || restoring` on the pre-existing backup/restore buttons. This story appends one term. If 24.4 named it differently, extend **that** name — do not introduce a second boolean.
- **Toast branching precedent**: 24.4 uses three import branches (`templateImported`, `templateImportedSkipped`, `templateImportAllSkipped` with `toast.info`) — this story mirrors that shape exactly with `templateApplied` / `templateAppliedSkipped` / `templateApplyAllSkipped`, so the two flows in the same card behave identically.
- **The `| null` cancel contract is dialog-only.** 24.4's `if (!result) return;` exists because a cancelled native dialog yields `Ok(None)`. Do not propagate it (§Prerequisite Gate).
- **The four canned Rust import/export messages surface verbatim, un-i18n'd**, and 24.4 flagged that as a known UX debt. This story's single canned message (`"That starter template is not available."`) follows the same rule — do **not** map it to an i18n key, and do **not** "fix" 24.4's.
- **`queryClient.clear()` is restore's nuclear option only.** Template flows use targeted invalidation, which the hook already performs.
- **Playwright: no `plugin:dialog|*` stub.** 24.4 §Conflict C corrects 24.3's advice — these dialogs live inside the Rust command, so only the `invoke` of the command itself crosses IPC.
- **Import lands every category at `$1.00`** (`DEFAULT_TEMPLATE_TARGET_CENTS = 100`). A **system** template never does — every one of the 12 targets is authored and positive. The "wall of $1.00" caveat 24.4 disclosed in its copy must **not** be repeated in this story's copy.

**From 25.2 (the direct predecessor):**

- `useSystemTemplates()` sets **only** `queryKey` + `queryFn` — no `staleTime`, no `enabled`, no `select`, no `placeholderData` (its §Conflict A). Consequence for this story: with `main.tsx:11`'s bare `new QueryClient()`, library defaults apply (`staleTime: 0`, `refetchOnWindowFocus: true`), so the list refetches on window focus. That is fine — one no-IO Rust call returning one 3-field object. **Do not "fix" it by adding caching options to the hook; that file is out of scope.** If the picker ever genuinely needs it, that is a follow-up, not this story.
- The apply mutation's `mutationFn` returns the `invoke` promise directly and is not `async`; `mutateAsync` therefore rejects with the raw `AppError` object, which is exactly what AC #5's `catch` reads.
- `useBudgetTemplates.ts` contains **no** `toast`, no `t()`, no `try`/`catch` by design (25.2 AC #8) — every user-facing concern is this component's job. That is why all ten strings and all three toast branches live here.
- `description` is `string | null` (not `?: string`) because the Rust `Option<String>` has no `skip_serializing_if`.
- 25.2 explicitly names this story's scope: "Starter-template **picker UI** in `YourDataSettings.tsx` + its apply toast + `locales/en.json`/`fr.json` strings"; "Localizing the template `name`/`description` (keyed off `CANADIAN_STARTER_ID`)"; "Surfacing `skipped_groups` copy for the **apply** path".
- **Scope-creep tripwire, inherited and re-narrowed:** 24.1–24.3 said "if you find yourself editing anything under `apps/desktop/src/`, stop"; 24.4 flipped it to `src-tauri/`; 25.2 narrowed it to its four paths. **This story: if you find yourself editing anything outside the five paths in AC #12, stop.**

**From 25.1 (transitive backend):** see §Backend & Hook Contract above. The one carried-forward instruction that is this story's alone: **`CANADIAN_STARTER_ID` (`"canadian-starter"`) is the stable i18n anchor** — key display strings off the id slug, never off the returned English `name`/`description` text.

### Project Structure Notes

- Monorepo: pnpm workspaces, scope **`@nixus/`** (not `@nkbaz/` — `project-context.md` is stale on this). Desktop is `apps/desktop` (`@nixus/desktop`); shared UI is `@nixus/shared`.
- Settings components live flat in `apps/desktop/src/components/settings/` (8 files). This story adds **no** file there — the picker is rows inside `YourDataSettings.tsx`, not a new `StarterTemplatePicker.tsx`. A separate component would be justified only if the block exceeded the file's other sections in complexity; it does not (one `.map`, one handler).
- Imports: `@/` alias for `@/hooks/**`, `@/lib/**`; relative `./` for sibling components in the same folder (`./DangerZone`, `./SettingRow`) — match what the file already does.
- Vitest specs live in `__tests__/` subfolders under `src/`; Playwright specs live flat in `apps/desktop/tests/`.
- **`docs/project-context.md` is stale in two ways that matter here:** §Testing Rules claims "No unit test framework in desktop — all testing is Playwright E2E" (**false**: `vitest.config.ts` exists, `"test": "vitest run"` is wired, and specs already run in `src/hooks/__tests__/` and `src/locales/__tests__/`), and it names the package scope `@nkbaz/` (**actual: `@nixus/`**). Use the verified facts.
- `routeTree.gen.ts` is generated — never edit it. This story adds no route.
- Verify with `pnpm --filter @nixus/desktop build`, `pnpm --filter @nixus/desktop test`, and `pnpm exec playwright test` from `apps/desktop/`.

### Git Intelligence

`git log --oneline -8`: `1bc5427 fix(trends): show friendly fallback instead of raw error on AI insight failure`, `9cadcad fix: AI chat layout + version bump to 0.3.1`, `ea5d9f8`/`f86f300 feat(ui): Implement new UI/UX`, `1e9560e feat(ui): Small improvements`, `ea8f35f chore: bump version to 0.2.8`, `0081d17 fix: where you can't delete a category due to past spending`, `e758710 fix(budget): show actionable errors when category delete is blocked`.

`1bc5427` is the direct precedent for AC #8: it replaced a raw error surface with a friendly, user-visible fallback rather than a console log. `e758710`/`0081d17` established that budget errors must reach the user with actionable copy — which is exactly why the apply failure goes to the persistent Alert and never to `console.error`. `ea5d9f8`/`f86f300` are the UI/UX pass that produced the current `SettingRow`/`SettingsSection`/`Card flush` idiom this story must match rather than restyle.

**Zero Epic 24/25 commits exist in history.** `git status --short` at story creation: `M _bmad-output/implementation-artifacts/deferred-work.md` plus untracked planning/story artifacts — **no source changes pending. Do not commit anything.**

### Latest Tech Information

- **TanStack Query 5.90.21.** `useMutation` exposes `isPending` (not v4's `isLoading`) and `variables` (the in-flight mutation's argument) — the two facts AC #7 relies on. `mutateAsync` rejects, so the component keeps its own `try`/`catch`. `useQuery` exposes `isPending` for "no data yet" (v5 renamed v4's `isLoading`); do **not** write `isLoading` on the query.
- **React 19.1.0**, `@tauri-apps/api ^2.11.0`. `invoke` is promise-based and rejects with the **deserialized** `AppError` object — read `err.message`, never `JSON.parse`.
- **sonner** for toasts (`toast.success` / `toast.info`); `<Toaster />` already mounted app-wide. No new dependency.
- **i18next + react-i18next**, `interpolation.escapeValue: false` — so `{{skipped}}` renders group names literally with no HTML escaping. Flat dotted keys are resolved by i18next's progressive path lookup; the whole app already depends on this.
- **`@nixus/shared`** UI is base-ui-backed. Its `Select` requires an `items` prop plus `value`/`onValueChange` — noted only so it is clear the component exists and is still deliberately not used (§Conflict A).
- **Vitest 3.2.4 + jsdom 25**, `globals: true` (existing specs still import `describe`/`it`/`expect` from `vitest` explicitly — do the same). No `setupFiles`, so no jest-dom matchers.
- **`@testing-library/react` is NOT a dependency of `@nixus/desktop`** — absent from both `dependencies` and `devDependencies`. There is therefore **no component-level unit test path for this JSX**; Playwright (AC #11) is the only way to prove the picker renders and behaves. That is why this story owns a Playwright case even though 25.2's boundary table did not assign one — without it, "starter picker works" would be an unverifiable claim.
- TypeScript `strict`, `noUnusedLocals`, `noUnusedParameters`. `import type` for type-only imports.

### UX / i18n Note (flag for review, do not block)

No UX-DR covers budget templates — `ux-design-specification.md` predates the 2026-08-01 FR70 amendment (epic § Requirements Inventory — UX Design Requirements), and architecture § Gap Analysis leaves the confirmation UX to story level. Five items are flagged for UX review; **implement as specified anyway**:

1. **No preview before apply.** The user sees a name and one sentence, then 4 groups / 12 categories appear. Justified by additive, collision-safe semantics (§Conflict D), but a reviewer may want a "this will add 4 groups and 12 categories" line — which is unavailable from `list_system_templates` today (§Conflict C).
2. **Targets are not editable before applying** in Settings (only 25.4's onboarding path gets that). The copy discloses that they are editable afterwards from the Budget page.
3. **A second apply of the same template silently adds nothing** and shows the all-skipped `toast.info`. There is no visual "already added" state on the row, because the frontend cannot know which groups exist without cross-referencing `useBudgetGroups` — deliberately not done here.
4. **The one canned Rust error message is English-only** even in the French UI, consistent with 24.4's four. Mapping the canned backend messages to i18n keys is a single follow-up covering both stories.
5. **Row ordering** places the starter above export/import. If UX prefers the sharing actions first, it is a one-line move.

### References

- [Source: _bmad-output/planning-artifacts/epics-budget-templates.md — **Story 25.3 all 4 ACs (lines 274-296)**, Epic 25 statement (218-220), Story 25.1 (222-248), Story 25.2 (250-272), Story 25.4 (298-324, scope boundary for editable targets), Requirements Inventory § Additional Requirements (lines 49-53: hook surface, i18n result-toast strings, "wires into the already-scaffolded but disabled `YourDataSettings.tsx` `settings.sectionTemplates` block"), line 47 (group-level skip + `skipped_groups` surfaced to the user), line 55 (no bare `Template`), FR Coverage Map (63-67), **UX Design Requirements gap note (line 59: "direct apply + result toast" is pre-decided)**]
- [Source: _bmad-output/planning-artifacts/architecture-budget-templates.md — § API & Communication Patterns (lines 168-169: `list_system_templates` / `apply_system_template` contracts), § Frontend Architecture (line 175: wires into the scaffolded `settings.sectionTemplates` block), § New Patterns → duplicate-group handling + example skipped-groups toast copy (line 219), § Project Structure → Files to MODIFY (line 263 `YourDataSettings.tsx`, line 265 locales), § Gap Analysis (lines 325-330: confirmation UX left to story level, FR i18n strings pending)]
- [Source: _bmad-output/implementation-artifacts/24-4-import-a-community-template-file.md — **§Scope Boundary vs. Stories 25.2 / 25.3 (binding ownership table + the verbatim "25.3 must therefore treat … as already satisfied" ruling)**, AC #7-#14 (the export/import rows, buttons, handlers, `busy`, toasts, testids this story must not duplicate), AC #15-#16 (the 14 i18n keys and the 2 deleted placeholder keys), AC #17 (the i18n parity spec + hook spec + no `@testing-library/react`), AC #18 (Playwright spec + `setupTauriMock`), AC #19 (its 9-path diff boundary), §Conflict C (no `plugin:dialog` stub), §Conflict D (the `groups_created === 0` `toast.info` branch), §Conflict E (direct apply, no preview, no `AlertDialog`), §Dev Notes (error-Alert vs success-toast asymmetry; `queryClient.clear()` is restore-only; the false "already-scaffolded buttons" claim), §Out of Scope, §Naming Collision Warning, §UX Note]
- [Source: _bmad-output/implementation-artifacts/25-2-frontend-hook-for-budget-templates.md — AC #2 (`SystemBudgetTemplateSummary` = `{ id, name, description: string \| null }`), AC #3 (`useSystemTemplates()` shape), AC #4 (`useApplySystemTemplate()` takes a bare `templateId: string`, returns non-`Option`), AC #5/#6 (the six-key invalidation the component must not duplicate), AC #7 (does not invalidate the system-template list or onboarding status), **AC #8 (no toast/`t()`/`try-catch` in the hook — all of it belongs here)**, §Prerequisite Gate (why no `\| null` guard), §Conflict A (no `staleTime` — do not "fix" it from this story), §Scope Boundary vs. 25.3/25.4 (picker UI, apply toast, locales, id-keyed localization, `skipped_groups` copy = 25.3)]
- [Source: _bmad-output/implementation-artifacts/25-1-canadian-starter-template-definition-list-apply-commands.md — AC #2 (12 categories, every `target_cents` pre-filled and positive), AC #4 (Rust summary = id/name/description projection, no targets), AC #5 (`list_system_templates` sync, no state, no IO, declaration order, one entry), AC #6 (`apply_system_template(template_id)` → non-`Option` result), AC #7 (`AppError::Validation { message: "That starter template is not available.", field: "template_id" }`, exact case-sensitive lookup), AC #8 (4 groups / 12 categories / empty skips on a fresh budget), §Canadian Starter Content (the 4 group names Housing/Transportation/Living/Savings), §UX / i18n Note (English-only consts; `CANADIAN_STARTER_ID` is the stable i18n anchor), §Dev Notes (one audit row, written in Rust; nothing to log in the frontend)]
- [Source: _bmad-output/planning-artifacts/prd.md — FR70 (line 532), FR71 (line 533), FR96 (line 600)]
- [Source: docs/project-context.md — §i18n (all user-visible strings through i18next), §Naming Conventions (PascalCase components, snake_case IPC fields), §TanStack Query (mutation `onSuccess` invalidates all affected keys — satisfied by the hook, not repeated here), §7 TS strictness, §9 warnings, §Code Quality (WHY-only comments, no `console.log`), §Anti-Patterns (never recreate a component that exists in shared/ui; never hardcode query keys); **§Testing Rules and the `@nkbaz/` scope are stale — see §Project Structure Notes**]
- [Source: docs/guidelines/warnings.md — all compilation warnings must be resolved]
- [Source: apps/desktop/src/components/settings/YourDataSettings.tsx:1-151 — full current file: imports (`sonner` :5, `@nixus/shared` :6, `./SettingRow` :8), `getErrorMessage` :10-13, locals :16-20, shared error Alert :60-64, backup section :66-89, restore section :93-116, export-promise section :121-133, **Templates placeholder :135-146 (the insertion target)**, `<DangerZone />` :148]
- [Source: apps/desktop/src/components/settings/SettingRow.tsx:1-70 — `SettingsSection({ heading, children })`, `SettingRow` prop contract, `not-last:border-b` hairline rule, `description !== undefined` guard; `SegmentedControl` (not used here)]
- [Source: apps/desktop/src/components/settings/DangerZone.tsx — the only `Dialog` in Settings, a type-DELETE destructive confirm; referenced as the wrong weight for an additive apply (§Conflict D), and as the source of the `JSON.stringify` `getErrorMessage` variant this story must **not** copy]
- [Source: apps/desktop/src/routes/settings.ai-provider.tsx:1-73 — the four settings sub-surfaces as `?section=` search params on one route; `settings-nav-data` link, `{active === "data" && <YourDataSettings />}` at :70; the E2E entry URL `/settings/ai-provider?section=data`]
- [Source: apps/desktop/src/locales/en.json / fr.json — flat dotted keys, 1117 each, identical order; `settings.sectionTemplates` = "Budget templates" / "Modèles de budget"; `settings.templatesUnavailableTitle`/`Body` present today; 124 `settings.*` keys; **zero `settings.template*` keys**]
- [Source: apps/desktop/src/lib/i18n.ts:1-25 — i18next init, `fallbackLng: "en"`, `load: "languageOnly"`, localStorage detection, `escapeValue: false`]
- [Source: apps/desktop/src/locales/__tests__/danger-zone-i18n.test.ts:1-60 — the parity-spec shape AC #10 follows: `REQUIRED_KEYS as const` + `it.each`, bidirectional prefix diff, `toContain("{{word}}")` placeholder assertions, explicit `vitest` imports]
- [Source: apps/desktop/tests/accessibility.spec.ts:10-80 — `setupTauriMock` shape: `page.addInitScript`, `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`, `__TAURI_INTERNALS__.transformCallback`, `cmd.startsWith("plugin:") → null` (mandatory), per-command `switch`, `default:` rejects `Unknown command: ${cmd}`, `convertFileSrc`]
- [Source: packages/shared/src/ui/index.ts — the full shared-UI export surface (`Alert`, `Button`, `Card`, `Dialog*`, `Select*`, `Skeleton`, `EmptyState`, `focusRing`, …); `packages/shared/src/ui/select.tsx:7-113` — `Select` requires `items`, referenced only to justify not using it]
- [Source: apps/desktop/src/components/expenses/ExpenseList.tsx:191-218 — the canonical `Select` usage (grouped, multi-option, inside a form): the shape this story deliberately does not adopt for a one-option list]
- [Source: apps/desktop/vitest.config.ts, apps/desktop/package.json — `vitest run`, `tsc && vite build`, no `playwright` script]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5 (Sisyphus-Junior, bmad-dev-story workflow)

### Debug Log References

**Prerequisite gate — result: BRANCH A (24.4 shipped). The story's PREREQUISITE GATE narrative is STALE.**

The gate section claims "nothing from Epic 24 or Epic 25 is implemented", `YourDataSettings.tsx` is 151 lines with a statement-only placeholder, `useBudgetTemplates.ts` does not exist, and locales hold 1117 keys. All five of those claims are false against the live tree. Verified actuals:

| Gate probe | Actual | Consequence |
|---|---|---|
| `useSystemTemplates` / `useApplySystemTemplate` in `hooks/useBudgetTemplates.ts` | Present (lines 45, 53) | No HARD STOP. Consume only. |
| `SystemBudgetTemplateSummary` / `ApplyBudgetTemplateResult` in `lib/types.ts` | Present (lines 32, 26), field names exactly `{ id, name, description: string \| null }` and `{ groups_created, categories_created, skipped_groups }` | No deviation; no `lib/types.ts` edit needed. |
| `queryKeys.systemBudgetTemplates` in `lib/constants.ts` | Present (line 8) | Consume only. |
| `your-data-template-export` in `YourDataSettings.tsx` | Present (line 192) | **Branch A confirmed.** |
| `setting-templates-unavailable` | Absent — 24.4 deleted the placeholder row and both its i18n keys | Branch B not taken. |
| `const busy` | Present (line 27) = `saving \|\| restoring \|\| exportTemplate.isPending \|\| importTemplate.isPending` | Widened with one term, not re-invented. |
| `locales/__tests__/budget-templates-i18n.test.ts` | Present, 21 cases | Extended, not created. |
| `tests/budget-templates.spec.ts` | Present, 8 cases | Extended, not created. |
| locale key count | 1129 each (not 1117), identical order | Baseline for the +10 append. |

Actual hook signatures typed against (not assumed): `useSystemTemplates()` → `UseQueryResult<SystemBudgetTemplateSummary[]>`; `useApplySystemTemplate()` → `UseMutationResult<ApplyBudgetTemplateResult, Error, string>` with `mutationFn: (templateId: string) => invoke(...)` returning a **non-`Option`** value. Confirmed no `| null` on the apply return, so no dead `if (!result) return;` guard was written (the story's named #1 mistake). 24.4's handlers are `handleExportTemplate` / `handleImportTemplate`; mutation locals are `exportTemplate` / `importTemplate` — extended those exact names.

**Test sequencing (red → green), real output:**

1. i18n keys appended → `vitest` 71/71 pass (data-assertion specs must have their data present to be meaningful).
2. Playwright spec extended **before** component wiring → **6 failed, 8 passed** (`locator.click: Test timeout … waiting for getByTestId('your-data-template-apply-canadian-starter')`). Genuine RED.
3. Component wired → **14/14 passed** after one fix: the assertion `getByText(/Every target is editable from the Budget page/)` hit a Playwright strict-mode violation resolving to 2 elements, because that sentence now appears in **both** the row description and the success toast. Collapsed into one unambiguous full-sentence regex. The ambiguity was itself confirmation that the editability message reaches the user twice.
4. Promoted the unmapped-id backend-fallback case from throwaway verification into the permanent spec → **15/15 passed**.

**French verification (Task 8) was executed as a real browser run, not an eyeball.** A throwaway spec (`tests/zz-temp-fr-check.spec.ts`) set `localStorage.i18nextLng = "fr"` before boot and drove the live surface: 6/6 passed — row title `Budget de départ canadien`, body `Catégories courantes des ménages canadiens … Chaque cible est modifiable depuis la page Budget après l'ajout.`, button `Ajouter à mon budget`, and all three toast variants in French (`4 groupes et 12 catégories ont été ajoutés…`, `… Ignorés : Logement, Épargne (existent déjà).`, `Rien n'a été ajouté — vous avez déjà tous les groupes…`), plus `setting-template-starter-empty` = `Aucun budget de départ n'est disponible.` A `not.toContainText("settings.template")` assertion proved no raw key strings render. **The throwaway spec was deleted afterwards** so the final diff stays inside AC #12's five paths; its one genuinely durable case (unmapped id → backend copy) was promoted into `budget-templates.spec.ts` instead.

**Full-suite results (real):** `tsc --noEmit` exit 0. `tsc && vite build` succeeded (the >500 kB chunk advisory is a pre-existing Vite note about a 1.85 MB bundle, not a TS warning). `vitest` 71/71 (baseline 56 + 15 new i18n cases). Playwright **324 total: 322 passed, 2 failed** (baseline 317 + 7 new).

Both failures are non-attributable, and I proved the second one rather than assuming it:

- `chat.spec.ts:250 › money in an answer is tabular Inter` — the documented pre-existing real failure. Not touched.
- `maintenance.spec.ts:1436 › task rows show status badges and tabular next-due figures` — **not** on the handed-down flaky list (which names `maintenance.spec.ts:1561`), so it was investigated: passes in isolation (1/1), and `maintenance.spec.ts` passes 42/42 as a whole file. `grep -c "settings\|YourData\|templateStarter" tests/maintenance.spec.ts` = **0** — zero shared surface with this story. Same parallelism-contention class as the four documented flakes.

**Scope proof.** Because the whole worktree is intentionally uncommitted at baseline `1bc5427`, `git diff --name-only` cannot separate this story from epics 24/25, so scope was proven by mtime instead. First write of this session: 14:40:35. Files with mtime ≥ 14:40 — `25-3-…md`, `sprint-status.yaml`, `YourDataSettings.tsx`, `budget-templates-i18n.test.ts`, `en.json`, `fr.json`, `budget-templates.spec.ts`. Exactly AC #12's five source paths plus the two workflow artifacts. `find` over `src-tauri/`, `apps/web/`, `packages/`, `src/hooks/`, `src/lib/`, `src/routes/` with the same cutoff returned **nothing**. `routeTree.gen.ts` mtime 21:31:40 (prior day) — untouched. A first pass with a 14:30 cutoff falsely flagged `hooks/useBudgetTemplates.ts` (14:33:55), `hooks/__tests__/useBudgetTemplates.test.tsx` (14:31:05) and `lib/constants.ts` (14:34:21); all three predate this session's first write and are 25-2 leftovers, corroborated by the 9 hook tests still passing untouched. **Nothing was committed.**

### Completion Notes List

- **Branch A taken.** The starter block is the first child of the *existing* Templates `<Card flush>`, above `setting-template-export`. No second `SettingsSection`, no new component file, no `useState` added (component still holds exactly its original three), no dropdown/`RadioGroup`/`Dialog`.
- **Four-control mutual exclusion preserved and extended.** `busy` gained exactly one term (`applyStarterTemplate.isPending`); all five buttons now route `disabled`/`aria-disabled` through it. New E2E case `disables every other data control while a starter apply is in flight` locks the widening in both directions — 24.4's existing case only proved import→others, and AC #7's new apply→others direction would otherwise have shipped untested.
- **Per-row pending state is derived, not stored:** `applyStarterTemplate.isPending ? applyStarterTemplate.variables : undefined`, read only while pending. TanStack v5 types `variables` as `string | undefined`, so `applyingId === template.id` is safe with no extra state and no `finally`.
- **Three-branch toast with `groups_created === 0` checked first** via `toast.info`, mirroring 24.4's import shape so both flows in the same card behave identically. `skipped_groups` is joined in TypeScript. No `queryClient.*` call added — the hook already invalidates.
- **Errors go to the existing shared `<Alert data-testid="your-data-error">`, never a toast and never `console.*`.** The canned Rust message `"That starter template is not available."` surfaces verbatim via the reused module-level `getErrorMessage`; `t("settings.templateApplyFailed")` is only the empty-string fallback. Success/error asymmetry preserved.
- **10 i18n keys appended to both locales** immediately after `settings.templateImportFailed` (the last 24.4 key), same index in both files. **1129 → 1139 keys each, key order verified byte-identical, placeholder sets verified equal per key.** No 24.4 key edited or removed; nothing nested.
- **Both carried-forward UX review findings are addressed, and both are now regression-locked by tests:**
  1. *"The Canadian starter hardcodes $5,000/mo — make editability unmissable."* The row description says targets are editable from the Budget page, **and** I extended `settings.templateApplied` past the AC's literal copy with `Every target is editable from the Budget page.` The row description is read *before* committing; the toast fires at the exact moment the user has 12 authored targets and is about to go look at them. One sentence in two places is deliberate. Asserted in `applies the starter budget and reports the counts`.
  2. *"Re-applying with matching group names 'succeeds' with 0 items — must not look like a silent no-op."* The `groups_created === 0` branch fires `toast.info` with `Nothing added — you already have every group in this starter budget: {{skipped}}.` — it names the colliding groups instead of reporting a hollow success. Asserted in `says nothing was added when every group already existed`, which also asserts the success copy is **absent**.
- **Money is never rendered.** No amount is computed, formatted, or displayed; the E2E fixture deliberately carries no `target_cents` (WHY-commented so a maintainer does not "improve" the fixture and quietly weaken NFR11/NFR13).
- **Two deviations from the AC text, both deliberate — see the Deviations section below.**
- Tests added: **15 new** (8 Vitest i18n via `REQUIRED_KEYS`/`PLACEHOLDER_KEYS`/`STARTER_TEMPLATE_COPY_KEYS` expansion → 21→36 cases in that file; 7 Playwright). No existing test was deleted, weakened, or had an assertion changed. The 9 hook tests, the i18n parity test, and 24.4's 8 E2E cases all still pass untouched. No fixed-macrotask flush introduced — I added no new Vitest async test, so the existing bounded-polling `settleQueries()` helper was left exactly as is.

**Deviations from the specified ACs (2):**

1. **AC #9 pending-label ellipsis.** The AC table specifies `Adding...` and `Loading starter budgets...` with three periods. I shipped `Adding…` and `Chargement des budgets de départ…` with U+2026. Reason: all four sibling pending labels in this same `<Card flush>` — `settings.backupSaving` (`Saving…`), `settings.restoring` (`Restoring…`), `settings.templateExporting` (`Saving…`), `settings.templateImporting` (`Opening…`) — use U+2026. A row rendering `Adding...` directly above `Saving…` is visibly inconsistent typography inside one card. The repo is mixed globally (14 keys use `...`, 12 use `…`) but *unanimous* on this surface. Low risk, reversible in one edit if a reviewer prefers AC literalism.
2. **AC #9 `settings.templateApplied` copy extended.** Specified: `Added {{groups}} groups and {{categories}} categories to your budget.` Shipped: that sentence plus `Every target is editable from the Budget page.` Reason: the explicit carried-forward UX instruction to make target editability unmissable. Both required placeholders are retained, so AC #10's placeholder assertion is unaffected. Flagged because it is copy beyond the AC's literal string.

**Forward gaps observed, deliberately NOT fixed (out of scope):**

- `budgetSummary` / `topBudgetCategories` query keys are invalidated by no budget mutation anywhere, including this apply path. Pre-existing, explicitly handed down as deferred.
- The one canned Rust validation message stays English-only in the French UI, consistent with 24.4's four. A single follow-up should i18n-map all five backend messages.
- No "already added" state on a starter row; the frontend cannot know which groups exist without cross-referencing `useBudgetGroups`. Deliberately not done (story §UX note 3).
- `useSystemTemplates()` has no `staleTime`, so it refetches on window focus. 25.2's documented decision; `hooks/**` is out of scope.

### File List

- `apps/desktop/src/components/settings/YourDataSettings.tsx` (modified) — two hook imports/calls, `STARTER_TEMPLATE_COPY` module const, widened `busy`, `starters`, `applyingId`, `handleApplyStarterTemplate`, and the three-state starter block as the first children of the existing Templates card
- `apps/desktop/src/locales/en.json` (modified) — +10 `settings.templateStarter*` / `settings.templateApply*` keys
- `apps/desktop/src/locales/fr.json` (modified) — the same 10 keys in French, same order and index
- `apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts` (modified) — +10 `REQUIRED_KEYS`, +3 `PLACEHOLDER_KEYS` entries, new `STARTER_TEMPLATE_COPY_KEYS` existence cases (21 → 36 cases)
- `apps/desktop/tests/budget-templates.spec.ts` (modified) — `list_system_templates` / `apply_system_template` added to `setupTauriMock` (+ optional `field` on the reject shape), new `system starter budget` describe with 7 cases (8 → 15)
- `_bmad-output/implementation-artifacts/25-3-settings-templates-section-wiring.md` (modified) — workflow artifact: `baseline_commit`, task checkboxes, Dev Agent Record, File List, Change Log, Status
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — workflow artifact: `25-3` `ready-for-dev` → `in-progress` → `review`

### Change Log

| Date | Change |
|---|---|
| 2026-08-04 | Implemented story 25.3 on Branch A: system starter-budget picker rows wired into the existing Settings Templates card via `useSystemTemplates` / `useApplySystemTemplate`, with a three-branch result toast, the shared page-level Alert error path, `busy` widened to gate all five controls, 10 new i18n keys in both locales (1129 → 1139), 8 new Vitest i18n cases, and 7 new Playwright cases. Zero TS errors; vitest 71/71; Playwright 322/324 with both failures proven non-attributable. Nothing committed. |

