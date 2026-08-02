import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Input, Money, focusRing } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";

// The dotted underline is the REQUIRED resting affordance, not decoration: a hover pencil is
// invisible to a keyboard-focus-only user, who never triggers hover. Never explained in helper
// text — the affordance has to carry itself.
const restingAffordance =
  "inline-flex min-h-target-min cursor-pointer items-center border-b border-dotted border-line-strong transition-colors hover:border-line-strong hover:text-ink";

function isActivationKey(key: string) {
  return key === "Enter" || key === " ";
}

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
  const { t } = useTranslation();
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
      toast.success(t("shell.changeSaved"));
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
        className={cn("h-7", inputClassName)}
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
        if (isActivationKey(e.key)) {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(restingAffordance, "text-body text-ink", focusRing, className)}
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
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
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
      toast.success(t("shell.changeSaved"));
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
      <span
        onKeyDown={handleKeyDown}
        className="inline-flex align-middle"
        data-testid={testId ? `${testId}-input` : undefined}
      >
        <MoneyInput
          value={draft}
          onChange={setDraft}
          onBlur={handleSave}
          className="h-7 w-28"
        />
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (isActivationKey(e.key)) {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(restingAffordance, "text-body text-ink", focusRing, className)}
      data-testid={testId}
    >
      <Money cents={value} locale={i18n.language} {...maskProps} />
    </span>
  );
}
