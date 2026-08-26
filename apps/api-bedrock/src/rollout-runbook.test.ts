import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The rollout runbook is not documentation in the decorative sense: AD-13 and AD-15 make
 * it the enablement gate itself, and it is the only record of what the quota actually
 * counts and which model identity the capability evidence belongs to. A silent edit that
 * drops a gate, or a "helpful" token preflight added back for cost accuracy, would remove
 * the one control standing between an unproved design and production traffic. Hence
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

describe("the quota design and model identity are recorded exactly", () => {
  /* The one thing a future reader is most likely to "restore": a token preflight. The
   * runbook has to state that quota counts requests, or the next person reads the token
   * counters in the logs as a billing input. */
  it("states that quota is per request and token counts are observability only", () => {
    expect(RUNBOOK).toMatch(/### 0\.1 Quota is per request/);
    expect(RUNBOOK).toMatch(/monthly entitlement is a \*\*request count\*\*/i);
    expect(RUNBOOK).toMatch(/one `charged_count` unit/);
    expect(RUNBOOK).toMatch(/\*\*observability only\*\*/i);
    expect(RUNBOOK).toMatch(/never gate a request, never bill/i);
  });

  /* An action nothing calls, still granted, is how a removed call comes back. */
  it("states that no CountTokens call or grant exists anywhere", () => {
    expect(RUNBOOK).toMatch(/no\s+`bedrock:CountTokens` call anywhere/i);
    expect(RUNBOOK).toMatch(/no `bedrock:CountTokens` in\s+the execution role/i);
    expect(RUNBOOK).toMatch(/do \*\*not\*\* add a `CountTokens` call, a token preflight/i);
    expect(RUNBOOK).toMatch(/do \*\*not\*\* make quota token-based/i);
  });

  /* Input bounding moved from tokens to bytes; if the runbook stops saying so, the
   * pre-reservation checks look optional. */
  it("records that input is bounded in bytes before any reservation", () => {
    expect(RUNBOOK).toMatch(/serialized-JSON ceilings and the 4 MiB decoded-media cap/i);
    expect(RUNBOOK).toMatch(/computable without an\s+upstream call/i);
    expect(RUNBOOK).toMatch(/inferenceConfig.maxTokens/);
    expect(RUNBOOK).toMatch(
      /do \*\*not\*\* remove the pre-reservation byte and media checks/i
    );
  });

  it("names the approved profile and region, and probes the deployed identity", () => {
    expect(RUNBOOK).toContain("us.anthropic.claude-sonnet-4-6");
    expect(RUNBOOK).toContain("--region us-east-1");
    expect(RUNBOOK).toContain("BedrockModelIdEcho");
    expect(RUNBOOK).toMatch(/never a remembered one/i);
    expect(RUNBOOK).toMatch(/do \*\*not\*\* change the model or move Bedrock out of `us-east-1`/i);
  });

  /* Profiles were once disqualified precisely because they lack CountTokens. Explaining
   * why that no longer disqualifies them is what stops the swap being re-litigated. */
  it("explains why an inference profile is legal again", () => {
    expect(RUNBOOK).toMatch(/Profiles do not support\s+`CountTokens`/i);
    expect(RUNBOOK).toMatch(/nothing asks them to now/i);
    expect(RUNBOOK).toMatch(/no Bedrock region parameter or environment variable/i);
  });

  /* The previous design's gates must not linger as if they still applied. */
  it("carries no stale CountTokens gate or London-region gate", () => {
    expect(RUNBOOK).not.toMatch(/CountTokens` PASSES/);
    expect(RUNBOOK).not.toMatch(/CountTokens probe/i);
    expect(RUNBOOK).not.toMatch(/Europe \(London\)/i);
    expect(RUNBOOK).not.toMatch(/United Kingdom/i);
    expect(RUNBOOK).not.toMatch(/direct processing in `eu-west-2`/i);
    expect(RUNBOOK).not.toMatch(/STREAM PROBE OUTSTANDING/i);
    expect(RUNBOOK).not.toMatch(/account verification/i);
  });

  it("states that no concurrency dependency remains", () => {
    expect(RUNBOOK).toMatch(/NO CONCURRENCY DEPENDENCY REMAINS/i);
    expect(RUNBOOK).not.toMatch(
      /ACTIVATION IS BLOCKED ONLY ON THE LAMBDA CONCURRENCY QUOTA/i
    );
  });

  /* Gate 1 is now a design property rather than a probe, and it must be tied to the
   * tests that actually hold it - otherwise it is an unfalsifiable tick. */
  it("gates the request-based design on the service tests that enforce it", () => {
    const row = gateRow("1");

    expect(row).toMatch(/no `CountTokens` call/i);
    expect(row).toMatch(/BY DESIGN/);
    expect(row).toMatch(/enforced by service tests/i);
    expect(row).toMatch(/one reservation per stream call/i);
  });

  /* The capability evidence was gathered against the direct model; the deployed identity
   * is now that model's profile. Carrying the evidence forward unqualified would claim a
   * check nobody ran against what production actually calls. */
  it("qualifies the carried-over capability evidence as owed a re-run", () => {
    expect(RUNBOOK).toMatch(/### 0\.2 Re-confirm the capability evidence through the profile/);
    expect(RUNBOOK).toMatch(/What changed is the invocation identity/i);

    for (const gate of ["1c", "1d", "1e"] as const) {
      const row = gateRow(gate);
      expect(row, `gate ${gate}`).toMatch(/PASSED for the direct model/);
      expect(row, `gate ${gate}`).toMatch(/re-confirm/i);
    }

    const streamGate = gateRow("1a");
    expect(streamGate).toMatch(/re-run against `us\.anthropic\.claude-sonnet-4-6`/i);
    // A gate marked passed with an empty cell is indistinguishable from one someone
    // ticked, so the observed reply has to be in the evidence column itself.
    expect(evidenceOf(streamGate)).toContain("OK.");
    expect(evidenceOf(streamGate).length).toBeGreaterThan(20);
    expect(gateRow("1h")).toMatch(/RE-RUN REQUIRED/);
    expect(gateRow("1f")).toMatch(/DEFERRED FOR REAL TRAFFIC/);
  });

  /* GLOBAL is enabled for the beta, so a failed re-confirmation is an incident to stop,
   * not a gate that quietly holds traffic. */
  it("routes a failed re-confirmation to the kill switch rather than a blocked gate", () => {
    expect(RUNBOOK).toMatch(/`GLOBAL` is already enabled for the first premium beta/i);
    expect(RUNBOOK).toMatch(/post-change verification on live configuration/i);
    expect(RUNBOOK).toMatch(/flip `enabled` to `false`/i);
  });

  /* Model-invocation logging is per region. us-east-1 is where invocations happen now;
   * eu-west-2 is residue from the brief London period and would otherwise persist
   * request content unnoticed (AD-11). */
  it("checks model-invocation logging in the active region and sweeps the former one", () => {
    expect(RUNBOOK).toMatch(/configured \*\*per region\*\*/i);
    expect(RUNBOOK).toMatch(/for region in us-east-1 eu-west-2/);
    expect(RUNBOOK).toContain("get-model-invocation-logging-configuration");

    expect(RUNBOOK).toContain(
      "aws bedrock delete-model-invocation-logging-configuration --region us-east-1"
    );
    expect(RUNBOOK).toContain(
      "aws bedrock delete-model-invocation-logging-configuration --region eu-west-2"
    );
    expect(gateRow("5")).toMatch(/us-east-1/);
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
    expect(section).toMatch(/input byte ceilings \+ 4 MiB media cap/i);
    expect(section).toMatch(/output token ceiling, applied by the model/i);
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
    expect(gateRow("1h")).toMatch(/Deployed model assertion passes/i);
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
