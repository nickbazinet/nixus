import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  actionsOf,
  loadTemplate,
  resourcesOfType,
  statementsOf,
  type IamStatement,
} from "./lib/testing/cfn.ts";

/*
 * AD-4's isolation, in all three directions, as a release gate.
 *
 * The rule is that the billing service, the profile service and the hosted-AI
 * service are never two writers of one entity and never two readers of each
 * other's storage: this role has nothing on the profile table, the account app's
 * session table or the hosted-AI table, and the reverse holds in those stacks'
 * own guards.
 *
 * It also carries the half of AD-4 that IAM cannot express. DynamoDB has no
 * condition key for a sort key - which is precisely WHY billing gets its own
 * table rather than reserved sort keys in the profile table - so "limited to
 * ENTITLEMENT, BILLING_CUSTOMER and EVENT#" is enforced by one module owning
 * those literals, and by this file.
 */

const TEMPLATE = loadTemplate("apps/api-billing/template.yaml");

const BILLING_ROLE = "BillingExecutionRole";
const BILLING_TABLE = "BillingTable";

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
 * NAMES the tables it must not reach and the fields it must not log, and a raw
 * text scan would match that rationale. */
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
  (file) => !file.path.endsWith(".test.ts") && !file.path.includes("testing/"),
);

function actionsIn(statement: IamStatement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

describe("the billing role's grant is exactly the enumerated set", () => {
  /* Asserted as a sorted, de-duplicated list rather than by absence, so ADDING
   * an action is a deliberate edit to this test and never an accident. The one
   * duplicate is dynamodb:Query, which appears on the table statement and again
   * on the index statement - the two have different resources and must stay
   * separate. */
  it("grants these actions and no others", () => {
    const actions = [...new Set(actionsOf(TEMPLATE, BILLING_ROLE))].sort();

    expect(actions).toEqual([
      "cloudwatch:PutMetricData",
      "dynamodb:ConditionCheckItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:TransactWriteItems",
      "dynamodb:UpdateItem",
      "kms:Decrypt",
      "kms:Sign",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "ssm:GetParameter",
    ]);
  });

  it("reaches only the five services the spine names", () => {
    const services = actionsOf(TEMPLATE, BILLING_ROLE).map(
      (action) => action.split(":")[0],
    );

    expect([...new Set(services)].sort()).toEqual([
      "cloudwatch",
      "dynamodb",
      "kms",
      "logs",
      "ssm",
    ]);
  });

  it("grants no wildcard action and keeps every action namespaced", () => {
    for (const action of actionsOf(TEMPLATE, BILLING_ROLE)) {
      expect(action, `grants ${action}`).not.toMatch(/\*/);
      expect(action, action).toMatch(/^[a-z0-9-]+:[A-Za-z]+$/);
    }
  });

  it("uses the explicit role rather than a managed basic-execution policy", () => {
    expect(
      TEMPLATE.resources[BILLING_ROLE].Properties.ManagedPolicyArns,
    ).toBeUndefined();
    // Resources only: the template's own comment NAMES the managed policy it
    // refuses to attach, so a raw-text scan would match that rationale.
    expect(JSON.stringify(TEMPLATE.resources)).not.toContain(
      "AWSLambdaBasicExecutionRole",
    );
    expect(resourcesOfType(TEMPLATE, "AWS::IAM::Role")).toHaveLength(1);
    expect(resourcesOfType(TEMPLATE, "AWS::IAM::ManagedPolicy")).toEqual([]);
  });
});

describe("the table grant cannot enumerate, delete, or escape its partitions", () => {
  it("holds no Scan, no DeleteItem, and no DeleteTable", () => {
    const actions = actionsOf(TEMPLATE, BILLING_ROLE);

    for (const forbidden of [
      "dynamodb:Scan",
      "dynamodb:DeleteItem",
      "dynamodb:DeleteTable",
      "dynamodb:BatchWriteItem",
      "dynamodb:DeleteBackup",
      "dynamodb:ExportTableToPointInTime",
      "dynamodb:PartiQLDelete",
      "dynamodb:PartiQLSelect",
    ]) {
      expect(actions, `must not grant ${forbidden}`).not.toContain(forbidden);
    }
  });

  /* The one bound IAM can express. The sort-key half is enforced by
   * src/lib/table.ts owning the literals, asserted at the bottom of this file. */
  it("bounds the table statement to this service's own USER# partitions", () => {
    const statement = statementsOf(TEMPLATE, BILLING_ROLE).find(
      (entry) => entry.Sid === "BillingItemsInThisServicesOwnPartitions",
    )!;

    expect(statement.Resource).toEqual({
      __cfn: "GetAtt",
      value: "BillingTable.Arn",
    });
    expect(statement.Condition).toEqual({
      "ForAllValues:StringLike": {
        "dynamodb:LeadingKeys": ["USER#*"],
      },
    });
  });

  /* The index's hash key is stripe_customer_id, so a USER# LeadingKeys bound
   * would match nothing and silently deny every webhook lookup. It is read-only
   * instead, which is the real bound available here. */
  it("grants the GSI Query only, with no LeadingKeys bound", () => {
    const statement = statementsOf(TEMPLATE, BILLING_ROLE).find(
      (entry) => entry.Sid === "ResolveAStripeCustomerToASubscriber",
    )!;

    expect(actionsIn(statement)).toEqual(["dynamodb:Query"]);
    expect(statement.Resource).toEqual({
      __cfn: "Sub",
      value: "${BillingTable.Arn}/index/*",
    });
    expect(statement.Condition).toBeUndefined();
  });
});

describe("AD-9 the KMS grant is sign-only", () => {
  const kms = statementsOf(TEMPLATE, BILLING_ROLE).filter((statement) =>
    actionsIn(statement).some((action) => action.startsWith("kms:")),
  );

  it("grants kms:Sign on the signing key and nothing else on it", () => {
    const signing = kms.find(
      (statement) => statement.Sid === "SignEntitlementStatementsOnly",
    )!;

    expect(actionsIn(signing)).toEqual(["kms:Sign"]);
    expect(signing.Resource).toEqual({
      __cfn: "GetAtt",
      value: "StatementSigningKey.Arn",
    });
  });

  /* Verification happens on the device against an embedded public key; the public
   * half is exported ONCE by an operator, so a runtime read would be a second
   * source of truth for the trusted key. */
  it("grants neither Verify nor GetPublicKey, anywhere", () => {
    const actions = actionsOf(TEMPLATE, BILLING_ROLE);

    for (const forbidden of [
      "kms:Verify",
      "kms:GetPublicKey",
      "kms:DescribeKey",
      "kms:CreateGrant",
      "kms:ScheduleKeyDeletion",
      "kms:Encrypt",
      "kms:GenerateDataKey",
    ]) {
      expect(actions, `must not grant ${forbidden}`).not.toContain(forbidden);
    }
  });

  /* kms:Decrypt exists for ONE reason: WithDecryption on a SecureString. The
   * AWS-managed aws/ssm key's id is account-generated and unknowable at template
   * time, and an alias ARN would match nothing on a Decrypt call - so the bound
   * is the ViaService condition, which makes the grant unusable for anything but
   * a Parameter Store read in this Region. */
  it("bounds kms:Decrypt to Parameter Store in this Region", () => {
    const decrypt = kms.find((statement) =>
      actionsIn(statement).includes("kms:Decrypt"),
    )!;

    expect(actionsIn(decrypt)).toEqual(["kms:Decrypt"]);
    expect(decrypt.Condition?.StringEquals?.["kms:ViaService"]).toEqual({
      __cfn: "Sub",
      value: "ssm.${AWS::Region}.amazonaws.com",
    });
  });
});

describe("AD-7 the SSM grant reads exactly the two parameters", () => {
  const ssm = statementsOf(TEMPLATE, BILLING_ROLE).filter((statement) =>
    actionsIn(statement).some((action) => action.startsWith("ssm:")),
  );

  it("reads two parameters by exact ARN, and never writes one", () => {
    expect(ssm).toHaveLength(1);
    expect(actionsIn(ssm[0]!)).toEqual(["ssm:GetParameter"]);

    expect(ssm[0]!.Resource).toEqual([
      {
        __cfn: "Sub",
        value:
          "arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter${StripeSecretKeyParameterName}",
      },
      {
        __cfn: "Sub",
        value:
          "arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter${StripeWebhookSecretParameterName}",
      },
    ]);
    expect(JSON.stringify(ssm[0]!.Resource)).not.toContain("parameter/*");

    for (const forbidden of [
      "ssm:PutParameter",
      "ssm:DeleteParameter",
      "ssm:GetParametersByPath",
      "ssm:DescribeParameters",
    ]) {
      expect(
        actionsOf(TEMPLATE, BILLING_ROLE),
        `must not grant ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });
});

describe("the metric grant is bounded to one namespace", () => {
  /* PutMetricData takes no resource ARN, so the namespace condition is the only
   * available bound - and it is a real one: the grant cannot write to AWS/Lambda,
   * AWS/ApiGateway, or any other stack's namespace. */
  it("scopes PutMetricData to the namespace the alarms read", () => {
    const statement = statementsOf(TEMPLATE, BILLING_ROLE).find((entry) =>
      actionsIn(entry).includes("cloudwatch:PutMetricData"),
    )!;

    expect(actionsIn(statement)).toEqual(["cloudwatch:PutMetricData"]);
    expect(statement.Condition?.StringEquals?.["cloudwatch:namespace"]).toBe(
      "Nixus/Billing",
    );
  });

  it("holds no alarm or dashboard write", () => {
    for (const forbidden of [
      "cloudwatch:PutMetricAlarm",
      "cloudwatch:DeleteAlarms",
      "cloudwatch:GetMetricData",
      "cloudwatch:PutDashboard",
    ]) {
      expect(
        actionsOf(TEMPLATE, BILLING_ROLE),
        `must not grant ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });
});

describe("every resource the role names belongs to this stack", () => {
  /* The complete allow-list of resources. A `*` is permitted ONLY where the
   * action accepts no ARN at all, and only with a bounding Condition - which is
   * what keeps "the action has no ARN" from becoming "the grant has no bound". */
  it("names only this stack's own table, index, log group, key and parameters", () => {
    const allowed = [
      "BillingTable.Arn",
      "BillingLogGroup.Arn",
      "StatementSigningKey.Arn",
      "StripeSecretKeyParameterName",
      "StripeWebhookSecretParameterName",
    ];

    for (const statement of statementsOf(TEMPLATE, BILLING_ROLE)) {
      const serialized = JSON.stringify(statement.Resource);

      if (statement.Resource === "*") {
        expect(
          statement.Condition,
          `${statement.Sid} uses * with no bounding condition`,
        ).toBeDefined();
        continue;
      }

      expect(
        allowed.some((name) => serialized.includes(name)),
        `${statement.Sid} names a resource outside this stack: ${serialized}`,
      ).toBe(true);
    }
  });

  /* The other two services' storage, by every name it could carry. A grant on a
   * resource whose logical id merely CONTAINS one of these is the mistake. */
  it("names no profile, session, or hosted-AI storage (AD-4)", () => {
    const serialized = JSON.stringify(statementsOf(TEMPLATE, BILLING_ROLE));

    for (const forbidden of [
      /profile/i,
      /session/i,
      /hosted/i,
      /HostedAiTable/,
      /nixus-account/,
      /nixus-bedrock/,
    ]) {
      expect(serialized, `must not reach ${String(forbidden)}`).not.toMatch(
        forbidden,
      );
    }
  });

  it("declares exactly one table, so there is nothing else to reach", () => {
    expect(
      resourcesOfType(TEMPLATE, "AWS::DynamoDB::Table").map(([name]) => name),
    ).toEqual([BILLING_TABLE]);
  });

  /* CloudFormation derives a role name from the stack name and the logical id,
   * and the bootstrap's IAM grant reaches only `nixus-billing-Billing*`. A rename
   * outside that prefix fails the deploy on authorization, which reads as a
   * broken pipeline rather than a renamed role. */
  it("carries a logical id the bootstrap's role-name grant covers", () => {
    for (const [name] of resourcesOfType(TEMPLATE, "AWS::IAM::Role")) {
      expect(name, `${name} falls outside the bootstrap's grant`).toMatch(
        /^Billing/,
      );
    }
  });
});

describe("the billing Lambda's code reaches only its own three sort keys", () => {
  it("spells every key literal in the storage boundary alone", () => {
    const declaring = RUNTIME_SOURCES.filter((file) =>
      /"(ENTITLEMENT|BILLING_CUSTOMER|EVENT#|USER#)"/.test(file.code),
    );
    expect(declaring.map((file) => file.path)).toEqual(["lib/table.ts"]);
  });

  it("composes the partition key in the storage boundary alone", () => {
    const composing = RUNTIME_SOURCES.filter((file) =>
      file.code.includes("USER#"),
    );
    expect(composing.map((file) => file.path)).toEqual(["lib/table.ts"]);
  });

  /* The reverse half of AD-4: the billing Lambda has no notion of a profile, a
   * session, or the hosted-AI table, so nothing in it may even reference one. */
  it("never references another service's storage or state", () => {
    for (const file of RUNTIME_SOURCES) {
      for (const forbidden of [
        "PROFILE_TABLE_NAME",
        "ProfileTable",
        "profile_table",
        "SESSION_TABLE",
        "SessionTable",
        "SESSION#",
        "HostedAiTable",
        "HOSTED_AI_TABLE",
        "charged_count",
      ]) {
        expect(
          file.code,
          `${file.path} references ${forbidden}`,
        ).not.toContain(forbidden);
      }
    }
  });

  /* AD-1: a gate may test only a capability. `tier` crosses the wire as an
   * opaque string for display and operations, and no code anywhere compares one -
   * which is what makes "add a tier" a Stripe Dashboard change with no deploy. */
  it("compares no tier value anywhere (AD-1)", () => {
    for (const file of RUNTIME_SOURCES) {
      for (const forbidden of [
        'tier === "',
        "tier === '",
        'tier == "',
        '"premium"',
        "PREMIUM_CLOUD_CAPABILITIES",
      ]) {
        expect(file.code, `${file.path} compares a tier`).not.toContain(
          forbidden,
        );
      }
    }
  });

  /* AD-14's structural half, from the other side: console output is the logging
   * transport, and src/lib/logging.ts is the ONLY module allowed to make the
   * call - otherwise the allow-list is one `console.log` away from being
   * bypassed. */
  it("writes to the console only through the one serializer (AD-14)", () => {
    const logging = RUNTIME_SOURCES.filter((file) =>
      file.code.includes("console."),
    );
    expect(logging.map((file) => file.path)).toEqual(["lib/logging.ts"]);
  });
});
