import { describe, expect, it } from "vitest";
import { deriveProfileSource } from "@/lib/profileSource";

const DATASET_ID = "00000000-0000-4000-8000-000000000001";

describe("deriveProfileSource", () => {
  it("names the local document whatever the machine-wide session says", () => {
    for (const isSignedIn of [false, true]) {
      expect(
        deriveProfileSource({
          kind: "local",
          dataset_id: DATASET_ID,
          is_signed_in: isSignedIn,
        }),
      ).toEqual({ kind: "local", source_key: `local:${DATASET_ID}` });
    }
  });

  it("names the cloud copy only while this dataset's own account is signed in", () => {
    expect(
      deriveProfileSource({
        kind: "cloud-linked",
        dataset_id: DATASET_ID,
        is_signed_in: true,
      }),
    ).toEqual({ kind: "cloud", source_key: `cloud:${DATASET_ID}` });
  });

  // `is_signed_in` is computed in Rust by comparing the session's subject to the dataset's own, so
  // a false here is the cross-account case as much as the signed-out one: a machine-wide session
  // belonging to another account must resolve to nothing, never to that account's copy.
  it("resolves to no source for a cloud-linked dataset whose account is not signed in", () => {
    expect(
      deriveProfileSource({
        kind: "cloud-linked",
        dataset_id: DATASET_ID,
        is_signed_in: false,
      }),
    ).toEqual({ kind: "none", source_key: null });
  });

  // Both absent shapes, because the command answers `null` on a run with no profile open while the
  // query is `undefined` until it resolves — and this runs in an always-mounted header, where a
  // throw takes the whole app down rather than failing one surface.
  it("resolves to no source for either absent answer", () => {
    for (const absent of [undefined, null]) {
      expect(deriveProfileSource(absent)).toEqual({
        kind: "none",
        source_key: null,
      });
    }
  });

  // The key is keyed on the DATASET in both arms: the Cognito subject never crosses IPC (D3), so a
  // key the webview holds must not be able to carry one.
  it("builds every key from the dataset id alone", () => {
    for (const kind of ["local", "cloud-linked"] as const) {
      const derived = deriveProfileSource({
        kind,
        dataset_id: DATASET_ID,
        is_signed_in: true,
      });
      expect(derived.source_key).toContain(DATASET_ID);
      expect(derived.source_key).toMatch(/^(local|cloud):/);
    }
  });
});
