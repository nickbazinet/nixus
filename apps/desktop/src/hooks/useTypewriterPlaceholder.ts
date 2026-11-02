import { useEffect, useState } from "react";

const TYPE_MS = 45;
const DELETE_MS = 22;
const HOLD_MS = 1800;
const GAP_MS = 350;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Placeholder text that types itself out, holds, erases, and moves to the next phrase — so an empty
 * prompt shows what can be asked instead of one fixed line.
 *
 * Runs only while `active` (the field is empty and unfocused): the moment the user is in the field
 * it rests on the first phrase, because text writing itself under a caret competes with their own
 * typing. Reduced motion gets the first phrase, still.
 */
export function useTypewriterPlaceholder(phrases: readonly string[], active: boolean): string {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const animate = active && phrases.length > 0 && !prefersReducedMotion();

  useEffect(() => {
    if (!animate) return;
    const phrase = phrases[index % phrases.length];

    let delay: number;
    let step: () => void;
    if (!deleting && length < phrase.length) {
      delay = TYPE_MS;
      step = () => setLength((n) => n + 1);
    } else if (!deleting) {
      delay = HOLD_MS;
      step = () => setDeleting(true);
    } else if (length > 0) {
      delay = DELETE_MS;
      step = () => setLength((n) => n - 1);
    } else {
      delay = GAP_MS;
      step = () => {
        setDeleting(false);
        setIndex((i) => (i + 1) % phrases.length);
      };
    }

    const timer = window.setTimeout(step, delay);
    return () => window.clearTimeout(timer);
  }, [animate, deleting, index, length, phrases]);

  if (!animate) return phrases[0] ?? "";
  return phrases[index % phrases.length].slice(0, length);
}
