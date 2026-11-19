import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import {
  ENTITLEMENT_STATEMENT_PREFIX,
  ENTITLEMENT_STATEMENT_SIGNING_ALGORITHM,
  ENTITLEMENT_STATEMENT_TTL_SECONDS,
  toBillingCapabilities,
  type BillingCapability,
  type EntitlementStatementClaims,
} from "@nixus/shared";

/*
 * AD-9's statement, and the ONLY place a statement is produced.
 *
 *     NXS1.<base64url_unpadded(claims JSON)>.<base64url_unpadded(DER signature)>
 *
 * The signing input is the UTF-8 bytes of the FIRST TWO PARTS joined by a dot -
 * `NXS1.<payload>`, with no trailing dot - signed by a KMS asymmetric
 * `ECC_NIST_P256` key with `ECDSA_SHA_256` over `MessageType: RAW`. The grant is
 * sign-only: this module never calls `Verify` or `GetPublicKey`, because
 * verification happens on the device against an embedded public key and a
 * runtime read would be a second source of truth for the trusted key.
 *
 * It is deliberately not a JWT: there is no negotiable `alg`, so there is no
 * algorithm-confusion surface and the Rust verifier needs no JOSE stack.
 */

export function statementSigningKeyArn(): string {
  const arn = process.env.STATEMENT_SIGNING_KEY_ARN;
  if (!arn) {
    throw new Error("STATEMENT_SIGNING_KEY_ARN is not configured");
  }
  return arn;
}

export function statementSigningKeyId(): string {
  const id = process.env.STATEMENT_SIGNING_KEY_ID;
  if (!id) {
    throw new Error("STATEMENT_SIGNING_KEY_ID is not configured");
  }
  return id;
}

let kmsClient: KMSClient | undefined;

function getKmsClient(): KMSClient {
  if (!kmsClient) {
    kmsClient = new KMSClient({});
  }
  return kmsClient;
}

/** Test seam: lets a spec sign against a stub without a network stack. */
export function setKmsClientForTesting(client: KMSClient | undefined): void {
  kmsClient = client;
}

function base64url(bytes: Uint8Array): string {
  // Node's `base64url` encoding is UNPADDED, which is what the contract
  // declares; `base64` would emit `=` and the Rust verifier would reject it.
  return Buffer.from(bytes).toString("base64url");
}

/**
 * `exp = iat + TTL`, further clamped to `current_period_end` ONLY when a period
 * end exists AND is still ahead of `iat`.
 *
 * Both halves of that condition matter. A free entitlement has no period end and
 * must receive a normal full-window statement, never a born-expired one - that
 * is what lets a client tell *verified free* from *could not reach the server*.
 * A period end already in the PAST is likewise not clamped to: the subscription
 * is by then in a status that grants nothing, so the statement carries an empty
 * capability list, and emitting it already-expired would make a verified
 * no-capability answer indistinguishable from an unreachable server.
 */
export function statementExpiry(args: {
  readonly iat: number;
  readonly currentPeriodEnd: number | null;
}): number {
  const window = args.iat + ENTITLEMENT_STATEMENT_TTL_SECONDS;
  const { currentPeriodEnd } = args;

  if (currentPeriodEnd === null || currentPeriodEnd <= args.iat) return window;
  return Math.min(window, currentPeriodEnd);
}

export interface SignedStatement {
  readonly statement: string;
  readonly claims: EntitlementStatementClaims;
}

/**
 * Builds the claims in the EXACT order the contract declares them - `sub`,
 * `tier`, `capabilities`, `monthly_request_limit`, `iat`, `exp`, `key_id` -
 * because the bytes are what gets signed and a re-serialised payload with a
 * different member order would not verify.
 */
function claimsFor(args: {
  readonly sub: string;
  readonly tier: string;
  readonly capabilities: readonly BillingCapability[];
  readonly monthlyRequestLimit: number | null;
  readonly iat: number;
  readonly exp: number;
  readonly keyId: string;
}): EntitlementStatementClaims {
  return {
    sub: args.sub,
    tier: args.tier,
    // Sorted and deduplicated, so two representations of one grant are
    // byte-identical (AD-1).
    capabilities: toBillingCapabilities(args.capabilities),
    monthly_request_limit: args.monthlyRequestLimit,
    iat: args.iat,
    exp: args.exp,
    key_id: args.keyId,
  };
}

/**
 * A KMS failure PROPAGATES. AD-5 requires that the handler never write an
 * entitlement it could not sign, so this function has no fallback, no retry and
 * no partial result: the caller's whole event fails and Stripe retries it.
 */
export async function signStatement(args: {
  readonly sub: string;
  readonly tier: string;
  readonly capabilities: readonly BillingCapability[];
  readonly monthlyRequestLimit: number | null;
  readonly currentPeriodEnd: number | null;
  readonly now: Date;
}): Promise<SignedStatement> {
  const iat = Math.floor(args.now.getTime() / 1000);
  const claims = claimsFor({
    sub: args.sub,
    tier: args.tier,
    capabilities: args.capabilities,
    monthlyRequestLimit: args.monthlyRequestLimit,
    iat,
    exp: statementExpiry({ iat, currentPeriodEnd: args.currentPeriodEnd }),
    keyId: statementSigningKeyId(),
  });

  const payload = base64url(Buffer.from(JSON.stringify(claims), "utf8"));
  const signingInput = `${ENTITLEMENT_STATEMENT_PREFIX}.${payload}`;

  const signed = await getKmsClient().send(
    new SignCommand({
      KeyId: statementSigningKeyArn(),
      Message: Buffer.from(signingInput, "utf8"),
      MessageType: "RAW",
      SigningAlgorithm: ENTITLEMENT_STATEMENT_SIGNING_ALGORITHM,
    }),
  );

  if (!signed.Signature) {
    throw new Error("KMS returned no signature for the entitlement statement");
  }

  // The returned signature is DER and is carried AS-IS: the device parses DER,
  // so re-encoding it to a fixed-width pair here would break every verifier.
  return {
    statement: `${signingInput}.${base64url(signed.Signature)}`,
    claims,
  };
}
