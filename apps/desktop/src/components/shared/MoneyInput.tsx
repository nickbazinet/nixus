import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface MoneyInputProps {
  value: number; // cents
  onChange: (cents: number) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
}

/**
 * MoneyInput - UX-DR18 compliant monetary input.
 * Displays with $ prefix, monospace font, auto-formats with commas on blur.
 * Accepts dollar input, stores/returns value as integer cents.
 */
export function MoneyInput({
  value,
  onChange,
  onBlur,
  placeholder = "0.00",
  className,
  id,
  "aria-invalid": ariaInvalid,
}: MoneyInputProps) {
  const formatDisplay = useCallback((cents: number): string => {
    if (cents === 0) return "";
    const dollars = cents / 100;
    return dollars.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, []);

  const [displayValue, setDisplayValue] = useState(() => formatDisplay(value));
  const [isFocused, setIsFocused] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.]/g, "");

    // Prevent multiple decimal points
    const parts = raw.split(".");
    const sanitized =
      parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : raw;

    // Limit to 2 decimal places
    const decimalParts = sanitized.split(".");
    const limited =
      decimalParts.length === 2 && decimalParts[1].length > 2
        ? decimalParts[0] + "." + decimalParts[1].slice(0, 2)
        : sanitized;

    setDisplayValue(limited);

    const dollars = parseFloat(limited);
    if (!isNaN(dollars)) {
      onChange(Math.round(dollars * 100));
    } else if (limited === "" || limited === ".") {
      onChange(0);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    // Show raw number without commas when focused
    if (value > 0) {
      setDisplayValue((value / 100).toFixed(2));
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    setDisplayValue(formatDisplay(value));
    onBlur?.();
  };

  return (
    <div className="relative">
      <span
        className={cn(
          "absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-muted-foreground",
          isFocused && "text-foreground"
        )}
      >
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        className={cn(
          "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent pl-7 pr-2.5 py-1 font-mono text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
          className
        )}
      />
    </div>
  );
}
