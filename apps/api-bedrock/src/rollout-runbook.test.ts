import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The rollout runbook is not documentation in the decorative sense: AD-13 and AD-15
 * make it the enablement gate itself, and it is now also the only record that the
 * CountTokens probe was run and rejected. A silent edit that drops a gate, or a
 * "helpful" suggestion to swap the model, would remove the one control standing
 * between a blocked design and production traffic. Hence assertions on its content.
 */

const RUNBOOK = readFileSync(
  fileURLToPath(
    new URL("../../../docs/runbooks/hosted-ai-rollout.md", import.meta.url)
  ),
  "utf8"
);

describe("the CountTokens blocker is recorded, not softened", () => {
  it("records the exact rejection the probe returned", () => {
    expect(RUNBOOK).toContain(
      "ValidationException: The provided model doesn't support counting tokens"
    );
    expect(RUNBOOK).toContain("PROBE RUN, PROBE FAILED");
    expect(RUNBOOK).toMatch(/ENABLEMENT IS BLOCKED/i);
  });

  /* The failure mode this guards is a future maintainer treating the blocker as a
   * config problem and quietly changing the thing that makes the gate meaningful. */
  it("forbids silently changing the model, region, or token gate", () => {
    expect(RUNBOOK).toMatch(/do \*\*not\*\* switch to a different model/i);
    expect(RUNBOOK).toMatch(/do \*\*not\*\* change the region/i);
    expect(RUNBOOK).toMatch(/do \*\*not\*\* remove, weaken, or reorder the pre-reservation token gate/i);
    expect(RUNBOOK).toMatch(/specification change/i);
  });

  it("keeps gate 1 marked failed rather than blank or passed", () => {
    const gateOne = RUNBOOK.split("\n").find(
      (line) => line.startsWith("| 1 |") && line.includes("CountTokens")
    );

    expect(gateOne, "gate 1 row is missing").toBeDefined();
    expect(gateOne).toMatch(/FAILED/);
  });
});

describe("reserved concurrency is documented as inert versus active", () => {
  it("explains that 0 is inert and 10 is the AD-4 active value", () => {
    expect(RUNBOOK).toMatch(/`0` is inert, `10` is active/i);
    expect(RUNBOOK).toMatch(/Inert\.\*\*|\*\*Inert\.\*\*/);
    expect(RUNBOOK).toMatch(/reserves nothing from the account's concurrency pool/i);
    expect(RUNBOOK).toMatch(/AD-4 mandates/i);
  });

  /* The rollback cause has to be written down, or the next person reads "reserve 10"
   * as a value that simply works. */
  it("explains why the first deployment rolled back", () => {
    expect(RUNBOOK).toMatch(/unreserved.*below a floor of 50|floor of 50/i);
    expect(RUNBOOK).toContain("ROLLBACK_COMPLETE");
    expect(RUNBOOK).toMatch(/quota is 50/i);
  });

  it("states that removing the reservation is not an option", () => {
    expect(RUNBOOK).toMatch(/Removing the reservation entirely is \*\*not\*\* an option/i);
    expect(RUNBOOK).toMatch(/AD-4 and\s+AD-14 depend on/i);
  });
});

describe("the quota increase and the reviewed flip are prerequisites", () => {
  it("gives a verifiable quota-increase step with the Lambda quota code", () => {
    expect(RUNBOOK).toContain("request-service-quota-increase");
    expect(RUNBOOK).toContain("L-B99A9384");
    expect(RUNBOOK).toContain("get-service-quota");
    expect(RUNBOOK).toMatch(/at least \*\*60\*\*|>= 60/);
  });

  it("requires the flip to 10 to be a reviewed pull request, not a console edit", () => {
    expect(RUNBOOK).toMatch(/reviewed pull request/i);
    expect(RUNBOOK).toMatch(/rather than a\s+console edit or a workflow\s+variable/i);
    expect(RUNBOOK).toContain("HostedAiReservedConcurrency");
  });

  it("gives a command that asserts the DEPLOYED reservation", () => {
    expect(RUNBOOK).toContain("aws lambda get-function-concurrency");
    expect(RUNBOOK).toContain("ReservedConcurrentExecutions");
    expect(RUNBOOK).toMatch(/proves nothing about the value CloudFormation actually/i);
  });

  /* These must gate enablement, not sit in prose the reader can skip. */
  it("adds the concurrency prerequisites to the enablement gate table", () => {
    const gateLines = RUNBOOK.split("\n").filter((line) => line.startsWith("| 1"));
    const gates = gateLines.join("\n");

    expect(gates).toMatch(/\| 1a \|.*quota raised to at least 60/i);
    expect(gates).toMatch(/\| 1b \|.*default flipped `0` → `10` in a reviewed pull request/i);
    expect(gates).toMatch(/\| 1c \|.*ReservedConcurrentExecutions = 10/i);
  });

  it("says enablement changes nothing while the function is inert", () => {
    expect(RUNBOOK).toMatch(/cannot execute at all, so flipping `GLOBAL.enabled`/i);
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
