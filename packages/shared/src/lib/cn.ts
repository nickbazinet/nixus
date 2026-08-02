import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge only knows the class names it ships with, and tokens.css adds two families it has
// never seen. Both gaps fail silently, which is why they are configured here rather than worked
// around at call sites.
//
// 1. Any `text-*` it cannot identify as a font size is classified as a COLOUR. Without the font-size
//    extension every type role — text-display, text-h3, text-label, text-column-head — is deleted
//    the moment a `text-ink*` class appears in the same cn() call, so the type scale never reaches
//    the DOM.
//
// 2. Named spacing (`p-card-pad`, `gap-grid-gap`, `size-target-min`, ...) is neither a number nor an
//    arbitrary value, so it is treated as an unknown class that conflicts with nothing. A call site
//    passing `p-0` to a Card would then get BOTH declarations and lose the override.
//
// shadow-float is registered as a box-shadow rather than a shadow colour for the same reason.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        "card-pad",
        "grid-gap",
        "page-x",
        "page-y",
        "section-gap",
        "rail-w",
        "rail-w-expanded",
        "target-min",
        "focus-ring-w",
        "focus-offset-w",
      ],
    },
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "stat",
            "h1",
            "h2",
            "h3",
            "body",
            "label",
            "column-head",
            "caption",
            "micro",
          ],
        },
      ],
      shadow: [{ shadow: ["float"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
