import {
  toAccountErrorCode,
  type AccountError,
  type AccountErrorCode,
  type AvatarPayload,
  type CloudProfile,
  type GetAvatarResponse,
  type GetProfileResponse,
  type LocationsResponse,
  type ProfileFields,
} from "@nixus/shared";

/**
 * The account app's ONLY profile access (AD-11).
 *
 * Every read and write goes to `https://api.nixusapp.com/v1/profile` with the
 * session's own user access token. The account-app IAM role holds nothing on the
 * profile table, and this module holds no AWS client — so there is exactly one
 * writer and one validation authority for a profile, and the app cannot become a
 * second one by accident.
 *
 * A request is bound to the token it was given: `sub` is never a parameter here,
 * so no request can select another subject's profile.
 */

export type ProfileResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AccountError };

export interface ProfileApi {
  getProfile(): Promise<ProfileResult<GetProfileResponse>>;
  putProfile(
    fields: ProfileFields,
    expectedVersion: number | null,
  ): Promise<ProfileResult<CloudProfile>>;
  getAvatar(): Promise<ProfileResult<GetAvatarResponse>>;
  putAvatar(
    payload: AvatarPayload,
    expectedVersion: number | null,
  ): Promise<ProfileResult<unknown>>;
  getLocations(): Promise<ProfileResult<LocationsResponse>>;
}

function fallbackError(code: AccountErrorCode): AccountError {
  return { code, message: "The profile service is unavailable.", request_id: "" } as AccountError;
}

async function readError(response: Response): Promise<AccountError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallbackError("unavailable");
  }
  const envelope = (body as { error?: Record<string, unknown> }).error;
  if (!envelope) return fallbackError("unavailable");

  const code = toAccountErrorCode(envelope.code);
  // An insufficient-scope 403 means the grant cannot be widened by a refresh, so
  // the user has to authenticate again (AD-13).
  const resolved: AccountErrorCode =
    code === "unauthorized" && response.status === 403 ? "reauthentication_required" : code;

  return { ...envelope, code: resolved } as AccountError;
}

async function readJson<T>(response: Response): Promise<ProfileResult<T>> {
  if (!response.ok) return { ok: false, error: await readError(response) };
  try {
    return { ok: true, value: (await response.json()) as T };
  } catch {
    return { ok: false, error: fallbackError("unavailable") };
  }
}

export function createProfileApi(baseUrl: string, accessToken: string): ProfileApi {
  const call = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      },
    });

  const put = <T>(path: string, body: unknown): Promise<ProfileResult<T>> =>
    call(path, { method: "PUT", body: JSON.stringify(body) }).then(readJson<T>);

  return {
    getProfile: () => call("").then(readJson<GetProfileResponse>),
    putProfile: (fields, expectedVersion) =>
      put<CloudProfile>("", { ...fields, expected_version: expectedVersion }),
    getAvatar: () => call("/avatar").then(readJson<GetAvatarResponse>),
    putAvatar: (payload, expectedVersion) =>
      put<unknown>("/avatar", { ...payload, expected_version: expectedVersion }),
    getLocations: () => call("/locations").then(readJson<LocationsResponse>),
  };
}
