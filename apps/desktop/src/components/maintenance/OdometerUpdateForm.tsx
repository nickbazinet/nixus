import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@nixus/shared";
import { formatOdometerKm } from "@/lib/maintenanceUtils";
import { useUpdateVehicleOdometer } from "@/hooks/useMaintenance";
import { cn } from "@/lib/utils";

interface OdometerUpdateFormProps {
  vehicleId: number;
  odometerKm: number;
  onSuccess?: () => void;
}

function parseOdometerKm(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 0) return null;

  return num;
}

export function OdometerUpdateForm({
  vehicleId,
  odometerKm,
  onSuccess,
}: OdometerUpdateFormProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [localKm, setLocalKm] = useState(odometerKm);
  const [draft, setDraft] = useState(String(odometerKm));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateOdometer = useUpdateVehicleOdometer();

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    setLocalKm(odometerKm);
  }, [odometerKm]);

  useEffect(() => {
    if (!editing) {
      setDraft(String(localKm));
      setError(null);
    }
  }, [localKm, editing]);

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const enterEditMode = () => {
    setDraft(String(localKm));
    setError(null);
    setEditing(true);
  };

  const handleCancel = () => {
    setDraft(String(localKm));
    setError(null);
    setEditing(false);
  };

  const handleSave = () => {
    const parsed = parseOdometerKm(draft);
    if (parsed === null) {
      setError(t("maintenance.odometer.invalid"));
      return;
    }

    if (parsed === localKm) {
      setEditing(false);
      return;
    }

    updateOdometer.mutate(
      { vehicleId, odometerKm: parsed },
      {
        onSuccess: () => {
          setLocalKm(parsed);
          setEditing(false);
          onSuccess?.();
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    stopPropagation(e);
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  if (editing) {
    return (
      <div
        className="flex flex-col items-end gap-1"
        onClick={stopPropagation}
        onKeyDown={handleKeyDown}
      >
        <Input
          ref={inputRef}
          type="number"
          min={0}
          step={1}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          className="h-7 w-28 text-sm font-mono tabular-nums text-right"
          aria-label={t("maintenance.odometer.label")}
          data-testid={`odometer-input-${vehicleId}`}
        />
        {error && (
          <p className="text-xs text-destructive" data-testid={`odometer-error-${vehicleId}`}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t("maintenance.odometer.label")}
      onClick={(e) => {
        stopPropagation(e);
        enterEditMode();
      }}
      onKeyDown={(e) => {
        stopPropagation(e);
        if (e.key === "Enter") {
          e.preventDefault();
          enterEditMode();
        }
      }}
      className={cn(
        "text-sm font-mono text-foreground tabular-nums shrink-0 cursor-pointer",
        "hover:underline decoration-dashed underline-offset-2"
      )}
      data-testid={`odometer-display-${vehicleId}`}
    >
      {formatOdometerKm(localKm)}
    </span>
  );
}
