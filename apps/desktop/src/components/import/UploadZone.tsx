import { useState, useCallback, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Upload, FileCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileValidationResult {
  file_name: string;
  file_path: string;
  file_size: number;
}

interface UploadZoneProps {
  onValidated: (result: FileValidationResult) => void;
}

export function UploadZone({ onValidated }: UploadZoneProps) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validatedFile, setValidatedFile] = useState<FileValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  const validateFile = useCallback(
    async (filePath: string) => {
      setError(null);
      setValidating(true);
      try {
        const result = await invoke<FileValidationResult>("validate_cc_file", {
          file_path: filePath,
        });
        setValidatedFile(result);
        onValidated(result);
      } catch (err: unknown) {
        const error = err as { message?: string };
        setError(error.message ?? "Failed to validate file");
        setValidatedFile(null);
      } finally {
        setValidating(false);
      }
    },
    [onValidated]
  );

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
      <div
        data-testid="upload-zone-success"
        className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-primary/50 bg-primary/5 p-12"
      >
        <FileCheck className="h-12 w-12 text-primary" />
        <p className="text-lg font-medium" data-testid="validated-file-name">
          {validatedFile.file_name}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("import.fileValidated")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        data-testid="upload-zone"
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-16 transition-colors",
          dragOver
            ? "border-primary bg-primary/10"
            : "border-muted-foreground/30 hover:border-muted-foreground/50"
        )}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick();
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Upload
          className={cn(
            "h-12 w-12",
            dragOver ? "text-primary" : "text-muted-foreground"
          )}
        />
        <div className="text-center">
          <p className="text-lg font-medium">
            {validating ? t("import.validating") : t("import.dropHere")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("import.orClickToBrowse")}
          </p>
        </div>
      </div>
      {error && (
        <p className="mt-3 text-sm text-destructive" data-testid="upload-error">
          {error}
        </p>
      )}
    </div>
  );
}
