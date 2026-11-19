import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ACCOUNT_CLIENT_VERSION } from "./client-version.ts";

/*
 * The constant is hand-written so the manifest never reaches the server bundle
 * (see `client-version.ts`). This is what keeps it honest: a version bump that
 * edits `package.json` and forgets this file fails here rather than quietly
 * telling the billing API the wrong version for a release.
 */

const MANIFEST = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string };

describe("ACCOUNT_CLIENT_VERSION", () => {
  it("is the version this package declares", () => {
    expect(ACCOUNT_CLIENT_VERSION).toBe(MANIFEST.version);
  });

  it("is a numeric triple the server-side floor can compare", () => {
    expect(ACCOUNT_CLIENT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
