import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { startDynamo, type RunningDynamo } from "./dynamo";
import { startEdge, type RunningEdge } from "./edge";
import { startIdp, type RunningIdp } from "./idp";
import { startProfileApi, type RunningProfileApi } from "./profile-api";

/**
 * Boots the REAL packaged server — the same `.deploy/bundle` CI uploads, started
 * through the same `srvx` entry wrapper and the same `AWS_LAMBDA_HTTP_ENDPOINT`
 * contract Lambda uses — against three local fakes. What the browser drives here
 * is the artifact that gets deployed, not a dev server.
 */

const APP_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BUNDLE = `${APP_ROOT}.deploy/bundle`;

export const WEB_CLIENT_SECRET = "stub-web-client-secret";
export const WEB_CLIENT_ID = "stubwebclientid0123456789";
export const SUBJECT = "4f21d9b4-6e07-4c3f-9a5e-1d0c2b3a4e5f";
export const EMAIL = "person@example.invalid";

export interface Harness {
  /** What the browser talks to: the fake edge, not the server. */
  readonly origin: string;
  readonly idp: RunningIdp;
  readonly api: RunningProfileApi;
  readonly dynamo: RunningDynamo;
  stop: () => Promise<void>;
}

async function waitForReady(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("the account server never started listening");
}

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

export async function startHarness(): Promise<Harness> {
  if (!existsSync(`${BUNDLE}/index.js`)) {
    throw new Error("run `pnpm build && pnpm package` before the E2E suite");
  }

  const [idp, api, dynamo, edgePort, serverPort] = await Promise.all([
    startIdp({
      clientId: WEB_CLIENT_ID,
      clientSecret: WEB_CLIENT_SECRET,
      sub: SUBJECT,
      email: EMAIL,
    }),
    startProfileApi(),
    startDynamo(),
    freePort(),
    freePort(),
  ]);

  // The browser's origin is the edge's, so that is what PUBLIC_ORIGIN must be.
  const origin = `http://127.0.0.1:${edgePort}`;
  const serverOrigin = `http://127.0.0.1:${serverPort}`;
  const child = spawn("node", ["index.js"], {
    cwd: BUNDLE,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      AWS_LAMBDA_HTTP_ENDPOINT: `127.0.0.1:${serverPort}`,
      PUBLIC_ORIGIN: origin,
      COGNITO_DOMAIN: idp.origin,
      COGNITO_CLIENT_ID: WEB_CLIENT_ID,
      COGNITO_USER_POOL_ID: "us-east-1_stubpool",
      AWS_REGION: "us-east-1",
      SESSION_TABLE_NAME: "nixus-account-sessions",
      PROFILE_API_BASE_URL: `${api.origin}/v1/profile`,
      CLIENT_SECRET_PARAMETER_NAME: "/nixus-account/web-client-secret",
      OIDC_ISSUER_FOR_LOCAL_RUN: idp.issuer,
      // The real SSM and DynamoDB clients, pointed at the local fakes.
      AWS_ENDPOINT_URL_DYNAMODB: dynamo.origin,
      AWS_ENDPOINT_URL_SSM: `${idp.origin}/ssm`,
      AWS_ACCESS_KEY_ID: "stub",
      AWS_SECRET_ACCESS_KEY: "stub",
    },
  });

  const logs: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));

  let edge: RunningEdge;
  try {
    await waitForReady(serverOrigin, child);
    edge = await startEdge({
      port: edgePort,
      serverOrigin,
      clientDir: `${APP_ROOT}dist/client`,
    });
  } catch (error: unknown) {
    console.error(logs.join(""));
    child.kill("SIGKILL");
    throw error;
  }

  return {
    origin,
    idp,
    api,
    dynamo,
    stop: async () => {
      child.kill("SIGKILL");
      await Promise.all([edge.close(), idp.close(), api.close(), dynamo.close()]);
    },
  };
}
