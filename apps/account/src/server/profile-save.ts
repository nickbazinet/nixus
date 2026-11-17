import {
  PROFILE_FIELD_NAMES,
  type AccountError,
  type CloudProfile,
  type ProfileFields,
} from "@nixus/shared";

import type { ProfileApi } from "./profile-client.ts";

/**
 * The save path's two awkward outcomes, in one place (AD-7 L1, adversary H5/H6).
 *
 * `version_conflict` reloads the one resource that conflicted so the UI can tell
 * the user what changed WITHOUT asserting that another actor changed it — on a
 * single-user profile the other actor is almost always the user's own other
 * device, or their own earlier tab.
 *
 * A save whose response was never observed is resolved by a `GET` and a field
 * comparison before anything is shown. Reporting "it failed" on a write the server
 * accepted is how a user ends up re-sending a save that then conflicts with
 * itself.
 */

export type SaveOutcome =
  | { readonly kind: "saved"; readonly profile: CloudProfile }
  | { readonly kind: "conflict"; readonly current: CloudProfile | null }
  | { readonly kind: "rejected"; readonly error: AccountError }
  | { readonly kind: "indeterminate" };

function sameFields(profile: CloudProfile, submitted: ProfileFields): boolean {
  return PROFILE_FIELD_NAMES.every((name) => profile[name] === submitted[name]);
}

async function reloadProfile(api: ProfileApi): Promise<CloudProfile | null> {
  const reread = await api.getProfile();
  return reread.ok ? reread.value : null;
}

export async function saveProfileFields(
  api: ProfileApi,
  fields: ProfileFields,
  expectedVersion: number | null,
): Promise<SaveOutcome> {
  let result;
  try {
    result = await api.putProfile(fields, expectedVersion);
  } catch {
    // The request may or may not have been applied. Ask.
    const current = await reloadProfile(api);
    if (current && sameFields(current, fields)) return { kind: "saved", profile: current };
    return { kind: "indeterminate" };
  }

  if (result.ok) return { kind: "saved", profile: result.value };
  if (result.error.code === "version_conflict") {
    return { kind: "conflict", current: await reloadProfile(api) };
  }
  return { kind: "rejected", error: result.error };
}
