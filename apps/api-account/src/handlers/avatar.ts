import type { GetAvatarResponse, PutAvatarResponse } from "@nixus/shared";

import { validateAvatarRequest } from "../lib/avatar.ts";
import { avatarItem, avatarResponse, readAvatarItem } from "../lib/store.ts";
import { putVersionedItem } from "../lib/table.ts";

/*
 * `GET /avatar` and `PUT /avatar` (AD-4). The avatar is its own item with its own
 * version, and it is never written in the same operation as the profile.
 */

export async function handleGetAvatar(sub: string): Promise<GetAvatarResponse> {
  const item = await readAvatarItem(sub);
  if (!item) return null;
  return avatarResponse(item);
}

export async function handlePutAvatar(args: {
  readonly sub: string;
  readonly body: string | undefined;
  readonly now: Date;
}): Promise<PutAvatarResponse> {
  const { sub, body, now } = args;

  const { mimeType, bytes, expectedVersion } = validateAvatarRequest(body);
  const updatedAt = now.toISOString();
  // No read-before-write: the avatar item carries no field to carry forward, and
  // the condition on `version` is what makes the increment safe.
  const version = expectedVersion === null ? 1 : expectedVersion + 1;

  const item = avatarItem({ sub, mimeType, bytes, version, updatedAt });
  await putVersionedItem({ item, expectedVersion, resource: "avatar" });

  return avatarResponse(item);
}
