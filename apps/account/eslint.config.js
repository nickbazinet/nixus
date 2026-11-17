import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".tanstack/**",
      ".deploy/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "src/routeTree.gen.ts",
    ],
  },
  tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    rules: {
      // AD-12: nothing this app handles is safe to print ad hoc. Server logging
      // goes through src/server/log.ts, which is the one allowed console site.
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/server/log.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["scripts/**/*.ts", "tests/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
