import type { GetProfileResponse, PutProfileResponse } from "@nixus/shared";

import { failConflict } from "../lib/errors.ts";
import {
  profileItem,
  profileResponse,
  readAvatarVersion,
  readProfileItem,
} from "../lib/store.ts";
import { putVersionedItem } from "../lib/table.ts";
import { validateProfileRequest } from "../lib/validation.ts";

/*
 * `GET /` and `PUT /` (AD-4). The `sub` arrives already taken from the
 * authorizer's verified claims: nothing here reads an identifier from a body, a
 * path or a query, so one user's token can only ever compose one user's key.
 */

export async function handleGetProfile(
  sub: string
): Promise<GetProfileResponse> {
  const item = await readProfileItem(sub);
  // Absent is a 200 with the JSON literal `null`, not a 404: a Nixus Cloud
  // account without a profile yet is a normal state (AD-2).
  if (!item) return null;

  return profileResponse(item, await readAvatarVersion(sub));
}

export async function handlePutProfile(args: {
  readonly sub: string;
  readonly body: string | undefined;
  readonly now: Date;
}): Promise<PutProfileResponse> {
  const { sub, body, now } = args;

  const { fields, expectedVersion } = validateProfileRequest(body, now);
  const updatedAt = now.toISOString();

  let createdAt = updatedAt;
  let version = 1;

  if (expectedVersion !== null) {
    const existing = await readProfileItem(sub);
    // A numbered write against an absent item is a conflict, never a create.
    if (!existing) failConflict("profile", null);

    // Carried forward verbatim; regenerating it would silently destroy the one
    // field that is set once and never overwritten.
    const storedCreatedAt = existing.created_at;
    createdAt =
      typeof storedCreatedAt === "string" ? storedCreatedAt : updatedAt;
    version = expectedVersion + 1;
  }

  const item = profileItem({ sub, fields, version, createdAt, updatedAt });
  await putVersionedItem({ item, expectedVersion, resource: "profile" });

  // Read after the write, so the response's `avatar_version` is the one a client
  // compares its cached avatar against.
  return profileResponse(item, await readAvatarVersion(sub));
}
