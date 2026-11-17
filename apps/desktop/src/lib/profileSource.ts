/**
 * Which demographic home the open profile has, and the opaque key every profile command is
 * threaded with (AD-6).
 *
 * Rust's resolver is the authority and re-checks the key before any read or write, so this is a
 * projection of its answer, never a second one: `get_profile_source` is what `/profile` reads.
 */
export type ProfileSourceKind = "local" | "cloud" | "none";

export interface ProfileSourceInfo {
  readonly kind: ProfileSourceKind;
  readonly source_key: string | null;
}

/** The subset of `get_active_profile`'s answer the source is derived from. */
interface ActiveDatasetFacts {
  readonly kind: "local" | "cloud-linked";
  readonly dataset_id: string;
  readonly is_signed_in: boolean;
}

/**
 * The same mapping Rust's resolver performs, derived from the already-mounted active-profile query.
 *
 * It exists for the always-mounted account menu, which reads the avatar and therefore needs a
 * source key — and may not add an `invoke()` of its own (D11), because every one of the repo's
 * ~40 Playwright specs would then need a mock for it or render the header in its error state.
 * Everything the mapping needs already crosses IPC on that query: `is_signed_in` is computed in
 * Rust by comparing the session's subject to the dataset's own, so no identity is derived here.
 *
 * Route-scoped surfaces call `get_profile_source` instead. Either way Rust refuses a key that no
 * longer names the active dataset, so this cannot authorize anything by itself.
 */
export function deriveProfileSource(
  active: ActiveDatasetFacts | null | undefined,
): ProfileSourceInfo {
  // `null` as well as `undefined`: the command answers `null` on a run with no profile open, and
  // this runs in an always-mounted header where a throw takes the whole app down with it.
  if (active === null || active === undefined) {
    return { kind: "none", source_key: null };
  }

  if (active.kind === "local") {
    return { kind: "local", source_key: `local:${active.dataset_id}` };
  }

  return active.is_signed_in
    ? { kind: "cloud", source_key: `cloud:${active.dataset_id}` }
    : { kind: "none", source_key: null };
}
