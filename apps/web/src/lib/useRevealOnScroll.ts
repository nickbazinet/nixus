import { useEffect } from "react";

/**
 * Reveals `[data-reveal-item]` elements as they scroll into view.
 *
 * One observer for the whole document rather than one per component: the
 * elements are static per route, so a single sweep is cheaper than a hook
 * instance per card, and a section opts in by adding an attribute instead of
 * importing anything.
 *
 * The hook does NOT decide whether to animate — `html[data-reveal="on"]`,
 * written by the pre-hydration script, is the only gate. If the attribute is
 * absent (no JS, no `IntersectionObserver`, or reduced motion) nothing was ever
 * hidden, so this hook has nothing to do and bails.
 *
 * ## Why there are two mechanisms
 *
 * Everything the CSS hides stays hidden until something reveals it, so a dead
 * observer would mean permanently blank sections. The first version guarded that
 * with a 2.5s timer that revealed every target on the page — which defeated the
 * feature: by the time a reader scrolled to the fourth section the timer had
 * already fired, and nothing below the fold ever animated again.
 *
 * So the fallback now replicates what the observer would have done instead of
 * bypassing it. `revealVisible` reveals only what is actually at or near the
 * fold, and runs on mount and on scroll. That keeps the one invariant that
 * matters — **no target is ever hidden while it is in the viewport** — without
 * spending the reveal on content the reader has not arrived at yet.
 *
 * The listeners detach as soon as nothing is left to reveal, so a fully-revealed
 * page carries no scroll handler.
 */
const REVEAL_SELECTOR = "[data-reveal-item]:not([data-revealed])";

/** Reveal once the element's top edge has risen 8% above the fold. */
const NEAR_VIEWPORT = 0.92;

export function useRevealOnScroll(routeKey: string): void {
  useEffect(() => {
    if (document.documentElement.getAttribute("data-reveal") !== "on") return;
    if (document.querySelector(REVEAL_SELECTOR) === null) return;

    /** Reveals what has reached the fold; returns how many are still below it. */
    const revealVisible = (): number => {
      const limit = window.innerHeight * NEAR_VIEWPORT;
      let remaining = 0;
      for (const el of document.querySelectorAll(REVEAL_SELECTOR)) {
        if (el.getBoundingClientRect().top < limit) {
          el.setAttribute("data-revealed", "1");
        } else {
          remaining += 1;
        }
      }
      return remaining;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-revealed", "1");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0 },
    );
    for (const el of document.querySelectorAll(REVEAL_SELECTOR)) {
      observer.observe(el);
    }

    let frame = 0;

    const detach = (): void => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };

    const onScroll = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (revealVisible() === 0) detach();
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    if (revealVisible() === 0) detach();

    return () => {
      observer.disconnect();
      detach();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [routeKey]);
}
