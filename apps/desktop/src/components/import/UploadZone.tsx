import { useState, useCallback, useEffect, useRef, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Upload, FileCheck } from "lucide-react";
import { Alert, Card, CardContent, focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";

const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;

interface FileValidationResult {
  file_name: string;
  file_path: string;
  file_size: number;
}

interface ClipboardImageSaveResult {
  file_path: string;
}

interface UploadZoneProps {
  onValidated: (result: FileValidationResult) => void;
}

type ClipboardImageExtract =
  | { kind: "supported"; blob: Blob; extension: "png" | "jpg" }
  | { kind: "unsupported"; mime: string }
  | { kind: "none" };

function extensionFromMime(mime: string): "png" | "jpg" | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  return null;
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function extractClipboardImage(
  clipboardData: DataTransfer | null
): ClipboardImageExtract {
  if (!clipboardData) return { kind: "none" };

  let sawUnsupportedImage = false;
  let unsupportedMime = "";

  const items = clipboardData.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type.startsWith("image/")) continue;
      const extension = extensionFromMime(item.type);
      if (!extension) {
        sawUnsupportedImage = true;
        unsupportedMime = item.type;
        continue;
      }
      const blob = item.getAsFile();
      if (blob) return { kind: "supported", blob, extension };
    }
  }

  const files = clipboardData.files;
  if (files) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) continue;
      const extension = extensionFromMime(file.type);
      if (!extension) {
        sawUnsupportedImage = true;
        unsupportedMime = file.type;
        continue;
      }
      return { kind: "supported", blob: file, extension };
    }
  }

  if (sawUnsupportedImage) {
    return { kind: "unsupported", mime: unsupportedMime };
  }
  return { kind: "none" };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function UploadZone({ onValidated }: UploadZoneProps) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validatedFile, setValidatedFile] = useState<FileValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const validatingRef = useRef(false);
  const mountedRef = useRef(true);

  const setValidatingSafe = useCallback((value: boolean) => {
    validatingRef.current = value;
    if (mountedRef.current) setValidating(value);
  }, []);

  const validateFile = useCallback(
    async (filePath: string) => {
      if (mountedRef.current) setError(null);
      setValidatingSafe(true);
      try {
        const result = await invoke<FileValidationResult>("validate_cc_file", {
          file_path: filePath,
        });
        if (!mountedRef.current) return;
        setValidatedFile(result);
        onValidated(result);
      } catch (err: unknown) {
        if (!mountedRef.current) return;
        const error = err as { message?: string };
        setError(error.message ?? "Failed to validate file");
        setValidatedFile(null);
      } finally {
        setValidatingSafe(false);
      }
    },
    [onValidated, setValidatingSafe]
  );

  const handlePasteEvent = useCallback(
    async (e: ClipboardEvent) => {
      if (isEditablePasteTarget(e.target)) {
        return;
      }

      if (validatingRef.current) {
        e.preventDefault();
        return;
      }

      const extracted = extractClipboardImage(e.clipboardData);
      if (extracted.kind === "none") {
        e.preventDefault();
        if (mountedRef.current) setError(t("import.pasteNoImage"));
        return;
      }
      if (extracted.kind === "unsupported") {
        e.preventDefault();
        if (mountedRef.current) setError(t("import.pasteUnsupportedImage"));
        return;
      }

      e.preventDefault();
      if (extracted.blob.size > MAX_CLIPBOARD_IMAGE_BYTES) {
        if (mountedRef.current) {
          setError(t("import.pasteTooLarge"));
        }
        return;
      }

      if (mountedRef.current) setError(null);
      setValidatingSafe(true);
      try {
        const buffer = await extracted.blob.arrayBuffer();
        if (!mountedRef.current) return;
        const bytesBase64 = bytesToBase64(new Uint8Array(buffer));
        const saved = await invoke<ClipboardImageSaveResult>(
          "save_import_clipboard_image",
          {
            bytes_base64: bytesBase64,
            extension: extracted.extension,
          }
        );
        if (!mountedRef.current) return;
        await validateFile(saved.file_path);
      } catch (err: unknown) {
        if (!mountedRef.current) return;
        const error = err as { message?: string };
        setError(error.message ?? t("import.pasteNoImage"));
        setValidatedFile(null);
        setValidatingSafe(false);
      }
    },
    [t, validateFile, setValidatingSafe]
  );

  useEffect(() => {
    mountedRef.current = true;
    const onWindowPaste = (e: ClipboardEvent) => {
      void handlePasteEvent(e);
    };
    window.addEventListener("paste", onWindowPaste);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("paste", onWindowPaste);
    };
  }, [handlePasteEvent]);

  const handleClick = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: t("import.ccStatement"),
          extensions: ["png", "jpg", "jpeg", "pdf"],
        },
      ],
    });
    if (selected) {
      await validateFile(selected);
    }
  }, [validateFile, t]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        // In Tauri, dropped files provide a path via webkitRelativePath or name
        // but we need the actual filesystem path. Tauri's drag-drop gives us the path.
        const filePath = (file as File & { path?: string }).path;
        if (filePath) {
          await validateFile(filePath);
        } else {
          setError(t("import.filePathError"));
        }
      }
    },
    [validateFile, t]
  );

  if (validatedFile) {
    return (
      <Card data-testid="upload-zone-success">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <span
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand-ink"
          >
            <FileCheck className="size-5" />
          </span>
          <p className="text-h2 text-ink" data-testid="validated-file-name">
            {validatedFile.file_name}
          </p>
          <p className="text-caption text-ink-dim">{t("import.fileValidated")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label={t("import.dropHere")}
        aria-describedby="upload-zone-hint"
        data-testid="upload-zone"
        className={cn(
          "flex min-h-target-min cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center transition-colors",
          dragOver
            ? "border-brand bg-brand-soft"
            : "border-line-strong bg-card hover:bg-hover",
          focusRing
        )}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick();
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid size-10 place-items-center rounded-lg",
            dragOver ? "bg-card text-brand-ink" : "bg-track text-ink-dim"
          )}
        >
          <Upload className="size-5" />
        </span>
        <div>
          <p className="text-h2 text-ink">
            {validating ? t("import.validating") : t("import.dropHere")}
          </p>
          <p id="upload-zone-hint" className="mt-1 text-caption text-ink-dim">
            {t("import.orClickToBrowse")}
          </p>
        </div>
      </div>
      {error && (
        <Alert variant="over" className="mt-3" data-testid="upload-error">
          {error}
        </Alert>
      )}
    </div>
  );
}
