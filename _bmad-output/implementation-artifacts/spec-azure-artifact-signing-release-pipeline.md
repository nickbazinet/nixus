---
title: 'Sign Windows releases with Azure Artifact Signing'
type: 'chore'
created: '2026-09-21'
status: 'in-review'
review_loop_iteration: 1
baseline_commit: 'e811e8601cfe1277079a0325c81fe0f6007f5877'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nixus publishes unsigned Windows NSIS and MSI installers, so Windows cannot verify the publisher and displays an unknown-publisher warning. The existing Tauri updater signatures prove update-channel integrity but are not Authenticode signatures.

**Approach:** Authenticate the Windows release job to Azure through the existing GitHub OIDC identity and make Tauri invoke Azure Artifact Signing during bundling. Tauri must sign the application executable before packaging and sign each completed installer afterward, then the workflow must reject any artifact whose Authenticode signature is not valid.

## Boundaries & Constraints

**Always:** Use the GitHub `release` environment and its existing `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` secrets; grant only `id-token: write` and the existing release-content permission; use the Public Trust profile `nixus-public-trust` in account `nixus`; timestamp signatures through Microsoft’s RFC 3161 service; pin the Artifact Signing CLI dependency; preserve Tauri updater signing and release-note behavior; fail before a release can be considered usable when authentication, signing, or signature verification fails.

**Ask First:** Committing or pushing the workflow, creating a release tag, publishing a draft release, or changing the Azure account/profile/region identifiers.

**Never:** Store an Azure client secret or signing private key; sign only the outer MSI/NSIS wrappers; change macOS signing; remove SmartScreen guidance before signed releases have accumulated reputation; replace the updater minisign credentials; publish test-trust certificates.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Windows tagged release | OIDC secrets, active profile, signer role | Signed `nixus.exe`, NSIS `.exe`, and WiX `.msi`, each with a valid timestamp | Any Azure or Tauri signing error fails the Windows job |
| Invalid signature | Build emits an unsigned, invalid, or missing expected artifact | No successful Windows release result | Verification throws with the affected path and status |
| macOS release | Matrix selects macOS | Existing unsigned macOS build and draft-release flow remain unchanged | Azure login and CLI installation are skipped |
| Manual dispatch | Workflow is started without a release tag | Existing workflow-dispatch behavior remains available | Signing requirements remain identical on Windows |

</frozen-after-approval>

## Code Map

- `.github/workflows/release.yml:9-83` -- current two-platform matrix; Tauri builds and uploads directly to a draft GitHub Release. Add the `release` environment, OIDC permission, Windows-only Azure login and CLI installation, then verify signatures after `tauri-action` returns.
- `apps/desktop/src-tauri/tauri.conf.json:41-53` -- base bundle configuration; keep local Windows builds unsigned.
- `apps/desktop/src-tauri/tauri.signing.conf.json` -- release-only Tauri overlay containing `bundle.windows.signCommand` so CI signs the patched main executable and both final installer formats.
- `_bmad-output/planning-artifacts/architecture-release-signing.md:54-64,113-128` -- read-only evidence that updater minisign and OS code signing are separate layers; preserve existing `TAURI_SIGNING_*` behavior.
- `.github/workflows/api-bedrock-ci.yml` -- read-only reference for this repository’s GitHub-to-cloud OIDC conventions; do not alter AWS deployment behavior.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/tauri.signing.conf.json` -- configure the release-only Windows signing command for Azure Artifact Signing account `nixus`, profile `nixus-public-trust`, and the East US endpoint while leaving local builds unsigned.
- [x] `.github/workflows/release.yml` -- enable OIDC for the `release` environment, authenticate Windows jobs with `azure/login`, install a pinned Artifact Signing client, and fail on missing or invalid signatures after bundling. *(Implemented with the pinned Microsoft Sign CLI — see Spec Change Log entry 1.)*
- [x] `_bmad-output/implementation-artifacts/spec-azure-artifact-signing-release-pipeline.md` -- record implementation evidence and review outcome through the BMad build workflow.

**Acceptance Criteria:**
- Given a Windows release build with valid Azure configuration, when Tauri packages Nixus, then the installed application executable and every emitted `.exe` and `.msi` installer have `Valid` Authenticode signatures issued through the configured Public Trust profile.
- Given Azure authentication, authorization, signing, timestamping, or signature validation fails, when the Windows job runs, then the job exits nonzero and does not report a successful Windows release.
- Given the macOS matrix entry runs, when the release workflow executes, then it does not authenticate to Azure or install Artifact Signing tooling and preserves its previous output.
- Given GitHub issues an OIDC token, when Azure evaluates it, then its subject uses the `release` environment and no reusable Azure credential exists in GitHub.

## Spec Change Log

**1. Signing CLI: `artifact-signing-cli` → Microsoft Sign CLI (`dotnet tool sign`), pinned to `0.9.1-beta.26431.1`.**

The Tasks section named the `artifact-signing-cli` crate. That tool cannot satisfy this spec's frozen credential model, so the pinned dependency was changed while every frozen constraint was kept.

Evidence, read from the published crate source (`artifact-signing-cli 0.11.0`, the newest version; `src/main.rs`):

- `azure_client_secret` is a required `String` argument (`#[arg(long, env = "AZURE_CLIENT_SECRET")] azure_client_secret: String`) — not an `Option`, so the process refuses to start without it.
- `run()` unconditionally executes `az login --service-principal -t <tenant> -u <client-id> -p <client-secret>` before any signing. There is no federated-token, workload-identity, or reuse-the-existing-session path.

That makes it structurally incompatible with **Never: _Store an Azure client secret_** and with **Approach: _authenticate … through the existing GitHub OIDC identity_**. Wiring it up would have required adding an `AZURE_CLIENT_SECRET` repository secret, i.e. exactly the reusable standing credential this spec forbids.

The replacement is Microsoft's own Sign CLI (`dotnet/sign`), whose `code artifact-signing` command is the first-party client for Azure Artifact Signing:

- `--azure-credential-type azure-cli` selects `AzureCliCredential`, which consumes the short-lived session `azure/login` establishes from the GitHub OIDC token. No secret exists at any point.
- The `artifact-signing` command name and its `--artifact-signing-endpoint` / `--artifact-signing-account` / `--artifact-signing-certificate-profile` options were verified against `src/Sign.Cli/ArtifactSigningCommand.cs`; the `azure-cli` literal against `src/Sign.Cli/AzureCredentialType.cs`; the `--timestamp-url` default (`http://timestamp.acs.microsoft.com`, Microsoft's RFC 3161 service) against `src/Sign.Cli/CodeCommand.cs`.
- Pinned to `0.9.1-beta.26431.1` — the newest `dotnet/sign` release, and after `v0.9.1-beta.26127.1`, which is the release that added the `artifact-signing` command. **The pin must stay a `0.9.1-beta.*` version:** the `sign` NuGet id also carries `1.0.0`–`1.1.5` versions that are not this tool, which is why the project's own install instructions require `--prerelease`. A naive "upgrade to latest stable" would install something else.

Unchanged by this substitution: account `nixus`, profile `nixus-public-trust`, the East US endpoint `https://eus.codesigning.azure.net`, Microsoft RFC 3161 timestamping, the `release` environment, the `id-token: write` + `contents: write` permission pair, and the dependency being pinned to an exact version.

**2. Review hardening: isolate release signing and verify current-version identity.**

Review found that putting `signCommand` in the base Tauri configuration broke documented local Windows builds without Azure credentials, and that the cached `target` directory could retain installers from a previous version. The signing command moved to a release-only Tauri config overlay; the Windows release job now clears stale bundle output before building, derives its probe command from that overlay to prevent configuration drift, validates the expected signer subject, and uses platform detection rather than one runner label. Manual dispatch remains a test path and must not replace assets on an already-published release. KEEP: OIDC-only authentication, Tauri-native pre/post-package signing order, the fail-fast signing probe, MSI/NSIS payload verification, updater minisign behavior, and tag-triggered releases.

## Design Notes

Tauri’s bundler patches and signs its main executable before embedding it, then signs each finished package. A post-build action that signs only `bundle/**/*.exe,msi` leaves the installed executable unsigned. Therefore `bundle.windows.signCommand` is the source of truth; the workflow-level PowerShell check is an assertion, not the signing mechanism.

**Why the object form of `signCommand`.** Tauri accepts either a single string (split on spaces) or `{ cmd, args }`. The object form is used because the argument list contains URLs and a product description, and the string form has no escape for whitespace.

**Why verification materializes both package payloads.** Tauri signs package-specific copies of the application executable and may leave the non-shipping Cargo output unsigned. The gate therefore uses MSI administrative extraction and an NSIS silent installation into runner-temporary directories, then verifies the `nixus.exe` each package actually delivers alongside both signed installer wrappers.

**Why the verification requires three separate properties.** `Status -eq 'Valid'` proves the file is signed, chains to a trusted root, and is unmodified. A non-null `SignerCertificate` proves a certificate was actually issued by the configured profile rather than the status being vacuously satisfied. A non-null `TimeStamperCertificate` is the one that matters most in practice: Artifact Signing leaf certificates are valid for days, so an untimestamped binary starts failing validation on users' machines almost immediately after release.

**Why the signing probe runs before the full build.** It exercises the same OIDC identity, account, profile, endpoint, signing client, and timestamp service against a generated executable. Configuration or authorization failures therefore stop before the expensive Tauri build; package-specific verification still runs afterward to prove the actual shipping bytes.

## Verification

**Commands:**
- `actionlint .github/workflows/release.yml` -- expected: workflow syntax and expression validation pass.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero TypeScript errors.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: existing desktop E2E suite passes.
- Windows release workflow signature check -- expected: both installer wrappers and both materialized package executables report `Valid` with a signer subject and timestamp.

**Manual checks (if no CLI):**
- Inspect the draft GitHub Release assets and Windows job log after an explicitly authorized push/tag; only signed installers and their matching updater signatures should be attached.

---

## Implementation Evidence

**Files changed**

| File | Change |
|------|--------|
| `apps/desktop/src-tauri/tauri.signing.conf.json` | Added a release-only `bundle.windows.signCommand` overlay invoking `sign code artifact-signing` against account `nixus`, profile `nixus-public-trust`, endpoint `https://eus.codesigning.azure.net`, timestamped through Microsoft's RFC 3161 service and authenticated with `--azure-credential-type azure-cli`. |
| `.github/workflows/release.yml` | Added `environment: release`; added `id-token: write` alongside `contents: write`; added Windows-only OIDC login, pinned Sign CLI installation, and a fail-fast signing probe; added package verification that checks the MSI/NSIS wrappers and both materialized application payloads. The Tauri updater credentials and release-note behavior remain unchanged. |

**Verification run**

| Command | Result |
|---------|--------|
| `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/release.yml` | **Pass** — zero findings. |
| Tauri config schema validation (`tauri info`) | **Pass** — parses clean. Proven to be a real gate, not a no-op: injecting a deliberate `bundle.windows.signCommandXYZ` key produced `Error "tauri.conf.json" error on 'bundle > windows': Additional properties are not allowed ('signCommandXYZ' was unexpected)`; the probe key was then removed and the file re-verified clean. This is what confirms `signCommand`'s `{ cmd, args }` object form is accepted by Tauri 2.11. |
| `pnpm --filter @nixus/desktop exec tsc --noEmit` | **Pass** — exit 0, zero errors. |
| `pnpm --filter @nixus/desktop exec playwright test` | **789 passed, 1 failed** — `tests/accessibility.spec.ts:156 › activating the skip link moves focus to the surface heading`. **Pre-existing and unrelated.** Proven by stashing both changes and re-running the same spec file at baseline `e811e86`, where it fails identically (14 passed, 1 failed). It is order-dependent, not a regression: run alone with `-g`, it passes on both trees. Neither changed file is read by this suite — the E2E suite runs against the Vite dev server, and the only occurrences of `tauri.conf.json` under `apps/desktop/tests` are two prose comments in `projects.spec.ts`. |
| [GitHub Actions run 35704423821](https://github.com/nickbazinet/nixus/actions/runs/35704423821) | **Blocked before signing** — Azure returned `AADSTS700213` because no federated identity matched the presented subject `repo:nickbazinet/nixus:environment:release`. The Windows job failed closed at `azure/login`; the still-running macOS test job was cancelled to avoid creating an irrelevant draft. No signing command ran and no Windows artifact was published. |
| [GitHub Actions run 35715339488](https://github.com/nickbazinet/nixus/actions/runs/35715339488) | **Signing passed; verifier exposed a false target.** OIDC, the signing probe, Tauri packaging, MSI signing, and NSIS signing succeeded. Both installer wrappers were valid and timestamped, but the verifier incorrectly rejected Tauri's non-shipping top-level Cargo executable. |
| [GitHub Actions run 35717800412](https://github.com/nickbazinet/nixus/actions/runs/35717800412) | **Pass.** Windows and macOS jobs succeeded. The MSI, NSIS installer, MSI payload `nixus.exe`, and NSIS-installed `nixus.exe` all reported `Valid`, signer `CN=Nicolas Bazinet`, and Microsoft timestamp certificates. Final output: `All 4 Windows artifacts carry a valid, timestamped Authenticode signature.` |

**Acceptance criteria status**

| Criterion | Status |
|-----------|--------|
| Signed app executable + every `.exe`/`.msi` with valid signatures through the Public Trust profile | **Verified.** Run `35717800412` checked both installer wrappers and the application executable materialized from each package; all four were valid and timestamped. |
| Auth/authorization/signing/timestamping/validation failure ⇒ nonzero exit, no successful Windows release | **Implemented.** Three independent gates: `azure/login` failure, `signCommand` failure aborting `tauri build` inside `tauri-action`, and the post-bundle verification `throw`. |
| macOS leg does not authenticate to Azure or install signing tooling, output preserved | **Implemented.** All four added steps carry `if: matrix.platform == 'windows-latest'`. The macOS leg's step list is otherwise identical to before. |
| OIDC subject uses the `release` environment; no reusable Azure credential in GitHub | **Verified.** `environment: release` produced the accepted subject `repo:nickbazinet/nixus:environment:release`; GitHub stores only the client, tenant, and subscription identifiers, and authentication succeeded without a client secret. |

**Operator configuration**

1. The Azure app registration for `AZURE_CLIENT_ID` needs a **federated credential** whose subject is `repo:nickbazinet/nixus:environment:release` (entity type: environment, environment name: `release`).
2. That identity needs the **Artifact Signing Certificate Profile Signer** role on the `nixus` Artifact Signing account (or on the `nixus-public-trust` profile).
3. `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` must live on the `release` GitHub environment. `AZURE_CLIENT_SECRET` must not exist.
4. The Public Trust profile's certificate subject must match the `identity validation` record for the account, or signing is rejected server-side.
