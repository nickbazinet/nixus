//! A profile seeded with distinctive, known figures — the fixture for Home Surface resolution tests
//! and for SM-2's privacy gate, which searches an outbound generation request for every one of them.

use rusqlite::{params, Connection};

/// Every value the seed writes into a finance table, as the strings a leak would show up as.
pub(crate) struct KnownProfile {
    pub needles: Vec<String>,
    pub groceries_category_id: i64,
}

/// Amounts chosen to be unlike anything a prompt would contain by accident (no round numbers, no
/// small integers), so a substring hit is a leak and never a coincidence.
const EXPENSES: [(&str, i64, i64); 4] = [
    ("Quokka Market", 873_419, 0),
    ("Bellwether Bistro", 259_377, 0),
    ("Quokka Market", 618_253, 1),
    ("Zinnia Pharmacy", 147_389, 2),
];

fn cents_spellings(cents: i64) -> Vec<String> {
    let dollars = cents / 100;
    let rem = cents % 100;
    vec![
        cents.to_string(),
        format!("{dollars}.{rem:02}"),
        format!("{dollars},{rem:02}"),
        format!("{},{:03}", dollars / 1000, dollars % 1000),
        format!("{} {:03}", dollars / 1000, dollars % 1000),
    ]
}

pub(crate) fn seed_known_profile(conn: &Connection) -> KnownProfile {
    let mut needles: Vec<String> = Vec::new();

    conn.execute(
        "INSERT INTO budget_groups (name, sort_order) VALUES ('Xylophone Living', 0)",
        [],
    )
    .expect("group");
    let group = conn.last_insert_rowid();
    needles.push("Xylophone Living".to_string());

    let mut categories = Vec::new();
    for (name, target) in [
        ("Quixotic Groceries", 912_345_i64),
        ("Marmalade Dining", 333_217),
    ] {
        conn.execute(
            "INSERT INTO budget_categories (group_id, name, target_cents, sort_order) VALUES (?1, ?2, ?3, 0)",
            params![group, name, target],
        )
        .expect("category");
        categories.push(conn.last_insert_rowid());
        needles.push(name.to_string());
        needles.extend(cents_spellings(target));
    }

    for (index, (merchant, cents, months_ago)) in EXPENSES.iter().enumerate() {
        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date)
             VALUES (?1, ?2, ?3, date('now', 'start of month', printf('-%d months', ?4), '+3 days'))",
            params![merchant, cents, categories[index % 2], months_ago],
        )
        .expect("expense");
        needles.push(merchant.to_string());
        needles.extend(cents_spellings(*cents));
    }

    for (name, kind, balance) in [
        ("Zephyrine Chequing", "chequing", 4_281_937_i64),
        ("Obsidian Visa", "credit_card", 381_746),
    ] {
        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, currency, balance_cents)
             VALUES (?1, 'Vantablack Credit Union', ?2, 'CAD', ?3)",
            params![name, kind, balance],
        )
        .expect("account");
        needles.push(name.to_string());
        needles.extend(cents_spellings(balance));
    }
    needles.push("Vantablack Credit Union".to_string());

    conn.execute(
        "INSERT INTO passive_assets (name, asset_type, value_cents) VALUES ('Larkspur Cottage', 'real_estate', 61_928_374)",
        [],
    )
    .expect("asset");
    needles.push("Larkspur Cottage".to_string());
    needles.extend(cents_spellings(61_928_374));

    for (months_ago, total) in [(2_i64, 63_017_291_i64), (1, 64_183_529), (0, 65_829_117)] {
        conn.execute(
            "INSERT INTO net_worth_snapshots (total_cents, snapshot_date, breakdown_json)
             VALUES (?1, date('now', 'start of month', printf('-%d months', ?2), '+9 days'), '{}')",
            params![total, months_ago],
        )
        .expect("snapshot");
        needles.extend(cents_spellings(total));
    }

    conn.execute(
        "INSERT INTO income_sources (name, income_type) VALUES ('Gossamer Consulting', 'freelance')",
        [],
    )
    .expect("income source");
    let source = conn.last_insert_rowid();
    needles.push("Gossamer Consulting".to_string());
    conn.execute(
        "INSERT INTO income_entries (source_id, amount_cents, date, month)
         VALUES (?1, 739_163, date('now', 'start of month', '+1 day'), strftime('%Y-%m', 'now'))",
        params![source],
    )
    .expect("income entry");
    needles.extend(cents_spellings(739_163));

    KnownProfile {
        needles,
        groceries_category_id: categories[0],
    }
}
