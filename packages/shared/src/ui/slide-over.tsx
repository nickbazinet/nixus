import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  "data-testid"?: string;
}

export function SlideOver({
  open,
  onClose,
  title,
  children,
  "data-testid": testId,
}: SlideOverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // Focus management
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      const timer = setTimeout(() => {
        const firstInput = panelRef.current?.querySelector<HTMLElement>(
          "input, select, textarea, button:not([data-close])"
        );
        firstInput?.focus();
      }, 100);
      return () => clearTimeout(timer);
    } else if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus();
    }
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/15 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
        data-testid={testId ? `${testId}-backdrop` : undefined}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        aria-label={title}
        data-testid={testId}
        className={cn(
          "fixed top-0 right-0 bottom-0 z-40 w-[400px] bg-card border-l border-border shadow-lg",
          "flex flex-col",
          "animate-in slide-in-from-right duration-300"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            data-close
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close panel"
            data-testid="slide-over-close"
          >
            <X size={18} />
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </>
  );
}
