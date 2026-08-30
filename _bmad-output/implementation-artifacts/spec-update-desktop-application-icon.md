---
title: 'Align desktop application icon with Nixus wordmark'
type: 'feature'
created: '2026-08-30'
status: 'done'
route: 'one-shot'
---

# Align desktop application icon with Nixus wordmark

## Intent

**Problem:** Tauri’s generated application icon assets used legacy cyan/yellow rings while the in-app Nixus identity uses the multicolor N, and the first corrected N filled too much of the Cmd+Tab tile.

**Approach:** Keep the sidebar wordmark unchanged, add a dedicated Tauri source SVG using the same N at 75% scale, regenerate the existing desktop/Windows icon outputs, and remove only the proven-unreferenced scaffold logo.

## Suggested Review Order

**Canonical app-icon source**

- Centered scale transform preserves the N geometry with 25% more breathing room.
  [`app-icon.svg:1`](../../apps/desktop/src-tauri/app-icon.svg#L1)

**Tauri integration**

- Existing bundle entries consume regenerated PNG, ICNS, and ICO variants.
  [`tauri.conf.json:43`](../../apps/desktop/src-tauri/tauri.conf.json#L43)
