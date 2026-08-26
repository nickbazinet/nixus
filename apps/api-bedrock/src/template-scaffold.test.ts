import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEMPLATE = readFileSync(
  fileURLToPath(new URL("../template.yaml", import.meta.url)),
  "utf8"
);

/* Comments are stripped before scanning: template.yaml deliberately *names* the
 * resource types it must not declare, and a raw text scan would match those. */
const DIRECTIVES = TEMPLATE.split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

const FORBIDDEN_RESOURCE_TYPES = [
  "AWS::Serverless::Function",
  "AWS::Serverless::Api",
  "AWS::Serverless::HttpApi",
  "AWS::Serverless::SimpleTable",
  "AWS::Lambda::Function",
  "AWS::ApiGateway::RestApi",
  "AWS::DynamoDB::Table",
  "AWS::IAM::Role",
  "AWS::IAM::Policy",
];

const FORBIDDEN_FUNCTION_KEYS = ["Events:", "Handler:", "CodeUri:", "InlineCode:"];

describe("apps/api-bedrock SAM scaffold", () => {
  it("pins the Node 22 ARM64 function conventions", () => {
    expect(DIRECTIVES).toContain("Transform: AWS::Serverless-2016-10-31");
    expect(DIRECTIVES).toContain("Runtime: nodejs22.x");
    expect(DIRECTIVES).toMatch(/Architectures:\s*\n\s*- arm64/);
  });

  it("declares only the approved no-op placeholder resource", () => {
    const resourceTypes = [...DIRECTIVES.matchAll(/^\s+Type:\s*(\S+)/gm)].map(
      (match) => match[1]
    );

    expect(resourceTypes).toEqual(["AWS::CloudFormation::WaitConditionHandle"]);
  });

  it("declares no runtime, API, data, or IAM resource and no handler wiring", () => {
    const declared = FORBIDDEN_RESOURCE_TYPES.filter((type) =>
      DIRECTIVES.includes(type)
    );
    const wired = FORBIDDEN_FUNCTION_KEYS.filter((key) =>
      DIRECTIVES.includes(key)
    );

    expect(declared).toEqual([]);
    expect(wired).toEqual([]);
  });
});
