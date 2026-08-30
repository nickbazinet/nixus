import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  isHostedAiError,
  parseAppError,
  type HostedAiErrorCode,
} from "@/lib/appError";
import type { ImportStage } from "@/components/import/ImportProgressStepper";

export interface ProposedCategory {
  name: string;
  group_id: number | null;
  group_name: string | null;
}

export interface ParsedTransaction {
  merchant: string;
  amount_cents: number;
  date: string;
  suggested_category_id: number | null;
  confidence: number;
  propose_category?: ProposedCategory | null;
}

interface ImportCompletePayload {
  transactions: ParsedTransaction[];
  flagged_count: number;
  auto_count: number;
  unreadable: string[];
  duplicate_indices: number[];
}

interface ImportProgressPayload {
  stage: ImportStage;
  message?: string;
}

interface ImportErrorPayload {
  message: string;
  recoverable: boolean;
}

type ImportStatus = "idle" | "processing" | "done" | "error";

/**
 * The failure shape the import screen renders, kept wide enough to be re-read by `parseAppError`.
 *
 * `code` and `recoverable` are the whole point: dropping them collapsed every hosted refusal —
 * premium, quota, auth, outage — into the generic "unavailable" wording, because an absent `code`
 * degrades to `hosted_unavailable` in the parser. A premium user out of this month's quota was told
 * Nixus could not read statements at all.
 */
export interface ImportError {
  message: string;
  type?: string;
  code?: HostedAiErrorCode;
  recoverable?: boolean;
}

export function useImport() {
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [stage, setStage] = useState<ImportStage>("uploading");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ImportCompletePayload | null>(null);
  const [error, setError] = useState<ImportError | null>(null);

  useEffect(() => {
    let cleaned = false;
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const fns = await Promise.all([
        listen<ImportProgressPayload>("import:progress", (event) => {
          setStage(event.payload.stage);
          setMessage(event.payload.message ?? null);
        }),
        listen<ImportCompletePayload>("import:complete", (event) => {
          setStatus("done");
          setResult(event.payload);
        }),
        listen<ImportErrorPayload>("import:error", (event) => {
          setStatus("error");
          // Merged, never assigned: `commands/import.rs` emits this event AND returns the typed
          // `AppError`, and the two IPC messages are not ordered by contract. This payload carries
          // no `type` and no `code`, so overwriting a rejection already in hand would silently
          // downgrade a premium/quota/auth refusal to the generic "unavailable" wording.
          setError((held) =>
            held?.type === undefined
              ? {
                  message: event.payload.message,
                  recoverable: event.payload.recoverable,
                }
              : held,
          );
        }),
      ]);

      if (cleaned) {
        fns.forEach((fn) => fn());
      } else {
        unlisteners.push(...fns);
      }
    };

    setup();

    return () => {
      cleaned = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const startImport = useCallback(async (filePath: string) => {
    setStatus("processing");
    setStage("uploading");
    setMessage(null);
    setResult(null);
    setError(null);

    try {
      await invoke("import_cc_statement", { file_path: filePath });
    } catch (err: unknown) {
      const parsed = parseAppError(err);
      setStatus("error");
      setError(
        isHostedAiError(parsed)
          ? {
              message: parsed.message || "Import failed",
              type: parsed.type,
              code: parsed.code,
              recoverable: parsed.recoverable,
            }
          : { message: parsed.message ?? "Import failed", type: parsed.type },
      );
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setStage("uploading");
    setMessage(null);
    setResult(null);
    setError(null);
  }, []);

  return { status, stage, message, result, error, startImport, reset };
}

// Keep backward-compatible alias for error message string extraction
export function getImportErrorMessage(error: ImportError | null): string | null {
  return error?.message ?? null;
}
