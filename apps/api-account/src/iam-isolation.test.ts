import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadTemplate, resourcesOfType, statementsOf } from "./lib/testing/cfn.ts";

/*
 * AD-11, both directions, as a CI guard.
 *
 * The rule is that the profile service and the account app are never two writers
 * of one entity: IAM gives the account-app role nothing on the profile table, and
 * the profile role nothing on the session table. Epic F adds the account app to
 * THIS template, so these assertions are written to hold now (when no other role
 * exists) and to fail the moment a role is added that reaches across.
 *
 * It also carries the half of AD-4 that IAM cannot express: DynamoDB has no
 * condition key for a sort key, so "limited to PROFILE and AVATAR" is enforced by
 * the code owning exactly those two literals - and by this file.
 */

const TEMPLATE = loadTemplate("apps/api-account/template.yaml");

const PROFILE_ROLE = "ProfileExecutionRole";
const PROFILE_TABLE = "ProfileTable";
const ACCOUNT_ROLE = "AccountAppExecutionRole";
const SESSION_TABLE = "SessionTable";

const SRC_ROOT = fileURLToPath(new URL("./", import.meta.url));

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

/* Comments are stripped before every literal scan: this service deliberately
 * NAMES the sort keys it refuses to touch and the session table it must not
 * know about, and a raw-text scan would match that rationale. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const SOURCES = sourceFiles(SRC_ROOT).map((path) => {
  const text = readFileSync(path, "utf8");
  return {
    path: path.slice(SRC_ROOT.length),
    text,
    code: stripComments(text),
  };
});

const RUNTIME_SOURCES = SOURCES.filter(
  (file) => !file.path.endsWith(".test.ts") && !file.path.includes("testing/")
);

describe("the profile role reaches nothing but the profile table", () => {
  it("names the profile table and no other storage resource", () => {
    const resources = JSON.stringify(
      statementsOf(TEMPLATE, PROFILE_ROLE).map(
        (statement) => statement.Resource
      )
    );

    expect(resources).toContain(`${PROFILE_TABLE}.Arn`);
    // The session table of Epic F, by any of the names it could carry.
    expect(resources).not.toMatch(/Session/i);
    expect(resources).not.toMatch(/session/);
  });

  /* Written against the whole statement, logical id included: a grant on a
   * resource whose logical id merely CONTAINS "Session" is the mistake. */
  it("references no resource whose logical id contains Session", () => {
    for (const statement of statementsOf(TEMPLATE, PROFILE_ROLE)) {
      expect(JSON.stringify(statement), statement.Sid).not.toMatch(/Session/i);
    }
  });

  it("holds no permission on CloudFront, S3, SSM, or Cognito either", () => {
    const actions = statementsOf(TEMPLATE, PROFILE_ROLE)
      .flatMap((statement) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action]
      )
      .map((action) => action.split(":")[0]);

    expect([...new Set(actions)].sort()).toEqual(["dynamodb", "logs"]);
  });
});

describe("no other role in the stack may reach the profile table", () => {
  /* Today the profile role is the only role; the assertion is written over
   * whatever roles exist so that Epic F's account-app role is caught by it
   * rather than by a reviewer. */
  it("gives every role other than the profile role nothing on that table", () => {
    const roles = resourcesOfType(TEMPLATE, "AWS::IAM::Role");
    expect(roles.map(([name]) => name)).toContain(PROFILE_ROLE);

    for (const [name] of roles) {
      if (name === PROFILE_ROLE) continue;

      const statements = JSON.stringify(statementsOf(TEMPLATE, name));
      expect(statements, `${name} must not reach the profile table`).not.toContain(
        PROFILE_TABLE
      );
      expect(statements, `${name} must not reach the profile table`).not.toMatch(
        /table\/\$\{AWS::StackName\}-profile/
      );
    }
  });

  /* Two tables now, so "the one grant" has to be stated as a pair rather than as
   * a count: the profile role reaches only the profile table, and the account
   * app's role only the session table. */
  it("declares exactly the profile table and the account app's session table", () => {
    expect(
      resourcesOfType(TEMPLATE, "AWS::DynamoDB::Table")
        .map(([name]) => name)
        .sort()
    ).toEqual([PROFILE_TABLE, SESSION_TABLE]);
  });
});

describe("the account app reaches nothing but the session table (AD-11)", () => {
  it("exists, so this guard is not vacuous", () => {
    expect(TEMPLATE.resources).toHaveProperty(ACCOUNT_ROLE);
  });

  it("names the session table and never the profile table", () => {
    const statements = JSON.stringify(statementsOf(TEMPLATE, ACCOUNT_ROLE));

    expect(statements).toContain(`${SESSION_TABLE}.Arn`);
    expect(statements).not.toContain(PROFILE_TABLE);
    expect(statements).not.toMatch(/table\/\$\{AWS::StackName\}-profile/);
    expect(statements).not.toMatch(/USER#/);
  });

  it("holds four single-item actions and no scan or query", () => {
    const dynamo = statementsOf(TEMPLATE, ACCOUNT_ROLE)
      .flatMap((statement) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action]
      )
      .filter((action) => action.startsWith("dynamodb:"))
      .sort();

    expect(dynamo).toEqual([
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]);
  });

  /* The app reads profiles over HTTPS with the user's own token, so an AWS grant
   * on anything but its own session table and its own secret is a second writer
   * waiting to happen. */
  it("reaches only logs, its session table, and its own client secret", () => {
    const services = statementsOf(TEMPLATE, ACCOUNT_ROLE)
      .flatMap((statement) =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action]
      )
      .map((action) => action.split(":")[0]);

    expect([...new Set(services)].sort()).toEqual(["dynamodb", "kms", "logs", "ssm"]);
  });

  it("reads one SSM parameter by exact path, and never writes one", () => {
    const ssm = statementsOf(TEMPLATE, ACCOUNT_ROLE).filter((statement) =>
      JSON.stringify(statement.Action).includes("ssm:")
    );

    expect(ssm).toHaveLength(1);
    expect(ssm[0]?.Action).toBe("ssm:GetParameter");
    expect(JSON.stringify(ssm[0]?.Resource)).toContain("web-client-secret");
    expect(JSON.stringify(ssm[0]?.Resource)).not.toContain("parameter/*");
  });

  /* The AWS-managed SSM key has no stack-scoped ARN, so ViaService is the only
   * available bound - without it the grant decrypts anything that key protects. */
  it("bounds kms:Decrypt to Parameter Store in this Region", () => {
    const kms = statementsOf(TEMPLATE, ACCOUNT_ROLE).filter((statement) =>
      JSON.stringify(statement.Action).includes("kms:")
    );

    expect(kms).toHaveLength(1);
    expect(kms[0]?.Condition?.StringEquals?.["kms:ViaService"]).toEqual({
      __cfn: "Sub",
      value: "ssm.${AWS::Region}.amazonaws.com",
    });
  });

  /* CloudFormation derives a role name from the stack name and the logical id, and
   * the bootstrap's IAM grant reaches only `nixus-account-Account*` and
   * `nixus-account-Web*`. A rename outside those prefixes fails the deploy on
   * authorization, which reads as a broken pipeline rather than a renamed role. */
  it("carries a logical id the bootstrap's role-name grant covers", () => {
    for (const [name] of resourcesOfType(TEMPLATE, "AWS::IAM::Role")) {
      expect(name, `${name} falls outside the bootstrap's grant`).toMatch(
        /^(Profile|Account|Web)/
      );
    }
  });
});

describe("the profile Lambda's code reaches only PROFILE and AVATAR", () => {
  it("spells the two sort keys once, in the storage boundary", () => {
    const declaring = RUNTIME_SOURCES.filter((file) =>
      /"(PROFILE|AVATAR)"/.test(file.code)
    );
    expect(declaring.map((file) => file.path)).toEqual(["lib/table.ts"]);
  });

  it("never names a sort key the billing spine reserves", () => {
    // Runtime sources only: this guard, and the route specs, must be free to
    // NAME the keys they prove unreachable.
    for (const file of RUNTIME_SOURCES) {
      for (const reserved of ["ENTITLEMENT", "BILLING_CUSTOMER"]) {
        expect(file.code, `${file.path} names ${reserved}`).not.toContain(
          reserved
        );
      }
    }
  });

  /* The reverse half of AD-11: the profile Lambda has no notion of a session,
   * so nothing in it may even reference one. */
  it("never references a session table, store, or cookie", () => {
    for (const file of RUNTIME_SOURCES) {
      for (const forbidden of [
        "SESSION_TABLE",
        "SessionTable",
        "session_table",
        "SESSION#",
        "idle_expires_at",
        "absolute_expires_at",
      ]) {
        expect(
          file.code,
          `${file.path} references ${forbidden}`
        ).not.toContain(forbidden);
      }
    }
  });

  it("composes the partition key in the storage boundary alone", () => {
    const composing = RUNTIME_SOURCES.filter((file) =>
      file.code.includes("USER#")
    );
    expect(composing.map((file) => file.path)).toEqual(["lib/table.ts"]);
  });

  /* AD-2: the profile routes authorize on identity and scope only. A read of an
   * entitlement, a premium flag, or the hosted-AI table would make a profile a
   * premium capability. */
  it("reads no entitlement or premium state anywhere (AD-2)", () => {
    for (const file of RUNTIME_SOURCES) {
      for (const forbidden of [
        "premium",
        "entitlement",
        "monthly_request_limit",
        "charged_count",
        "HostedAiTable",
      ]) {
        expect(file.code, `${file.path} mentions ${forbidden}`).not.toContain(
          forbidden
        );
      }
    }
  });
});
