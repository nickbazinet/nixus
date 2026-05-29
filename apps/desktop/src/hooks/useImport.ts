import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ImportStage } from "@/components/import/ImportProgressStepper";

export interface ParsedTransaction {
  merchant: string;
  amount_cents: number;
  date: string;
  suggested_category_id: number | null;
  confidence: number;
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

export interface ImportError {
  message: string;
  type?: string;
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
          setError({ message: event.payload.message });
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
      const e = err as { message?: string; type?: string };
      setStatus("error");
      setError({ message: e.message ?? "Import failed", type: e.type });
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
