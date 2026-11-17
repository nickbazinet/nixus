import { sendJson, startFake, type RunningFake } from "./fake";

/**
 * Stub profile API, standing in for `https://api.nixusapp.com/v1/profile`.
 *
 * It enforces the two things the BFF's behaviour depends on: a bearer token must
 * be present (so a request that lost its token fails here rather than silently
 * succeeding), and `expected_version` decides between a create, an accepted write
 * and a `version_conflict`.
 */

interface StoredProfile {
  version: number;
  avatar_version: number | null;
  [field: string]: unknown;
}

export interface RunningProfileApi extends RunningFake {
  readonly tokens: string[];
  profile: StoredProfile | null;
  avatar: { mime_type: string; data: string; version: number } | null;
  /** Forces the next PUT to answer `version_conflict`. */
  conflictNext: boolean;
}

const LOCATIONS = {
  countries: [
    {
      code: "CA",
      name_en: "Canada",
      name_fr: "Canada",
      subdivisions: [
        { code: "CA-QC", name_en: "Quebec", name_fr: "Québec" },
        { code: "CA-ON", name_en: "Ontario", name_fr: "Ontario" },
      ],
    },
    { code: "FR", name_en: "France", name_fr: "France", subdivisions: [] },
  ],
};

function envelope(code: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message: "fixed sentence", request_id: "req-stub", ...extra } };
}

export async function startProfileApi(): Promise<RunningProfileApi> {
  const tokens: string[] = [];
  const state = {
    profile: null as StoredProfile | null,
    avatar: null as { mime_type: string; data: string; version: number } | null,
    conflictNext: false,
  };

  const fake = await startFake("profile-api", (request, response) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      return sendJson(response, 401, envelope("unauthorized"));
    }
    tokens.push(authorization.slice(7));

    const path = request.url.pathname.replace(/^\/v1\/profile/, "");

    if (path === "/locations") return sendJson(response, 200, LOCATIONS);

    if (path === "" && request.method === "GET") {
      return sendJson(response, 200, state.profile);
    }

    if (path === "" && request.method === "PUT") {
      const body = JSON.parse(request.body) as Record<string, unknown> & {
        expected_version: number | null;
      };
      const current = state.profile?.version ?? null;
      if (state.conflictNext || body.expected_version !== current) {
        state.conflictNext = false;
        return sendJson(
          response,
          409,
          envelope("version_conflict", { resource: "profile", current_version: current }),
        );
      }
      const fields = { ...body, expected_version: undefined };
      delete fields.expected_version;
      state.profile = {
        ...fields,
        version: (current ?? 0) + 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
        avatar_version: state.avatar?.version ?? null,
      };
      return sendJson(response, 200, state.profile);
    }

    if (path === "/avatar" && request.method === "GET") {
      return sendJson(
        response,
        200,
        state.avatar === null
          ? null
          : { mime_type: state.avatar.mime_type, data: state.avatar.data, version: state.avatar.version, updated_at: "2026-02-01T00:00:00Z" },
      );
    }

    if (path === "/avatar" && request.method === "PUT") {
      const body = JSON.parse(request.body) as { mime_type: string; data: string };
      const bytes = Buffer.from(body.data, "base64").byteLength;
      if (bytes > 64 * 1024) {
        return sendJson(response, 413, envelope("payload_too_large"));
      }
      state.avatar = {
        mime_type: body.mime_type,
        data: body.data,
        version: (state.avatar?.version ?? 0) + 1,
      };
      if (state.profile) state.profile.avatar_version = state.avatar.version;
      return sendJson(response, 200, { ...state.avatar, updated_at: "2026-02-01T00:00:00Z" });
    }

    return false;
  });

  return {
    origin: fake.origin,
    close: fake.close,
    tokens,
    get profile() {
      return state.profile;
    },
    set profile(value: StoredProfile | null) {
      state.profile = value;
    },
    get avatar() {
      return state.avatar;
    },
    set avatar(value: { mime_type: string; data: string; version: number } | null) {
      state.avatar = value;
    },
    get conflictNext() {
      return state.conflictNext;
    },
    set conflictNext(value: boolean) {
      state.conflictNext = value;
    },
  };
}
