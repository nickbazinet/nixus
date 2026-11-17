import { createServerFn } from "@tanstack/react-start";
import {
  AVATAR_MAX_DECODED_BYTES,
  AVATAR_MIME_TYPES,
  PROFILE_FIELD_NAMES,
  type AvatarMimeType,
  type ProfileFields,
} from "@nixus/shared";

import { log } from "@/server/log";
import { countryOptions, loadCatalog, subdivisionOptions } from "@/server/locations";
import { saveProfileFields, type SaveOutcome } from "@/server/profile-save";
import { profileApiFor } from "@/server/runtime";
import {
  ANONYMOUS_VIEW,
  EXPIRED_VIEW,
  gate,
  type AccountView,
  type ProfileSnapshot,
} from "./gate";

/**
 * Server functions for the profile page (AD-11, AD-12).
 *
 * Every one of them goes through `gate()`, so the browser never holds a token and
 * a request can only ever reach the profile of the session that made it. Nothing
 * here logs a field value, avatar bytes, or a token — the log entries carry a
 * route, a status and a code.
 */

type Locale = "en" | "fr";

function locale(value: unknown): Locale {
  return value === "fr" ? "fr" : "en";
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // Absent is `null`, never `""` (AD-13 conventions).
  return trimmed === "" ? null : trimmed;
}

/**
 * Shape narrowing only. The profile API is the single validation authority
 * (AD-5), so this never decides whether a value is acceptable — it decides what
 * the member's type is before it crosses the wire.
 */
function toProfileFields(input: Record<string, unknown>): ProfileFields {
  const fields = Object.fromEntries(
    PROFILE_FIELD_NAMES.map((name) => [name, nullableString(input[name])]),
  );
  return fields as unknown as ProfileFields;
}

function snapshot(profile: {
  version: number;
  avatar_version: number | null;
}): ProfileSnapshot {
  return {
    fields: toProfileFields(profile as unknown as Record<string, unknown>),
    version: profile.version,
    avatar_version: profile.avatar_version,
  };
}

export const loadAccountView = createServerFn({ method: "GET" })
  .inputValidator((data: { locale?: string }) => ({ locale: locale(data.locale) }))
  .handler(async ({ data }): Promise<AccountView> => {
    const result = await gate(false);
    if (result.state === "anonymous") return ANONYMOUS_VIEW;
    if (result.state === "expired") return EXPIRED_VIEW;

    const api = profileApiFor(result.session.accessToken);
    const [profileResult, catalog] = await Promise.all([api.getProfile(), loadCatalog(api)]);

    if (!profileResult.ok) {
      log("info", { route: "/profile", code: profileResult.error.code, sub: result.session.sub });
      return { ...ANONYMOUS_VIEW, signedIn: true, email: result.session.email, error: profileResult.error.code };
    }

    const profile = profileResult.value;
    const avatarResult =
      profile && profile.avatar_version !== null ? await api.getAvatar() : null;

    return {
      signedIn: true,
      email: result.session.email,
      profile: profile ? snapshot(profile) : null,
      avatar:
        avatarResult?.ok && avatarResult.value
          ? { mime_type: avatarResult.value.mime_type, data: avatarResult.value.data }
          : null,
      countries: catalog ? countryOptions(catalog, data.locale) : [],
      subdivisions: catalog
        ? subdivisionOptions(catalog, profile?.country_code ?? null, data.locale)
        : [],
      error: null,
    };
  });

export const loadSubdivisions = createServerFn({ method: "GET" })
  .inputValidator((data: { country?: string | null; locale?: string }) => ({
    country: nullableString(data.country),
    locale: locale(data.locale),
  }))
  .handler(async ({ data }) => {
    const result = await gate(false);
    if (result.state !== "ok") return { subdivisions: [] };
    const catalog = await loadCatalog(profileApiFor(result.session.accessToken));
    return {
      subdivisions: catalog ? subdivisionOptions(catalog, data.country, data.locale) : [],
    };
  });

export type SaveProfileResponse =
  | { readonly kind: "saved"; readonly profile: ProfileSnapshot }
  | { readonly kind: "conflict"; readonly profile: ProfileSnapshot | null }
  | {
      readonly kind: "rejected";
      readonly code: string;
      readonly field: string | null;
      readonly reason: string | null;
    }
  | { readonly kind: "indeterminate" }
  | { readonly kind: "signed_out" };

function toResponse(outcome: SaveOutcome): SaveProfileResponse {
  switch (outcome.kind) {
    case "saved":
      return { kind: "saved", profile: snapshot(outcome.profile) };
    case "conflict":
      return { kind: "conflict", profile: outcome.current ? snapshot(outcome.current) : null };
    case "rejected":
      return {
        kind: "rejected",
        code: outcome.error.code,
        field: "field" in outcome.error ? outcome.error.field : null,
        reason: "reason" in outcome.error ? outcome.error.reason : null,
      };
    case "indeterminate":
      return { kind: "indeterminate" };
  }
}

export const saveProfile = createServerFn({ method: "POST" })
  .inputValidator((data: Record<string, unknown>) => ({
    fields: toProfileFields(data),
    expected_version:
      typeof data.expected_version === "number" ? data.expected_version : null,
  }))
  .handler(async ({ data }): Promise<SaveProfileResponse> => {
    const result = await gate(true);
    if (result.state !== "ok") return { kind: "signed_out" };

    const outcome = await saveProfileFields(
      profileApiFor(result.session.accessToken),
      data.fields,
      data.expected_version,
    );
    log("info", { route: "/profile", code: `save_${outcome.kind}`, sub: result.session.sub });
    return toResponse(outcome);
  });

function avatarMime(value: unknown): AvatarMimeType | null {
  return AVATAR_MIME_TYPES.includes(value as AvatarMimeType) ? (value as AvatarMimeType) : null;
}

export type SaveAvatarResponse =
  | { readonly kind: "saved" }
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "signed_out" };

export const saveAvatar = createServerFn({ method: "POST" })
  .inputValidator((data: { mime_type?: unknown; data?: unknown; expected_version?: unknown }) => ({
    mime_type: avatarMime(data.mime_type),
    data: typeof data.data === "string" ? data.data : "",
    expected_version:
      typeof data.expected_version === "number" ? data.expected_version : null,
  }))
  .handler(async ({ data }): Promise<SaveAvatarResponse> => {
    const result = await gate(true);
    if (result.state !== "ok") return { kind: "signed_out" };
    if (data.mime_type === null) return { kind: "rejected", code: "unsupported_media" };

    // The browser produced the derivative; this is the cheap refusal before a
    // ~90 KB body is forwarded. The profile API re-checks everything (AD-5).
    const decodedBytes = Buffer.from(data.data, "base64").byteLength;
    if (decodedBytes === 0 || decodedBytes > AVATAR_MAX_DECODED_BYTES) {
      log("info", { route: "/profile/avatar", code: "payload_too_large", bytes: decodedBytes });
      return { kind: "rejected", code: "payload_too_large" };
    }

    const upload = await profileApiFor(result.session.accessToken).putAvatar(
      { mime_type: data.mime_type, data: data.data },
      data.expected_version,
    );
    log("info", {
      route: "/profile/avatar",
      code: upload.ok ? "avatar_saved" : upload.error.code,
      bytes: decodedBytes,
      sub: result.session.sub,
    });
    return upload.ok ? { kind: "saved" } : { kind: "rejected", code: upload.error.code };
  });
