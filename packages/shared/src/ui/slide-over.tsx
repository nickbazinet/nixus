import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { focusRing } from "./focus";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

// Every create and edit flow. Never nested — a second SlideOver over a first is the modal stack
// this system bans.
//
// `description` is optional only so the apps/desktop migration can land in pieces. Supply it:
// aria-describedby is required on every off-canvas surface and the app currently ships zero.
export function SlideOver({
  open,
  onClose,
  title,
  description,
  children,
  className,
  "data-testid": testId,
}: SlideOverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // The cleanup path is the focus-return path, so it fires whether the panel is closed by the user
  // or unmounted by a route change. Focus goes back to the element that opened it — the row, the
  // value, the button — never to <body>, which would drop a keyboard user at the top of the shell.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const timer = setTimeout(() => {
      const firstField = panelRef.current?.querySelector<HTMLElement>(
        "input, select, textarea, button:not([data-close])"
      );
      (firstField ?? panelRef.current)?.focus();
    }, 100);
    return () => {
      clearTimeout(timer);
      previousFocusRef.current?.focus();
    };
  }, [open]);

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
      <div
        className="fixed inset-0 z-40 bg-scrim transition-opacity"
        onClick={onClose}
        aria-hidden="true"
        data-testid={testId ? `${testId}-backdrop` : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-slot="slide-over"
        data-testid={testId}
        className={cn(
          "fixed top-0 right-0 bottom-0 z-40 flex w-[400px] flex-col rounded-l-xl border-l border-line bg-card text-body text-ink shadow-float",
          "animate-in slide-in-from-right duration-300",
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-card-pad py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-h2 text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-caption text-ink-dim">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            data-close
            className={cn(
              "-mr-1 inline-flex min-h-target-min min-w-target-min shrink-0 items-center justify-center rounded-md p-1 text-ink-dim transition-colors hover:bg-hover hover:text-ink",
              focusRing
            )}
            aria-label="Close panel"
            data-testid="slide-over-close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-card-pad py-card-pad">
          {children}
        </div>
      </div>
    </>
  );
}
