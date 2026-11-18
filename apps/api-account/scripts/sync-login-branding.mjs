#!/usr/bin/env node
/**
 * Writes the account web client's Managed Login branding into template.yaml from the
 * committed files in ../branding, between the BEGIN/END markers.
 *
 * The branding is the SAME style the desktop client's console-managed branding uses
 * (copied from DescribeManagedLoginBrandingByClient on 2026-11-17), so both sign-in
 * pages look identical. CloudFormation can only take the asset bytes inline, which is
 * why the block is generated rather than hand-edited; `account-app-infra.test.ts`
 * fails if the template and these files ever disagree.
 *
 * Usage: node apps/api-account/scripts/sync-login-branding.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(ROOT, "template.yaml");
const BEGIN = "  # BEGIN generated managed-login branding (scripts/sync-login-branding.mjs)";
const END = "  # END generated managed-login branding";

const ASSETS = [
  { Category: "PAGE_BACKGROUND", ColorMode: "LIGHT", Extension: "WEBP", file: "page-background-light.webp" },
  { Category: "FAVICON_SVG", ColorMode: "LIGHT", Extension: "SVG", file: "favicon-light.svg" },
];

const settings = JSON.parse(readFileSync(join(ROOT, "branding", "managed-login-settings.json"), "utf8"));

const lines = [
  BEGIN,
  "  AccountWebClientBranding:",
  "    Type: AWS::Cognito::ManagedLoginBranding",
  "    Properties:",
  "      UserPoolId: !Ref CognitoUserPoolId",
  "      ClientId: !Ref AccountWebClient",
  "      UseCognitoProvidedValues: false",
  // JSON is valid YAML, so the settings stay a structured value CloudFormation parses.
  `      Settings: ${JSON.stringify(settings)}`,
  "      Assets:",
  ...ASSETS.flatMap(({ file, ...asset }) => [
    `        - Category: ${asset.Category}`,
    `          ColorMode: ${asset.ColorMode}`,
    `          Extension: ${asset.Extension}`,
    `          Bytes: ${readFileSync(join(ROOT, "branding", file)).toString("base64")}`,
  ]),
  END,
];

const template = readFileSync(TEMPLATE, "utf8");
const start = template.indexOf(BEGIN);
const stop = template.indexOf(END);
if (start === -1 || stop === -1 || stop < start) {
  throw new Error("template.yaml is missing the branding markers");
}
writeFileSync(TEMPLATE, template.slice(0, start) + lines.join("\n") + template.slice(stop + END.length));
console.log("managed-login branding written to template.yaml");
