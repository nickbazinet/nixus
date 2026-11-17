import { defineConfig } from "vitest/config";

export default defineConfig({
  // The 570 KB ISO 3166 catalog is imported by the Lambda's locations module.
  // `stringify` keeps Vite from emitting it as a JS object literal, which an
  // esbuild transform of that size makes the slowest step of the whole suite.
  json: { stringify: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
