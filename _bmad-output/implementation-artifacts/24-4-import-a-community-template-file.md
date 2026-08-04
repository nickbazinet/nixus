---
baseline_commit: 1bc542762f39223e091c1f9d297fd2b0b8e9cc3e
---

# Story 24.4: Import a Community Template File

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to pick a template file from disk and apply it to my budget,
so that I can adopt a category structure someone else shared with me.

**Scope:** Frontend only (TypeScript/React) + tests. One new hook file `hooks/useBudgetTemplates.ts` (`useImportBudgetTemplate`, `useExportBudgetTemplate`), one new TS interface in `lib/types.ts`, a one-word `export` on an existing helper in `hooks/useBudget.ts`, the real Templates controls in `components/settings/YourDataSettings.tsx` (replacing the "not built yet" placeholder), new + deleted i18n keys in `locales/en.json` / `locales/fr.json`, a new Playwright spec `tests/budget-templates.spec.ts`, and two new Vitest specs. **No Rust changes. No migration. No `SYSTEM_TEMPLATES`. No starter-template picker. No onboarding changes.**

**FRs:** FR96 (import user-facing path + the export entry point Story 24.3 deferred) · **NFRs:** NFR11 (never silently lose/corrupt records — surfaced here as "never leave the UI showing a partial state")
**Epic:** [epics-budget-templates.md § Epic 24, Story 24.4](../planning-artifacts/epics-budget-templates.md) — **final story in Epic 24**
**Architecture:** [architecture-budget-templates.md](../planning-artifacts/architecture-budget-templates.md) — § Frontend Architecture, § API & Communication Patterns, § New Patterns (duplicate-group handling / result toast), § Project Structure, § Gap Analysis (import-confirmation UX)
**Predecessors:** [24.1](24-1-template-schema-models-core-apply-function.md) (types, apply core) · [24.2](24-2-import-validation-for-untrusted-template-files.md) (`import_budget_template` command, cancel→`Ok(None)`, canned error copy) · [24.3](24-3-export-current-budget-as-shareable-template.md) (`export_budget_template` command, `{ path }` result, round-trip guarantee)

---

## ⛔ HARD PREREQUISITE — READ FIRST

**Stories 24.1, 24.2 and 24.3 must all be implemented before this story starts.** This story calls two Tauri commands and does not create either of them. Verified at story-creation time: **none of the three exist yet** — `apps/desktop/src-tauri/src/db/budget_template.rs` and `apps/desktop/src-tauri/src/commands/budget_template.rs` are both absent, and `models/mod.rs` contains none of the template structs.

**Before writing any code, run:**

```bash
grep -n "import_budget_template\|export_budget_template" apps/desktop/src-tauri/src/lib.rs
grep -n "pub struct ApplyBudgetTemplateResult" apps/desktop/src-tauri/src/models/mod.rs
grep -n "pub async fn import_budget_template\|pub async fn export_budget_template" apps/desktop/src-tauri/src/commands/budget_template.rs
```

- Either command missing from `lib.rs`'s `generate_handler!` → **STOP and report which of 24.2 / 24.3 is not done.** Do **not** implement the Rust side here.
- `ApplyBudgetTemplateResult` missing from `models/mod.rs` → **STOP**, Story 24.1 is not done.

**Then confirm the two return shapes you are about to type against, and use the ACTUAL Rust signatures if they differ from this story's assumption:**

| Command | Expected Rust return | TS type to declare |
|---|---|---|
| `import_budget_template` | `Result<Option<ApplyBudgetTemplateResult>, AppError>` | `ApplyBudgetTemplateResult \| null` |
| `export_budget_template` | `Result<Option<BudgetTemplateExportResult>, AppError>` | `{ path: string } \| null` |

Both are `Option<…>` because a cancelled native dialog is `Ok(None)`, not an error (24.2 §Conflict A, 24.3 §Conflict B). If 24.2/24.3 shipped a non-`Option` return, note the deviation in Completion Notes and drop the `| null` — but **do not** change the Rust.

---

## Acceptance Criteria

1. **Given** `apps/desktop/src/lib/types.ts`
   **When** this story is implemented
   **Then** it declares, inserted immediately after `BudgetCategoryStatus` (currently ends at line 24, before `Expense`-era types):
   ```ts
   export interface ApplyBudgetTemplateResult {
     groups_created: number;
     categories_created: number;
     skipped_groups: string[];
   }
   ```
   **And** the fields are `snake_case`, matching 24.1's Rust struct field-for-field
   **And** `SystemBudgetTemplateSummary` is **not** added (Story 25.2 owns it — nothing in this story lists system templates)

2. **Given** `apps/desktop/src/hooks/useBudget.ts`
   **When** this story is implemented
   **Then** the existing module-private `function invalidateTrendsQueries(queryClient: QueryClient)` at `useBudget.ts:7` becomes `export function invalidateTrendsQueries(...)`
   **And** **nothing else in that file changes** — no hook is added, moved, or reworded there
   *(Rationale + rejected alternative: Dev Notes §Conflict B)*

3. **Given** `apps/desktop/src/hooks/useBudgetTemplates.ts` (new file)
   **When** this story is implemented
   **Then** it exports `useImportBudgetTemplate()` as a TanStack Query mutation whose `mutationFn` is `() => invoke<ApplyBudgetTemplateResult | null>("import_budget_template")` — **no arguments object**, because the native file dialog lives in Rust (24.2) and the command takes only the injected `AppHandle`
   **And** it exports `useExportBudgetTemplate()` as a mutation whose `mutationFn` is `() => invoke<{ path: string } | null>("export_budget_template")`
   **And** `invoke` is imported from `@tauri-apps/api/core` (never `@tauri-apps/api`), matching `useBudget.ts:3`
   **And** `useSystemTemplates()` / `useApplySystemTemplate()` are **not** defined (Story 25.2)

4. **Given** `useImportBudgetTemplate()`'s `onSuccess(data)`
   **When** `data` is a non-null `ApplyBudgetTemplateResult`
   **Then** it invalidates, in this order: `queryKeys.budgetGroups`, the raw prefix `["budget-categories"]`, the raw prefix `["budget-status"]`, and then calls `invalidateTrendsQueries(queryClient)` (which itself invalidates `["spending-trends"]`, `["trends-insight"]`, `queryKeys.allBudgetCategories`)
   **And** the two raw-array prefixes are written as literals, **not** as `queryKeys.budgetCategories(id)` / `queryKeys.budgetStatus(y, m)` — both of those are parameterized factory functions and an import knows neither the new group ids nor the viewed month
   *(Resolves the epic-vs-`queryKeys` conflict: Dev Notes §Conflict A. Prefix matching is TanStack Query's default, so `["budget-status"]` invalidates every `["budget-status", year, month]` entry.)*

5. **Given** `useImportBudgetTemplate()`'s `onSuccess(data)`
   **When** `data` is `null` (the user cancelled the native open dialog)
   **Then** the function returns early and **invalidates nothing** — a cancelled import changed no rows, so refetching every budget query would be pure waste

6. **Given** `useExportBudgetTemplate()`
   **When** it succeeds
   **Then** it invalidates **no** query keys — export is strictly read-only (24.3 AC #12)

7. **Given** `components/settings/YourDataSettings.tsx`
   **When** this story is implemented
   **Then** the `settings.sectionTemplates` block (currently `YourDataSettings.tsx:135-146`) renders **two** `SettingRow`s inside the existing `<Card flush>`: an export row with `data-testid="setting-template-export"` and a control `Button` with `data-testid="your-data-template-export"`, and an import row with `data-testid="setting-template-import"` and a control `Button variant="outline"` with `data-testid="your-data-template-import"`
   **And** the placeholder `SettingRow` with `data-testid="setting-templates-unavailable"` is **removed**
   **And** the stale source comment at `YourDataSettings.tsx:135-137` ("needs a versioned document format and an amount-stripping export the backend does not have") is **deleted** — its premise is false once 24.1–24.3 land, and a WHY comment that lies is worse than no comment
   **And** `<SettingsSection heading={t("settings.sectionTemplates")}>` and the `<Card flush>` wrapper are kept as-is

8. **Given** either new Button
   **When** any of the four in-flight operations on this page is pending
   **Then** both template Buttons carry `disabled={saving || restoring || exportTemplate.isPending || importTemplate.isPending}` and the mirrored `aria-disabled={… || undefined}`, and each Button's **label text swaps** to its "-ing…" i18n string while its own mutation is pending — exactly the pattern at `YourDataSettings.tsx:72-79` / `:103-111`
   **And** no spinner component is introduced (`Button` from `@nixus/shared` has no pending prop; every call site in this codebase hand-rolls the disabled + label swap)
   **And** the existing `saving` / `restoring` Buttons additionally gain the two new pending booleans in their `disabled` expressions, so a template operation cannot run concurrently with a backup/restore

9. **Given** a successful import that created at least one group
   **When** `skipped_groups` is empty
   **Then** `toast.success(t("settings.templateImported", { groups: result.groups_created, categories: result.categories_created }))` fires

10. **Given** a successful import that created at least one group **and** skipped one or more by name collision
    **When** the result is shown
    **Then** `toast.success(t("settings.templateImportedSkipped", { groups, categories, skipped: result.skipped_groups.join(", ") }))` fires, rendering e.g. `Template applied — added 2 groups and 7 categories. Skipped: Housing, Transportation (already exist).`

11. **Given** a successful import where **every** group collided (`groups_created === 0`)
    **When** the result is shown
    **Then** `toast.info(t("settings.templateImportAllSkipped", { skipped }))` fires — **not** `toast.success`, because "Template applied" would be false: nothing was added
    *(New branch this story introduces; the epic's single example message does not cover it — Dev Notes §Conflict D. `toast.info` has precedent, 2 existing call sites.)*

12. **Given** the user cancels the native open dialog
    **When** `import_budget_template` resolves `null`
    **Then** **no** toast, **no** error Alert, and no query refetch occur — the page returns silently to idle
    **And** the same silent-cancel rule applies to `export_budget_template` resolving `null`

13. **Given** a successful export
    **When** the result is non-null
    **Then** `toast.success(t("settings.templateSaved", { path: result.path }))` fires, mirroring `YourDataSettings.tsx:27`'s `sidebar.backupSaved` shape

14. **Given** either command rejects with an `AppError`
    **When** the rejection is handled
    **Then** the message is surfaced through this file's **existing** `error` state into the **existing** `<Alert variant="over" data-testid="your-data-error">` at `YourDataSettings.tsx:60-64`, via `setError(getErrorMessage(err) || t("settings.templateImportFailed"))` (or `templateSaveFailed` for export) — reusing the `getErrorMessage` helper already at `YourDataSettings.tsx:10-13`
    **And** no new local `getErrorMessage` / `interface AppError` is declared in this file
    **And** the four canned Rust messages from 24.2/24.3 (`This file is not a valid Nixus budget template.`, `This template was created with a newer version of Nixus. Please update the app.`, `There is nothing to export yet. …`, `Your budget is too large to share as a template. …`) reach the Alert **verbatim** — they are not re-mapped to i18n keys in this story
    **And** `setError(null)` is called at the start of each handler, and the budget is never left in a partial state (guaranteed backend-side by 24.1's single transaction)

15. **Given** `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json`
    **When** this story is implemented
    **Then** `settings.templatesUnavailableTitle` and `settings.templatesUnavailableBody` (currently line 795 and 796 in **both** files) are **deleted** from both — they are now dead copy asserting a shipped feature does not exist
    **And** all 14 new keys from Task 4's two tables are inserted at the same position in both files (between `settings.sectionTemplates` and `settings.aboutTitle`), in the same order
    **And** `settings.sectionTemplates` is kept unchanged
    **And** the two files still have identical key sets **and** identical key ordering (they do today: 1117 keys each, verified byte-for-byte in order)

16. **Given** `apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts` (new file)
    **When** `pnpm --filter @nixus/desktop test` runs
    **Then** it asserts every new `settings.template*` key exists and is non-empty in **both** locales, that no `settings.template`-prefixed key exists in one locale but not the other, that the deleted `templatesUnavailable*` keys are absent from both, and that each interpolated key retains its `{{groups}}` / `{{categories}}` / `{{skipped}}` / `{{path}}` placeholders in both locales
    **And** it follows `src/locales/__tests__/danger-zone-i18n.test.ts` exactly (flat `Record<string, string>` cast of the imported JSON, `it.each(REQUIRED_KEYS)`, `describe`/`it` from `vitest`)

17. **Given** `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` (new file)
    **When** `pnpm --filter @nixus/desktop test` runs
    **Then** it proves, using the `vi.mock("@tauri-apps/api/core")` + `createRoot`/`act` harness from `src/hooks/__tests__/useTrendsInsight.test.tsx`: (a) `useImportBudgetTemplate().mutateAsync()` invokes `"import_budget_template"` with **no** args object, (b) a non-null result invalidates all six expected query keys, (c) a `null` result invalidates **nothing**, and (d) `useExportBudgetTemplate()` invalidates nothing on success
    **And** invalidation is asserted by spying on `queryClient.invalidateQueries` (`vi.spyOn`), not by observing refetches
    **And** `@testing-library/react` is **not** imported — it is not a dependency of `@nixus/desktop`

18. **Given** `apps/desktop/tests/budget-templates.spec.ts` (new file)
    **When** the Playwright suite runs
    **Then** it navigates directly to `/settings/ai-provider?section=data` (the Your Data tab is a search-param section of the `settings.ai-provider` route, **not** its own route), and covers: import-with-skips shows the skipped group names, import-cancelled (`null`) shows no toast, import-rejection shows the canned message in `[data-testid="your-data-error"]`, and export success shows the saved-path toast
    **And** the IPC mock is a spec-local `setupTauriMock(page)` adapted from `tests/accessibility.spec.ts:10-80` — including `transformCallback: () => 1` and `if (cmd.startsWith("plugin:")) return Promise.resolve(null);`
    **And** it does **not** stub `"plugin:dialog|open"` / `"plugin:dialog|save"` — both dialogs are Rust-side and never cross IPC as dialog-plugin calls (Dev Notes §Conflict C)

19. **Given** the desktop app
    **When** `pnpm --filter @nixus/desktop build` runs (`tsc && vite build`)
    **Then** it completes with **zero** TypeScript errors or warnings — `strict` + `noUnusedLocals` + `noUnusedParameters` are on, so an unused import or leftover state variable is a hard failure
    **And** no Rust file is modified, so `cargo check` output is unchanged from 24.3's baseline

---

## Tasks / Subtasks

- [x] **Task 0: Confirm prerequisites** (see ⛔ HARD PREREQUISITE)
  - [x] Run the three greps; STOP if any of 24.1/24.2/24.3 is missing
  - [x] Record the **actual** return types of `import_budget_template` / `export_budget_template` and the actual `ApplyBudgetTemplateResult` field names; if they differ from this story's assumption, use the real ones and note it in Completion Notes
  - [x] `grep -rn "templates-unavailable\|templatesUnavailable" apps/desktop/src apps/desktop/tests` → confirm the only references are `YourDataSettings.tsx:141-143` and `en.json`/`fr.json:795-796`. **No test references them** (verified at story creation), so deleting them breaks nothing

- [x] **Task 1: Add the TS result type** (AC: #1)
  - [x] `apps/desktop/src/lib/types.ts` — insert `ApplyBudgetTemplateResult` right after `BudgetCategoryStatus` (line 24) to keep the budget cluster contiguous
  - [x] Do not add `SystemBudgetTemplateSummary`; do not touch any other interface

- [x] **Task 2: Export the shared trends-invalidation helper** (AC: #2)
  - [x] `apps/desktop/src/hooks/useBudget.ts:7` — change `function invalidateTrendsQueries(` to `export function invalidateTrendsQueries(`
  - [x] Change nothing else in this file

- [x] **Task 3: Create `apps/desktop/src/hooks/useBudgetTemplates.ts`** (AC: #3, #4, #5, #6)
  - [x] Imports:
    ```ts
    import { useMutation, useQueryClient } from "@tanstack/react-query";
    import { invoke } from "@tauri-apps/api/core";
    import { queryKeys } from "@/lib/constants";
    import { invalidateTrendsQueries } from "@/hooks/useBudget";
    import type { ApplyBudgetTemplateResult } from "@/lib/types";
    ```
    Use the `@/` alias, never a relative `../` path
  - [x] ```ts
        export function useImportBudgetTemplate() {
          const queryClient = useQueryClient();

          return useMutation({
            // The native open dialog lives in Rust (tauri-plugin-dialog), so the command takes no
            // arguments and returns null when the user cancels.
            mutationFn: () =>
              invoke<ApplyBudgetTemplateResult | null>("import_budget_template"),
            onSuccess: (data) => {
              if (!data) return;
              queryClient.invalidateQueries({ queryKey: queryKeys.budgetGroups });
              // Prefix invalidation: an import cannot know the new group ids or the viewed month,
              // and queryKeys.budgetCategories/budgetStatus are per-id/per-month factories.
              queryClient.invalidateQueries({ queryKey: ["budget-categories"] });
              queryClient.invalidateQueries({ queryKey: ["budget-status"] });
              invalidateTrendsQueries(queryClient);
            },
          });
        }
        ```
  - [x] ```ts
        export function useExportBudgetTemplate() {
          // Export is read-only: nothing to invalidate.
          return useMutation({
            mutationFn: () =>
              invoke<{ path: string } | null>("export_budget_template"),
          });
        }
        ```
  - [x] Do **not** add `useSystemTemplates` / `useApplySystemTemplate` / `queryKeys.systemBudgetTemplates` (Story 25.2)

- [x] **Task 4: i18n keys — both locales, identical position and order** (AC: #15)
  - [x] Delete line 795 (`settings.templatesUnavailableTitle`) and line 796 (`settings.templatesUnavailableBody`) from **both** `en.json` and `fr.json`
  - [x] Insert these 12 keys immediately after `settings.sectionTemplates` (line 794) in both files, keeping this order:

  | Key | en.json | fr.json |
  |---|---|---|
  | `settings.templateExportTitle` | `Save your budget as a template` | `Enregistrer votre budget comme modèle` |
  | `settings.templateExportBody` | `Creates a file with your group and category names only — every dollar amount is left out, so you can share it safely.` | `Crée un fichier contenant uniquement vos noms de groupes et de catégories — aucun montant n'est inclus, vous pouvez donc le partager en toute sécurité.` |
  | `settings.templateExportAction` | `Save as template` | `Enregistrer comme modèle` |
  | `settings.templateExporting` | `Saving…` | `Enregistrement…` |
  | `settings.templateSaved` | `Template saved to {{path}}` | `Modèle enregistré dans {{path}}` |
  | `settings.templateSaveFailed` | `Failed to save the template` | `Échec de l'enregistrement du modèle` |
  | `settings.templateImportTitle` | `Open a template someone shared` | `Ouvrir un modèle partagé` |
  | `settings.templateImportBody` | `Adds the template's groups and categories to your budget. Groups you already have are skipped, and every new category starts at $1.00 so you can set your own targets.` | `Ajoute les groupes et catégories du modèle à votre budget. Les groupes que vous avez déjà sont ignorés, et chaque nouvelle catégorie démarre à 1,00 $ pour que vous fixiez vos propres objectifs.` |
  | `settings.templateImportAction` | `Open a template` | `Ouvrir un modèle` |
  | `settings.templateImporting` | `Opening…` | `Ouverture…` |
  | `settings.templateImported` | `Template applied — added {{groups}} groups and {{categories}} categories.` | `Modèle appliqué — {{groups}} groupes et {{categories}} catégories ajoutés.` |
  | `settings.templateImportedSkipped` | `Template applied — added {{groups}} groups and {{categories}} categories. Skipped: {{skipped}} (already exist).` | `Modèle appliqué — {{groups}} groupes et {{categories}} catégories ajoutés. Ignorés : {{skipped}} (existent déjà).` |

  - [x] Then insert these 2 remaining keys directly after the table's last row, still before `settings.aboutTitle`:

  | Key | en.json | fr.json |
  |---|---|---|
  | `settings.templateImportAllSkipped` | `Nothing to add — every group in this template already exists: {{skipped}}.` | `Rien à ajouter — tous les groupes de ce modèle existent déjà : {{skipped}}.` |
  | `settings.templateImportFailed` | `Failed to open the template` | `Échec de l'ouverture du modèle` |

  - [x] The locale files are **flat** `"namespace.key": "value"` maps — **not** nested objects. Do not introduce nesting
  - [x] The `$1.00` figure in `templateImportBody` comes from 24.1's `DEFAULT_TEMPLATE_TARGET_CENTS = 100`; if 24.1 shipped a different default, correct the copy in both locales and note it

- [x] **Task 5: Wire the Templates section in `YourDataSettings.tsx`** (AC: #7, #8, #9, #10, #11, #12, #13, #14)
  - [x] Add to the imports at the top of the file:
    ```ts
    import {
      useExportBudgetTemplate,
      useImportBudgetTemplate,
    } from "@/hooks/useBudgetTemplates";
    ```
    Note: this file currently uses relative imports (`"./DangerZone"`) for siblings but has no hook import yet — use the `@/` alias, per `project-context.md` §TypeScript
  - [x] Inside `YourDataSettings()`, after the existing `useState` lines:
    ```ts
    const exportTemplate = useExportBudgetTemplate();
    const importTemplate = useImportBudgetTemplate();
    const busy =
      saving || restoring || exportTemplate.isPending || importTemplate.isPending;
    ```
    Use `busy` in **all four** Buttons' `disabled`/`aria-disabled` so the backup, restore, and both template controls are mutually exclusive (AC #8). Replace the existing `saving || restoring` expressions at lines 74-75 and 106-107 with `busy`
  - [x] Handlers — reuse the file's existing `setError` + `getErrorMessage` idiom, do **not** add a second error helper:
    ```ts
    const handleExportTemplate = async () => {
      setError(null);
      try {
        const result = await exportTemplate.mutateAsync();
        if (result) toast.success(t("settings.templateSaved", { path: result.path }));
      } catch (err: unknown) {
        setError(getErrorMessage(err) || t("settings.templateSaveFailed"));
      }
    };

    const handleImportTemplate = async () => {
      setError(null);
      try {
        const result = await importTemplate.mutateAsync();
        if (!result) return; // User cancelled the native dialog
        const skipped = result.skipped_groups.join(", ");
        if (result.groups_created === 0) {
          toast.info(t("settings.templateImportAllSkipped", { skipped }));
        } else if (result.skipped_groups.length > 0) {
          toast.success(
            t("settings.templateImportedSkipped", {
              groups: result.groups_created,
              categories: result.categories_created,
              skipped,
            })
          );
        } else {
          toast.success(
            t("settings.templateImported", {
              groups: result.groups_created,
              categories: result.categories_created,
            })
          );
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err) || t("settings.templateImportFailed"));
      }
    };
    ```
    No `finally` block is needed — `isPending` is managed by TanStack Query, unlike the hand-rolled `saving`/`restoring` booleans. Use `mutateAsync` (not `mutate`) so the existing try/catch shape carries over unchanged
  - [x] Replace lines 135-146 wholesale (delete the stale comment and the placeholder row):
    ```tsx
    <SettingsSection heading={t("settings.sectionTemplates")}>
      <Card flush>
        <SettingRow
          title={t("settings.templateExportTitle")}
          description={t("settings.templateExportBody")}
          control={
            <Button
              onClick={handleExportTemplate}
              disabled={busy}
              aria-disabled={busy || undefined}
              data-testid="your-data-template-export"
            >
              {exportTemplate.isPending
                ? t("settings.templateExporting")
                : t("settings.templateExportAction")}
            </Button>
          }
          data-testid="setting-template-export"
        />
        <SettingRow
          title={t("settings.templateImportTitle")}
          description={t("settings.templateImportBody")}
          control={
            <Button
              variant="outline"
              onClick={handleImportTemplate}
              disabled={busy}
              aria-disabled={busy || undefined}
              data-testid="your-data-template-import"
            >
              {importTemplate.isPending
                ? t("settings.templateImporting")
                : t("settings.templateImportAction")}
            </Button>
          }
          data-testid="setting-template-import"
        />
      </Card>
    </SettingsSection>
    ```
    `variant="outline"` on import mirrors the restore Button (`:104`) — the destructive-ish/secondary action of the pair
  - [x] Do **not** add an `Alert variant="caution"`, a confirm `Dialog`, or a preview step (Dev Notes §Conflict E). The `templateImportBody` description carries the "groups you already have are skipped" warning inline, matching the restore section's "tell them before they pick the file" principle (source comment at `:91-92`)
  - [x] Do **not** call `queryClient.clear()` (that is restore's nuclear option at `:41`); the hook's targeted invalidation is correct here. The `useQueryClient()` at `:17` stays for restore's use

- [x] **Task 6: i18n parity test** (AC: #16)
  - [x] Create `apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts`, copying the shape of `danger-zone-i18n.test.ts` (56 lines) verbatim: `import enLocale from "../en.json"; import frLocale from "../fr.json";` then `const en = enLocale as Record<string, string>;`
  - [x] `REQUIRED_KEYS` = the 14 new keys plus `settings.sectionTemplates`
  - [x] Add tests: `it.each(REQUIRED_KEYS)` non-empty in both; prefix-symmetry on `"settings.template"`; `expect(en["settings.templatesUnavailableTitle"]).toBeUndefined()` (and `Body`, and both in `fr`); placeholder retention — `{{path}}` in `templateSaved`, `{{groups}}` + `{{categories}}` in `templateImported`, all three of `{{groups}}`/`{{categories}}`/`{{skipped}}` in `templateImportedSkipped`, `{{skipped}}` in `templateImportAllSkipped`, in **both** locales

- [x] **Task 7: Hook unit test** (AC: #17)
  - [x] Create `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx`, mirroring `useTrendsInsight.test.tsx` (112 lines) for the harness: `declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }`, `const invokeMock = vi.fn();`, `vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));`, a `Harness` component, `createRoot` + `act`, `QueryClientProvider` with `retry: false`
  - [x] `vi.useFakeTimers()` is **not** needed here (no debounce) — omit it and the matching `useRealTimers`
  - [x] Capture the mutation result object out of the harness (e.g. assign `useImportBudgetTemplate()`'s return to a module-scoped `let` inside the component) so the test can `await act(async () => { await hook.mutateAsync(); })`
  - [x] `const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");` then assert the exact keys:
    ```ts
    expect(invalidateSpy.mock.calls.map((c) => c[0]?.queryKey)).toEqual([
      ["budget-groups"],
      ["budget-categories"],
      ["budget-status"],
      ["spending-trends"],
      ["trends-insight"],
      ["all-budget-categories"],
    ]);
    ```
  - [x] Tests:

  | Test | Mock resolves | Expected |
  |---|---|---|
  | `import invokes the command with no arguments` | `{ groups_created: 2, categories_created: 7, skipped_groups: [] }` | `invokeMock` called once with `"import_budget_template"` and **no** second arg |
  | `import invalidates every budget-facing query key` | same | the 6-key array above, in order |
  | `cancelled import invalidates nothing` | `null` | `invalidateSpy` not called |
  | `export invalidates nothing` | `{ path: "/tmp/t.json" }` | `invokeMock` called with `"export_budget_template"`; `invalidateSpy` not called |

- [x] **Task 8: Playwright E2E** (AC: #18)
  - [x] Create `apps/desktop/tests/budget-templates.spec.ts`. Copy `setupTauriMock` from `tests/accessibility.spec.ts:10-80` (it is the leanest full-boot mock: `transformCallback: () => 1`, `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`, `if (cmd.startsWith("plugin:")) return Promise.resolve(null);`, then a `switch (cmd)` with `check_onboarding_status`, `get_db_status`, and the budget/account/asset getters). There is **no** shared test helper file in `apps/desktop/tests/` — every spec inlines its own mock; do not create one now
  - [x] Parameterize the mock so each test can choose the `import_budget_template` / `export_budget_template` outcome (resolve a result, resolve `null`, or `Promise.reject({ type: "file", message: "…" })` — Tauri rejects with the plain serialized `AppError` object, which is why the frontend reads `err.message` directly)
  - [x] Navigate with `await page.goto("/settings/ai-provider?section=data")`. **`/settings` redirects to `/settings/ai-provider` (the General tab), not to Your Data** — the four Your Data / General / Reading / About sub-surfaces are `?section=` search params on one route (`settings.ai-provider.tsx:17-33`), so the query string is mandatory. Assert `page.getByTestId("settings-your-data")` is visible before clicking
  - [x] Tests:

  | Test | Mock | Assertions |
  |---|---|---|
  | `applies a shared template and reports skipped groups` | `{ groups_created: 2, categories_created: 7, skipped_groups: ["Housing", "Transportation"] }` | click `your-data-template-import`; `page.getByText(/Skipped: Housing, Transportation \(already exist\)/)` visible; `your-data-error` absent |
  | `says nothing was added when every group already exists` | `{ groups_created: 0, categories_created: 0, skipped_groups: ["Housing"] }` | toast text contains `every group in this template already exists`; not `Template applied` |
  | `stays silent when the user cancels the file picker` | `null` | no toast appears (assert the success/info copy has count 0); `your-data-error` absent; the Button returns to its idle label |
  | `shows the backend message when the file is not a template` | reject `{ type: "file", message: "This file is not a valid Nixus budget template." }` | `page.getByTestId("your-data-error")` contains that exact string |
  | `saves the budget as a template` | `{ path: "/tmp/budget-template-my-budget-2026-08-04.json" }` | click `your-data-template-export`; toast contains the path |
  | `shows the backend message when there is nothing to export` | reject `{ type: "file", message: "There is nothing to export yet. Create at least one budget category first." }` | `your-data-error` contains it |

  - [x] Do **not** stub `"plugin:dialog|open"` / `"plugin:dialog|save"` — unlike `tests/import.spec.ts:50` (where the *frontend* opens the picker via `@tauri-apps/plugin-dialog`), this feature's dialogs are opened inside the Rust command, so the only IPC call is the command itself
  - [x] Run with `pnpm exec playwright test tests/budget-templates.spec.ts` from `apps/desktop/` — **there is no `e2e`/`playwright` npm script** in either `package.json`; `playwright.config.ts` boots the Vite dev server on port 1420 and runs in a plain browser (hence the `__TAURI_INTERNALS__` injection). Do not add a script in this story

- [x] **Task 9: Verification** (AC: #19)
  - [x] `pnpm --filter @nixus/desktop build` → zero TS errors/warnings (`tsc` runs first; `noUnusedLocals` will catch a leftover `saving`/`restoring` reference if you mis-edit)
  - [x] `pnpm --filter @nixus/desktop test` → all Vitest specs pass (4 pre-existing + 2 new); record the total in Completion Notes, do not hardcode an expected count
  - [x] `pnpm exec playwright test tests/budget-templates.spec.ts` from `apps/desktop/` → all new E2E pass
  - [x] `pnpm exec playwright test` (full suite) → no regressions. The Your Data tab had **zero** test coverage before this story, so nothing existing asserts on the block you replaced
  - [x] Confirm untouched: **all of `apps/desktop/src-tauri/**`**, `lib/constants.ts`, `apps/web/**`, `packages/shared/**`, `routeTree.gen.ts`, every other file in `components/settings/`, `hooks/useBudget.ts` beyond the single `export` keyword
  - [x] `git diff --stat` should show exactly these 9 paths, all under `apps/desktop/`: `src/lib/types.ts`, `src/hooks/useBudget.ts`, `src/hooks/useBudgetTemplates.ts` (new), `src/components/settings/YourDataSettings.tsx`, `src/locales/en.json`, `src/locales/fr.json`, `src/locales/__tests__/budget-templates-i18n.test.ts` (new), `src/hooks/__tests__/useBudgetTemplates.test.tsx` (new), `tests/budget-templates.spec.ts` (new)
  - [x] **Do not commit**

### Review Findings

_Adversarial code review, 2026-08-04. Scope: this story's own additions/modifications only — `apps/desktop/src/lib/types.ts` (`ApplyBudgetTemplateResult`), `apps/desktop/src/hooks/useBudget.ts` (the `export` keyword on `invalidateTrendsQueries`), `apps/desktop/src/hooks/useBudgetTemplates.ts` (new), `apps/desktop/src/components/settings/YourDataSettings.tsx`, `apps/desktop/src/locales/en.json`/`fr.json`, `apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts` (new), `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` (new), `apps/desktop/tests/budget-templates.spec.ts` (new). Stories 24.1/24.2/24.3 Rust code excluded — already reviewed and passed. Independently confirmed **zero** Rust changes: `git diff --name-only -- apps/desktop/src-tauri/` returns only `commands/mod.rs`, `db/mod.rs`, `lib.rs`, `models/mod.rs` — all pre-existing 24.1–24.3 uncommitted work, none touched by this story's diff._

_Verification (all re-run, real output): `tsc --noEmit` — 0 errors. `pnpm test` (Vitest) — **51/51 passed, 6 files** (matches Completion Notes exactly). `playwright test tests/budget-templates.spec.ts` — **8/8 passed**. `cargo check --all-targets` — 0 warnings. `cargo clippy --all-targets -- -D warnings` (sources `touch`ed to bust the cache) — 0 warnings. `cargo test` — **241/241 passed** (matches the stated 24.3 baseline). `chat.spec.ts` run in isolation — **21 passed, 1 failed** at line 250 (`tabular-nums` vs `normal`), independently confirmed pre-existing and unrelated: `git diff --stat` over `components/chat`, `components/ai`, `packages/shared`, `index.css`, `styles/` is empty._

_Type fidelity: `ApplyBudgetTemplateResult` in `types.ts` matches `models/mod.rs:68-72` field-for-field (`groups_created: i32`↔`number`, `categories_created: i32`↔`number`, `skipped_groups: Vec<String>`↔`string[]`). Both commands confirmed `Result<Option<T>, AppError>` in `commands/budget_template.rs:26,74`; both hook return types carry `| null`; the cancel branch (`if (!data) return`import, no-op export) is correctly silent per AC #5/#12._

_i18n: `en.json`/`fr.json` independently diffed — **1129 keys each, 0 order mismatches, 0 one-sided keys** (byte-identical key sets and ordering, confirming AC #15's claim). French copy is genuine French, not copy-pasted English (spot-checked all 14 strings); `1,00 $` in `templateImportBody` is correct fr-CA currency typography (comma decimal, space before symbol). No hardcoded English found in `YourDataSettings.tsx` or `useBudgetTemplates.ts` — every user-facing string routes through `t()`._

_Query invalidation: the raw prefixes `["budget-categories"]`/`["budget-status"]` are confirmed valid TanStack-Query prefix-matches against the factory-produced keys in `constants.ts:3-6` (`budgetCategories(groupId)` → `["budget-categories", groupId]`, `budgetStatus(y,m)` → `["budget-status", y, m]`), and precedented 3× already in `useBudget.ts`. Exporting `invalidateTrendsQueries` does not break its 3 existing same-file callers (`useCreateBudgetCategory`/`useUpdateBudgetCategory`/`useDeleteBudgetCategory`) — confirmed no other file called it before this story. **Mutation-tested**: temporarily removed the `["budget-categories"]` invalidation call — the vitest exact-order assertion failed as expected; reverted and re-verified 51/51 green. Not vacuous._

_Concurrency: `busy` (`saving || restoring || exportTemplate.isPending || importTemplate.isPending`) gates all 4 buttons' `disabled`/`aria-disabled`; TanStack Query resets `isPending` on both the success and the throw path with no `finally` needed, so the error path correctly un-blocks the UI. **Mutation-tested**: temporarily dropped `importTemplate.isPending` from `busy` — the Playwright "disables the backup and restore controls" test failed as expected (`your-data-save-copy` stayed enabled); reverted and re-verified 8/8 green. Not vacuous. Both mutated files diffed byte-identical to their pre-mutation state after revert._

_Test non-vacuity (beyond the two mutation-tested above): the i18n parity test's membership/placeholder assertions would fail on a dropped key or a stripped `{{placeholder}}`; the Playwright cancel tests use `delayMs` to make the pending window observable so "no toast" assertions run after the only moment one could fire, not before it — reasoned through, not mutation-tested (lower marginal risk than the two selected)._

- [x] [Review][Defer] The Playwright spec hardcodes 2 of the 4 canned Rust error strings (`MSG_INVALID_FILE`, `MSG_NOTHING_TO_EXPORT` from `db/budget_template.rs:40-46`) verbatim as mock reject payloads rather than importing/sharing them from a single source of truth. If a future Rust change edits that copy, this E2E suite keeps passing against the old string while the live app shows the new one — a silent drift risk. **Not introduced by this story**: it is the same IPC-mocking convention every Rust-backed Playwright spec in this repo already uses (`tests/import.spec.ts`, `tests/accessibility.spec.ts`, etc.) — fixing it means a repo-wide shared-fixtures pass, not a one-file patch. Logged in `deferred-work.md`.
- [x] [Review][Defer] `queryKeys.budgetSummary(year, month)`/`queryKeys.topBudgetCategories(year, month)` (consumed by the Dashboard and the Budget page via `useDashboard.ts`) are invalidated by **no** budget mutation anywhere in the codebase, including this story's `useImportBudgetTemplate` — so a user who imports a template while sitting on the Dashboard/Budget page can see a stale summary/top-categories card until the next window focus or navigation remount. **Not introduced by this story**: `useCreateBudgetCategory`/`useUpdateBudgetCategory`/`useDeleteBudgetCategory` in `useBudget.ts` have the identical gap today, and 24.4 faithfully mirrored the established (if incomplete) invalidation convention rather than inventing a new one. A fix belongs to a systemic invalidation-set review across all budget mutations, not this story. Logged in `deferred-work.md`.

**Dismissed as noise / handled elsewhere (3):** i18n parity test checks key *membership* per-file but not key *order* — AC #16's own wording doesn't require an order assertion, and order equality was independently verified by direct file inspection (see Verification above), so this is a test-coverage nicety, not a gap that hides a real bug. The Playwright suite doesn't separately assert the import button disables *itself* mid-pending (only its label swap and 3 sibling buttons) — mirrors the same minor coverage gap already present for the pre-existing save/restore buttons, not a regression. `getErrorMessage`'s `err as { message?: string }` cast is unsafe-by-construction but is the file's pre-existing helper, reused verbatim per the story's own explicit instruction not to add a second one.

**Scope overlap check (25.2 / 25.3):** none found. Actual shipped code matches, field-for-field and name-for-name, what both 25-2 (`25-2-frontend-hook-for-budget-templates.md` §Prerequisite Gate, §Scope Reconciliation) and 25-3 (`25-3-settings-templates-section-wiring.md` §Prerequisite Gate "Branch A") already assume 24.4 will ship: `useBudgetTemplates.ts` contains exactly `useImportBudgetTemplate`/`useExportBudgetTemplate` (no `useSystemTemplates`/`useApplySystemTemplate`); `lib/types.ts` has exactly `ApplyBudgetTemplateResult` (no `SystemBudgetTemplateSummary`); `constants.ts` is untouched (no `systemBudgetTemplates` key); `YourDataSettings.tsx`'s Templates card has exactly the export/import rows (no starter-template rows); the six-key invalidation sequence in `useImportBudgetTemplate` is exactly what 25.2 Task 3 plans to extract into a shared `invalidateAppliedTemplateQueries` helper, unmodified. `en.json`/`fr.json` key count (1129 = 1117 + 14 − 2) matches the arithmetic both follow-on stories' prerequisite gates expect. **No pre-emption, no conflict — the next dev agent can proceed on 25.2/25.3 exactly per their existing gates.**

---

## Dev Notes

### Critical Rules (DO NOT VIOLATE)

1. **Zero Rust changes.** 24.2 and 24.3 own both commands, both dialogs, all validation, and all four canned user-facing messages. If you find yourself opening anything under `src-tauri/`, stop — that is a scope violation. [Source: 24-2 §Scope Boundary vs. Story 24.4]
2. **`invoke` comes from `@tauri-apps/api/core`.** Every one of the 21 hook files uses this exact specifier (`useBudget.ts:3`). `@tauri-apps/api` (bare) and `@tauri-apps/plugin-dialog` are both wrong here.
3. **All IPC field names stay `snake_case` end to end.** `groups_created`, `categories_created`, `skipped_groups` — no camelCase mapping layer exists anywhere in `lib/types.ts` (596 lines, every interface snake_case). [Source: project-context.md §2, §4]
4. **Every mutation invalidates all affected keys.** [Source: project-context.md §6] — but see §Conflict A for *which* keys, because two of them cannot be taken from `queryKeys`.
5. **No hardcoded English in JSX.** All 14 strings go through `t()` in both locales. [Source: project-context.md §i18n]
6. **Check `@nixus/shared/ui` before creating any component.** `Button`, `Card`, `Alert`, `AlertTitle`, `AlertDescription` are already imported at `YourDataSettings.tsx:6`. You need **no** new component — `SettingRow`'s `control` prop takes the Button. [Source: project-context.md §8]
7. **Zero TypeScript warnings.** `strict` + `noUnusedLocals` + `noUnusedParameters`. [Source: project-context.md §7, §9; docs/guidelines/warnings.md]
8. **No comments explaining *what*; only *why*.** [Source: project-context.md §Code Quality] The two WHY comments this story requires are the prefix-invalidation rationale and the Rust-side-dialog/no-args note. Delete the now-false WHY comment at `YourDataSettings.tsx:135-137`.
9. **No starter templates, no `SYSTEM_TEMPLATES`, no onboarding changes, no `queryKeys.systemBudgetTemplates`.**

### Five Conflicts Resolved Here (Binding — Do Not Re-derive)

**Conflict A — the epic says "invalidate the `budgetStatus` query key", but `queryKeys.budgetStatus` is not a key.**
`constants.ts:5-6` defines `budgetStatus: (year, month) => ["budget-status", year, month]` and `constants.ts:3-4` defines `budgetCategories: (groupId) => ["budget-categories", groupId]` — both are **factories**, not keys. An import creates groups whose ids it learns only from the backend (and the result carries counts, not ids), and it has no idea which month the user is viewing. So neither factory can be called.
**Resolution:** invalidate the raw prefixes `["budget-categories"]` and `["budget-status"]`. This is not an invention — `useBudget.ts:60-62`, `:102-104`, `:120-122` already invalidate the literal `["budget-status"]` in exactly this situation, three times. TanStack Query matches query keys by prefix by default, so `["budget-status"]` covers every `["budget-status", year, month]` entry, and `["budget-categories"]` covers every per-group list. This is a **documented, precedented deviation from `project-context.md` §6** ("never hardcode query keys in hooks"): the alternative — adding non-parameterized `budgetStatusAll` / `budgetCategoriesAll` entries to `constants.ts` — would introduce two keys nothing else uses and make this story the odd one out among four existing call sites. `["budget-categories"]` is additionally **beyond** the epic's stated three keys; it is required because a mounted `BudgetGroupCard` renders `useBudgetCategories(groupId)` and would otherwise show a stale list for a group whose categories the import just added.

**Conflict B — `invalidateTrendsQueries` is module-private, but this story must not drift from it.**
`useBudget.ts:7-11` is a non-exported helper invalidating `["spending-trends"]`, `["trends-insight"]`, and `queryKeys.allBudgetCategories`. Applying a template creates categories with targets, which changes the target side of the trends comparison — so a template import must invalidate the same three. A new file cannot import a private function.
**Resolution:** add the `export` keyword (one word, AC #2) and import it. Copy-pasting the three lines into `useBudgetTemplates.ts` was rejected: a duplicated invalidation set is exactly the drift `project-context.md` §6 exists to prevent, and the next person to add a trends query would update one copy. `useBudget.ts` is not on any "do not modify" list for this epic (24.2/24.3's tripwire lists `db/budget.rs`, `db/audit.rs`, `error.rs`, `models/mod.rs` — all Rust).

**Conflict C — the Playwright dialog-stub advice inherited from 24.3 is wrong for this feature.**
24.3's UX note says an export E2E "will need the same treatment for `plugin:dialog|save`", by analogy with `tests/import.spec.ts:50`'s `if (cmd === "plugin:dialog|open") return Promise.resolve("/tmp/statement.png")`. That analogy does not hold: in the CC-import flow the **frontend** opens the picker via `@tauri-apps/plugin-dialog`, so the dialog crosses IPC as a `plugin:dialog|*` command. Here, architecture § API & Communication Patterns mandates a **Rust-side** dialog (`blocking_pick_file` / `blocking_save_file` inside the command, 24.2 AC #1 / 24.3 AC #8), so the only IPC traffic is `invoke("import_budget_template")` with no args.
**Resolution:** mock the two commands directly as `switch` cases; stub no dialog-plugin command. `accessibility.spec.ts`'s blanket `if (cmd.startsWith("plugin:")) return Promise.resolve(null);` already neutralizes the plugin namespace (and is required anyway — a truthy updater response opens a focus-trapping Dialog that `aria-hidden`s the whole app; see that file's header comment).

**Conflict D — the epic's single toast example is false when every group collides.**
Epic AC 24.4 #3 gives one message: `"Applied template. Skipped: Housing, Transportation (already exist)."` But 24.1 AC #4 skips the **entire** group on a case-insensitive name match, and 24.3 §Schema notes that re-importing your own export into the same budget skips **every** group. In that case `groups_created === 0` and `categories_created === 0`, and "Template applied — added 0 groups and 0 categories" is a confusing near-lie.
**Resolution:** three branches (AC #9/#10/#11), with the all-skipped case using `toast.info` and copy that says nothing was added. `toast.info` is already used twice in the codebase, so this needs no new primitive. Branch on `groups_created === 0` (not on `skipped_groups.length === totalGroups`, which the result does not let you compute).

**Conflict E — architecture flags import-confirmation UX as undecided; this story decides it.**
`architecture-budget-templates.md` § Gap Analysis lists "whether the frontend shows a preview ('this will add 3 groups, skip 1 duplicate — proceed?') before committing" as an open, story-level decision. The epic's § UX Design Requirements likewise says the ACs "make a minimal, consistent UX decision and flag it explicitly for UX review".
**Resolution: direct apply + result toast. No preview, no confirm dialog.** Grounds: (a) `import_budget_template` is one round trip that reads, validates, and applies — a preview would require a second Rust command (a dry-run mode) that no story specifies and 24.2 did not build; (b) the operation is purely **additive** and group-collision-safe, so unlike restore it cannot destroy anything, which is why the restore section's `Alert variant="caution"` is *not* replicated; (c) this file's own established principle is "tell them before they pick the file, not after" (`YourDataSettings.tsx:91-92`), satisfied by `templateImportBody`'s inline description; (d) there is **no `AlertDialog` component in this codebase at all** — the only modal primitive is `Dialog` from `@nixus/shared`, used once in `DangerZone.tsx:181-239` for a type-DELETE-to-confirm destructive flow, which is the wrong weight for an additive action. **Flag for UX review** (see §UX Note), but implement direct apply.

### Two Facts That Contradict the Planning Docs (verified in code)

1. **There are no "already-scaffolded but disabled" Templates buttons to enable.** Architecture § Frontend Architecture and the epic's § Additional Requirements both say `YourDataSettings.tsx`'s `settings.sectionTemplates` block has "buttons currently disabled". It does not — 24.3 flagged this and it is re-confirmed: `YourDataSettings.tsx:138-146` is a `SettingsSection` containing one statement-only `SettingRow` (`title` + `description` + `data-testid="setting-templates-unavailable"`), with **no `control` prop, no `Button`, no `disabled` attribute**, plus a three-line source comment explaining the deferral. Only three template i18n keys exist (`en.json`/`fr.json:794-796`). You are **creating** the controls and **adding** keys, not enabling and reusing.
2. **`project-context.md` is stale in two ways that matter here.** It says "No unit test framework in desktop — all testing is Playwright E2E" (§Testing Rules) — **false**: `apps/desktop/vitest.config.ts` exists (jsdom, `globals: true`, `include: ["src/**/*.test.{ts,tsx}"]`), `"test": "vitest run"` is wired in `package.json`, and four specs already run, including a hook test and two i18n-parity tests. It also says the package scope is `@nkbaz/` — the actual scope is **`@nixus/`** (`@nixus/desktop`, `@nixus/shared`), so every filter command is `pnpm --filter @nixus/desktop …` and the shared UI import is `from "@nixus/shared"`. Use the verified facts, not the doc.

### Existing Code to Extend (DO NOT REINVENT)

| Item | File:line | Exact fact |
|---|---|---|
| Mutation hook shape | `hooks/useBudget.ts:42-66` (`useCreateBudgetCategory`) | `useMutation({ mutationFn: (input) => invoke<T>("cmd", {...}), onSuccess: (_data, variables) => {...} })`. `mutationFn` is **not** wrapped in `async` — it returns the `invoke` promise directly |
| Zero-arg mutation precedent | `hooks/useBudget.ts:24-25`, `:141-142` | `mutationFn: (name: string) => invoke<BudgetGroup>("create_budget_group", { name })` — args object omitted entirely when there are none |
| Trends invalidation set | `hooks/useBudget.ts:7-11` | `invalidateTrendsQueries` → `["spending-trends"]`, `["trends-insight"]`, `queryKeys.allBudgetCategories`. Module-private today (AC #2 exports it) |
| Raw `["budget-status"]` precedent | `hooks/useBudget.ts:60-62`, `:102-104`, `:120-122` | Three existing call sites already hardcode this prefix rather than calling the `budgetStatus(y, m)` factory |
| `queryKeys` shape | `lib/constants.ts:1-58` | `export const queryKeys = { … }`; entries are either `["kebab-case"] as const` tuples or factory functions. `budgetGroups: ["budget-groups"]` (`:2`), `allBudgetCategories: ["all-budget-categories"]` (`:7`). **No `systemBudgetTemplates` entry — and this story adds none** |
| `lib/types.ts` convention | `lib/types.ts:1-24`, `:111-125` | `export interface X { field_name: type; }`, all `snake_case`, mirroring Rust DTOs 1:1. Budget cluster is lines 1-24 (`BudgetGroup`, `BudgetCategory`, `BudgetCategoryStatus`) — insert after line 24. 596 lines total |
| Cancel-guard idiom | `YourDataSettings.tsx:26-27` | `const result = await invoke<{ path: string } \| null>("export_backup"); if (result) toast.success(...)` — the exact `Ok(None)` → `null` → silent-return contract this story reuses twice |
| Error surfacing | `YourDataSettings.tsx:10-13`, `:29`, `:45`, `:60-64` | Local `getErrorMessage(err)` (`(err as { message?: string }).message ?? …`), `setError(getErrorMessage(err) \|\| t("…Failed"))`, rendered in `<Alert variant="over" data-testid="your-data-error">`. **Reuse all of it** — there is **no shared error helper in `lib/`** (each component defines its own; do not add a fourth copy in this file, which already has one) |
| Tauri rejection shape | `src-tauri/src/error.rs:62-67` | `AppError::File` serializes to `{ "type": "file", "message": "…" }`; Tauri rejects the promise with that plain object already deserialized — hence `err as { message?: string }`, never `JSON.parse` |
| Button + pending pattern | `YourDataSettings.tsx:72-79`, `:103-111` | `<Button variant?  onClick disabled={…} aria-disabled={… \|\| undefined} data-testid>{pending ? t("…ing") : t("…Action")}</Button>`. No spinner; the label swaps |
| `Button` API | `packages/shared/src/ui/button.tsx` | `cva`-wrapped `@base-ui/react/button`. Variants `default \| outline \| secondary \| ghost \| destructive \| link`; sizes `default \| xs \| sm \| lg \| icon…`. **No `isPending`/loading prop** |
| `SettingRow` API | `components/settings/SettingRow.tsx:23-32` | `{ title: ReactNode; description?: ReactNode; control?: ReactNode; htmlFor?: string; className?: string; "data-testid"?: string }`. `control` omitted ⇒ statement-only row |
| `SettingsSection` API | `components/settings/SettingRow.tsx:8-21` | `{ heading: string; children: ReactNode }` — **no `data-testid` prop**; do not pass one |
| Toast | `sonner`, `import { toast } from "sonner"` | Repo-wide counts: 45 `toast.success`, 44 `toast.error`, 2 `toast.info`. Interpolation: `toast.success(t("sidebar.backupSaved", { path: result.path }))` (`YourDataSettings.tsx:27`) |
| Locale file shape | `locales/en.json`, `locales/fr.json` | **Flat** `"settings.key": "value"` maps, 1119 lines / 1117 keys each, **identical key sets and identical ordering** (verified). i18next `{{var}}` interpolation (`en.json:31`) |
| i18n hook | `YourDataSettings.tsx:2,16` | `import { useTranslation } from "react-i18next"; const { t } = useTranslation();` |
| i18n parity test | `locales/__tests__/danger-zone-i18n.test.ts:1-56` | The template to copy: flat `Record<string, string>` cast, `REQUIRED_KEYS as const`, `it.each`, prefix-symmetry test, `{{word}}` placeholder-retention test |
| Hook unit-test harness | `hooks/__tests__/useTrendsInsight.test.tsx:1-112` | `vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a) => invokeMock(...a) }))`, `globalThis.IS_REACT_ACT_ENVIRONMENT = true`, `createRoot` + `act` from `react-dom/client`/`react`, `QueryClientProvider` with `retry: false`. **`@testing-library/react` is NOT a desktop dependency** — do not import it |
| Playwright IPC mock | `tests/accessibility.spec.ts:10-80` | Leanest full-boot mock: `transformCallback: () => 1` (without it every `event.listen()` throws), `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`, `if (cmd.startsWith("plugin:")) return Promise.resolve(null)`, then `switch (cmd)` with `check_onboarding_status`, `get_db_status`, budget/account/asset getters, `default: Promise.reject(...)` |
| Frontend dialog mock (do **not** copy) | `tests/import.spec.ts:50` | `if (cmd === "plugin:dialog\|open") return Promise.resolve("/tmp/statement.png")` — applies only to the frontend-opened picker; irrelevant here (§Conflict C) |
| Settings sub-route | `routes/settings.ai-provider.tsx:17-33,44-64` | Four sub-surfaces are `?section=general\|reading\|data\|about` search params on **one** route. `/settings` → redirects to `/settings/ai-provider` (`settings.index.tsx`). Your Data URL: **`/settings/ai-provider?section=data`**; nav testid `settings-nav-data`; root testid `settings-your-data` (`YourDataSettings.tsx:52`) |
| Modal primitive (if ever needed) | `components/settings/DangerZone.tsx:7-20,181-239` | `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter` from `@nixus/shared`. **`AlertDialog` does not exist anywhere in this repo.** This story needs none (§Conflict E) |

### Scope Boundary vs. Stories 25.2 / 25.3 (binding)

Epic Stories 25.2 and 25.3 nominally claim `hooks/useBudgetTemplates.ts` and the `YourDataSettings.tsx` Templates wiring, while 24.2's binding scope note assigns the import hook, the TS types, the Settings button, the toast copy, the locale strings, and `tests/budget-templates.spec.ts` to **this** story. Both cannot own them.

**Resolution — this story owns the file-based half of the Templates surface; Story 25.3 owns only the system-template half:**

| Item | Owner |
|---|---|
| `hooks/useBudgetTemplates.ts` **created**, with `useImportBudgetTemplate` + `useExportBudgetTemplate` | **24.4** |
| `ApplyBudgetTemplateResult` in `lib/types.ts` | **24.4** |
| `export` on `invalidateTrendsQueries` | **24.4** |
| "Save as template" + "Open a template" rows/buttons/toasts/errors in `YourDataSettings.tsx` | **24.4** |
| The 14 `settings.template*` i18n keys; deletion of the two `templatesUnavailable*` keys | **24.4** |
| `tests/budget-templates.spec.ts`, `budget-templates-i18n.test.ts`, `useBudgetTemplates.test.tsx` | **24.4** |
| `useSystemTemplates()` + `useApplySystemTemplate()` **appended to** the existing `useBudgetTemplates.ts` | 25.2 |
| `SystemBudgetTemplateSummary` in `lib/types.ts`; `queryKeys.systemBudgetTemplates` in `constants.ts` | 25.2 |
| Starter-template **picker** row in the same Templates section + its apply toast | 25.3 |
| Onboarding fork starter-template path | 25.4 |

**Why the export button lands here rather than in 25.3:** Epic AC 24.3 #1 requires the export to be triggerable "from the Settings 'Templates' section" and #3 requires a success toast — Story 24.3 scoped itself to the Rust backend and deferred both. 24.4 is the **final story in Epic 24**, so leaving them undone would close the epic with two of its own acceptance criteria unmet and an export command no user can reach. Wiring both buttons at once also avoids editing the same eight lines twice and prevents an incoherent intermediate state where the section's copy half-contradicts itself. **Story 25.3 must therefore treat its "Export as template / Import template buttons are enabled and wired" AC as already satisfied and add only the starter-template picker.**

### Out of Scope (later stories)

| Item | Story |
|---|---|
| `useSystemTemplates`, `useApplySystemTemplate`, `queryKeys.systemBudgetTemplates`, `SystemBudgetTemplateSummary` | 25.2 |
| Starter-template picker UI + its toasts | 25.3 |
| Onboarding fork starter-template path, editable pre-filled targets | 25.4 |
| Any Rust change (commands, validation, dialogs, `SYSTEM_TEMPLATES`, `template_defaults.rs`) | 24.1–24.3 (done) / 25.1 |
| Mapping the four canned Rust messages to i18n keys | Deferred — flag at UX review; they ship as returned |
| Letting the user **name** the exported template (hardcoded `"My Budget"` today) | Deferred (24.3 §Out of Scope) |
| Import preview / dry-run confirmation | Decided **against** here (§Conflict E); revisit only if UX review overrides |
| A `playwright`/`e2e` npm script | Not this story — none exists; run via `pnpm exec playwright test` |
| New migration / `budget_templates` table | Never (Decision 1) |

### Naming Collision Warning

`lib/types.ts` and the Rust `models/mod.rs:351-361` already carry `RecurringExpenseTemplate` (a recurring monthly expense rule — `merchant`, `amount_cents`, `budget_category_id`, `day_of_month`), and `constants.ts:42` defines `queryKeys.recurringTemplates: ["recurring-templates"]`. **Unrelated concept.** Never introduce a bare `Template` type or a `queryKeys.templates` entry, and never touch `hooks/useRecurringExpenses.ts`. Every new identifier here is `BudgetTemplate`/`budgetTemplate`/`settings.template*`-prefixed. [Source: architecture § Technical Constraints]

### Project Structure Notes

- Monorepo: pnpm workspaces, scope **`@nixus/`**. Desktop is `apps/desktop` (`@nixus/desktop`); shared UI is `@nixus/shared`
- Hooks live in `apps/desktop/src/hooks/`, **one file per feature domain exporting several hooks** (21 files today; `useBudget.ts` alone exports 9). `useBudgetTemplates.ts` is a new domain file — correct per architecture § Frontend Architecture and consistent with the convention; do **not** append these hooks to `useBudget.ts`
- Always use the `@/` alias (`@/hooks/…`, `@/lib/…`), never relative `../../`
- `routeTree.gen.ts` is generated — never edit it. This story adds no route
- Vitest specs live in `__tests__/` subfolders under `src/` (`include: ["src/**/*.test.{ts,tsx}"]`); Playwright specs live flat in `apps/desktop/tests/` (22 today, none named `budget-templates.spec.ts`, none covering the Your Data tab)
- Money is `number` cents with a `_cents` suffix; never format in the hook — `useFormatCurrency` exists for display, and this story displays **no** amount
- Build/verify: `pnpm --filter @nixus/desktop build` (`tsc && vite build`), `pnpm --filter @nixus/desktop test` (Vitest), `pnpm exec playwright test` from `apps/desktop/`

### Previous Story Intelligence (24.1 → 24.3)

All three predecessors are `ready-for-dev`, **not verified code** — treat their contents as specification and re-check the real signatures (Task 0). Carry-forwards that shape this story:

- **The cancel contract is settled twice over.** 24.2 §Conflict A and 24.3 §Conflict B both resolved to `Result<Option<T>, AppError>` + `Ok(None)` on cancel, precedented by `commands/backup.rs::export_backup`. The frontend contract is therefore `T | null` and a silent early return — never an `Err`, never a `boolean`.
- **Every category an import creates lands at $1.00.** 24.1 Conflict 1 sets `DEFAULT_TEMPLATE_TARGET_CENTS = 100`, and 24.2 AC #9 extends that to an explicit `target_cents: 0`. Amount-stripped community templates carry no targets, so *every* imported category starts at $1.00. `templateImportBody` states this up front so the user is not ambushed by a budget full of $1 targets.
- **Group collisions are case-insensitive and skip the whole group.** 24.1 AC #4 — no merge, no partial group. `skipped_groups` carries the names. This is what makes the operation safe enough to apply without a confirm dialog (§Conflict E) and what makes the all-skipped branch reachable (§Conflict D).
- **Re-importing your own export skips everything.** 24.3 §Schema Emitted by This Story. That is the exact scenario AC #11 / the second E2E test cover, and it is the round-trip the epic asked to E2E-test — verifiable through the UI without a real file, because both dialogs are Rust-side and the E2E mocks the command results.
- **Exactly one audit row per apply, written by the Rust `db/` primitive; none on export.** 24.1 AC #6, 24.2 AC #15, 24.3 §Conflict C. Nothing in the frontend logs or audits — do not add anything.
- **The four canned messages are fixed strings.** `MSG_INVALID_FILE`, `MSG_VERSION_TOO_NEW`, `MSG_NOTHING_TO_EXPORT`, `MSG_EXPORT_NOT_PORTABLE`. The E2E asserts two of them verbatim; copy them from 24.2/24.3 (or from the Rust source once it exists), never retype from memory.
- **Scope-creep tripwire, inherited from 23.1 and repeated by 24.1/24.2/24.3, inverted for this story:** they said "if you find yourself editing anything under `apps/desktop/src/`, stop." Here the rule flips — **if you find yourself editing anything under `apps/desktop/src-tauri/`, stop.**

### Recent Commit Context

`git log --oneline -8`: `1bc5427 fix(trends): show friendly fallback instead of raw error on AI insight failure`, `9cadcad fix: AI chat layout + version bump to 0.3.1`, `ea5d9f8`/`f86f300 feat(ui): Implement new UI/UX`, `1e9560e feat(ui): Small improvements`, `ea8f35f chore: bump version to 0.2.8`, `0081d17 fix: where you can't delete a category due to past spending`, `e758710 fix(budget): show actionable errors when category delete is blocked`.

Two of these are direct precedent for this story's error UX: `e758710`/`0081d17` made budget errors **actionable and user-facing** rather than swallowed, and `1bc5427` established "friendly canned copy instead of raw error text" — which is exactly the division of labour here (canned Rust copy in the Alert; a generic i18n fallback only when the error object carries no message). The `feat(ui)` pair is what produced the current `SettingsSection`/`SettingRow`/`SegmentedNav` shape of the settings page — follow it, do not restyle it.

`git status --short` at story creation: `M _bmad-output/implementation-artifacts/deferred-work.md` plus untracked planning/story artifacts. **No source changes pending, and no template code exists in history — this is greenfield. Do not commit anything.**

### Latest Tech Information

- **TanStack Query 5.90.21.** `useMutation` returns `isPending` (not the v4 `isLoading`); `mutateAsync` rejects so the existing try/catch shape works unchanged. `invalidateQueries({ queryKey })` matches by **prefix** by default — that is what makes `["budget-status"]` and `["budget-categories"]` correct without exact args. `onSuccess` runs before `mutateAsync` resolves, so the toast in the handler always fires after invalidation is queued.
- **React 19.1.0 + `@tauri-apps/api ^2.11.0`.** `invoke` is `Promise`-based and rejects with the deserialized `AppError` object.
- **sonner 2.0.7** — `toast.success` / `toast.error` / `toast.info`. The `<Toaster />` is already mounted by the app shell; Playwright asserts toasts with `page.getByText(...)` (see `tests/budget.spec.ts:380-381`).
- **Vitest 3.2.4 + jsdom 25**, `globals: true` (so `describe`/`it`/`expect` are ambient, though existing specs import them explicitly — do the same). `@testing-library/react` is only in `apps/web`; the desktop hook test drives React with `createRoot` + `act` directly.
- **Playwright 1.58.2**, config boots `pnpm run dev` on port 1420 and drives a **plain browser** — `window.__TAURI_INTERNALS__` must be injected via `page.addInitScript` before any Tauri code path runs, or every `invoke()` throws.
- **react-i18next 17.0.2 / i18next 26.0.3**, `{{var}}` interpolation, flat dotted keys.

### UX Note

No UX-DR covers budget templates — `ux-design-specification.md` predates the 2026-08-01 FR70 amendment, and architecture § Gap Analysis explicitly leaves the import-confirmation UX to story level. This story therefore makes the minimal, internally-consistent decision (§Conflict E: direct apply + result toast, description-as-warning, no preview) and **flags these five items for UX review** — implement as specified, do not block on the review:

1. **No preview/dry-run before applying.** Decided against for the reasons in §Conflict E; revisit if a "this will add 3 groups, skip 1" step is wanted (it would need a new Rust dry-run command).
2. **Every imported category lands at $1.00.** Disclosed in `templateImportBody`, but the first post-import budget screen will show a wall of $1.00 targets. Whether that needs a follow-up "set your targets" nudge is a product question.
3. **The four canned Rust messages are English-only**, surfaced verbatim in the Alert even in a French UI. Consistent with 24.1–24.3's precedent; 25.3 or a follow-up decides whether to map them to i18n keys.
4. **The exported template is always named "My Budget"** (24.3's `DEFAULT_EXPORT_TEMPLATE_NAME`); the user cannot title it.
5. **Errors use the page-level Alert, successes use a toast.** That asymmetry is this file's existing convention (`YourDataSettings.tsx:29`, `:45` vs `:27`, `:42`), deliberately preserved rather than "fixed" — an error the user must read should not auto-dismiss.

### References

- [Source: _bmad-output/planning-artifacts/epics-budget-templates.md — Epic 24 § Story 24.4 (all 6 ACs), § Story 24.3 (deferred export entry point), § Story 25.2/25.3 (scope boundary), Requirements Inventory § Additional Requirements (hook surface, invalidation set, i18n), § UX Design Requirements (UX gap + minimal-decision mandate)]
- [Source: _bmad-output/planning-artifacts/architecture-budget-templates.md — § Frontend Architecture (`useBudgetTemplates.ts`, invalidation set), § API & Communication Patterns (Rust-side dialogs, `ApplyBudgetTemplateResult` contract), § New Patterns (duplicate-group handling + result-toast example), § Project Structure & Implementation Map (Files to CREATE/MODIFY), § Gap Analysis (import-confirmation UX undecided → resolved here)]
- [Source: _bmad-output/implementation-artifacts/24-1-template-schema-models-core-apply-function.md — §Type Definitions (`ApplyBudgetTemplateResult` field names), §Constants (`DEFAULT_TEMPLATE_TARGET_CENTS = 100`), §Three Conflicts (1: $1.00 default), AC #4 (case-insensitive whole-group skip), AC #6 (single audit row)]
- [Source: _bmad-output/implementation-artifacts/24-2-import-validation-for-untrusted-template-files.md — §Conflict A (`Result<Option<T>>` + `Ok(None)` on cancel), §Scope Boundary vs. Story 24.4 (this story's ownership list), AC #1 (Rust-side `blocking_pick_file`, `json` filter), AC #15 (one audit row), §Latest Tech Information]
- [Source: _bmad-output/implementation-artifacts/24-3-export-current-budget-as-shareable-template.md — AC #8/#10/#11 (`BudgetTemplateExportResult { path }`, `Ok(None)` on cancel), AC #12 (export writes nothing), §Conflict B, §Two Facts That Contradict the Planning Docs (no scaffolded buttons), §Schema Emitted by This Story (self-reimport skips everything), §UX Note (Playwright dialog advice — corrected in §Conflict C)]
- [Source: _bmad-output/planning-artifacts/prd.md:600 — FR96; :532 FR70; :533 FR71; :626 NFR11; :628 NFR13]
- [Source: docs/project-context.md — §2 Tauri IPC (`invoke<T>("cmd", { snake_case })`), §5 `AppError` serialized shape, §6 TanStack Query keys + mandatory invalidation, §7 TS strictness (`noUnusedLocals`), §8 check `@nixus/shared/ui` first, §9 warnings policy, §Hooks Pattern, §i18n, §Anti-Patterns; **§Testing Rules and the `@nkbaz/` scope are stale — see §Two Facts**]
- [Source: docs/guidelines/warnings.md — all compilation warnings must be resolved]
- [Source: apps/desktop/src/hooks/useBudget.ts:1-11,20-30,42-66,60-62,102-104,120-122,137-147 — `invoke` specifier, private `invalidateTrendsQueries`, mutation shape, zero-arg mutation precedent, raw `["budget-status"]` precedent]
- [Source: apps/desktop/src/lib/constants.ts:1-7,42,58 — `queryKeys` tuple-vs-factory shape, `budgetGroups`/`budgetCategories(id)`/`budgetStatus(y,m)`/`allBudgetCategories`, `recurringTemplates` collision, no `systemBudgetTemplates`]
- [Source: apps/desktop/src/lib/types.ts:1-24,111-125 — snake_case interface convention, budget cluster insertion point, 596 lines]
- [Source: apps/desktop/src/components/settings/YourDataSettings.tsx:1-13,17-49,52,60-64,72-79,91-92,103-111,118-120,135-146 — imports, `getErrorMessage`, backup/restore handler shape incl. cancel guard, `settings-your-data` testid, `your-data-error` Alert, Button + pending-label pattern, "warn before the picker" comment, the Templates block to replace]
- [Source: apps/desktop/src/components/settings/SettingRow.tsx:8-21,23-32,36-43 — `SettingsSection` and `SettingRowProps` APIs]
- [Source: apps/desktop/src/components/settings/DangerZone.tsx:7-20,181-239 — the only modal-confirm precedent (`Dialog`, not `AlertDialog`); not used by this story]
- [Source: packages/shared/src/ui/button.tsx — `Button` variants/sizes, no pending prop]
- [Source: apps/desktop/src/routes/settings.ai-provider.tsx:10-33,44-64,66-71 — `?section=` sub-surface routing, `settings-nav-data`/`settings-sub-nav` testids, `active === "data" && <YourDataSettings />`]
- [Source: apps/desktop/src/routes/settings.index.tsx:1-8 — `/settings` → `/settings/ai-provider` redirect]
- [Source: apps/desktop/src/locales/en.json:31-35,789-800 and fr.json:31-35,789-800 — flat dotted keys, `{{path}}` interpolation, `sidebar.backup*` toast namespace, exact insertion point, the two keys to delete; identical key sets/order verified]
- [Source: apps/desktop/src/locales/__tests__/danger-zone-i18n.test.ts:1-56 — i18n parity + placeholder-retention test template]
- [Source: apps/desktop/src/hooks/__tests__/useTrendsInsight.test.tsx:1-112 — hook unit-test harness (`vi.mock` of `@tauri-apps/api/core`, `createRoot`/`act`, `QueryClientProvider`)]
- [Source: apps/desktop/vitest.config.ts:1-15 — jsdom, `globals: true`, `include: ["src/**/*.test.{ts,tsx}"]`, `@` alias]
- [Source: apps/desktop/playwright.config.ts — `testDir: './tests'`, `webServer: pnpm run dev` on port 1420, `baseURL http://localhost:1420`]
- [Source: apps/desktop/tests/accessibility.spec.ts:1-80 — `setupTauriMock` to adapt: `transformCallback`, `plugin:` → null, boot-command switch]
- [Source: apps/desktop/tests/import.spec.ts:9-50,115-117 — per-spec local mock convention, `plugin:dialog|open` stub (deliberately NOT copied), `__TAURI_INVOKE_LOG__` arg-capture idiom]
- [Source: apps/desktop/tests/budget.spec.ts:374-381 — Playwright toast assertion via `page.getByText`]
- [Source: apps/desktop/package.json — scope `@nixus/desktop`, `"build": "tsc && vite build"`, `"test": "vitest run"`, `@playwright/test` devDep with no script; sonner 2.0.7, TanStack Query 5.90.21, react-i18next 17.0.2, Vitest 3.2.4, no `@testing-library/react`]
- [Source: apps/desktop/src-tauri/src/error.rs:62-67 — `AppError::File` → `{ "type": "file", "message": "…" }`]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `pnpm` / `node` are not on the default shell `PATH` on this machine; every JS command was run with `export PATH="/opt/homebrew/bin:$PATH"` (node v25.2.1, pnpm 10.33.0).
- `_bmad/scripts/resolve_customization.py` was not invoked; the skill's documented manual merge fallback was used (no `_bmad/custom/bmad-dev-story*.toml` overrides exist).
- One TS error surfaced on the first `tsc` pass: `let invalidateSpy: ReturnType<typeof vi.spyOn>` widened `mock.calls` to `unknown[]`, which is not assignable from `QueryClient["invalidateQueries"]`'s generic signature. Fixed by annotating with `MockInstance<QueryClient["invalidateQueries"]>` (imported as a type from `vitest`), which also let `call[0]?.queryKey` be read without a cast. No `as any` / `@ts-ignore` was used.

### Completion Notes List

**Task 0 — prerequisite verification (all three predecessors confirmed present in code, not just spec):**

- `lib.rs:103-104` registers `commands::budget_template::import_budget_template` and `…::export_budget_template`.
- `models/mod.rs:68-72` — `ApplyBudgetTemplateResult { groups_created: i32, categories_created: i32, skipped_groups: Vec<String> }`. Field names match the story's assumption **exactly**, so `lib/types.ts` mirrors them 1:1 with `number` / `string[]`.
- `commands/budget_template.rs:24-26` — `import_budget_template(app_handle: AppHandle) -> Result<Option<ApplyBudgetTemplateResult>, AppError>`; `:71-74` — `export_budget_template(app_handle) -> Result<Option<BudgetTemplateExportResult>, AppError>` with `BudgetTemplateExportResult { path: String }` (`:11-14`). **Both are `Option`, so both TS types keep `| null`. No deviation.**
- Both dialogs are Rust-side (`blocking_pick_file` `:34`, `blocking_save_file` `:99`), confirming §Conflict C: the Playwright spec stubs no `plugin:dialog|*` command.
- `db/budget_template.rs:30` — `DEFAULT_TEMPLATE_TARGET_CENTS: i64 = 100`, so the `$1.00` / `1,00 $` figure in `templateImportBody` is correct as written in both locales; no copy correction needed.
- The four canned messages were copied verbatim from `db/budget_template.rs:40-46` rather than retyped from memory. `MSG_INVALID_FILE` / `MSG_VERSION_TOO_NEW` are still module-private `const`s and **were deliberately left private**: this story needed no Rust change, because the Playwright mock supplies the strings as literals on the reject path. Making them `pub` would have been a scope violation of Critical Rule #1 for zero benefit.
- `grep -rn "templates-unavailable\|templatesUnavailable"` found references only at `YourDataSettings.tsx:141-143` and `en.json`/`fr.json:795-796` — **no test referenced them**, so removing them broke nothing.

**Decisions made (all follow the story's binding resolutions; none re-derived):**

- Invalidation uses `queryKeys.budgetGroups` plus the raw prefixes `["budget-categories"]` and `["budget-status"]`, then `invalidateTrendsQueries(queryClient)` (§Conflict A). `constants.ts` was **not** touched — no `budgetStatusAll`/`budgetCategoriesAll` entries added.
- `invalidateTrendsQueries` gained only the `export` keyword (§Conflict B). `git diff` on `useBudget.ts` is exactly 1 line changed (`2 +-`).
- Direct apply + result toast; no preview, no confirm `Dialog`, no `Alert variant="caution"` (§Conflict E).
- Three import branches, with `toast.info` for the all-skipped case (§Conflict D).
- `busy = saving || restoring || exportTemplate.isPending || importTemplate.isPending` replaced the two existing `saving || restoring` expressions, so all four controls on the page are mutually exclusive (AC #8). An E2E test asserts this directly rather than trusting the expression.

**Deliberate additions beyond the letter of the task tables (both additive, neither contradicts an AC):**

1. The Playwright spec has **8** tests instead of the table's 6. Two were added because the ACs assert behaviour the table left uncovered: `export cancel → silent` (AC #12's second clause — the table only covered the import cancel) and `import in flight → backup/restore/export all disabled` (AC #8's mutual-exclusion clause, otherwise verified by nothing).
2. `CommandOutcome` in the spec carries an optional `delayMs`. Both cancel tests use it to make the pending window observable, so the "no toast appeared" assertions run *after* the only moment a toast could have fired instead of racing it — and the same delay proves the AC #8 label swap (`Opening…` → `Open a template`, `Saving…` → `Save as template`) rather than asserting an unobservable state.

**Real verification output:**

| Command | Result |
|---|---|
| `pnpm --filter @nixus/desktop build` (`tsc && vite build`) | **Pass** — zero TS errors/warnings; `✓ built in 14.08s`. The only console note is Vite's pre-existing `chunks are larger than 500 kB` advisory (bundle was already 1.8 MB before this story; not a TS warning) |
| `pnpm --filter @nixus/desktop exec tsc --noEmit` | **Pass** — no output |
| `pnpm --filter @nixus/desktop test` (Vitest) | **51 passed / 51, 6 files** (4 pre-existing files + 2 new: 21 i18n cases + 4 hook cases). Pre-story total was 26 tests across 4 files |
| `pnpm exec playwright test tests/budget-templates.spec.ts` | **8 passed** (16.8s) |
| `pnpm exec playwright test` (full suite) | **316 passed, 1 failed** — see pre-existing failure below |
| `cargo check --all-targets` | **Pass**, 0 warnings |
| `cargo clippy --all-targets -- -D warnings` | **Pass**, 0 warnings (sources `touch`ed first to defeat the clippy cache) |
| `cargo test` | **241 passed, 0 failed** — identical to the stated 24.3 baseline, as required by AC #19 (`rollback_leaves_no_rows`, `export_json_strips_all_amounts`, `export_json_round_trips_through_apply` all still green and untouched) |

**Pre-existing, unrelated Playwright failure — not introduced by this story:**

`tests/chat.spec.ts:250 › money in an answer is tabular Inter, never monospace [AC4]` fails asserting `font-variant-numeric` is `tabular-nums` on a chat money `<p>` (received `normal`). It reproduces in isolation (`playwright test tests/chat.spec.ts` → 21 passed, same 1 failed). It cannot be caused by this story: `git diff --stat` over `apps/desktop/src/components/chat`, `…/components/ai`, `packages/shared`, `apps/desktop/src/index.css` and `…/src/styles` is **empty** — the only modified frontend files are this story's five, none of which is in that test's render path. Most likely drift from the `feat(ui)` / `fix: AI chat layout` commits noted in §Recent Commit Context. Left untouched: fixing it would be an out-of-scope edit to the chat surface.

**Scope confirmations:**

- **Zero Rust changes.** Nothing under `apps/desktop/src-tauri/**` was edited (the `M` entries there are stories 24.1–24.3's pre-existing uncommitted work, left exactly as found; `touch` altered mtimes only, to force clippy re-analysis).
- Untouched as required: `lib/constants.ts`, `apps/web/**`, `packages/shared/**`, `routeTree.gen.ts`, every other file in `components/settings/`, and `hooks/useBudget.ts` beyond the single `export` keyword.
- No epic-25 work: no `useSystemTemplates`, no `useApplySystemTemplate`, no `SystemBudgetTemplateSummary`, no `queryKeys.systemBudgetTemplates`, no starter-template picker, no onboarding change.
- `git diff --stat` shows exactly the 9 paths the story specified, all under `apps/desktop/`.
- **Nothing was committed, staged, stashed, or reverted.**

### File List

Modified:

- `apps/desktop/src/lib/types.ts` — added `ApplyBudgetTemplateResult` after `BudgetCategoryStatus`
- `apps/desktop/src/hooks/useBudget.ts` — `invalidateTrendsQueries` is now exported (1 line)
- `apps/desktop/src/components/settings/YourDataSettings.tsx` — real Templates controls, two handlers, `busy` gating
- `apps/desktop/src/locales/en.json` — −2 `templatesUnavailable*`, +14 `settings.template*`
- `apps/desktop/src/locales/fr.json` — same keys, same order

New:

- `apps/desktop/src/hooks/useBudgetTemplates.ts`
- `apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts`
- `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx`
- `apps/desktop/tests/budget-templates.spec.ts`

## Change Log

- 2026-08-04: Story context created (ready-for-dev).
- 2026-08-04: Implemented the file-based Templates surface — `useBudgetTemplates.ts` hooks, `ApplyBudgetTemplateResult` type, exported `invalidateTrendsQueries`, two wired `SettingRow`s replacing the "not built yet" placeholder, 14 new / 2 deleted i18n keys in both locales, and three new specs (21 i18n + 4 hook Vitest cases, 8 Playwright E2E). Frontend only; zero Rust changes. Status → review.

