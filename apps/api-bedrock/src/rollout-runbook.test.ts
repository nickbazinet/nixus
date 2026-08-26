import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The rollout runbook is not documentation in the decorative sense: AD-13 and AD-15
 * make it the enablement gate itself, and it is also the only record of which model
 * and region the CountTokens gate was actually proved against. A silent edit that
 * drops a gate, or a "helpful" swap back to an inference profile, would remove the
 * one control standing between an unproved design and production traffic. Hence
 * assertions on its content.
 */

const RUNBOOK = readFileSync(
  fileURLToPath(
    new URL("../../../docs/runbooks/hosted-ai-rollout.md", import.meta.url)
  ),
  "utf8"
);

/** Fails naming the gate rather than returning undefined into a silent `.toMatch`. */
function gateRow(id: string): string {
  const row = RUNBOOK.split("\n").find((line) => line.startsWith(`| ${id} |`));
  expect(row, `gate ${id} row is missing`).toBeDefined();
  return row!;
}

/** The evidence column, so "marked passed" and "carries evidence" stay distinguishable. */
function evidenceOf(row: string): string {
  const cells = row.split("|").map((cell) => cell.trim());
  return cells[4] ?? "";
}

function sectionOf(heading: string, terminator: string): string {
  const start = RUNBOOK.indexOf(heading);
  expect(start, `section ${heading} is missing`).toBeGreaterThan(-1);
  const end = RUNBOOK.indexOf(terminator, start + heading.length);
  return RUNBOOK.slice(start, end === -1 ? undefined : end);
}

describe("the model capability probes are recorded with their exact identity", () => {
  it("keeps the rejection that ruled out the inference profile on the record", () => {
    expect(RUNBOOK).toContain(
      "ValidationException: The provided model doesn't support counting tokens"
    );
    // Without the original failure written down, reverting to a profile looks free.
    expect(RUNBOOK).toContain("us.anthropic.claude-sonnet-4-6");
    expect(RUNBOOK).toMatch(/inference profiles do not carry/i);
  });

  it("records the direct model and region the CountTokens gate now passes on", () => {
    expect(RUNBOOK).toContain("anthropic.claude-3-7-sonnet-20250219-v1:0");
    expect(RUNBOOK).toContain("--region eu-west-2");
    expect(RUNBOOK).toContain("CountTokens` PASSES");

    const gateOne = RUNBOOK.split("\n").find(
      (line) => line.startsWith("| 1 |") && line.includes("CountTokens")
    );
    expect(gateOne, "gate 1 row is missing").toBeDefined();
    expect(gateOne).toMatch(/PASSED/);
    expect(gateOne).toContain("eu-west-2");
  });

  /* A passing count says nothing about streaming, so streaming stays a gate of its own
   * rather than being folded into gate 1. Asserted as a gate row carrying evidence -
   * not as a status word - so the assertion survives the status changing again. */
  it("keeps ConverseStream as its own gate, passed with recorded evidence", () => {
    expect(RUNBOOK).toContain("converse-stream");

    const gate = gateRow("1a");
    expect(gate).toMatch(/ConverseStream/);
    expect(gate).toMatch(/PASSED/);
    // The observed reply is the evidence; a gate marked passed with an empty cell is
    // indistinguishable from a gate someone ticked.
    expect(gate).toContain("OK.");
    expect(gate).toContain("eu-west-2");
    expect(evidenceOf(gate).length).toBeGreaterThan(20);
  });

  /* The whole point of the amendment was that a blocked gate must not be softened; the
   * inverse failure is a resolved gate still advertised as blocking, which sends the
   * next reader chasing an AWS ticket that closed. */
  it("carries no stale unresolved-stream or account-verification claim", () => {
    expect(RUNBOOK).not.toMatch(/STREAM PROBE OUTSTANDING/i);
    expect(RUNBOOK).not.toMatch(/account verification/i);
    expect(RUNBOOK).not.toMatch(/under two hours/i);
    expect(RUNBOOK).not.toMatch(/ConverseStream` — outstanding/i);
  });

  /* With both probes passing and the reservation waived, no capacity dependency remains.
   * Saying so is what stops the next reader waiting on a quota ticket that no longer
   * gates anything. */
  it("states that no concurrency dependency remains", () => {
    expect(RUNBOOK).toMatch(/NO CONCURRENCY DEPENDENCY REMAINS/i);
    expect(RUNBOOK).not.toMatch(
      /ACTIVATION IS BLOCKED ONLY ON THE LAMBDA CONCURRENCY QUOTA/i
    );
  });

  it("records the first-customer capability probes without overstating quotas", () => {
    expect(RUNBOOK).toMatch(/### 0\.3 First-customer capability checks/);

    for (const [gate, matcher] of [
      ["1c", /lifecycle/i],
      ["1d", /Multimodal/i],
      ["1e", /output ceiling/i],
    ] as const) {
      const row = gateRow(gate);
      expect(row, `gate ${gate}`).toMatch(matcher);
      expect(row, `gate ${gate} must carry live evidence`).toMatch(/PASSED/);
    }

    expect(gateRow("1f")).toMatch(/DEFERRED FOR REAL TRAFFIC/);
  });

  /* Both probes must target the values CloudFormation actually applied: a count
   * proved against a remembered pair proves nothing about the deployed one. */
  it("probes the deployed identity from the stack outputs, not a remembered pair", () => {
    expect(RUNBOOK).toContain("BedrockModelIdEcho");
    expect(RUNBOOK).toContain("BedrockRegionEcho");
    expect(RUNBOOK).toContain("`$MODEL`/`$REGION`");
    expect(RUNBOOK).toMatch(/Both probes must pass against the \*same\*/);
  });

  /* The failure mode this guards is a future maintainer treating a blocker as a
   * config problem and quietly changing the thing that makes the gate meaningful. */
  it("forbids silently changing the model, region, or token gate", () => {
    expect(RUNBOOK).toMatch(/do \*\*not\*\* switch to a different model/i);
    expect(RUNBOOK).toMatch(/do \*\*not\*\* reintroduce an inference profile/i);
    expect(RUNBOOK).toMatch(/do \*\*not\*\* change the region away from `eu-west-2`/i);
    expect(RUNBOOK).toMatch(/do \*\*not\*\* remove, weaken, or reorder the pre-reservation token gate/i);
    expect(RUNBOOK).toMatch(/specification change/i);
  });

  /* Model-invocation logging is per region. Checking only the new region would miss a
   * configuration left behind in the old one by earlier probing - which is precisely the
   * kind of state that survives a region change unnoticed (AD-11). */
  it("checks model-invocation logging in both the active and the former region", () => {
    expect(RUNBOOK).toMatch(/configured \*\*per region\*\*/i);
    expect(RUNBOOK).toMatch(/for region in eu-west-2 us-east-1/);
    expect(RUNBOOK).toContain("get-model-invocation-logging-configuration");

    // And the disable path must cover both, or the check finds something the operator
    // has no committed command to fix.
    expect(RUNBOOK).toContain(
      "aws bedrock delete-model-invocation-logging-configuration --region eu-west-2"
    );
    expect(RUNBOOK).toContain(
      "aws bedrock delete-model-invocation-logging-configuration --region us-east-1"
    );
    expect(gateRow("5")).toMatch(/eu-west-2/);
  });
});

describe("the premium user grant is parameterised and cannot overwrite silently", () => {
  it("writes the user CONFIG item conditionally", () => {
    expect(RUNBOOK).toContain(
      "attribute_not_exists(pk) AND attribute_not_exists(sk)"
    );
    expect(RUNBOOK).toContain("ConditionalCheckFailedException");
    expect(RUNBOOK).toMatch(/never re-run with the condition removed/i);
    expect(RUNBOOK).toContain('"monthly_request_limit": {"N": "200"}');
  });

  /* Committed command text is copy-pasted by definition. A real address baked into it
   * both leaks who holds premium and invites the next operator to grant the wrong
   * account by editing nothing. */
  it("hardcodes no account email, sub, pool id, or table name", () => {
    expect(RUNBOOK).toContain('"${PREMIUM_EMAIL:?');
    expect(RUNBOOK).not.toMatch(/[\w.+-]+@(live|gmail|outlook|hotmail|yahoo|icloud)\.[a-z.]+/i);
    expect(RUNBOOK).not.toContain("HostedAiTable-");
    expect(RUNBOOK).not.toMatch(/--user-pool-id "[a-z]{2}-[a-z]+-\d_/);
  });

  /* Both identifiers are read back from the deployed stack, so this block cannot be run
   * against a stale table or a pool the stack does not authorize against. */
  it("derives the pool id and table name from the deployed stack", () => {
    const section = sectionOf("### 3.2", "---");

    expect(section).toContain("CognitoUserPoolIdEcho");
    expect(section).toContain("TableName");
    expect(section).toContain("describe-stacks --stack-name nixus-bedrock-api");
    expect(section).toMatch(/unresolved/);
  });

  /* Two confirmed matches, or one unconfirmed match, would otherwise grant premium to
   * whichever account happened to sort first. */
  it("requires exactly one confirmed Cognito match before writing", () => {
    const section = sectionOf("### 3.2", "---");

    expect(section).toContain("UserStatus==`CONFIRMED`");
    expect(section).toMatch(/expected exactly 1 confirmed match/i);
    expect(section).toContain('test "$COUNT" -eq 1');
  });

  it("gates the grant on verified attributes that exclude email and content", () => {
    const row = gateRow("11b");

    expect(row).toMatch(/premium=true/);
    expect(row).toMatch(/monthly_request_limit=200/);
    expect(row).toMatch(/no email, name, or content/i);
    expect(RUNBOOK).toMatch(/expect NO email, name, phone, or any prompt\/response attribute/i);
  });
});

/*
 * The 2026-08-26 capacity decision. Everything here guards one confusion: a reservation
 * of `0` and no reservation at all are opposite states that read almost identically. If
 * the runbook stops explaining that, the next operator "restores" the reservation, AWS
 * rejects every positive value against this account's quota, and 0 is what lands - a
 * permanently inert function that looks configured.
 */
describe("the reservation waiver is documented, with its trade-off", () => {
  it("states the function carries no reservation and uses the account's shared 50", () => {
    expect(RUNBOOK).toMatch(
      /### 2\.1 Concurrency: no function-level reservation \(user decision, 2026-08-26\)/
    );
    expect(RUNBOOK).toMatch(/carries no `ReservedConcurrentExecutions`/);
    expect(RUNBOOK).toMatch(/shared pool of 50 unreserved executions/i);
  });

  /* Without the arithmetic written down, "just reserve 10" looks like a value that works. */
  it("explains why every positive reservation was refused", () => {
    expect(RUNBOOK).toMatch(/floor of 50/i);
    expect(RUNBOOK).toMatch(/quota \*\*is\*\* 50/i);
    expect(RUNBOOK).toContain("ROLLBACK_COMPLETE");
    expect(RUNBOOK).toMatch(/throttles the function to\s*zero concurrent executions/i);
  });

  it("records the waiver as the user's decision, not an implementation choice", () => {
    expect(RUNBOOK).toMatch(/\*\*the user chose\s*neither and waived the reservation\*\*/i);
    expect(RUNBOOK).toMatch(/accepting the account's shared 50/i);
  });

  /* A waiver that hides what it costs is not a decision record. */
  it("states the shared-pool exposure the waiver accepts", () => {
    expect(RUNBOOK).toMatch(/What this trades away/i);
    expect(RUNBOOK).toMatch(/can exhaust the shared pool and throttle other functions/i);
    expect(RUNBOOK).toMatch(/`Throttles` alarm \(threshold 1\)/);
  });

  /* The reservation was one of several layered bounds; the waiver must not read as a
   * waiver of the bounding itself. */
  it("lists the bounds that are unchanged, including the throttle and both caps", () => {
    const section = sectionOf("### 2.1", "### 2.2");

    expect(section).toMatch(/10 RPS \/ burst 20/);
    expect(section).toMatch(/Cognito authorizer/i);
    expect(section).toMatch(/Per-user monthly cap/i);
    expect(section).toMatch(/`GLOBAL` monthly hard cap/);
    expect(section).toMatch(/token ceilings/i);
    expect(section).toMatch(/AWS Budget/);
    expect(section).toMatch(/specification change/i);
  });

  /* `--query` on an absent field prints "None"; only a key-absence check tells the two
   * states apart, and the runbook has to say so or the manual check is wrong. */
  it("gives a command that distinguishes unreserved from reserved-zero", () => {
    const section = sectionOf("### 2.2 Assert the function is unreserved", "### 2.3");

    expect(section).toContain("aws lambda get-function-concurrency");
    expect(section).toContain("--output json");
    expect(section).toMatch(/expect: \{\}/);
    expect(section).toMatch(/prints the string `None`/);
    expect(section).toMatch(/0 means it cannot execute/i);
    expect(section).toContain("get-account-settings");
  });

  it("explains that removing the property is an UPDATE, not a replacement", () => {
    const section = sectionOf("### 2.3 Removing the reservation", "### 2.4");

    expect(section).toMatch(/removes the reservation on UPDATE/i);
    expect(section).toMatch(/does \*\*not\*\* require a stack replacement/i);
    expect(section).toMatch(/does not touch the retained table/i);
    // CloudFormation keeps prior parameter values, which is why model/region are passed.
    expect(section).toMatch(/preserves previous parameter values on UPDATE/i);
  });

  /* The activation apparatus has to be gone from the operator instructions too, or the
   * next person sets a variable that nothing reads. */
  it("no longer instructs anyone to configure a reservation variable", () => {
    expect(RUNBOOK).not.toContain("HOSTED_AI_RESERVED_CONCURRENCY");
    expect(RUNBOOK).not.toContain("HostedAiReservedConcurrency");
    expect(RUNBOOK).not.toContain("request-service-quota-increase");
    expect(RUNBOOK).not.toContain("L-B99A9384");
  });

  it("records the quota request as open but no longer a dependency", () => {
    const row = gateRow("1b");

    expect(row).toMatch(/WAIVED/);
    expect(row).toMatch(/no longer a rollout dependency/i);
    expect(row).toContain("87ed4948ee0d48d59c3637f58a2ed33bo8DRLke8");
    expect(row).toMatch(/NOT A DEPENDENCY/);
  });

  it("gates the deployed function on being unreserved, not on a reservation value", () => {
    expect(gateRow("1g")).toMatch(/no\*\* `ReservedConcurrentExecutions`/);
    expect(gateRow("1g")).toMatch(/PASSED/);
    expect(gateRow("1h")).toMatch(/model\/region assertions pass/i);
  });

  /* A stale triage row would send the operator looking for a function-level limit that
   * does not exist, instead of at the account pool. */
  it("triages the Throttles alarm against the account pool", () => {
    const row = RUNBOOK.split("\n").find((line) =>
      line.startsWith("| Lambda `Throttles` |")
    );
    expect(row, "Throttles triage row is missing").toBeDefined();
    expect(row).toMatch(/account's\*\* shared unreserved pool/i);
    expect(row).toContain("get-account-settings");
    expect(row).not.toMatch(/Reserved concurrency \(10\)/);
  });
});

describe("local deployment is prohibited", () => {
  it("states GitHub Actions is the only path that may mutate the stack", () => {
    expect(RUNBOOK).toMatch(/## 2\. Deploy — GitHub Actions only/);
    expect(RUNBOOK).toMatch(/\*\*Local deployment is prohibited\.\*\*/);
    expect(RUNBOOK).toMatch(/there is no local\s+credential to deploy with/i);
  });

  it("offers only offline local commands, never a deploy", () => {
    const deploySection = RUNBOOK.slice(
      RUNBOOK.indexOf("## 2. Deploy"),
      RUNBOOK.indexOf("### 2.1")
    );

    expect(deploySection).toContain("pnpm sam:validate");
    expect(deploySection).toContain("pnpm sam:build");
    expect(deploySection).toMatch(/touches no AWS account/i);
    // No runnable local `sam deploy` invocation in the local-commands block.
    expect(deploySection).not.toMatch(/^\s*sam deploy/m);
  });
});

describe("the rolled-back attempt's artefacts are accounted for", () => {
  it("explains that only ROLLBACK_COMPLETE may be auto-deleted", () => {
    expect(RUNBOOK).toMatch(/only\*\* when the status is exactly `ROLLBACK_COMPLETE`/i);
    expect(RUNBOOK).toMatch(/no resource was successfully created, so nothing can be lost/i);
    expect(RUNBOOK).toMatch(/is left strictly alone/i);
  });

  it("records the orphaned retained table and how to confirm it is empty", () => {
    expect(RUNBOOK).toMatch(/orphan/i);
    expect(RUNBOOK).toContain("--select COUNT");
    expect(RUNBOOK).toMatch(/expect 0 before deleting/i);
    // Removed by hand: no automation may delete a retained table.
    expect(RUNBOOK).toMatch(/by hand/i);
  });

  it("gates the orphan cleanup in the enablement table", () => {
    expect(RUNBOOK).toMatch(/\| 11a \|.*Orphaned retained table/i);
  });
});

describe("runbook cross-references resolve", () => {
  it("has no dangling section reference", () => {
    const headings = new Set(
      [...RUNBOOK.matchAll(/^#{2,3} (\d+(?:\.\d+)?)/gm)].map((match) => match[1])
    );
    const references = new Set(
      [...RUNBOOK.matchAll(/§(\d+(?:\.\d+)?)/g)].map((match) => match[1])
    );

    const dangling = [...references].filter((ref) => !headings.has(ref));
    expect(dangling).toEqual([]);
  });

  it("numbers every subsection of section 2 uniquely", () => {
    const subsections = [...RUNBOOK.matchAll(/^### (2\.\d+)/gm)].map(
      (match) => match[1]
    );

    expect(new Set(subsections).size).toBe(subsections.length);
  });
});

describe("the bootstrap sequence is documented end to end", () => {
  it("explains the bootstrap paradox rather than just asserting the exception", () => {
    expect(RUNBOOK).toMatch(/bootstrap paradox/i);
    expect(RUNBOOK).toMatch(/nothing can create the OIDC provider \*over\* OIDC/i);
    expect(RUNBOOK).toMatch(/only file permitted to use them/i);
  });

  it("names both roles and the reason there are two", () => {
    expect(RUNBOOK).toContain("nixus-bedrock-api-github-deploy");
    expect(RUNBOOK).toContain("nixus-bedrock-api-cfn-exec");
    expect(RUNBOOK).toMatch(/could grant itself anything/i);
    expect(RUNBOOK).toMatch(/no statement grants a wildcard action/i);
    expect(RUNBOOK).toMatch(/AdministratorAccess/);
  });

  it("gives the exact environment secret and variable names", () => {
    for (const name of [
      "AWS_BEDROCK_DEPLOY_ROLE_ARN",
      "AWS_BEDROCK_CFN_EXEC_ROLE_ARN",
      "SAM_ARTIFACT_BUCKET",
      "API_BEDROCK_DEPLOY_ENABLED",
    ]) {
      expect(RUNBOOK, `${name} must be documented`).toContain(name);
    }
  });

  it("requires the bootstrap workflow to be deleted after it succeeds", () => {
    expect(RUNBOOK).toContain(
      "git rm .github/workflows/api-bedrock-oidc-bootstrap.yml"
    );
    expect(RUNBOOK).toMatch(/bootstrap \*\*stack\*\* stays/i);
    expect(RUNBOOK).toMatch(/\| 3c \|.*Bootstrap workflow file deleted/i);
  });

  it("documents the confirmation input and the create-or-adopt precheck", () => {
    expect(RUNBOOK).toContain("BOOTSTRAP");
    expect(RUNBOOK).toMatch(/only one per issuer URL/i);
    expect(RUNBOOK).toMatch(/create_oidc_provider/);
    expect(RUNBOOK).toMatch(/existing_oidc_provider_arn/);
  });

  /* The claim form depends on a repository setting, so the runbook has to say which
   * one is in force rather than list both and leave it ambiguous. */
  it("records the exact trusted subject and why it takes the plain form", () => {
    expect(RUNBOOK).toContain("repo:nickbazinet/nixus:environment:production");
    expect(RUNBOOK).toMatch(/immutable subject claims disabled/i);
    expect(RUNBOOK).toMatch(/use_immutable_subject: false/);
    expect(RUNBOOK).toContain("TrustedSubject");
  });

  it("keeps the branch restriction as three independent controls", () => {
    expect(RUNBOOK).toMatch(/cannot\*\* encode both an environment and a branch/i);
    expect(RUNBOOK).toMatch(/three independent controls/i);
    expect(RUNBOOK).toMatch(/deployment-branch policy/i);
  });
});

describe("manual dispatch is documented without weakening the no-local-deploy rule", () => {
  it("documents dispatching a normal deployment from master", () => {
    expect(RUNBOOK).toMatch(/### 1\.2b Manual dispatch/);
    expect(RUNBOOK).toMatch(/API Bedrock CI\*\* → \*\*Run workflow\*\* → branch `master`/);
    expect(RUNBOOK).toMatch(/refused by the job's `if`/i);
  });

  /* Both the bootstrap and the dispatch look like exceptions to the rule, so the
   * runbook has to say explicitly that neither is a local deploy. */
  it("states that neither the bootstrap nor a dispatch is a local deploy", () => {
    expect(RUNBOOK).toMatch(/\*\*Local deployment is prohibited\.\*\*/);
    expect(RUNBOOK).toMatch(/both look like exceptions and are not/i);
    expect(RUNBOOK).toMatch(/not a local deploy/i);
  });

  it("explains resolve_s3 being off and the role-arn handoff", () => {
    expect(RUNBOOK).toMatch(/`resolve_s3` is \*\*off\*\*/);
    expect(RUNBOOK).toContain("--s3-bucket");
    expect(RUNBOOK).toContain("--role-arn");
    expect(RUNBOOK).toMatch(/deliberately cannot create anything/i);
  });

  it("gives an offline lint command for the bootstrap template", () => {
    expect(RUNBOOK).toContain("cfn-lint infra/bootstrap/github-oidc-deploy.yaml");
    expect(RUNBOOK).toMatch(/`sam validate` does not\s+cover it/i);
  });
});
