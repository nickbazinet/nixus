// In TanStack Start v1 (post-Vinxi, March 2026 GA), framework configuration
// lives in `vite.config.ts` via the `tanstackStart()` plugin. This file is kept
// only to satisfy the documented `app.config.ts` artifact in the architecture
// spec — it re-exports the Vite config as a compatibility shim.
//
// See: https://tanstack.com/start/latest
//
// To configure prerendering, server adapter, or routing — edit `vite.config.ts`.
export { default } from "./vite.config";
