// Ring PLUS surface-coloured offset, per DESIGN.md {components.focus-ring}. The offset is
// load-bearing, not decoration: in dark mode a ring must clear 3:1 against both --card and
// --brand, which is an empty solution set for any single hex. Separating the ring from the
// element with an offset means it only ever needs contrast against the surface behind it, so it
// stays legible on a brand-filled primary button.
//
// Deliberately no `outline-none` companion: that would set --tw-outline-style to `none` and the
// focus-visible width would then render with no style at all.
const focusRing =
  "focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2"

export { focusRing }
