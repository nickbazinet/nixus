import { useState, useRef, useEffect } from "react";
import { Input } from "@nkbaz/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { cn } from "@/lib/utils";

interface InlineEditTextProps {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  inputClassName?: string;
  "data-testid"?: string;
}

export function InlineEditText({
  value,
  onSave,
  className,
  inputClassName,
  "data-testid": testId,
}: InlineEditTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  // Sync draft with external value when not editing
  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    }
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        className={cn("h-7 text-sm", inputClassName)}
        data-testid={testId ? `${testId}-input` : undefined}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") setEditing(true);
      }}
      className={cn("cursor-pointer hover:underline decoration-dashed underline-offset-2", className)}
      data-testid={testId}
    >
      {value}
    </span>
  );
}

interface InlineEditMoneyProps {
  value: number; // cents
  onSave: (cents: number) => void;
  className?: string;
  "data-testid"?: string;
}

export function InlineEditMoney({
  value,
  onSave,
  className,
  "data-testid": testId,
}: InlineEditMoneyProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  // Sync draft with external value when not editing
  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  const handleSave = () => {
    if (draft > 0 && draft !== value) {
      onSave(draft);
    }
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      <div onKeyDown={handleKeyDown} data-testid={testId ? `${testId}-input` : undefined}>
        <MoneyInput
          value={draft}
          onChange={setDraft}
          onBlur={handleSave}
          className="h-7 w-28 text-sm"
        />
      </div>
    );
  }

  const dollars = value / 100;
  const formatted = dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") setEditing(true);
      }}
      className={cn(
        "font-mono text-sm text-foreground tabular-nums cursor-pointer hover:underline decoration-dashed underline-offset-2",
        className
      )}
      data-testid={testId}
    >
      {formatted}
    </span>
  );
}
