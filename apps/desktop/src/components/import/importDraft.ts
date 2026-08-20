import type { ParsedTransaction } from "@/hooks/useImport";
import { IMPORT_DRAFT_STORAGE_KEY } from "@/lib/datasetSwitch";

export interface ManualEntry {
  merchant: string;
  amount_cents: number;
  budget_category_id: number;
  date: string;
}

export interface ImportDraft {
  transactions: ParsedTransaction[];
  unreadable: string[];
  duplicateIndices: number[];
  fieldOverrides: Record<number, Partial<ParsedTransaction>>;
  deselected: number[];
  manualEntries: ManualEntry[];
  savedAt: string;
}

interface StoredDraft extends Omit<ImportDraft, "fieldOverrides"> {
  version: 1;
  // JSON object keys are always strings, so the numeric index map round-trips through this shape.
  fieldOverrides: Record<string, Partial<ParsedTransaction>>;
}

const STORAGE_KEY = IMPORT_DRAFT_STORAGE_KEY;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The review draft is written to this machine's own storage, not to the database: `confirm_import`
// has no draft endpoint, and a force-quit or a failed commit must not discard 40-80 corrections.
export function readImportDraft(): ImportDraft | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    if (!Array.isArray(parsed.transactions) || parsed.transactions.length === 0) {
      return null;
    }

    const stored = parsed as unknown as StoredDraft;
    const fieldOverrides: Record<number, Partial<ParsedTransaction>> = {};
    for (const [key, value] of Object.entries(stored.fieldOverrides ?? {})) {
      const index = Number(key);
      if (Number.isInteger(index)) fieldOverrides[index] = value;
    }

    return {
      transactions: stored.transactions,
      unreadable: stored.unreadable ?? [],
      duplicateIndices: stored.duplicateIndices ?? [],
      fieldOverrides,
      deselected: stored.deselected ?? [],
      manualEntries: stored.manualEntries ?? [],
      savedAt: stored.savedAt,
    };
  } catch {
    return null;
  }
}

export function writeImportDraft(draft: ImportDraft): void {
  const stored: StoredDraft = { ...draft, version: 1 };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage full or unavailable: the in-memory review is still intact this session.
  }
}

export function clearImportDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
