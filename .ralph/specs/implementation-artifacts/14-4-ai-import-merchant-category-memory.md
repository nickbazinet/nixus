# Story 14.4: AI Import Merchant-Category Memory

Status: review

## Story

As a user,
I want the import system to remember how I categorized merchants in past imports,
so that future imports require fewer manual corrections and accuracy improves over time.

## Acceptance Criteria

1. When a user corrects the AI's category suggestion during review, that merchant→category mapping is saved.
2. When a user confirms a flagged transaction (confidence < 0.8) without changing the category, that mapping is saved.
3. On the next import, saved merchant hints are injected into the AI prompt so Claude can use them to categorize matching merchants.
4. Merchant matching is case-insensitive (store and match as lowercase).
5. If a hint is later overridden (user changes to a different category), the old hint's confidence degrades; the new category's hint is recorded.
6. No UI changes are required in this story — the improvement is invisible to the user (they simply see fewer flagged/wrong categorizations over time).

## Tasks / Subtasks

- [x] Create migration 015 (AC: #1–#4)
  - [x] Create `apps/desktop/src-tauri/migrations/015_merchant_category_hints.sql`
  - [x] Register migration in `apps/desktop/src-tauri/src/db/mod.rs` MIGRATIONS array

- [x] Add MerchantHint model (AC: #3, #4)
  - [x] Add `MerchantHint` struct to `apps/desktop/src-tauri/src/models/mod.rs`

- [x] Add db functions (AC: #1, #2, #3, #4, #5)
  - [x] In `apps/desktop/src-tauri/src/db/expense.rs`, add `get_merchant_category_hints(conn) -> Result<Vec<MerchantHint>, AppError>`
  - [x] In `apps/desktop/src-tauri/src/db/expense.rs`, add `record_merchant_category_hint(conn, merchant: &str, budget_category_id: i64, user_corrected: bool) -> Result<(), AppError>`

- [x] Inject hints into AI prompt (AC: #3)
  - [x] In `apps/desktop/src-tauri/src/ai/cc_parser.rs`, update `build_system_prompt()` signature to accept `hints: &[MerchantHint]` and append a known-mappings section to the prompt
  - [x] Update `parse_cc_statement()` signature to accept and pass hints through

- [x] Fetch hints and record corrections in import command (AC: #1, #2, #5)
  - [x] In `apps/desktop/src-tauri/src/commands/import.rs`, after fetching categories (~line 110), fetch hints from DB
  - [x] Pass hints to `cc_parser::parse_cc_statement()`
  - [x] In `confirm_import()`, after `bulk_insert_imported_expenses()`, loop through confirmed transactions and call `record_merchant_category_hint()` for each that meets the criteria

## Dev Notes

### Migration 015 schema

`apps/desktop/src-tauri/migrations/015_merchant_category_hints.sql`:
```sql
CREATE TABLE merchant_category_hints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant TEXT NOT NULL,
    budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
    confidence_score REAL NOT NULL DEFAULT 1.0,
    usage_count INTEGER NOT NULL DEFAULT 1,
    last_updated TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(merchant, budget_category_id)
);

CREATE INDEX idx_merchant_hints_merchant ON merchant_category_hints(merchant);
```

Register in `apps/desktop/src-tauri/src/db/mod.rs` MIGRATIONS array:
```rust
(15, include_str!("../../migrations/015_merchant_category_hints.sql")),
```

### MerchantHint model

Add to `apps/desktop/src-tauri/src/models/mod.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerchantHint {
    pub merchant: String,
    pub budget_category_id: i64,
    pub confidence_score: f64,
    pub usage_count: i64,
}
```

### DB functions in `db/expense.rs`

```rust
pub fn get_merchant_category_hints(conn: &Connection) -> Result<Vec<MerchantHint>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT merchant, budget_category_id, confidence_score, usage_count
         FROM merchant_category_hints
         ORDER BY confidence_score * usage_count DESC
         LIMIT 50"
    )?;
    // map rows to MerchantHint
}

pub fn record_merchant_category_hint(
    conn: &Connection,
    merchant: &str,
    budget_category_id: i64,
    user_corrected: bool,
) -> Result<(), AppError> {
    let normalized = merchant.to_lowercase().trim().to_string();
    // INSERT OR IGNORE first
    conn.execute(
        "INSERT OR IGNORE INTO merchant_category_hints
         (merchant, budget_category_id, confidence_score, usage_count)
         VALUES (?1, ?2, 1.0, 1)",
        params![normalized, budget_category_id],
    )?;
    // Then UPDATE based on whether user corrected or confirmed
    if user_corrected {
        // User changed the category — this is a new correct mapping, reinforce it
        conn.execute(
            "UPDATE merchant_category_hints
             SET usage_count = usage_count + 1,
                 confidence_score = 1.0,
                 last_updated = datetime('now')
             WHERE merchant = ?1 AND budget_category_id = ?2",
            params![normalized, budget_category_id],
        )?;
        // Degrade any OTHER mappings for this merchant
        conn.execute(
            "UPDATE merchant_category_hints
             SET confidence_score = MAX(0.1, confidence_score * 0.7),
                 last_updated = datetime('now')
             WHERE merchant = ?1 AND budget_category_id != ?2",
            params![normalized, budget_category_id],
        )?;
    } else {
        // User confirmed without change — reinforce
        conn.execute(
            "UPDATE merchant_category_hints
             SET usage_count = usage_count + 1,
                 confidence_score = MIN(1.0, confidence_score + 0.1),
                 last_updated = datetime('now')
             WHERE merchant = ?1 AND budget_category_id = ?2",
            params![normalized, budget_category_id],
        )?;
    }
    Ok(())
}
```

### AI prompt injection in `cc_parser.rs`

**`build_system_prompt` signature change:**
```rust
fn build_system_prompt(today: &str, categories: &[BudgetCategory], hints: &[MerchantHint]) -> String
```

**Append hints section** (after the categories list, before the final instructions):
```
Known merchant-category mappings from past imports (use these when the merchant matches):
{for each hint: "- "{merchant}" → category id {budget_category_id} (used {usage_count} times, {confidence}% confidence)"}

When a merchant matches a known mapping, use that category_id directly.
```

Limit hint injection to top 30 by `confidence_score * usage_count` to avoid prompt bloat.

**`parse_cc_statement` signature change:**
```rust
pub async fn parse_cc_statement(
    client: &BedrockClient,
    file_path: &Path,
    categories: &[BudgetCategory],
    hints: &[MerchantHint],  // NEW
) -> Result<ParsedStatement, AppError>
```

### Import command changes in `commands/import.rs`

**In `import_cc_statement()`, after fetching categories (~line 110-115):**
```rust
let categories = budget_db::get_all_budget_categories(&conn)?;
let hints = expense_db::get_merchant_category_hints(&conn)?;  // NEW
```

**Pass hints to parser (~line 141):**
```rust
let result = cc_parser::parse_cc_statement(&bedrock_client, &file_path, &categories, &hints).await?;
```

**In `confirm_import()`, after `bulk_insert_imported_expenses()` (~line 303):**
```rust
// Record merchant hints for future imports
for tx in &transactions {
    let ai_suggestion = /* need to pass original AI suggestions through ConfirmTransaction */;
    let user_corrected = tx.budget_category_id != ai_suggestion;
    // Only record for non-trivial merchants (len > 2)
    if tx.merchant.trim().len() > 2 {
        if let Err(e) = expense_db::record_merchant_category_hint(
            &conn,
            &tx.merchant,
            tx.budget_category_id,
            user_corrected,
        ) {
            tracing::warn!("Failed to record merchant hint: {}", e);
        }
    }
}
```

**Note on ConfirmTransaction struct:** To know if the user corrected the AI suggestion, the `ConfirmTransaction` struct needs an `original_category_id: Option<i64>` field added. The frontend already has this information (the AI suggestion is displayed in the review card). Add this field to the struct and pass it from the frontend.

Alternatively, if adding to ConfirmTransaction is complex: record a hint for every confirmed transaction unconditionally (user acceptance reinforces the mapping). This is simpler and still improves accuracy over time.

**Simpler approach (recommended for first implementation):** Record for every confirmed transaction without tracking corrections — accuracy compounds naturally.

### ConfirmTransaction struct (if adding original_category_id)

In `apps/desktop/src-tauri/src/commands/import.rs`:
```rust
#[derive(Debug, Deserialize)]
pub struct ConfirmTransaction {
    pub merchant: String,
    pub amount_cents: i64,
    pub budget_category_id: i64,
    pub date: String,
    // existing fields above ^^^
    pub original_suggested_category_id: Option<i64>,  // ADD THIS
}
```

Frontend passes this from the existing `suggested_category_id` field already present in the import result.

### Hint recording criteria

Record a hint when:
- Transaction is confirmed (any confirmed transaction strengthens the mapping)
- `merchant.trim().len() > 2` (filter out garbage/empty merchants)
- Do NOT record for AI-unreadable / manually-entered transactions (they come from the `unreadable_transactions` list, not the main categorized list)

### Project Structure Notes

- All changes are in the Rust backend — no frontend component changes needed
- The improvement is transparent: users see higher AI accuracy without any new UI
- Hints are stored with the merchant name normalized to lowercase trimmed — always apply `.to_lowercase().trim()` before storing or querying
- `tracing::warn!` (not `error!`) for hint recording failures — they must never block the import confirmation

### References

- Migration dir: `apps/desktop/src-tauri/migrations/` (next is 015)
- DB migration registration: `apps/desktop/src-tauri/src/db/mod.rs` MIGRATIONS array
- Model structs: `apps/desktop/src-tauri/src/models/mod.rs`
- DB functions to add to: `apps/desktop/src-tauri/src/db/expense.rs`
- AI prompt builder: `apps/desktop/src-tauri/src/ai/cc_parser.rs`
- Import command: `apps/desktop/src-tauri/src/commands/import.rs`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Used simpler approach for `confirm_import`: added `original_suggested_category_id: Option<i64>` to `ConfirmTransaction` so the frontend can signal whether the user corrected the AI suggestion; if field is absent/null, `user_corrected` defaults to `false` (confirmation reinforces the mapping).
- Merchant names normalized to lowercase+trimmed before storing or querying.
- Hint injection limited to top 30 by `confidence_score * usage_count` to avoid prompt bloat.
- Hint recording failures use `tracing::warn!` and never block confirmation.

### File List

- `apps/desktop/src-tauri/migrations/015_merchant_category_hints.sql` — new migration
- `apps/desktop/src-tauri/src/db/mod.rs` — registered migration 15
- `apps/desktop/src-tauri/src/models/mod.rs` — added MerchantHint struct
- `apps/desktop/src-tauri/src/db/expense.rs` — added get_merchant_category_hints and record_merchant_category_hint
- `apps/desktop/src-tauri/src/ai/cc_parser.rs` — updated build_system_prompt and parse_cc_statement to accept hints
- `apps/desktop/src-tauri/src/commands/import.rs` — fetch hints, pass to parser, added original_suggested_category_id, record hints in confirm_import
