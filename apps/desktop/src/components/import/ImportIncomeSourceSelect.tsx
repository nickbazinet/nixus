import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";

export interface ImportSelectIncomeSource {
  id: number;
  name: string;
}

const NEW_SOURCE_VALUE = "new";

interface ImportIncomeSourceSelectProps {
  id: string;
  /** An existing source id, or `0` for a new source named `newSourceName`. */
  value: number;
  newSourceName: string;
  onChange: (sourceId: number) => void;
  sources: ImportSelectIncomeSource[];
  testId: string;
  className?: string;
}

export function ImportIncomeSourceSelect({
  id,
  value,
  newSourceName,
  onChange,
  sources,
  testId,
  className,
}: ImportIncomeSourceSelectProps) {
  const { t } = useTranslation();
  const newSourceLabel = t("import.newIncomeSource", { name: newSourceName });
  const selected = value > 0 ? sources.find((source) => source.id === value) ?? null : null;

  const items = useMemo(
    () => [
      ...sources.map((source) => ({ value: String(source.id), label: source.name })),
      { value: NEW_SOURCE_VALUE, label: newSourceLabel },
    ],
    [sources, newSourceLabel]
  );

  return (
    <Select
      value={selected ? String(selected.id) : NEW_SOURCE_VALUE}
      onValueChange={(next: string | null) => {
        if (next === null || next === "") return;
        onChange(next === NEW_SOURCE_VALUE ? 0 : Number(next));
      }}
      items={items}
    >
      <SelectTrigger id={id} className={className} data-testid={testId}>
        <SelectValue className="min-w-0 truncate" data-testid="income-source-name">
          {() => selected?.name ?? newSourceLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {sources.map((source) => (
          <SelectItem key={source.id} value={String(source.id)}>
            {source.name}
          </SelectItem>
        ))}
        {sources.length > 0 && <SelectSeparator />}
        <SelectItem value={NEW_SOURCE_VALUE}>{newSourceLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}
