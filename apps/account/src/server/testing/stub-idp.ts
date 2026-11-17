import { OidcError, type OidcClient, type VerifiedIdentity } from "../oidc.ts";

/**
 * Stub identity provider.
 *
 * Narrow on purpose: the only things stubbed are the two operations that genuinely
 * cannot run locally — Cognito's token endpoint and its JWKS. The `nonce` check is
 * performed here exactly as `oidc.ts` performs it, so the nonce-mismatch gate
 * exercises a real refusal rather than a mock returning what the test asked for.
 */
export interface StubIdpOptions {
  readonly sub?: string;
  readonly email?: string | null;
  /** Nonce the "id_token" actually carries. Differs from the expected one to fail. */
  readonly nonce?: string;
  readonly exchangeFails?: boolean;
  readonly refreshFails?: boolean;
}

export class StubIdp implements OidcClient {
  readonly exchanges: { code: string; verifier: string }[] = [];
  readonly revoked: string[] = [];
  readonly refreshes: string[] = [];
  readonly authorizeCalls: { state: string; nonce: string; codeChallenge: string }[] = [];

  constructor(private readonly options: StubIdpOptions = {}) {}

  authorizeUrl(params: {
    state: string;
    nonce: string;
    codeChallenge: string;
    language: "en" | "fr";
  }): string {
    this.authorizeCalls.push(params);
    return `https://auth.nixusapp.com/oauth2/authorize?state=${params.state}&nonce=${params.nonce}&lang=${params.language}`;
  }

  async exchangeCode(code: string, codeVerifier: string) {
    this.exchanges.push({ code, verifier: codeVerifier });
    if (this.options.exchangeFails) throw new OidcError("token_exchange_failed");
    return {
      access_token: `access-for-${code}`,
      refresh_token: `refresh-for-${code}`,
      id_token: `id-for-${code}`,
      expires_in: 900,
    };
  }

  async refresh(refreshToken: string) {
    this.refreshes.push(refreshToken);
    if (this.options.refreshFails) throw new OidcError("token_refresh_failed");
    return { access_token: `refreshed-${refreshToken}`, expires_in: 900 };
  }

  async revoke(refreshToken: string): Promise<void> {
    this.revoked.push(refreshToken);
  }

  async verifyIdToken(_idToken: string, expectedNonce: string): Promise<VerifiedIdentity> {
    const carried = this.options.nonce ?? expectedNonce;
    if (carried !== expectedNonce) throw new OidcError("nonce_mismatch");
    return {
      sub: this.options.sub ?? "11111111-1111-4111-8111-111111111111",
      email: this.options.email ?? "person@example.com",
    };
  }

  logoutUrl(): string {
    return "https://auth.nixusapp.com/logout?client_id=web&logout_uri=https%3A%2F%2Faccount.nixusapp.com%2F";
  }
}
