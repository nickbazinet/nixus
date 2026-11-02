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

  /* The unprefixed foundation model has no direct in-region on-demand endpoint, so an
   * operator who "simplifies" the probe by dropping the `us.` prefix gets a model-shaped
   * error about a request it never made. */
  it("states that the unprefixed foundation model is a destination, not an endpoint", () => {
    expect(RUNBOOK).toMatch(/no direct in-region on-demand endpoint/i);
    expect(RUNBOOK).toMatch(
      /do \*\*not\*\* invoke the unprefixed foundation model; it is a destination/i
    );
  });

  /* A probe against an unresolved stack output reaches Bedrock with an empty model id and
   * comes back complaining about the request shape, which reads as a Bedrock problem
   * rather than as a stack that never deployed the output. */
  it("fails fast before probing rather than probing an unresolved model", () => {
    const section = sectionOf("### 0.1", "### 0.2");

    expect(section).toContain("set -euo pipefail");
    expect(section).toMatch(/BedrockModelIdEcho unresolved/);
    expect(section).toContain('test "$MODEL" = "us.anthropic.claude-sonnet-4-6"');
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

  /* The capability evidence on record was gathered against the direct model
   * `anthropic.claude-sonnet-4-6`, which is the destination this profile routes to - so
   * it is evidence about the same model, owed only a re-confirmation through the profile.
   * The dates stay because they are what makes the evidence a record rather than a tick,
   * and a row re-dated by the 2026-11-02 rollback would be a rewritten record. */
  it("keeps the dated 4.6 evidence and marks the profile re-confirmation owed", () => {
    expect(RUNBOOK).toMatch(
      /### 0\.3 Re-confirm the capability evidence through the profile/
    );
    expect(RUNBOOK).toMatch(/What changed is the invocation identity/i);

    for (const gate of ["1a", "1c", "1d", "1e"] as const) {
      const row = gateRow(gate);
      expect(row, `gate ${gate}`).toMatch(/PASSED for `anthropic\.claude-sonnet-4-6`/);
      expect(row, `gate ${gate}`).toMatch(/re-confirm through the profile|RE-RUN REQUIRED/i);
      // The original evidence date survives; a re-dated row is a rewritten record.
      expect(row, `gate ${gate}`).toContain("2026-08-26");
    }

    const streamGate = gateRow("1a");
    expect(streamGate).toMatch(/RE-RUN REQUIRED against `us\.anthropic\.claude-sonnet-4-6`/i);
    // A gate marked passed with an empty cell is indistinguishable from one someone
    // ticked, so the observed reply has to be in the evidence column itself.
    expect(evidenceOf(streamGate)).toContain("OK.");
    expect(evidenceOf(streamGate).length).toBeGreaterThan(20);
    expect(gateRow("1h")).toMatch(/RE-RUN REQUIRED/);
    expect(gateRow("1f")).toMatch(/DEFERRED FOR REAL TRAFFIC/);
  });

  /*
   * Sonnet 5.5 was adopted on 2026-10-28 and withdrawn on 2026-11-02 because this account
   * holds zero Bedrock throughput for it — every call came back `AccessDeniedException`,
   * which no code change can fix. Without that record the next reader sees a model that
   * is newer than the deployed one and nothing explaining why it is not in use, so the
   * cheapest next step looks like "switch the id back" rather than "get the quota first".
   * Hence both halves are asserted: that it was tried and reverted, and that the
   * precondition for retrying is a quota increase.
   */
  it("records the 5.5 rollback and names the quota increase as its precondition", () => {
    expect(RUNBOOK).toMatch(/\*\*Rolled back — 2026-11-02\.\*\*/);
    expect(RUNBOOK).toContain("us.anthropic.claude-sonnet-5-5");
    expect(RUNBOOK).toMatch(/0 TPM and 0 RPM/);
    expect(RUNBOOK).toContain("AccessDeniedException");
    expect(RUNBOOK).toMatch(
      /Re-adopting Sonnet 5\.5 requires an approved Bedrock throughput quota increase/i
    );

    // The rollback must not read as a retreat from the deploy hardening it arrived with.
    expect(RUNBOOK).toContain("BedrockFoundationModelArnPattern");
    expect(gateRow("1j")).toMatch(/PRE-DEPLOY/);
  });

  /* A BYO user never reaches this stack: their own AWS account needs 4.6 model access,
   * and the desktop adapter invokes the profile with their credentials. Hosted evidence
   * proves nothing for them, so release readiness has to show this gate unpassed. */
  it("carries an unpassed BYO 4.6 invocation and model-access gate", () => {
    const row = gateRow("1i");

    expect(row).toMatch(/BYO Bedrock verified on 4\.6/i);
    expect(row).toMatch(/statement import/i);
    expect(row).toMatch(/model access/i);
    expect(row).toMatch(/NOT RUN/);
    // Unpassed means no date, not a date with a caveat.
    expect(row.split("|").map((cell) => cell.trim()).at(-2)).toBe("");
    expect(RUNBOOK).toMatch(/A hosted-only verification leaves every BYO user\s+unverified/i);
  });

  /* Without the bootstrap grant the application deploy's pre-deploy validation fails on
   * authorization rather than on a stale ARN, which reads as a broken check. Its
   * position in the sequence is the gate, so "pre-deploy" has to be on the row. */
  it("gates and orders the bootstrap read grant ahead of the application deploy", () => {
    const row = gateRow("1j");

    expect(row).toMatch(/bedrock:GetInferenceProfile/);
    expect(row).toMatch(/PRE-DEPLOY/);
    expect(row).toMatch(/before\*\* the application deploy/i);
    expect(row).toMatch(/NOT RUN/);

    expect(RUNBOOK).toMatch(/#### Bootstrap before application/);
    expect(RUNBOOK).toMatch(/Ordering is load-bearing/i);
    expect(RUNBOOK).toMatch(/fails closed on\s+\*\*authorization\*\*/i);
    expect(RUNBOOK).toContain("infra/bootstrap/**");
    expect(RUNBOOK).toMatch(/no invoke,\s*\n?list, or write action/i);
  });

  /* "DEFERRED" without instructions is indistinguishable from "nobody knows how". The
   * row has to point at a command, and it must not read as confirmed: a zero account
   * quota is precisely what made Sonnet 5.5 undeployable, and that is the one failure a
   * reader of this row needs to be able to anticipate. */
  it("points the throughput-quota gate at real instructions and marks it unconfirmed", () => {
    const row = gateRow("1f");

    expect(row).toMatch(/§0\.4/);
    expect(row).toMatch(/DEFERRED FOR REAL TRAFFIC/);
    expect(row).toMatch(/not yet confirmed/i);

    const section = sectionOf("### 0.4", "## 1.");
    expect(section).toContain("aws service-quotas list-service-quotas");
    expect(section).toContain("--service-code bedrock");
    expect(section).toContain("--region us-east-1");
    expect(section).toMatch(/ThrottlingException/);
    expect(section).toMatch(/a new model starts\s*\n?with its own/i);
    expect(section).toMatch(/deferred for real traffic\*\*, not waived/i);

    // The concurrency-quota apparatus the user waived must not reappear here.
    expect(section).not.toContain("request-service-quota-increase");
    expect(section).not.toContain("L-B99A9384");
  });

  /* The ARN is the one account-bearing input and the one a well-formed-but-wrong value
   * can sail through, so obtaining it, validating it, and setting it must all fail
   * closed rather than leave a stale secret in place. */
  it("gives fail-fast commands to obtain, validate, and set the profile secret", () => {
    const section = sectionOf("### 0.2", "### 0.3");

    expect(section).toContain("set -euo pipefail");
    expect(section).toContain("aws bedrock get-inference-profile");
    expect(section).toContain("BEDROCK_INFERENCE_PROFILE_ARN");

    // Account-bearing, so it is set through the UI and never echoed.
    expect(section).toMatch(/Do not echo/i);
    expect(section).toMatch(/preserves a parameter an UPDATE\s+omits/i);
  });

  /* The manual block and the CI script must check the SAME things, or "it passed by
   * hand" stops predicting "the deploy will pass" — and the gap is exactly where a
   * well-formed-but-wrong ARN survives. */
  it("checks every field the deploy script checks, including the ARN echo-back", () => {
    const section = sectionOf("### 0.2", "### 0.3");

    for (const check of [
      ".inferenceProfileArn",
      ".inferenceProfileId",
      ".status",
      "ACTIVE",
      ".type",
      "SYSTEM_DEFINED",
      "foundation-model/anthropic",
    ]) {
      expect(section, `missing validation of ${check}`).toContain(check);
    }

    // The resolved ARN must be compared back to the supplied one, not merely read.
    expect(section).toContain('= "$PROFILE_ARN"');
    expect(section).toMatch(/the resolved ARN is not the ARN supplied/i);

    // A non-empty destination list, and every entry carrying a modelArn.
    expect(section).toContain("(.models // []) | length");
    expect(section).toMatch(/-ge 1/);
    expect(section).toMatch(/declares no destination models/i);
    expect(section).toContain('(.modelArn // "") != ""');
    expect(section).toMatch(/carries no modelArn/i);

    // It points at the script it mirrors, so the two cannot drift silently.
    expect(section).toContain("scripts/validate-inference-profile.sh");
  });

  /* A hardcoded role name passes against whatever role happens to carry that name,
   * including one from an abandoned bootstrap stack. */
  it("derives the deploy role from the bootstrap stack and checks the exact grant", () => {
    const section = sectionOf("#### Bootstrap before application", "#### Verifying");

    expect(section).toContain("BOOTSTRAP_STACK:?");
    expect(section).toContain("OutputKey=='DeployRoleArn'");
    expect(section).not.toContain('ROLE="nixus-bedrock-api-github-deploy"');

    // Exactly one action, exactly one resource, no wildcard, exact profile suffix.
    expect(section).toContain('["bedrock:GetInferenceProfile"]');
    expect(section).toContain("| flatten | length) == 1");
    expect(section).toMatch(/inference-profile\/us\\\\\.anthropic\\\\\.claude-sonnet-4-6\$/);
    expect(section).toContain('test("\\\\*") | not');
    expect(section).toMatch(/not exactly one read action/i);
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
  /*
   * Every block here is copy-pasted into a terminal by definition. Without `set -e` an
   * unresolved lookup becomes an empty variable and the NEXT command runs anyway — which
   * is how a quota item gets written to `USER#` or a probe gets sent with an empty model
   * id, reported as a Bedrock problem rather than as a stack that never deployed.
   *
   * The exceptions are enumerated rather than pattern-matched, because "no guard needed"
   * is a judgement about one specific block and must be re-made when a block changes.
   */
  it("makes every multi-step command block fail fast", () => {
    const blocks = [...RUNBOOK.matchAll(/```bash\n([\s\S]*?)```/g)].map(
      (match) => match[1]!
    );
    expect(blocks.length).toBeGreaterThan(15);

    const singleCommandBlocks = [
      "git rm",
      "aws bedrock delete-model-invocation-logging-configuration",
      "cd apps/api-bedrock",
      "pipx run cfn-lint",
      "aws lambda get-account-settings",
      "bash apps/api-bedrock/scripts/smoke-test.sh",
    ];

    const unguarded = blocks
      .filter(
        (block) =>
          !/^\s*set -[eu]/m.test(block) && !singleCommandBlocks.some((head) => block.includes(head))
      )
      .map((block) => block.trim().split("\n")[0]);

    expect(unguarded).toEqual([]);
  });

  /* A variable carried over from an earlier block is the one a reader is most likely not
   * to have set, and an unset table name silently targets nothing. */
  it("requires carried-over variables rather than defaulting them", () => {
    const section = sectionOf("### 3.2", "---");

    expect(section).toContain('"${TABLE:?');
    expect(section).toContain('"${SUB:?');
    expect(RUNBOOK).toContain('"${TABLE:?set TABLE to the deployed quota table name');
  });

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
