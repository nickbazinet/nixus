import type { KMSClient } from "@aws-sdk/client-kms";

/*
 * In-memory stand-in for KMS. The signature it returns is not a real ECDSA
 * signature and is not meant to be: AD-9's VERIFYING half lives in the desktop's
 * Rust, and the billing role holds no `kms:Verify` grant, so what this package
 * can and must assert is the signing INPUT, the algorithm, the key, the claim
 * order and the failure behaviour.
 */

export interface CapturedSignRequest {
  readonly KeyId?: string;
  readonly Message?: Uint8Array;
  readonly MessageType?: string;
  readonly SigningAlgorithm?: string;
}

export class FakeKms {
  readonly signed: CapturedSignRequest[] = [];
  private failure: Error | undefined;
  private signature: Uint8Array | undefined = Buffer.from(
    // A DER-shaped placeholder, so a spec asserting the statement's third part
    // is reading something of the right general shape.
    "3045022100a1b2c3d4e5f60708090a0b0c0d0e0f1011121314151617181920212223242526",
    "hex",
  );

  failWith(error: Error): this {
    this.failure = error;
    return this;
  }

  returnNoSignature(): this {
    this.signature = undefined;
    return this;
  }

  get signCount(): number {
    return this.signed.length;
  }

  /** The exact bytes handed to KMS, which is what AD-9 pins. */
  lastSigningInput(): string {
    const message = this.signed.at(-1)?.Message;
    return message === undefined ? "" : Buffer.from(message).toString("utf8");
  }

  async send(command: {
    input: CapturedSignRequest;
  }): Promise<{ Signature?: Uint8Array }> {
    this.signed.push(command.input);
    if (this.failure) throw this.failure;
    return { Signature: this.signature };
  }

  asKmsClient(): KMSClient {
    return this as unknown as KMSClient;
  }
}
