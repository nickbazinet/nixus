import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  focusRing,
} from "@nixus/shared";
import { cn } from "@/lib/utils";
import {
  useVehicleCatalogStatus,
  useVehicleMakes,
  useVehicleModels,
} from "@/hooks/useVehicleCatalog";

/** Suppress OS/browser autofill on make & model fields (catalog search + manual entry). */
const disableBrowserAutocomplete = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": true,
  "data-lpignore": "true",
} as const;

interface VehicleCatalogFieldsProps {
  make: string;
  model: string;
  year: string;
  onMakeChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onYearChange: (value: string) => void;
  makeInputId?: string;
  modelInputId?: string;
  yearInputId?: string;
  initialManualMode?: boolean;
}

interface SearchableComboboxProps {
  label: string;
  labelFor: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  disabled?: boolean;
  disabledHint?: string;
  testId: string;
  loading?: boolean;
  loadingMessage?: string;
}

function SearchableCombobox({
  label,
  labelFor,
  value,
  options,
  onSelect,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  disabledHint,
  testId,
  loading,
  loadingMessage,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const hintId = useId();

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [filter, options]);

  const displayValue = value.trim() || placeholder;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={labelFor}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={labelFor}
              type="button"
              variant="outline"
              disabled={disabled}
              aria-disabled={disabled || undefined}
              aria-describedby={disabled && disabledHint ? hintId : undefined}
              data-testid={testId}
              className="w-full justify-start text-body"
            />
          }
        >
          <span className={value.trim() ? "" : "text-ink-faint"}>
            {displayValue}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--anchor-width)] p-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="mb-2"
            autoFocus
            name={`catalog-search-${testId}`}
            {...disableBrowserAutocomplete}
          />
          <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {loading && (
              <p className="px-2 py-1.5 text-caption text-ink-dim">
                {loadingMessage}
              </p>
            )}
            {!loading && filtered.length === 0 && (
              <p className="px-2 py-1.5 text-caption text-ink-dim">
                {emptyMessage}
              </p>
            )}
            {!loading &&
              filtered.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={cn(
                    "min-h-target-min w-full rounded-md px-2 py-1.5 text-left text-body text-ink hover:bg-hover",
                    focusRing
                  )}
                  onClick={() => {
                    onSelect(opt);
                    setFilter("");
                    setOpen(false);
                  }}
                >
                  {opt}
                </button>
              ))}
          </div>
        </PopoverContent>
      </Popover>
      {/* The reason sits beside the control, not inside a popover the disabled trigger cannot
          open — a dead button with no reachable explanation is the pattern this replaces. */}
      {disabled && disabledHint && (
        <p id={hintId} className="text-caption text-ink-dim">
          {disabledHint}
        </p>
      )}
    </div>
  );
}

export function VehicleCatalogFields({
  make,
  model,
  year,
  onMakeChange,
  onModelChange,
  onYearChange,
  makeInputId = "vehicle-make",
  modelInputId = "vehicle-model",
  yearInputId = "vehicle-year",
  initialManualMode,
}: VehicleCatalogFieldsProps) {
  const { t } = useTranslation();
  const { data: status, isLoading: statusLoading } = useVehicleCatalogStatus();
  const catalogAvailable = status?.available ?? false;
  const { data: makes = [] } = useVehicleMakes(
    catalogAvailable && !statusLoading
  );

  const parsedYear = year.trim() ? Number.parseInt(year, 10) : null;
  const yearValid =
    parsedYear !== null &&
    !Number.isNaN(parsedYear) &&
    parsedYear >= 1900 &&
    parsedYear <= 2100;

  const { data: models = [], isFetching: modelsLoading } = useVehicleModels(
    make,
    yearValid ? parsedYear : null,
    catalogAvailable && !statusLoading
  );

  const [manualMode, setManualMode] = useState(initialManualMode ?? false);

  useEffect(() => {
    if (initialManualMode !== undefined) {
      setManualMode(initialManualMode);
      return;
    }
    if (!catalogAvailable || !make.trim()) return;
    const inList = makes.some((m) => m.name === make.trim());
    if (!inList) {
      setManualMode(true);
    }
  }, [catalogAvailable, makes, make, initialManualMode]);

  const makeOptions = makes.map((m) => m.name);
  const modelOptions = models.map((m) => m.name);

  const handleMakeSelect = (selected: string) => {
    onMakeChange(selected);
    onModelChange("");
  };

  const handleYearChange = (nextYear: string) => {
    onYearChange(nextYear);
    onModelChange("");
  };

  if (statusLoading) {
    return (
      <div className="flex flex-col gap-3" data-testid="vehicle-catalog-loading">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={makeInputId}>{t("maintenance.fields.make")}</Label>
          <Input
            id={makeInputId}
            value={make}
            onChange={(e) => onMakeChange(e.target.value)}
            name={makeInputId}
            {...disableBrowserAutocomplete}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={modelInputId}>{t("maintenance.fields.model")}</Label>
          <Input
            id={modelInputId}
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            name={modelInputId}
            {...disableBrowserAutocomplete}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={yearInputId}>{t("maintenance.fields.year")}</Label>
          <Input
            id={yearInputId}
            type="number"
            min={1900}
            max={2100}
            step={1}
            value={year}
            onChange={(e) => onYearChange(e.target.value)}
          />
        </div>
      </div>
    );
  }

  if (!catalogAvailable) {
    return (
      <div data-testid="vehicle-catalog-mode-manual">
        <p className="mb-3 text-caption text-ink-dim">
          {t("maintenance.catalog.unavailableHint")}
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={makeInputId}>{t("maintenance.fields.make")}</Label>
            <Input
              id={makeInputId}
              value={make}
              onChange={(e) => onMakeChange(e.target.value)}
              name={makeInputId}
              {...disableBrowserAutocomplete}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={modelInputId}>
              {t("maintenance.fields.model")}
            </Label>
            <Input
              id={modelInputId}
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              name={modelInputId}
              {...disableBrowserAutocomplete}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={yearInputId}>{t("maintenance.fields.year")}</Label>
            <Input
              id={yearInputId}
              type="number"
              min={1900}
              max={2100}
              step={1}
              value={year}
              onChange={(e) => onYearChange(e.target.value)}
            />
          </div>
        </div>
      </div>
    );
  }

  if (manualMode) {
    return (
      <div data-testid="vehicle-catalog-mode-manual">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={makeInputId}>{t("maintenance.fields.make")}</Label>
            <Input
              id={makeInputId}
              value={make}
              onChange={(e) => onMakeChange(e.target.value)}
              name={makeInputId}
              {...disableBrowserAutocomplete}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={modelInputId}>
              {t("maintenance.fields.model")}
            </Label>
            <Input
              id={modelInputId}
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              name={modelInputId}
              {...disableBrowserAutocomplete}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={yearInputId}>{t("maintenance.fields.year")}</Label>
            <Input
              id={yearInputId}
              type="number"
              min={1900}
              max={2100}
              step={1}
              value={year}
              onChange={(e) => onYearChange(e.target.value)}
            />
          </div>
        </div>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="mt-2 h-auto p-0"
          data-testid="vehicle-catalog-manual-toggle"
          onClick={() => setManualMode(false)}
        >
          {t("maintenance.catalog.useCatalog")}
        </Button>
      </div>
    );
  }

  return (
    <div data-testid="vehicle-catalog-mode-catalog">
      {status?.stale && (
        <p className="mb-3 text-caption text-ink-dim">
          {t("maintenance.catalog.staleHint")}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={yearInputId}>{t("maintenance.fields.year")}</Label>
          <Input
            id={yearInputId}
            type="number"
            min={1900}
            max={2100}
            step={1}
            value={year}
            onChange={(e) => handleYearChange(e.target.value)}
          />
        </div>

        <SearchableCombobox
          label={t("maintenance.fields.make")}
          labelFor={makeInputId}
          value={make}
          options={makeOptions}
          onSelect={handleMakeSelect}
          placeholder={t("maintenance.catalog.searchMake")}
          searchPlaceholder={t("maintenance.catalog.searchMake")}
          emptyMessage={t("maintenance.catalog.noMakes")}
          testId="vehicle-catalog-make"
        />

        <SearchableCombobox
          label={t("maintenance.fields.model")}
          labelFor={modelInputId}
          value={model}
          options={modelOptions}
          onSelect={onModelChange}
          placeholder={t("maintenance.catalog.searchModel")}
          searchPlaceholder={t("maintenance.catalog.searchModel")}
          emptyMessage={t("maintenance.catalog.noModels")}
          disabled={!make.trim() || !yearValid}
          disabledHint={
            !yearValid
              ? t("maintenance.catalog.selectYearFirst")
              : t("maintenance.catalog.selectMakeFirst")
          }
          testId="vehicle-catalog-model"
          loading={modelsLoading}
          loadingMessage={t("maintenance.catalog.loadingModels")}
        />
      </div>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="mt-2 h-auto p-0"
        data-testid="vehicle-catalog-manual-toggle"
        onClick={() => setManualMode(true)}
      >
        {t("maintenance.catalog.enterManually")}
      </Button>
    </div>
  );
}
