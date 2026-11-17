import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/*
 * CloudFormation short-form intrinsics (!Ref, !Sub, !GetAtt, ...) are not valid
 * YAML tags, so they are resolved into plain marker objects before parsing. That
 * keeps the infrastructure assertions structural instead of regex-over-text.
 */

const CFN_TAGS = [
  "Ref",
  "Sub",
  "GetAtt",
  "ImportValue",
  "Base64",
  "Condition",
  "Join",
  "Select",
  "Split",
  "FindInMap",
  "If",
  "Equals",
  "And",
  "Or",
  "Not",
  "Cidr",
  "GetAZs",
] as const;

export interface CfnMarker {
  readonly __cfn: string;
  readonly value: unknown;
}

const customTags = CFN_TAGS.flatMap((name) => [
  {
    tag: `!${name}`,
    resolve: (value: string): CfnMarker => ({ __cfn: name, value }),
  },
  {
    tag: `!${name}`,
    collection: "seq" as const,
    resolve: (seq: { toJSON: () => unknown }): CfnMarker => ({
      __cfn: name,
      value: seq.toJSON(),
    }),
  },
]);

export function ref(name: string): CfnMarker {
  return { __cfn: "Ref", value: name };
}

export function getAtt(path: string): CfnMarker {
  return { __cfn: "GetAtt", value: path };
}

export const REPO_ROOT = new URL("../../../../../", import.meta.url);

export function readRepoFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, REPO_ROOT)), "utf8");
}

/* A CloudFormation template is an untyped document by nature; these helpers and
 * the specs using them are the type boundary for it. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CfnTemplate {
  readonly text: string;
  readonly doc: any;
  readonly resources: Record<string, any>;
  readonly parameters: Record<string, any>;
  readonly outputs: Record<string, any>;
}

export function loadTemplate(relativePath: string): CfnTemplate {
  const text = readRepoFile(relativePath);
  const doc = parse(text, { customTags }) as any;
  return {
    text,
    doc,
    resources: doc.Resources ?? {},
    parameters: doc.Parameters ?? {},
    outputs: doc.Outputs ?? {},
  };
}

export function resourcesOfType(
  template: CfnTemplate,
  type: string
): [string, any][] {
  return Object.entries(template.resources).filter(
    ([, resource]) => resource.Type === type
  );
}

export interface IamStatement {
  readonly Sid?: string;
  readonly Effect: string;
  readonly Action: string | string[];
  readonly Resource?: unknown;
  readonly Condition?: Record<string, Record<string, unknown>>;
}

export function statementsOf(
  template: CfnTemplate,
  roleLogicalId: string
): IamStatement[] {
  const policies = template.resources[roleLogicalId].Properties.Policies as {
    PolicyDocument: { Statement: IamStatement[] };
  }[];
  return policies.flatMap((policy) => policy.PolicyDocument.Statement);
}

export function actionsOf(
  template: CfnTemplate,
  roleLogicalId: string
): string[] {
  return statementsOf(template, roleLogicalId).flatMap((statement) =>
    Array.isArray(statement.Action) ? statement.Action : [statement.Action]
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
