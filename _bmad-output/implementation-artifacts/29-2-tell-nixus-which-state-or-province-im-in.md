# Story 29.2: Tell Nixus which state or province I'm in

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user in a country with subdivisions,
I want to select my state, province, or region after choosing my country,
so that Nixus can apply guidance that varies within my country.

## Acceptance Criteria

1. **Given** I have selected a country that has subdivisions
   **When** I open the subdivision selector
   **Then** I see only that country's ISO 3166-2 subdivisions

2. **Given** I have selected a country with no subdivisions in the dataset
   **When** I look at the form
   **Then** the subdivision field is not offered

3. **Given** I have not selected a country
   **When** I look at the form
   **Then** the subdivision field is unavailable rather than showing a global list

4. **Given** I have selected a subdivision and then change my country
   **When** the country changes
   **Then** the subdivision selection is cleared in the same form update
   **And** I cannot submit a subdivision belonging to a previously selected country

5. **Given** a `subdivision_code` is submitted with no `country_code`
   **When** validation runs
   **Then** it is rejected as `AppError::Validation { field: "subdivision_code" }`

6. **Given** a `subdivision_code` is submitted that does not belong to the submitted `country_code`
   **When** validation runs
   **Then** it is rejected with the same field-scoped error

7. **Given** I am viewing the app in French
   **When** I open the subdivision selector
   **Then** names display `name_fr` where present and fall back to `name_en` otherwise

8. **Given** subdivisions are fetched for a country
   **When** the query key is inspected
   **Then** it is `["subdivisions", countryCode]` with `staleTime: Infinity`, so switching back to a previously viewed country makes no new call

## Tasks / Subtasks

- [x] **Task 1 — Add the `subdivisions_for` lookup to `apps/desktop/src-tauri/src/profile_store.rs` (AC: #1, #2, #7)**
  - [x] Story 29.1 already put the dataset loader in this file: `const ISO3166_JSON: &str = include_str!("../data/iso3166.json");`, `static ISO3166: OnceLock<Iso3166Dataset>`, and `pub(crate) fn dataset() -> &'static Iso3166Dataset`, plus `countries()` and `country_exists()`. **Reuse `dataset()`. Do not add a second `include_str!`, a second `OnceLock`, or a new `iso3166.rs` module** — 29.1 explicitly rejected a separate module and fixed `profile_store.rs` as the loader's home.
  - [x] Add one sibling accessor beside `countries()` / `country_exists()`, returning a **borrow** rather than a clone (the dataset already stores `Vec<Subdivision>`, so nothing needs copying until the IPC boundary):

    ```rust
    pub(crate) fn subdivisions_for(country_code: &str) -> &'static [Subdivision] {
        dataset()
            .countries
            .iter()
            .find(|c| c.code == country_code)
            .map(|c| c.subdivisions.as_slice())
            .unwrap_or(&[])
    }
    ```

  - [x] **An unknown country code yields an empty slice, not an error.** 29.1's dataset nests `subdivisions` under each country precisely so this is an index lookup rather than a filter over a flat 5,000-row list, and `#[serde(default)]` on `CountryEntry.subdivisions` means a subdivision-less country omits the key entirely and deserializes to an empty `Vec`. "No subdivisions" and "unknown country" are therefore the same shape — exactly what AC 2 and AC 3 need.
  - [x] Do not uppercase, slug, or otherwise transform the code — compare it to the dataset verbatim. `countries[].code` is uppercase ISO 3166-1 alpha-2 and the only producer of this argument is the country selector, whose values come from `get_countries`.
  - [x] `Subdivision` **already exists** in `apps/desktop/src-tauri/src/models/mod.rs` (29.1 added it — `code: String`, `name_en: String`, `name_fr: Option<String>` — because `CountryEntry` needs it to parse the dataset). Reuse it verbatim. **Do not add a second struct**, do not add fields, and do not add `#[serde(rename_all = "camelCase")]` — `maintenance/catalog.rs`'s `VehicleCatalogStatus` carries that attribute as a local exception that must not be copied (architecture "Format Patterns" explicit anti-pattern).
  - [x] `Subdivision` also already exists in `apps/desktop/src/lib/types.ts` (29.1 added `Country` and `Subdivision` with `code`, `name_en`, `name_fr?`). Reuse it; add no second mirror. Note `name_fr` is **optional** (`name_fr?: string`), not `string | null` — 29.1's generator omits the key entirely when there is no French name rather than emitting `null` or `""`.
  - [x] No new crate, no `Cargo.toml` change, no `.unwrap()` / `.expect()` outside `#[cfg(test)]`.

- [x] **Task 2 — Add the `get_subdivisions` command to `apps/desktop/src-tauri/src/commands/profile.rs` (AC: #1, #2, #7)**
  - [x] The file already exists (28.2 created it with `get_user_profile` / `save_user_profile`; 29.1 added `get_countries`). Append one command; do not restructure the file.
  - [x] Exact signature — **synchronous `pub fn`, not `pub async fn`**:

    ```rust
    #[tauri::command(rename_all = "snake_case")]
    pub fn get_subdivisions(country_code: String) -> Result<Vec<Subdivision>, AppError> {
        Ok(crate::profile_store::subdivisions_for(country_code.trim()).to_vec())
    }
    ```

  - [x] **It is deliberately NOT session-gated.** Do **not** call `crate::commands::auth::current_subject()`, do not take `app: AppHandle`, and do not take `state: State<DbState>`. The ISO 3166 list is not user data (architecture Correction 2: *"Both are synchronous, non-session-gated (the ISO list is not user data), and read from the same embedded dataset"*). That is also why it can be `pub fn` — there is no token refresh to await, unlike `get_user_profile` / `save_user_profile`. It mirrors `get_countries`, which 29.1 built the same way.
  - [x] The command **orchestrates only** — the lookup lives in the store (project rule 3; architecture "Pattern Examples"). No `include_str!` here, no iteration over the dataset here, no filtering here.
  - [x] **Ordering: return the dataset's order and sort in the frontend.** 29.1 fixed this split — the generator emits `countries` and each country's `subdivisions` sorted ascending by `code` for diff stability, and 29.1's `COUNTRY_OPTIONS` re-sorts by *resolved display label* with `new Intl.Collator(i18n.language)` because "sorted for browsing" is a locale-dependent display concern. Do not sort in Rust and do not introduce a second ordering convention.
  - [x] Returns `Ok(Vec::new())` for an unknown or blank code — never an `Err`. This is a display read, not a validation gate; the authority is `save_profile` (Task 3). An `Err` here would raise a toast for a condition the UI must render as "field not offered", and a profile document carrying a stale country code would brick the form instead of degrading.
  - [x] Register it in `apps/desktop/src-tauri/src/lib.rs`'s `tauri::generate_handler!`, appended to the `commands::profile::*` block that 28.2 and 29.1 established after `commands::auth::sign_out,` (lib.rs:271): `commands::profile::get_subdivisions,`. Every new command must be registered in `lib.rs` (project rule 2) — an unregistered command fails at runtime as an unknown-command rejection, not at compile time.
  - [x] Do **not** implement `get_location_catalog`. It is superseded by `get_countries` + `get_subdivisions` and must not exist (architecture "Corrections to Prior Decisions", Correction 2).

- [x] **Task 3 — Add `subdivision_code` cross-validation to `apps/desktop/src-tauri/src/profile_store.rs` (AC: #4, #5, #6)**
  - [x] Validation lives in the **store**, not in `commands/profile.rs` (architecture "Validation placement"; project rule 3's `commands/` → data-layer separation).
  - [x] Write the rule as a **pure** function that receives the candidate subdivisions as a parameter, so its tests are deterministic and independent of dataset churn:

    ```rust
    fn validate_subdivision_code_against(
        country_code: Option<&str>,
        subdivision_code: Option<&str>,
        subdivisions_for_country: &[Subdivision],
    ) -> Result<Option<String>, AppError>
    ```

    The purity precedent is `apps/desktop/src-tauri/src/commands/auth.rs:499`, whose own comment reads *"`now_unix` is a parameter rather than an inner `Utc::now()` so this is pure."* Story 28.3 used the same shape for `birth_date`.
  - [x] Rules, **in this order** (the order is behaviour, not style):
        1. `subdivision_code` is `None`, or `Some(s)` with `s.trim().is_empty()` → `Ok(None)`. A subdivision is optional and clearing it is a legal save.
        2. `country_code` is `None`, or `Some(c)` with `c.trim().is_empty()` → `Err(AppError::Validation { message: "…", field: Some("subdivision_code".to_string()) })`. **AC 5.**
        3. `subdivisions_for_country.is_empty()` → `Err(…)` with `field: Some("subdivision_code")`. One branch covers both "this country has no subdivisions" and "this country code is unknown to the dataset".
        4. no entry whose `code` equals the trimmed `subdivision_code` → `Err(…)` with `field: Some("subdivision_code")`. **AC 6.**
        5. otherwise `Ok(Some(trimmed.to_string()))` — store the ISO 3166-2 code verbatim.
  - [x] Call it from the validation function Story 28.2 created, **after** 29.1's `country_code` check (29.1 Task 7: `if let Some(code) = input.country_code.as_deref() { if !country_exists(code) { … field: Some("country_code") } }`). Ordering matters: an invalid country must report `field: "country_code"`, not `"subdivision_code"`. Pass the lookup result straight through:

    ```rust
    let country = input.country_code.as_deref();
    let subs = country.map(subdivisions_for).unwrap_or(&[]);
    let subdivision_code =
        validate_subdivision_code_against(country, input.subdivision_code.as_deref(), subs)?;
    ```

  - [x] Match the field-error construction style of `apps/desktop/src-tauri/src/db/account.rs:117-146` exactly: `trim()` first, one `if` per rule with an early `return Err(...)`, `message` a plain English sentence, `field: Some("<snake_case field>".to_string())`, membership tested explicitly with `.any(...)` / `.contains(...)`.
  - [x] Reuse `AppError::Validation`. Introduce **no** new `AppError` variant (architecture D13).
  - [x] Add **no** SQLite migration, **no** table, **no** `db/profile.rs`, and **no** `insert_audit_log` call — a file-backed store has neither a `Connection` nor an `i64 entity_id` (architecture D2 / D10). `db/mod.rs`'s `MIGRATIONS` and `db/danger_zone.rs`'s `WIPE_TABLES` / `PRESERVED_TABLES` stay untouched.

- [x] **Task 4 — Rust unit tests in `profile_store.rs` (AC: #5, #6)**
  - [x] Extend the existing `#[cfg(test)] mod tests` in `apps/desktop/src-tauri/src/profile_store.rs` (inline module, established by 28.2 from the `db/backup.rs` pattern, extended by 28.3 and 29.1). Do not create a file under `src-tauri/tests/`.
  - [x] Build local fixtures so the pure validator's tests never depend on the 5,000-row bundled dataset:

    ```rust
    fn sub(code: &str, name_en: &str, name_fr: Option<&str>) -> Subdivision {
        Subdivision {
            code: code.to_string(),
            name_en: name_en.to_string(),
            name_fr: name_fr.map(str::to_string),
        }
    }

    fn ca_subs() -> Vec<Subdivision> {
        vec![sub("CA-QC", "Quebec", Some("Québec")), sub("CA-ON", "Ontario", None)]
    }

    fn us_subs() -> Vec<Subdivision> {
        vec![sub("US-NY", "New York", None), sub("US-CA", "California", None)]
    }
    ```

  - [x] **The four required cases:**
        1. **valid country + subdivision pair** — `validate_subdivision_code_against(Some("CA"), Some("CA-QC"), &ca_subs())` → `Ok(Some("CA-QC".to_string()))`
        2. **subdivision without country** — `(None, Some("CA-QC"), &[])` → `Err` with `field == Some("subdivision_code".to_string())`
        3. **subdivision belonging to a different country** — `(Some("US"), Some("CA-QC"), &us_subs())` → `Err` with `field == Some("subdivision_code".to_string())`
        4. **country with no subdivisions** — `(Some("VA"), Some("VA-01"), &[])` → `Err` with `field == Some("subdivision_code".to_string())`
  - [x] Plus these, each a distinct branch that would otherwise be untested: `(Some("CA"), None, &ca_subs())` → `Ok(None)`; `(Some("CA"), Some(""), &ca_subs())` → `Ok(None)`; `(None, None, &[])` → `Ok(None)`; `(Some("   "), Some("CA-QC"), &ca_subs())` → `Err` (a blank country is the same failure as no country).
  - [x] **Every failing case must assert the `field` is exactly `Some("subdivision_code")`** — a test that only asserts "is an error" passes with the wrong field and silently breaks AC 5, AC 6, and the form's field mapping.
  - [x] Add one `tempfile`-based round trip through `save_profile` / `load_profile` (`tempfile = "3"` is already a dependency — add nothing to `Cargo.toml`):
        - a real pair (`country_code: "CA"`, `subdivision_code: "CA-QC"`) persists as `"subdivision_code": "CA-QC"` in the JSON document and reads back unchanged;
        - a save with `subdivision_code: None` persists `"subdivision_code": null`;
        - a real mismatched pair (`country_code: "US"`, `subdivision_code: "CA-QC"`) is rejected by `save_profile` with `field == Some("subdivision_code")` **and no file is written or modified**.
        This is the only test that exercises the real bundled dataset through `subdivisions_for`, which is why it uses codes that certainly exist in ISO 3166-2.
  - [x] Add one test for the lookup itself: `subdivisions_for("CA")` is non-empty and every entry has a non-empty `name_en`; `subdivisions_for("ZZ")` is empty. This pairs with 29.1's `std::ptr::eq(dataset(), dataset())` test rather than repeating it.
  - [x] Run `cargo test` and `cargo clippy` in `apps/desktop/src-tauri` — zero warnings, all green (project rule 9).

- [x] **Task 5 — `queryKeys.subdivisions` + `useSubdivisions` (AC: #1, #3, #8)**
  - [x] `apps/desktop/src/lib/constants.ts`: add the parameterized key as a factory function inside `queryKeys`, beside the `profile` (28.2) and `countries` (29.1) entries:
        `subdivisions: (countryCode: string) => ["subdivisions", countryCode] as const,`
  - [x] That is the established shape for a parameterized key in this file — `constants.ts:50-53`:

    ```ts
      maintenanceVehicle: (vehicleId: number) =>
        ["maintenance", vehicleId] as const,
      maintenanceHistory: (vehicleId: number) =>
        ["maintenance-history", vehicleId] as const,
    ```

    with the multi-parameter variants at `constants.ts:57-58` (`vehicleModels: (make: string, year: number) => ["vehicle-catalog", "models", make, year] as const,`) and `constants.ts:13-14` (`expensesByMonth: (year: number, month: number) => ["expenses", year, month] as const,`). Flat, top-level, `as const`. Do **not** nest it under `profile` — the nested `auth.session` entry (constants.ts:62-64) is the outlier, not the convention.
  - [x] Never hardcode the key array in the hook — import `queryKeys` from `@/lib/constants` (project rule 6; `hooks/useAiConfig.ts` is the pre-existing outlier 29.1 already flagged as the pattern not to copy).
  - [x] `apps/desktop/src/hooks/useProfile.ts`: add `useSubdivisions` to the existing file (28.2 created it with `useUserProfile` / `useSaveUserProfile`; 29.1 added `useCountries`). `useProfile.ts` is the **sole** frontend module invoking the four profile commands — no component may call `invoke` for them directly (architecture "Component Boundaries").
  - [x] Exact shape, modelled on the dependent-query precedent `apps/desktop/src/hooks/useVehicleCatalog.ts:29-48`:

    ```ts
    export function useSubdivisions(countryCode: string | null | undefined) {
      const trimmed = countryCode?.trim() ?? "";

      return useQuery({
        queryKey: queryKeys.subdivisions(trimmed),
        queryFn: () =>
          invoke<Subdivision[]>("get_subdivisions", { country_code: trimmed }),
        enabled: trimmed.length > 0,
        // The dataset is embedded in the binary and cannot change while the app is running.
        staleTime: Infinity,
      });
    }
    ```

  - [x] `enabled: trimmed.length > 0` is what satisfies AC 3 at the network layer: with no country selected the query never runs, so there is no code path that could return a global list. It also handles 29.1's `""` sentinel — the country control stores `""` for "Not specified", so an unset country is a blank string, not `undefined`. `useVehicleModels` uses the same guard (`enabled: enabled && trimmedMake.length > 0 && yearValid`), and `useBudgetTemplates.ts:69` (`enabled: templateId !== ""`) is the same idea for a string parameter.
  - [x] `staleTime: Infinity` is mandatory and is half of AC 8 (architecture "Communication Patterns": *"`useCountries` / `useSubdivisions` use `staleTime: Infinity`. The dataset cannot change while the app is running; refetching it is pure waste."*). Do not use a finite `staleTime`, do not set `refetchInterval` / `refetchOnMount` / `refetchOnWindowFocus`, and do not set a `gcTime` short enough to evict the entry between country switches.
  - [x] The parameterized key is the other half of AC 8: because the country code is **in** the key, `["subdivisions","CA"]` and `["subdivisions","US"]` are independent cache entries, so returning to `CA` reads a still-fresh entry instead of refetching. A single `["subdivisions"]` key with the code passed only to `queryFn` would refetch on every switch *and* serve one country's list under another country's key.
  - [x] Do **not** add a `select`, a client-side filter, or any per-country filtering in the hook or the component. Rust returns only that country's subdivisions; the frontend ships no copy of the dataset and no second filter (architecture "Structure Patterns": single source of truth).

- [x] **Task 6 — Dependent subdivision `Select` in `apps/desktop/src/components/profile/ProfileForm.tsx` (AC: #1, #2, #3, #4, #7)**
  - [x] `ProfileForm.tsx` already exists (28.2), already uses `useForm<ProfileFormData>` with `snake_case` field names, already has `birth_date` (28.3), and already renders a `country_code` `Select` (29.1). This task adds one dependent field plus one line of cascade behaviour on the country field — nothing else.
  - [x] Add `subdivision_code: string` to `ProfileFormData`. The field name MUST be exactly `subdivision_code` — the `snake_case` IPC name — so `AppError::Validation { field }` maps to `setError(field)` with no translation table (architecture "Process Patterns").
  - [x] Default value / reset: include `subdivision_code: data?.subdivision_code ?? ""` in `defaultValues` and in the `reset({ … })` call 28.2 performs when the profile query resolves.
  - [x] **Take `subdivision_code` off Story 28.2's pass-through in `onSubmit`.** 28.2 forwards the fields it does not render straight from the loaded profile (`subdivision_code: data?.subdivision_code ?? null`) so that a full-replace save cannot silently clear them; 28.3 repointed `birth_date` and 29.1 repointed `country_code` the same way. It is now a rendered field, so its value must come from the form: `subdivision_code: data.subdivision_code.trim() || null`. Miss this one line and the selector appears to work while every save writes the old value back.
  - [x] Absent values are `null`, never `""` (architecture "Format Patterns"; 29.1: *"The `""` sentinel exists only inside the control; map it to `null` on submit"*). Hence `.trim() || null`.
  - [x] Drive the query from form state:
        `const countryCode = watch("country_code");`
        `const { data: subdivisions } = useSubdivisions(countryCode);`
  - [x] **Render the field only when the country actually has subdivisions.** One condition satisfies AC 1, AC 2 and AC 3 at once: no country → `enabled: false` → no data → not rendered; a country with no subdivisions → `Ok([])` → not rendered; a country with subdivisions → rendered with exactly that country's options.
        `const hasSubdivisions = (subdivisions?.length ?? 0) > 0;`
        Gate on the **data**, not on the built options array — the options array always contains the leading "not specified" entry and would never be empty.
  - [x] Do **not** render a disabled `Select`, a skeleton, an "N/A", or a loading placeholder in the empty case. AC 2 and AC 3 say the field is *not offered* / *unavailable*, not "present but inert" — and a placeholder would flash for a country that turns out to have none, since `get_subdivisions` is a synchronous in-memory lookup.
  - [x] **Cascade reset — inside the country field's `onValueChange`, in the same form update (AC 4).** 29.1's country `Controller` currently passes `field.onChange` straight through; wrap it:

    ```tsx
    <Controller
      name="country_code"
      control={control}
      render={({ field }) => (
        <Select
          value={field.value}
          onValueChange={(value) => {
            field.onChange(value);
            // Rust rejects a mismatched pair, but the UI must never let one be submitted.
            setValue("subdivision_code", "", { shouldDirty: true });
            clearErrors("subdivision_code");
          }}
          items={COUNTRY_OPTIONS}
        >
          {/* trigger + content unchanged from Story 29.1 */}
        </Select>
      )}
    />
    ```

    `clearErrors` is not optional polish: without it a stale `subdivision_code` message outlives the value it referred to. Destructure `setValue` and `clearErrors` from the existing `useForm(...)` call.
  - [x] **Do NOT implement the reset as `useEffect(() => setValue("subdivision_code", ""), [countryCode])`.** Two real failures: (a) an effect runs *after* the render that already re-enabled the submit path, so there is a window in which an invalid pair is submittable — AC 4 says "in the same form update"; (b) the effect also fires on mount and on the post-load `reset()`, wiping the persisted subdivision of a user who merely opened the page.
  - [x] The in-repo precedent is `apps/desktop/src/components/maintenance/VehicleCatalogFields.tsx:209-217` — the dependent value is cleared in the same handler that changes the parent, never in an effect:

    ```tsx
    const handleMakeSelect = (selected: string) => {
      onMakeChange(selected);
      onModelChange("");
    };

    const handleYearChange = (nextYear: string) => {
      onYearChange(nextYear);
      onModelChange("");
    };
    ```

  - [x] Build the options exactly the way 29.1 builds `COUNTRY_OPTIONS` — same fallback operator, same collator, same leading "not specified" entry — so the two location selects behave identically:

    ```tsx
    const SUBDIVISION_OPTIONS = useMemo(() => {
      const collator = new Intl.Collator(i18n.language);
      const options = (subdivisions ?? []).map((s) => ({
        value: s.code,
        // G6: FR coverage is incomplete by design; EN is the guaranteed non-empty field.
        label: i18n.language.startsWith("fr") ? (s.name_fr ?? s.name_en) : s.name_en,
      }));
      options.sort((a, b) => collator.compare(a.label, b.label));
      return [{ value: "", label: t("profile.subdivisionUnset") }, ...options];
    }, [subdivisions, i18n.language, t]);
    ```

  - [x] **Use `??`, not `||`, for the fallback** — matching 29.1's explicit instruction. 29.1's generator omits `name_fr` entirely when unavailable (never `null`, never `""`), so `undefined ?? name_en` is the complete and only case; a truthiness check would imply a `""` value the data contract forbids.
  - [x] Field markup:

    ```tsx
    {hasSubdivisions && (
      <div className="space-y-1.5" data-testid="profile-subdivision">
        <Label htmlFor={subdivisionId}>{t("profile.subdivision")}</Label>
        <Controller
          name="subdivision_code"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              items={SUBDIVISION_OPTIONS}
            >
              <SelectTrigger
                id={subdivisionId}
                data-testid="profile-subdivision-trigger"
                aria-invalid={!!errors.subdivision_code}
                aria-describedby={
                  errors.subdivision_code ? subdivisionErrorId : undefined
                }
              >
                <SelectValue placeholder={t("profile.subdivisionPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {SUBDIVISION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.subdivision_code && (
          <p id={subdivisionErrorId} className="text-caption text-over-ink">
            {errors.subdivision_code.message}
          </p>
        )}
      </div>
    )}
    ```

  - [x] `subdivision_code` is **optional**: no `required` on `Label`, no `aria-required`, and no `rules` on the `Controller` (the optional-field variant Story 28.3 established for `birth_date`). The `{ value: "", label: t("profile.subdivisionUnset") }` entry is how the user unsets it — a translated label, never a blank option, so G6's "never rendering blank" holds. Do not add a separate clear `Button`; 29.1 chose the explicit unset option for the country select and the two fields must not diverge.
  - [x] The `items` prop is not decoration: `packages/shared/src/ui/select.tsx:7-9` passes it through to `@base-ui/react`'s `Select.Root`, which is what lets `<SelectValue />` resolve the selected value to its **label** instead of its raw code. Pass the same array to `items` and to the `.map()` that renders `SelectItem`s, exactly as `AddAccountForm.tsx:156-171` does; `AddRecurringIncomeForm.tsx:96` is the precedent for building `items` from query data.
  - [x] **Extend Story 28.2's `onError` field allow-list to include `"subdivision_code"`.** 28.2 calls `setError(field, { message })` only for fields it recognizes and otherwise falls through to `toast.error(t("toast.saveFailed"))`; 28.3 added `"birth_date"` and 29.1 added `"country_code"`. Without `"subdivision_code"`, a Rust rejection under AC 5 / AC 6 surfaces as a generic toast with nothing marked on the field. Reuse 28.2's existing `getErrorMessage` reader (the shape from `apps/desktop/src/components/settings/CredentialsForm.tsx:23-36`) — do not add a second error reader.
  - [x] The allow-list is a guard against `setError` being called with a key absent from `ProfileFormData`; it is **not** a translation table. The `field` string is passed to `setError` unmodified — no renaming, no camelCase conversion, no message→i18n-key lookup. That identity mapping is why the form field name had to be `subdivision_code`.
  - [x] Import UI from the package root: `import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nixus/shared"` — never `"@nixus/shared/ui"`, never a local re-implementation (project rule 8). `useId()` for `subdivisionId` / `subdivisionErrorId`, matching the existing fields.
  - [x] Add **no** `invoke()` call to `ProfileMenu.tsx`, `TopBar`, or any always-mounted component (architecture D11 — this is what keeps every existing Playwright mock untouched; `docs/project-context.md:295`).

- [x] **Task 7 — i18n: field-label keys in BOTH locale files, plus the parity-suite declaration (AC: #1, #2, #7)**
  - [x] Add these three flat dotted keys to `apps/desktop/src/locales/en.json` **and** `apps/desktop/src/locales/fr.json` **in the same change**. Locale files are flat dotted-key JSON (not nested) and the keys extend the existing `profile.*` namespace (en.json:40-46) — do **not** introduce `userProfile.*` or `location.*`. They mirror 29.1's `profile.country` / `profile.countryPlaceholder` / `profile.countryUnset` trio one-for-one.

    | Key | en.json | fr.json |
    | --- | --- | --- |
    | `profile.subdivision` | `State, province, or region` | `État, province ou région` |
    | `profile.subdivisionPlaceholder` | `Select a state, province, or region` | `Sélectionner un état, une province ou une région` |
    | `profile.subdivisionUnset` | `Not specified` | `Non spécifié` |

  - [x] **These are field labels only. Subdivision NAMES are never i18n keys** — they come from the dataset's `name_en` / `name_fr` (architecture D8: *"Display names come from the dataset's EN and FR fields, not from i18n keys. Only the field labels are i18n keys — 5,000 hand-written translations would be untenable."*). Adding even one subdivision name to a locale file is a defect.
  - [x] `profile.subdivisionPlaceholder` is not optional polish: `subdivision_code` starts as `""`, and a trigger with no placeholder renders as a blank control in both locales.
  - [x] `profile.subdivisionUnset` may carry the same wording as `profile.countryUnset` but must be its own key — the parity suite asserts on the key set, and sharing one key across two controls would make a future divergence inexpressible.
  - [x] Reuse `common.save` (en.json:61), `toast.saveSuccess` (en.json:577) and `toast.saveFailed` (en.json:578) — all already exist in both locales. Add no duplicates, and add no i18n key for Rust validation messages; those are surfaced as returned, the way `getErrorMessage(err)` results already are in `YourDataSettings.tsx` and `DangerZone.tsx`.
  - [x] **REGRESSION TRAP — must be handled or CI fails.** `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` has a test named `"declares every profile key it ships"` (lines 61-68) asserting that the complete set of `profile.`-prefixed keys equals its `REQUIRED_KEYS` array (lines 9-18) exactly. Add all three new keys to `REQUIRED_KEYS`. A correctly-paired key that is not declared there fails CI just as surely as a one-sided key does.
  - [x] Do not add these to that file's `ARIA_LABEL_KEYS` or `PLACEHOLDER_KEYS` — none is an accessible-name-only string and none carries an `{{interpolation}}`. Do not add them to `ELLIPSIS_KEYS` — none is pending-state copy.
  - [x] Run `pnpm --filter @nixus/desktop test` and confirm `src/locales/__tests__/profile-i18n.test.ts` passes, **including** its `"has no profile key present in one locale but not the other"` assertion — the locale-parity suite fails CI on one-sided keys, which is why both files must change together.

- [x] **Task 8 — Playwright coverage in the existing profile spec (AC: #1, #2, #3, #4, #7, #8)**
  - [x] Extend the profile spec created by Stories 28.1 / 28.2 and extended by 29.1 (`apps/desktop/tests/profile.spec.ts`). Add a `case "get_subdivisions":` to **that spec's** Tauri mock switch only. No other spec needs a new case, because this story adds no `invoke()` to any always-mounted component (architecture D11) — if you find yourself editing a second spec, stop and re-check Task 6's last bullet.
  - [x] Mock data must include the FR-fallback case shaped like the real dataset — **omit** `name_fr` rather than sending `null`, because 29.1's generator omits the key entirely: for `CA`, `[{ code: "CA-QC", name_en: "Quebec", name_fr: "Québec" }, { code: "CA-ON", name_en: "Ontario" }]`; for `US`, two `US-*` entries; for a subdivision-less country (e.g. `VA`), `[]`.
  - [x] Specs to add, one per behaviour:
        1. **AC 1** — select a country with subdivisions → the subdivision field is visible and its options are exactly that country's codes plus the "not specified" entry; no `US-*` option appears while `CA` is selected.
        2. **AC 2** — select the subdivision-less country → `page.getByTestId("profile-subdivision")` has `toHaveCount(0)`.
        3. **AC 3** — on first load with no country saved → `profile-subdivision` has `toHaveCount(0)` **and** `window.__IPC_CALLS` contains **zero** `get_subdivisions` calls (proving `enabled` is false, not merely that the field is hidden).
        4. **AC 4** — select `CA`, pick `CA-QC`, then switch the country to `US`: the subdivision trigger shows the placeholder again, and pressing Save invokes `save_user_profile` with `subdivision_code: null`. Assert the invoke args, not just the visual state — the AC is about what can be submitted.
        5. **AC 8** — switch `CA` → `US` → `CA`, then read `window.__IPC_CALLS` and assert exactly **two** `get_subdivisions` calls with distinct `country_code` values. A third call means `staleTime` or the key is wrong.
        6. **AC 7** — with the app in FR, assert the `CA-ON` option renders `Ontario` (the EN fallback, `name_fr` absent) and `CA-QC` renders `Québec`, and that no option has an empty accessible name.
  - [x] `window.__IPC_CALLS` is the established recording mechanism: `apps/desktop/tests/auth.spec.ts:77-78` does `const ipcCalls: IpcCall[] = []; window.__IPC_CALLS = ipcCalls;` and pushes `{ cmd, args }` inside the mock (`auth.spec.ts:146`). Reuse it; do not invent a second counter.
  - [x] Remember the suite's shape: E2E runs against the plain Vite dev server on port 1420 with `window.__TAURI_INTERNALS__.invoke` stubbed per spec. There is no real IPC layer, so these specs assert wiring and behaviour, not Rust validation — AC 5 and AC 6 are proven by Task 4 only.

- [x] **Task 9 — Verification gates (AC: all)**
  - [x] `cargo clippy` and `cargo test` in `apps/desktop/src-tauri` — zero warnings, all tests green (project rule 9). Confirm the existing `catalog.rs`, `auth.rs`, and `profile_store.rs` tests (including 29.1's `std::ptr::eq(dataset(), dataset())` and `country_code` tests) still pass.
  - [x] `pnpm --filter @nixus/desktop build` (`tsc && vite build`) — zero TypeScript errors and zero warnings; `noUnusedLocals` / `noUnusedParameters` are CI failures (project rule 7).
  - [x] `pnpm --filter @nixus/shared typecheck` — zero errors. This story changes nothing in `packages/shared`, so a failure here means something was touched that should not have been.
  - [x] `pnpm --filter @nixus/desktop test` — Vitest, including the locale-parity suite.
  - [x] Playwright: the profile spec above, plus `tests/auth.spec.ts`, `accessibility.spec.ts`, `navigation.spec.ts`, `nav-qa.spec.ts` as the standing regression set for this feature.
  - [x] Audit by inspection: `src-tauri/migrations/` has no new file; `db/mod.rs`'s `MIGRATIONS` is unchanged; `db/danger_zone.rs`'s `WIPE_TABLES` / `PRESERVED_TABLES` are unchanged; no `insert_audit_log` call was added; `Cargo.toml` and every `package.json` dependency list is unchanged; `error.rs` gained no `AppError` variant; `rg 'include_str!' apps/desktop/src-tauri/src` returns exactly one `iso3166.json` hit; `rg 'get_location_catalog' apps/desktop` returns nothing; no URL literal, `fetch`, or `reqwest` call was added anywhere in the shipped path.
  - [x] Manual: sign in, open `/profile`, pick Canada → pick Quebec → Save → relaunch and confirm `CA-QC` round-trips. Change the country to the United States and confirm the subdivision clears in the same interaction; Save and confirm `"subdivision_code": null` in `app_data_dir/profiles/<sub>.json`. Switch to a country with no subdivisions and confirm the field disappears entirely. Switch the UI to French and confirm no option renders blank.
  - [x] Do **NOT** touch `_bmad-output/implementation-artifacts/sprint-status.yaml` — the orchestrator performs one consolidated update.

## Dev Notes

**Prerequisites.** This story depends on **Story 28.2** and **Story 29.1** only. Per the epic's forward-dependency check, `29.2 → 29.1`, and no later story is required.

Already in place when this story starts:

| From | Already exists — extend, do not recreate |
| --- | --- |
| 28.2 | `profile_store.rs` (`load_profile`, `save_profile`, `delete_all_profiles`, `profiles_dir`, `sub` charset validation, `cognito_sub` mismatch guard, `#[cfg(test)] mod tests` with `tempfile`), `json_store.rs`, `commands/profile.rs` (`get_user_profile`, `save_user_profile` with its seven flat scalar params including `subdivision_code`), `commands/auth.rs::current_subject()`, `UserProfile` / `UpdateUserProfileInput`, `hooks/useProfile.ts`, `components/profile/ProfileForm.tsx` (`useForm<ProfileFormData>`, post-load `reset`, explicit Save button, `onError` field allow-list, `getErrorMessage`), `queryKeys.profile`, `removeQueries` on identity change |
| 28.3 | `birth_date` field plus its pure validator, and the optional-field form variant (no `required`, no `aria-required`, no `rules`) |
| 29.1 | `src-tauri/data/iso3166.json` + `scripts/generate-iso3166.mjs` + the `generate:iso3166` package script; `Country`, `Subdivision`, `Iso3166Dataset`, `CountryEntry` in `models/mod.rs`; `ISO3166_JSON` / `OnceLock` / `dataset()` / `countries()` / `country_exists()` in `profile_store.rs`; `country_code` validation; `get_countries`; `queryKeys.countries`; `useCountries`; `Country` / `Subdivision` in `lib/types.ts`; the country `Select` in `ProfileForm.tsx` with its `Intl.Collator` sort, `??` FR→EN fallback and `""` unset sentinel; `profile.country` / `profile.countryPlaceholder` / `profile.countryUnset` |

**Do not re-create Story 29.1's work.** The ISO 3166 dataset, its JSON schema, its `_source` / `_source_retrieved_at` / `_generated_by` metadata, and `scripts/generate-iso3166.mjs` are 29.1's scope and are pre-existing here. Do not re-specify the schema, do not regenerate the file, do not run `generate:iso3166`, do not add a second `include_str!`, and do not add a second `OnceLock`. This story adds exactly one accessor (`subdivisions_for`) to the loader 29.1 built.

**Out of scope — do not implement any of this here.** `get_location_catalog` (superseded by Correction 2 — it must not exist). Income bracket, its currency, and their conditional validation (Story 29.3). Any TFSA calculation, limits table, `get_tfsa_accumulated_limit` command, or profile-surface TFSA panel (Epic 30). Delete-all coverage (28.4). The "Nixus Cloud" relabel (28.5). Any SQLite migration, table, `db/` module, or `insert_audit_log` call. Any runtime network call. Any new Rust crate, npm package, or `AppError` variant. Any change to `packages/shared`.

### Two guards, and both are required

Rust is the validation authority. `profile_store.rs` rejects a `subdivision_code` with no `country_code`, and a `subdivision_code` that does not belong to the submitted `country_code`, as `AppError::Validation { field: "subdivision_code" }`. That is the boundary the webview cannot bypass, and it is what AC 5 and AC 6 test.

The frontend cascade reset is **not** redundant belt-and-braces. The architecture states it outright: *"changing `country_code` clears `subdivision_code` in the same form update. A subdivision from a previously selected country must never survive a country change — `profile_store.rs` would reject it, but the UI must not allow the invalid state to be submitted in the first place."* Ship only the Rust guard and you get a form that looks fine, lets the user press Save, then throws a field error at them for a combination the UI itself constructed. Ship only the cascade reset and you get a validation hole reachable by any caller that is not this form. AC 4 covers the UI half; AC 5 and AC 6 cover the Rust half. A change that satisfies one and not the other fails this story.

The same two-layer posture governs availability: `enabled: trimmed.length > 0` means no country → no IPC call at all, and `subdivisions_for` returning an empty slice for an unknown code means a stale document degrades to "field not offered" rather than an error toast. Neither layer trusts the other's shape.

### What Story 29.1 shipped that this story extends

The loader lives in `profile_store.rs` — 29.1 fixed that decision explicitly and rejected a separate `iso3166.rs` module, because the store must read the dataset anyway to validate and because `commands/profile.rs` calling into the store preserves the "commands orchestrate only" separation:

```rust
const ISO3166_JSON: &str = include_str!("../data/iso3166.json");
static ISO3166: OnceLock<Iso3166Dataset> = OnceLock::new();

pub(crate) fn dataset() -> &'static Iso3166Dataset {
    ISO3166.get_or_init(|| {
        serde_json::from_str(ISO3166_JSON).unwrap_or_else(|e| {
            tracing::error!("Failed to parse bundled iso3166.json: {}", e);
            Iso3166Dataset { countries: Vec::new() }
        })
    })
}
```

The file model nests subdivisions under their country, with `#[serde(default)]` so a subdivision-less country simply omits the key:

```rust
pub struct CountryEntry {
    pub code: String,
    pub name_en: String,
    pub name_fr: Option<String>,
    #[serde(default)]
    pub subdivisions: Vec<Subdivision>,
}
```

29.1 recorded why: *"The nesting is deliberate: subdivisions live under their country so that Story 29.2's `get_subdivisions(country_code)` is an index lookup rather than a filter over a flat 5,000-row list."* `subdivisions_for` is that index lookup, and the nesting is also why `get_countries` never ships 5,000 rows to fill a 250-row select.

### The command shape to copy

`apps/desktop/src-tauri/src/commands/account.rs:41-48` is the canonical thin read command — no logic, `Result<T, AppError>`, straight through to the data layer:

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn get_accounts(state: State<DbState>) -> Result<Vec<Account>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    account_db::get_all_accounts(&conn)
}
```

`get_subdivisions` is that shape with every parameter removed except the one the caller supplies: no `DbState` (nothing SQLite), no `AppHandle` (nothing on disk — the dataset is in the binary), no session (the ISO list is not user data). `apps/desktop/src-tauri/src/commands/maintenance.rs:303-313` shows the same thinness for a non-SQLite catalog read and — relevantly — returns `Ok(vec![…])` from a source that may legitimately be empty rather than erroring:

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn get_vehicle_catalog_status(app: AppHandle) -> Result<VehicleCatalogStatus, AppError> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    Ok(catalog::get_catalog_status(&app_data_dir))
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_vehicle_makes(app: AppHandle) -> Result<Vec<VehicleMake>, AppError> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    Ok(catalog::get_cached_makes(&app_data_dir))
}
```

Registration in `lib.rs` is a flat list of paths inside `tauri::generate_handler!` (lib.rs:168-272), which currently ends:

```rust
            commands::maintenance::get_vehicle_catalog_status,
            commands::maintenance::get_vehicle_makes,
            commands::maintenance::get_vehicle_models,
            …
            commands::auth::start_login,
            commands::auth::handle_auth_callback,
            commands::auth::get_auth_session,
            commands::auth::sign_out,
        ])
```

Append `commands::profile::get_subdivisions,` to the `commands::profile::*` block that 28.2 and 29.1 added after `commands::auth::sign_out,`.

### The Rust validation style to match

`apps/desktop/src-tauri/src/db/account.rs` is the reference for both halves of Task 3 — module-top allow-lists and field-scoped rejection. The allow-lists (lines 6-17):

```rust
const VALID_ACCOUNT_TYPES: &[&str] = &[
    "chequing",
    "savings",
    "credit_card",
    "tfsa",
    "rrsp",
    "fhsa",
    "non_registered",
    "crypto",
];

const VALID_CURRENCIES: &[&str] = &["CAD", "USD"];
```

And the validation shape (lines 117-146):

```rust
pub fn insert_account(conn: &Connection, input: &CreateAccountInput) -> Result<Account, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Account name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    let institution = input.institution.trim();
    if institution.is_empty() {
        return Err(AppError::Validation {
            message: "Institution is required".to_string(),
            field: Some("institution".to_string()),
        });
    }

    if !VALID_ACCOUNT_TYPES.contains(&input.account_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid account type: {}", input.account_type),
            field: Some("account_type".to_string()),
        });
    }

    if !VALID_CURRENCIES.contains(&input.currency.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid currency: {}", input.currency),
            field: Some("currency".to_string()),
        });
    }
```

Reproduce that shape: `trim()` first, one `if` per rule with an early `return Err(...)`, `message` a plain English sentence, `field: Some("<snake_case field>".to_string())`, membership tested explicitly. The difference for subdivisions is that the allow-list is not a compile-time const but the dataset slice for the *selected country* — which is precisely what makes this a cross-field rule rather than a value rule, and precisely why the pure function takes that slice as a parameter instead of reaching for `dataset()` itself.

Test style comes from the same file (`db/account.rs:310-405`): inline `#[cfg(test)] mod tests { use super::*; … }`, one `#[test]` per behaviour, small local fixture builders, `.unwrap()` only inside tests.

### Error shape on the wire

`AppError::Validation` serializes flat (`apps/desktop/src-tauri/src/error.rs:41-50`):

```rust
AppError::Validation { message, field } => {
    let len = if field.is_some() { 3 } else { 2 };
    let mut map = serializer.serialize_map(Some(len))?;
    map.serialize_entry("type", "validation")?;
    map.serialize_entry("message", message)?;
    if let Some(f) = field {
        map.serialize_entry("field", f)?;
    }
    map.end()
}
```

So the frontend receives `{ "type": "validation", "message": "…", "field": "subdivision_code" }`, with `field` omitted entirely when `None`. Because the react-hook-form field name **is** the `snake_case` IPC name, `field` goes straight into `setError(field, { message })` — there is no mapping layer and none may be added. The rejected-`invoke` reader to reuse is `apps/desktop/src/components/settings/CredentialsForm.tsx:23-36`.

### The dependent-query precedent

`apps/desktop/src/hooks/useVehicleCatalog.ts:29-48` is the same problem already solved once in this codebase — a list that depends on another field's value, keyed by that value, gated by `enabled`:

```ts
export function useVehicleModels(
  make: string | null,
  year: number | null,
  enabled: boolean
) {
  const trimmedMake = make?.trim() ?? "";
  const yearValid =
    year !== null && !Number.isNaN(year) && year >= 1900 && year <= 2100;

  return useQuery({
    queryKey: queryKeys.vehicleModels(trimmedMake, year ?? 0),
    queryFn: () =>
      invoke<VehicleModel[]>("get_vehicle_models", {
        make: trimmedMake,
        year: year as number,
      }),
    enabled: enabled && trimmedMake.length > 0 && yearValid,
    staleTime: 30 * 60 * 1000,
  });
}
```

Two deliberate differences for `useSubdivisions`: no third `enabled` argument (there is no catalog-availability gate — the dataset is compiled in and always present, which is exactly the difference 29.1 called out between an embedded dataset and the fetch-and-cache vehicle catalog), and `staleTime: Infinity` rather than 30 minutes, because an embedded dataset cannot change while the process is running.

The corresponding key factories in `apps/desktop/src/lib/constants.ts` are the shape to follow — `constants.ts:57-58` and `constants.ts:50-53`:

```ts
  vehicleModels: (make: string, year: number) =>
    ["vehicle-catalog", "models", make, year] as const,
  …
  maintenanceVehicle: (vehicleId: number) =>
    ["maintenance", vehicleId] as const,
  maintenanceHistory: (vehicleId: number) =>
    ["maintenance-history", vehicleId] as const,
```

`queryKeys.subdivisions(countryCode) => ["subdivisions", countryCode] as const` is dictated verbatim by the architecture and by AC 8; do not rename the prefix and do not add a namespace segment.

### Why AC 8 is satisfied structurally rather than by a cache trick

Two one-line properties together produce "switching back to a previously viewed country makes no new call":

1. The country code is **part of the query key**, so TanStack Query stores `["subdivisions","CA"]` and `["subdivisions","US"]` as independent entries. Returning to `CA` looks up an entry that already exists.
2. `staleTime: Infinity` means that entry is never stale, so no background refetch fires on remount or window focus.

Drop either and AC 8 fails in a way manual testing cannot see — which is why Task 8 asserts on the recorded `get_subdivisions` call count rather than on what the user observes.

### The `Select` pattern to copy, and what `items` is for

`packages/shared/src/ui/select.tsx` is a thin wrapper over `@base-ui/react/select`. The root passes everything through (lines 7-9):

```tsx
function Select<Value>({ ...props }: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}
```

`SelectValue` (lines 34-36) is likewise a pass-through of `SelectPrimitive.Value`, which resolves the selected value to a **label** using the `items` array handed to the root. That is why every call site in this repo passes the same array twice — once as `items`, once through `.map()` to build the `SelectItem`s. `apps/desktop/src/components/accounts/AddAccountForm.tsx:150-174`:

```tsx
<div className="space-y-1.5">
  <Label htmlFor="account-type">{t("common.type")}</Label>
  <Controller
    name="account_type"
    control={control}
    render={({ field }) => (
      <Select
        value={field.value}
        onValueChange={field.onChange}
        items={ACCOUNT_TYPE_OPTIONS}
      >
        <SelectTrigger id="account-type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACCOUNT_TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )}
  />
</div>
```

Differences for `subdivision_code`: options come from query data rather than a module const (`AddRecurringIncomeForm.tsx:96` — `items={sources.map((s) => ({ value: String(s.id), label: s.name }))}`); the field is optional, so no `Label required`, no `aria-required`, no `rules`; the initial value is `""` so `SelectValue` needs a `placeholder`; and the whole block is conditional on the country actually having subdivisions. `SelectTrigger` already styles `aria-invalid` (select.tsx:20), so the error state needs no extra class.

`AddAccountForm.tsx:69` (`mode: "onBlur"`) and `AddAccountForm.tsx:96-101` (`noValidate` on the `<form>`) are conventions Story 28.2's `ProfileForm` already adopted — do not change them.

### EN fallback for missing French names (G6)

Architecture gap **G6**: *"No public ISO 3166-2 source provides FR names for every subdivision, so the dataset will have gaps — which would render as blank options in the FR locale, breaking NFR5 in practice rather than in principle. Resolved: the dataset carries `name_en` (required) and `name_fr` (optional); the frontend falls back to `name_en` when `name_fr` is absent."*

What this story must honour:

- The fallback lives in the **frontend**, in the one place options are built. Rust returns the raw dataset row with `name_fr` absent — it does not pre-fill EN into the FR field, which would hide the gap from the next dataset regeneration.
- Use `??`, exactly as 29.1's country options do. 29.1's generator *omits* `name_fr` entirely when unavailable — "never `null`, never `""`" — so `undefined ?? name_en` is the complete case set, and a truthiness check would imply a value the data contract forbids.
- `name_en` is non-optional in both the Rust struct and the TS mirror, so the resolved label can never be `undefined`. 29.1's dataset test already asserts every country's `name_en` is non-empty; Task 4 extends that assertion to the subdivisions of a real country.
- Never a blank option. The unset entry carries the translated `profile.subdivisionUnset` label, not an empty string — which is why no separate clear `Button` is needed and why a `SelectItem` with an empty label must not be introduced.
- No subdivision name goes into `en.json` / `fr.json`. Only the three field-label keys do.

### i18n mechanics

Locale files are **flat dotted-key JSON**, not nested. The `profile.*` namespace already exists (`en.json` / `fr.json` lines 40-46: `profile.signIn`, `profile.accountMenu`, `profile.loading`, `profile.signedInAs`, `profile.signOut`, `profile.sessionExpired`, `profile.sessionExpiredAction`) and has been extended by 28.2 (`profile.firstName`, `profile.lastName`, `profile.saving`), 28.3 (`profile.birthDate`, `profile.birthDatePlaceholder`, `profile.birthDateClear`) and 29.1 (`profile.country`, `profile.countryPlaceholder`, `profile.countryUnset`). Extend the same namespace; do not create `userProfile.*` or `location.*`.

`apps/desktop/src/locales/__tests__/profile-i18n.test.ts` enforces two things that matter here. The parity check (`"has no profile key present in one locale but not the other"`, lines 52-59) fails CI on any key present in only one file — the platform-wide i18n rule made machine-checked, and the reason `en.json` and `fr.json` must change in the same commit. The stricter trap is `"declares every profile key it ships"` (lines 61-68):

```ts
const declared = [...REQUIRED_KEYS].sort();

expect(profileKeys(en).sort()).toEqual(declared);
expect(profileKeys(fr).sort()).toEqual(declared);
```

so a correctly-paired key that is not added to `REQUIRED_KEYS` still fails. Add all three.

Rust validation messages are surfaced to the user as returned (English), matching how `getErrorMessage(err)` results are already displayed in `YourDataSettings.tsx` and `DangerZone.tsx`. Do not add i18n keys for them and do not build a code→key table; the generic fallback for non-field failures is the existing `toast.saveFailed`.

### Testing standards summary

- **Rust:** inline `#[cfg(test)] mod tests` in `profile_store.rs`; `tempfile` for the filesystem round trip (the `db/backup.rs` pattern 28.2 established); local fixture `Vec<Subdivision>` values for the pure validator so it is independent of dataset churn; one real-dataset test for `subdivisions_for`. `.unwrap()` only inside tests. `cargo clippy` warning-free (project rule 9).
- **Desktop unit (Vitest + jsdom):** locale-parity specs in `src/locales/__tests__/`; hook tests in `src/hooks/__tests__/`. There is no `@testing-library/react` in desktop — tests use `createRoot` / `act` directly — so cover the cascade behaviour in Playwright rather than in a component unit test.
- **Playwright:** `apps/desktop/tests/`, against the plain Vite dev server on port 1420 with `window.__TAURI_INTERNALS__.invoke` stubbed per spec (`docs/project-context.md:293-295`). Only the profile spec's mock switch gains a `get_subdivisions` case; no always-mounted component gains an `invoke()`, so no other spec's mock needs touching (architecture D11).
- **What E2E does NOT cover:** Rust validation. There is no real IPC in that suite, so AC 5 and AC 6 are proven only by Task 4. Do not "cover" them with a mock that rejects — that tests the mock.

### Project Structure Notes

Files this story touches, and nothing else:

| Path | Change |
| --- | --- |
| `apps/desktop/src-tauri/src/profile_store.rs` | MODIFIED — `+ subdivisions_for()` beside 29.1's `dataset()` / `countries()` / `country_exists()`; `+ validate_subdivision_code_against()` wired into the existing validation path; `+` unit tests |
| `apps/desktop/src-tauri/src/commands/profile.rs` | MODIFIED — `+ get_subdivisions` (synchronous, not session-gated) |
| `apps/desktop/src-tauri/src/lib.rs` | MODIFIED — register `commands::profile::get_subdivisions` |
| `apps/desktop/src/lib/constants.ts` | MODIFIED — `+ queryKeys.subdivisions(countryCode)` |
| `apps/desktop/src/hooks/useProfile.ts` | MODIFIED — `+ useSubdivisions(countryCode)` |
| `apps/desktop/src/components/profile/ProfileForm.tsx` | MODIFIED — dependent subdivision `Select`, cascade reset + `clearErrors` on the country field, `subdivision_code` off the 28.2 pass-through, `"subdivision_code"` added to the `onError` allow-list |
| `apps/desktop/src/locales/en.json` | MODIFIED — 3 new `profile.*` keys |
| `apps/desktop/src/locales/fr.json` | MODIFIED — same 3 keys, FR values |
| `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` | MODIFIED — 3 new keys added to `REQUIRED_KEYS` |
| `apps/desktop/tests/profile.spec.ts` | MODIFIED — `get_subdivisions` mock case + the six specs in Task 8 |

`models/mod.rs` and `lib/types.ts` are deliberately **not** in that list: Story 29.1 already added `Subdivision` on both sides (its dataset parse needs it), so this story consumes those types rather than defining them. If either is somehow missing, add it with exactly the 29.1 shape (`code`, `name_en`, `name_fr: Option<String>` / `name_fr?: string`) rather than inventing a variant.

Deliberately **not** touched: `apps/desktop/src-tauri/data/iso3166.json`, `apps/desktop/scripts/generate-iso3166.mjs`, and `apps/desktop/package.json`'s `generate:iso3166` entry (29.1's artefacts — pre-existing), `src-tauri/migrations/`, `db/mod.rs` `MIGRATIONS`, `db/danger_zone.rs`, `db/audit.rs`, `db/backup.rs`, `commands/auth.rs`, `commands/danger_zone.rs`, `credentials.rs`, `json_store.rs`, `maintenance/catalog.rs`, `error.rs`, `Cargo.toml`, every `package.json` dependency list, all of `packages/shared/`, `apps/desktop/src/routes/profile.tsx`, `routeTree.gen.ts`, `apps/desktop/src/components/auth/ProfileMenu.tsx`, `apps/desktop/src/hooks/useAuth.ts` (28.2 already removes `queryKeys.profile` on identity change and nothing about subdivisions alters that), `components/shared/AppSidebar.tsx`, `DestinationNav.tsx`, `lib/navigation.ts` (rule D8 — `/profile` stays outside the four-destination IA), every other `tests/*.spec.ts`, and `_bmad-output/implementation-artifacts/sprint-status.yaml`.

Naming alignment: `subdivision_code` is `snake_case` in the Rust model, in the stored JSON document, as the `save_user_profile` IPC parameter, and as the react-hook-form field name — one identifier end to end, which is what makes the `AppError::Validation { field }` → `setError(field)` mapping a no-op rather than a table. The i18n keys are camelCase after the dot (`profile.subdivision`), matching every existing key in the locale files; that is a separate namespace from field names and is not a variance. The query key `["subdivisions", countryCode]` is the architecture's literal specification.

Two variances worth recording. First, `subdivisions_for` is not named in the architecture — the architecture mandates `get_subdivisions(country_code)` and puts `country_code` / `subdivision_code` validation in `profile_store.rs`, but names no lookup helper. This story adds it as a `pub(crate)` sibling of 29.1's `countries()` / `country_exists()`, inside the module 29.1 already established as the loader's home, so the dataset stays behind one accessor set instead of being reached into from two files. Second, the "not specified" option is not in the architecture's delta tree; it is required because the field is optional and G6 forbids a blank option, and it reuses 29.1's `profile.countryUnset` pattern rather than 28.3's clear-`Button` pattern so the two location selects behave identically. Both variances are consistency-preserving rather than novel.

### References

- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 29.2: Tell Nixus which state or province I'm in] — the eight acceptance criteria, copied verbatim
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory] — FR2 (subdivision is a profile field), FR5 (first-class domain read; Canada logic gates on `country_code == "CA"`), NFR5 (EN/FR i18n; dataset EN/FR display names with EN fallback), NFR6 (zero new dependencies)
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements] — conditional validation rules in `profile_store.rs` (`subdivision_code` without `country_code` rejected; must belong to the selected `country_code`); `get_subdivisions` in the new IPC surface, registered in `lib.rs`; `queryKeys.subdivisions(countryCode) => ["subdivisions", countryCode]`; `useSubdivisions` with `staleTime: Infinity`; form field names are the `snake_case` IPC names and changing `country_code` clears `subdivision_code` in the same form update; models derive exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` with `snake_case` fields; dataset embedded via `include_str!` + `OnceLock`, never fetched at runtime, never a second frontend copy; no SQLite work; no audit logging; no new `AppError` variant; no new crate or npm package; Rust unit tests inline with `tempfile`; locale parity enforced by `src/locales/__tests__/`
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Epic 29: Location & Income Context] — epic scope: the `get_countries` / `get_subdivisions` pair, conditional validation, and the country→subdivision cascade reset
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)] — forward-dependency check: `29.2 → 29.1`; no story depends on a later story
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Corrections to Prior Decisions] — **Correction 2**: `get_countries()` and `get_subdivisions(country_code)` replace `get_location_catalog`; both synchronous, both non-session-gated, both reading the same embedded dataset; `get_location_catalog` is **not** implemented
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Data Architecture] — **D8**: `subdivision_code` is ISO 3166-2, validated against the subdivisions *of the selected country*, omitted for countries without subdivisions, and a subdivision without a country is `AppError::Validation { field: "subdivision_code" }`; display names come from the dataset, not i18n keys; all profile fields nullable
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Gap Analysis Results] — **G6**: `name_en` required, `name_fr` optional, frontend falls back to `name_en`, never rendering blank; **G1**: full-replace save semantics (`None` clears a field, which is why a cascade-cleared subdivision must be submitted as `null`)
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Implementation Patterns & Consistency Rules] — validation is server-authoritative and lives in `profile_store.rs`; form field names are the `snake_case` IPC names so `field` maps to `setError(field)` with no translation table; **cascade reset** (*"`profile_store.rs` would reject it, but the UI must not allow the invalid state to be submitted in the first place"*); absent values are `null`, never empty strings; dataset embedded in the Rust binary only; `useCountries` / `useSubdivisions` use `staleTime: Infinity`; no `.unwrap()` outside tests; the `catalog.rs` `camelCase` serde exception must not be copied
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Structure Patterns] — dataset at `src-tauri/data/iso3166.json`, `include_str!` plus a single `std::sync::OnceLock` parse; regeneration is a deliberate commit, never a build step and never a runtime fetch
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Project Structure & Boundaries] — delta tree and the "not touched, deliberately" list; `useProfile.ts` is the sole frontend `invoke` caller; D11 (no new `invoke` in always-mounted components); D13 (reuse existing `AppError` variants)
- [Source: _bmad-output/implementation-artifacts/29-1-tell-nixus-which-country-i-live-in.md] — the direct dependency. `dataset()` / `countries()` / `country_exists()` and the `include_str!` + `OnceLock` block live in `profile_store.rs` (an `iso3166.rs` module was explicitly rejected); `Country`, `Subdivision`, `Iso3166Dataset`, `CountryEntry` are already in `models/mod.rs`, with `Subdivision` added there precisely because `CountryEntry` needs it; `subdivisions` is nested under each country with `#[serde(default)]` so `get_subdivisions` is an index lookup, not a filter; `name_fr` is **omitted entirely** when unavailable (never `null`, never `""`); the generator sorts by `code` for diff stability while the UI re-sorts by resolved label with `new Intl.Collator(i18n.language)`; `COUNTRY_OPTIONS` uses `i18n.language.startsWith("fr") ? (c.name_fr ?? c.name_en) : c.name_en` and prepends `{ value: "", label: t("profile.countryUnset") }` with the `""` sentinel mapped to `null` on submit; `queryKeys.countries` and `useCountries` with `staleTime: Infinity`; `profile.country` / `profile.countryPlaceholder` / `profile.countryUnset`; and 29.1's own instruction that `get_subdivisions`, `useSubdivisions`, `queryKeys.subdivisions`, the subdivision `Select`, and `subdivision_code` cross-validation are all this story's scope
- [Source: _bmad-output/implementation-artifacts/28-2-record-my-name-so-its-remembered-next-time.md#Tasks / Subtasks] — the inherited surface: `save_user_profile`'s seven flat scalar parameters including `subdivision_code`; `useSaveUserProfile`'s invoke mapping; `useForm<ProfileFormData>` with `snake_case` field names and the post-load `reset({ … })`; `onSubmit`'s pass-through of unrendered fields as `data?.subdivision_code ?? null` (the line this story repoints at the form value); the `onError` field allow-list that must gain `"subdivision_code"`; the `getErrorMessage` reader; the mandatory `REQUIRED_KEYS` update
- [Source: _bmad-output/implementation-artifacts/28-3-record-my-date-of-birth-without-fighting-the-calendar.md] — the optional-field form variant (no `Label required`, no `aria-required`, no `rules`) and the pure-validator-with-injected-input test style reused here for the subdivision rule
- [Source: docs/project-context.md#Critical Implementation Rules] — rule 2 (`#[tauri::command(rename_all = "snake_case")]`, `Result<T, AppError>`, register in `lib.rs`, `invoke` arg names match Rust parameter names), rule 3 (`commands/` orchestrate only), rule 4 (models derive exactly, `snake_case` fields), rule 5 (`AppError` only), rule 6 (all query keys in `lib/constants.ts`), rule 7 (`noUnusedLocals` / `noUnusedParameters` are CI failures), rule 8 (check `@nixus/shared/ui` first; never duplicate a shared component), rule 9 (zero Rust/TS warnings before committing)
- [Source: docs/project-context.md#Testing Rules] — Vitest locale-parity specs; Playwright against the Vite dev server with `invoke` stubbed per spec; line 295's always-mounted-component mock trap
- [Source: docs/project-context.md#Anti-Patterns to Avoid] — hardcoded query keys in hooks; creating UI that already exists in `@nixus/shared/ui`; leaving compilation warnings
- [Source: apps/desktop/src-tauri/src/db/account.rs] — `const VALID_ACCOUNT_TYPES` / `VALID_CURRENCIES` module-top allow-lists (lines 6-17); `insert_account`'s field-scoped validation style (lines 117-146); inline `#[cfg(test)] mod tests` with local fixture builders (lines 310-405)
- [Source: apps/desktop/src-tauri/src/commands/account.rs] — thin read command `get_accounts` (lines 41-48) and flat scalar parameters on writes (lines 80-88)
- [Source: apps/desktop/src-tauri/src/commands/maintenance.rs] — `get_vehicle_catalog_status` / `get_vehicle_makes` (lines 303-313): synchronous non-SQLite reads returning `Ok(vec![…])` for a legitimately empty result
- [Source: apps/desktop/src-tauri/src/lib.rs] — `tauri::generate_handler!` list (lines 168-272), ending at `commands::auth::sign_out,` (line 271) where the `commands::profile::*` block belongs
- [Source: apps/desktop/src-tauri/src/error.rs] — `AppError::Validation { message, field }` (line 6) and its flat `{ type, message, field }` serialization with `field` omitted when `None` (lines 41-50)
- [Source: apps/desktop/src-tauri/src/commands/auth.rs] — line 499 precedent for taking an input as a parameter to keep a validator pure and testable
- [Source: apps/desktop/src/lib/constants.ts] — parameterized key factories: `maintenanceVehicle` / `maintenanceHistory` (lines 50-53), `vehicleModels` (lines 57-58), `expensesByMonth` (lines 13-14); the nested `auth.session` outlier (lines 62-64) that must not be imitated
- [Source: apps/desktop/src/hooks/useVehicleCatalog.ts] — `useVehicleModels` (lines 29-48): the dependent-query precedent with a parameterized key, an `enabled` guard on a trimmed string, and a long `staleTime`
- [Source: apps/desktop/src/hooks/useAccounts.ts] — hook file conventions: `useQuery` / `useMutation`, `invoke<T>` with `snake_case` args, `queryKeys` imported from `@/lib/constants`
- [Source: apps/desktop/src/hooks/useBudgetTemplates.ts] — line 69 `enabled: templateId !== ""`, the string-parameter conditional-query precedent
- [Source: apps/desktop/src/components/maintenance/VehicleCatalogFields.tsx] — lines 209-217: the cascade-reset precedent, clearing the dependent value in the same handler that changes the parent, never in a `useEffect`; lines 175-190 show the dependent hook wired to the parent's current value
- [Source: apps/desktop/src/components/accounts/AddAccountForm.tsx] — lines 150-174: `Controller` + shared `Select` + `items` + `SelectValue` + `.map()` over the same option array; lines 60-70 (`mode: "onBlur"`) and 96-101 (`noValidate`) for the surrounding form conventions
- [Source: apps/desktop/src/components/income/AddRecurringIncomeForm.tsx] — line 96: building `items` from query data
- [Source: apps/desktop/src/components/settings/CredentialsForm.tsx] — lines 23-36: `getErrorMessage(err)` reading `{ type, message }` off a rejected `invoke`
- [Source: packages/shared/src/ui/select.tsx] — `Select` root passes `items` through to `@base-ui/react`'s `Select.Root` (lines 7-9); `SelectValue` is a pass-through of `SelectPrimitive.Value` (lines 34-36); `SelectTrigger` already styles `aria-invalid` (line 20)
- [Source: apps/desktop/src/locales/__tests__/profile-i18n.test.ts] — `REQUIRED_KEYS` (lines 9-18), the two-way parity assertion (lines 52-59), and the `"declares every profile key it ships"` exact-set assertion (lines 61-68) that new keys must be registered in
- [Source: apps/desktop/src/locales/en.json] / [Source: apps/desktop/src/locales/fr.json] — existing flat `profile.*` block (lines 40-46), `common.save` (line 61), `toast.saveSuccess` / `toast.saveFailed` (lines 577-578)
- [Source: apps/desktop/tests/auth.spec.ts] — the per-spec Tauri mock switch and the `window.__IPC_CALLS` recording mechanism (lines 77-78, 141-153) used to prove AC 3 and AC 8

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

None — no failing gate required investigation.

### Completion Notes List

- `subdivisions_for(country_code) -> &'static [Subdivision]` added beside 29.1's `countries()` / `country_exists()` in `profile_store.rs`, reusing the existing `dataset()` `OnceLock`. No second `include_str!`, no second `OnceLock`, no `iso3166.rs` module. `rg 'include_str!' apps/desktop/src-tauri/src` still returns exactly one `iso3166.json` hit.
- `validate_subdivision_code_against(country_code, subdivision_code, subdivisions_for_country)` is pure — the candidate slice is injected, matching the `validate_birth_date_at(…, today)` precedent — and applies the five rules in the mandated order. It is called from `save_profile` *after* `validate_country_code`, so an unknown country reports `field: "country_code"` (asserted by `an_unknown_country_reports_the_country_field_not_the_subdivision`).
- `subdivision_code` in the written document now comes from the validator's return rather than `normalize(&input.subdivision_code)`, so the stored value is the trimmed ISO 3166-2 code and a blank clears to `null`.
- `get_subdivisions(country_code: String)` is a synchronous `pub fn`, not session-gated, no `AppHandle`, no `State<DbState>`; it orchestrates only and answers `Ok(vec![])` for an unknown or blank code. Registered in `lib.rs` after `commands::profile::get_countries`. `get_location_catalog` was not implemented (`rg 'get_location_catalog' apps/desktop` → no hits).
- Frontend: `queryKeys.subdivisions(countryCode) => ["subdivisions", countryCode]` and `useSubdivisions` with `enabled: trimmed.length > 0` and `staleTime: Infinity`. No `select`, no client-side filter, no second dataset copy.
- `ProfileForm.tsx`: `subdivision_code` added to `ProfileFormData`, `defaultValues`, the post-load `reset`, and the `isProfileField` allow-list; `onSubmit` now sends `emptyToNull(form.subdivision_code)` instead of 28.2's `data?.subdivision_code ?? null` pass-through. The field renders only when `(subdivisions?.length ?? 0) > 0`, which is one condition covering AC 1, AC 2 and AC 3. The cascade reset (`setValue("subdivision_code", "", { shouldDirty: true })` + `clearErrors("subdivision_code")`) lives inside the country `onValueChange` — not in a `useEffect`.
- The subdivision control deliberately mirrors 29.1's **shipped** country control rather than the story's illustrative snippet: 29.1 renders the unset entry as a standalone `<SelectItem value={null}>` and maps `""`↔`null` at the control boundary instead of prepending `{ value: "", label: … }` to the options array. Copying the snippet verbatim would have made the two location selects behave differently. Same `??` FR→EN fallback, same `Intl.Collator(i18n.language)` sort, same translated unset label, so no option can ever render blank.
- Label wording: one generic `profile.subdivision` = "State, province, or region" / "État, province ou région" for every country. The real-world label varies (state / province / region / prefecture), but no per-country label data exists in the dataset and inventing one was out of scope, so the generic enumeration is used — it reads correctly for all three of the common cases and is the same compromise the placeholder makes.
- i18n: 3 new flat `profile.*` keys added to `en.json` and `fr.json` in the same change (1202 → 1205 keys in both files, verified equal) and declared in `profile-i18n.test.ts`'s `REQUIRED_KEYS`. No subdivision NAME was added to any locale file. Not added to `ARIA_LABEL_KEYS`, `PLACEHOLDER_KEYS` or `ELLIPSIS_KEYS`.
- `tests/profile.spec.ts`: one `case "get_subdivisions"` added to that spec's mock (CA with the `name_fr`-omitted `CA-ON` fallback row, US, and the subdivision-less `VA`), plus a `language` option seeding `i18nextLng` for the FR case. `FUTURE_PROFILE_COMMANDS` was repointed from `["get_subdivisions"]` (now shipped) to `["get_location_catalog", "get_tfsa_accumulated_limit"]`, keeping that guard meaningful. No other spec's mock needed a case — confirmed by the full Playwright suite passing untouched.
- Verification (all real output observed):
  - `cargo test` — **402 passed; 0 failed** (baseline 391, +11 new).
  - `cargo clippy --all-targets` — **1 warning, the pre-existing `commands/backup.rs:106` `explicit_auto_deref`**. No new warning.
  - `pnpm --filter @nixus/desktop exec tsc --noEmit` — no output, zero errors.
  - `pnpm --filter @nixus/desktop test` — **174 passed** (baseline 171, +3 from the `it.each` over the new `REQUIRED_KEYS`).
  - `pnpm --filter @nixus/desktop exec playwright test` — **379 passed** (baseline 371, +8 new subdivision specs), full suite, no flakes and no re-runs needed.
- Audit by inspection: no new file in `src-tauri/migrations/`; `db/mod.rs` `MIGRATIONS`, `db/danger_zone.rs` `WIPE_TABLES` / `PRESERVED_TABLES` untouched; no `insert_audit_log` added; `Cargo.toml` and every `package.json` dependency list unchanged; `error.rs` gained no variant; no `fetch` / `reqwest` / URL literal added; `data/iso3166.json` and `scripts/generate-iso3166.mjs` untouched; `packages/shared/` untouched; `sprint-status.yaml` untouched.

### File List

- `apps/desktop/src-tauri/src/profile_store.rs` — MODIFIED
- `apps/desktop/src-tauri/src/commands/profile.rs` — MODIFIED
- `apps/desktop/src-tauri/src/lib.rs` — MODIFIED
- `apps/desktop/src/lib/constants.ts` — MODIFIED
- `apps/desktop/src/hooks/useProfile.ts` — MODIFIED
- `apps/desktop/src/components/profile/ProfileForm.tsx` — MODIFIED
- `apps/desktop/src/locales/en.json` — MODIFIED
- `apps/desktop/src/locales/fr.json` — MODIFIED
- `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` — MODIFIED
- `apps/desktop/tests/profile.spec.ts` — MODIFIED

