import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";

/** `flex!` overrides the shared trigger's `[&>span]:line-clamp-1`, whose `-webkit-box` display
 *  would otherwise stack the category and its group caption vertically. The shared primitive is
 *  off limits, and a parent-scoped rule outranks a plain class, so importance is the lever left. */
const VALUE_ROW_LAYOUT = "flex! min-w-0 flex-1 items-baseline gap-1.5";

export interface ImportSelectCategory {
  id: number;
  group_id: number;
  name: string;
}

export interface ImportSelectGroup {
  id: number;
  name: string;
}

interface ImportCategorySelectProps {
  id: string;
  value: number | null;
  onChange: (categoryId: number) => void;
  categories: ImportSelectCategory[];
  groups: ImportSelectGroup[];
  placeholder: string;
  testId: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  onBlur?: () => void;
}

export function ImportCategorySelect({
  id,
  value,
  onChange,
  categories,
  groups,
  placeholder,
  testId,
  className,
  disabled,
  invalid,
  onBlur,
}: ImportCategorySelectProps) {
  const { t } = useTranslation();

  const { populatedGroups, looseCategories } = useMemo(() => {
    const withGroup = groups
      .map((group) => ({
        group,
        groupCategories: categories.filter((cat) => cat.group_id === group.id),
      }))
      .filter((entry) => entry.groupCategories.length > 0);
    const placed = new Set(
      withGroup.flatMap((entry) => entry.groupCategories.map((cat) => cat.id))
    );
    // Every category renders exactly once, so `items` and the options stay the same set. Grouping
    // is presentation: an empty groups query or a group id this list has never heard of must not
    // cost the user an option they could pick before, and there is no honest heading to file them
    // under, so they render bare.
    return {
      populatedGroups: withGroup,
      looseCategories: categories.filter((cat) => !placed.has(cat.id)),
    };
  }, [groups, categories]);

  const items = useMemo(
    () => categories.map((cat) => ({ value: String(cat.id), label: cat.name })),
    [categories]
  );

  const selected = useMemo(
    () =>
      value !== null && value > 0
        ? categories.find((cat) => cat.id === value) ?? null
        : null,
    [categories, value]
  );

  const selectedGroupName = useMemo(() => {
    if (selected === null) return null;
    return groups.find((group) => group.id === selected.group_id)?.name ?? null;
  }, [groups, selected]);

  return (
    <Select
      value={value !== null && value > 0 ? String(value) : ""}
      onValueChange={(next: string | null) => {
        if (next === null || next === "") return;
        onChange(Number(next));
      }}
      items={items}
    >
      <SelectTrigger
        id={id}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onBlur={onBlur}
        className={className}
        data-testid={testId}
      >
        <span data-slot="import-category-value" className={VALUE_ROW_LAYOUT}>
          <SelectValue
            className="min-w-0 truncate"
            placeholder={placeholder}
            data-testid="category-name"
          >
            {() => selected?.name ?? placeholder}
          </SelectValue>
          {selectedGroupName !== null && (
            <>
              {/* `basis-0 grow` gives the group only leftover space, so it truncates before the
                  category gives any up. `aria-hidden` stops it concatenating into the category
                  name; the phrased sr-only line carries the same context to assistive tech. */}
              <span
                aria-hidden="true"
                className="min-w-0 max-w-fit grow basis-0 truncate text-caption text-ink-dim"
                data-testid="category-group-context"
              >
                {selectedGroupName}
              </span>
              <span className="sr-only">
                {t("import.categoryInGroup", { group: selectedGroupName })}
              </span>
            </>
          )}
        </span>
      </SelectTrigger>
      <SelectContent>
        {populatedGroups.map(({ group, groupCategories }) => (
          <SelectGroup key={group.id}>
            <SelectGroupLabel className="sticky top-0 z-10 bg-card">
              {group.name}
            </SelectGroupLabel>
            {groupCategories.map((cat) => (
              <SelectItem key={cat.id} value={String(cat.id)}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {looseCategories.map((cat) => (
          <SelectItem key={cat.id} value={String(cat.id)}>
            {cat.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
