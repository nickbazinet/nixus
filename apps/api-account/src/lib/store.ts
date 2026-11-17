import type {
  CloudAvatar,
  CloudProfile,
  AvatarMimeType,
  ProfileFields,
} from "@nixus/shared";
import { AVATAR_MIME_TYPES } from "@nixus/shared";

import { encodeStandardBase64 } from "./avatar.ts";
import {
  VERSION_ATTRIBUTE,
  VERSION_PROJECTION,
  avatarKey,
  getItem,
  profileKey,
} from "./table.ts";

/*
 * Reads and item shapes for the two sort keys this service owns (AD-4). Responses
 * are built member by member from the contract's own field names, which is what
 * keeps `pk`, `sk` and anything else stored out of every response body (AD-3).
 */

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A stored item that does not carry these is corrupt, not absent: the caller answers `unavailable`. */
function requireString(item: Record<string, unknown>, name: string): string {
  const value = item[name];
  if (typeof value !== "string") {
    throw new Error(`stored item is missing ${name}`);
  }
  return value;
}

function requireVersion(item: Record<string, unknown>): number {
  const value = item[VERSION_ATTRIBUTE];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("stored item carries no usable version");
  }
  return value;
}

function versionOf(item: Record<string, unknown> | undefined): number | null {
  if (!item) return null;
  const value = item[VERSION_ATTRIBUTE];
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

export async function readProfileItem(
  sub: string
): Promise<Record<string, unknown> | undefined> {
  return getItem(profileKey(sub));
}

export async function readAvatarItem(
  sub: string
): Promise<Record<string, unknown> | undefined> {
  return getItem(avatarKey(sub));
}

/**
 * Projects the version alone, so `GET /` never loads the avatar's bytes to find
 * out whether a client's cached copy is current (AD-4).
 */
export async function readAvatarVersion(sub: string): Promise<number | null> {
  return versionOf(await getItem(avatarKey(sub), VERSION_PROJECTION));
}

export function profileItem(args: {
  readonly sub: string;
  readonly fields: ProfileFields;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}): Record<string, unknown> {
  return {
    ...profileKey(args.sub),
    first_name: args.fields.first_name,
    last_name: args.fields.last_name,
    birth_date: args.fields.birth_date,
    income_bracket: args.fields.income_bracket,
    income_bracket_currency: args.fields.income_bracket_currency,
    country_code: args.fields.country_code,
    subdivision_code: args.fields.subdivision_code,
    [VERSION_ATTRIBUTE]: args.version,
    created_at: args.createdAt,
    updated_at: args.updatedAt,
  };
}

export function avatarItem(args: {
  readonly sub: string;
  readonly mimeType: AvatarMimeType;
  readonly bytes: Uint8Array;
  readonly version: number;
  readonly updatedAt: string;
}): Record<string, unknown> {
  return {
    ...avatarKey(args.sub),
    // Binary, not base64 text: DynamoDB sizes a `B` attribute by its raw bytes.
    data: args.bytes,
    mime_type: args.mimeType,
    [VERSION_ATTRIBUTE]: args.version,
    updated_at: args.updatedAt,
  };
}

export function profileResponse(
  item: Record<string, unknown>,
  avatarVersion: number | null
): CloudProfile {
  return {
    first_name: stringOrNull(item.first_name),
    last_name: stringOrNull(item.last_name),
    birth_date: stringOrNull(item.birth_date),
    income_bracket: stringOrNull(item.income_bracket) as
      | CloudProfile["income_bracket"],
    income_bracket_currency: stringOrNull(item.income_bracket_currency) as
      | CloudProfile["income_bracket_currency"],
    country_code: stringOrNull(item.country_code),
    subdivision_code: stringOrNull(item.subdivision_code),
    version: requireVersion(item),
    created_at: requireString(item, "created_at"),
    updated_at: requireString(item, "updated_at"),
    avatar_version: avatarVersion,
  };
}

function storedMimeType(item: Record<string, unknown>): AvatarMimeType {
  const value = item.mime_type;
  if (
    typeof value !== "string" ||
    !(AVATAR_MIME_TYPES as readonly string[]).includes(value)
  ) {
    throw new Error("stored avatar carries no usable mime type");
  }
  return value as AvatarMimeType;
}

function storedBytes(item: Record<string, unknown>): Uint8Array {
  const value = item.data;
  if (!(value instanceof Uint8Array)) {
    throw new Error("stored avatar carries no binary data");
  }
  return value;
}

export function avatarResponse(item: Record<string, unknown>): CloudAvatar {
  return {
    mime_type: storedMimeType(item),
    data: encodeStandardBase64(storedBytes(item)),
    version: requireVersion(item),
    updated_at: requireString(item, "updated_at"),
  };
}
