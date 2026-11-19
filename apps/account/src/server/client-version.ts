/**
 * The account app's own version, as it states it to the billing API (billing AD-9).
 *
 * `GET /entitlement` refuses to serve a client below a server-side minimum
 * version, which is half of AD-9's revocation path for a leaked statement
 * signing key. A surface that sends no version cannot be shown to meet a floor
 * once one is configured, so this app states one rather than relying on the
 * launch default of `0.0.0` refusing nothing.
 *
 * It is a CONSTANT here rather than an import of `package.json`, for two
 * reasons: `verbatimModuleSyntax` plus a JSON import would pull the whole
 * manifest — every dependency name and version — into the server bundle, and the
 * manifest is not something the server half should be able to read at all.
 * `client-version.test.ts` asserts it equals `package.json`'s `version`, so the
 * two cannot drift past a test run, and `scripts/` version bumps have one more
 * place to fail loudly rather than silently.
 */
export const ACCOUNT_CLIENT_VERSION = "0.0.1";
