---
title: 'Input Reconciliation — Nixus Cloud Billing & Entitlements Spine'
date: '2026-11-18'
status: final
reviews: ARCHITECTURE-SPINE.md (this folder)
method: 'Every fork/decision/requirement in each input checked against the spine''s ADs, Conventions, and Deferred list. Only omissions and contradictions are reported; landed items are not restated. A deliberate, stated deferral is not an omission.'
---

# Input Reconciliation Review

Severity scale: **Critical** (blocks safe implementation or reopens a closed risk) · **High** (load-bearing obligation with no home in the spine) · **Moderate** (a real gap, recoverable without redesign) · **Low** (naming/traceability only).

---

## a) `INVESTIGATION.md`

| # | Omission / contradiction | Input ref | Severity |
|---|---|---|---|
| 1 | **The ten-document supersession-notes obligation (§1) has no home in the spine.** INVESTIGATION §1 names ten planning documents (`architecture-entitlements-licensing.md`, `architecture-login.md`, `epics-login.md`, `architecture-cloud-bedrock.md`, `architecture.md`, `prd.md`, `architecture/architecture-nixus-2026-08-25/**`, `specs/spec-cloud-bedrock/**`, `implementation-artifacts/deferred-work.md`, `research/pricing-model-competitive-analysis-2026-08-12.md`) that still name the old LemonSqueezy/Keygen provider and must carry a supersession note. The sibling profile spine carries exactly this kind of list under a `Deferred → Source-document supersession notes` heading; the billing spine has no equivalent heading, bullet, or AD reference anywhere. Silent drop, not a deferral — INVESTIGATION's status line calls the document "ready to feed ARCHITECTURE-SPINE.md," i.e., this was meant to land. | INVESTIGATION.md:33-41 | High |
| 2 | **The required rewrite of `27-4-auth-e2e-coverage-and-licensing-independence-amendment.md`'s greps, sequenced *before* the first billing commit, does not appear in the spine at all** — not in an AD, not in Deferred, not in the release gates (AD-16). INVESTIGATION calls this the one document that is "load-bearing, not cosmetic" because its acceptance criteria grep the repo for `lemonsqueezy\|keygen\|entitlement` to prove auth has no billing coupling; that grep will start failing the moment real billing code lands. The ordering requirement ("before, not after, the first billing commit") is exactly the kind of one-line obligation that gets lost when a memlog is distilled into ADs, and it has been lost here. | INVESTIGATION.md:44-49, 525-527 | High |
| 3 | **The "verify DynamoDB has no sort-key IAM condition" action item (§5.1) is silently downgraded from an action to an already-settled fact.** INVESTIGATION explicitly flags this as unverified and load-bearing: "Verify the no-sort-key-condition claim against current IAM docs before committing — it is the whole basis of this fork." AD-4 in the spine restates the claim as "Reason of record" with no hedge and no verification gate anywhere in AD-15 or AD-16's release-gate lists. If the claim is wrong, AD-4's whole "declared departure" from profile AD-4 loses its justification, and nothing in the spine would catch that before a deploy. | INVESTIGATION.md:319-332, 522-524 | Critical |
| 4 | **B10 (hosted-AI quota per tier) has no AD, Deferred entry, or release gate.** The fork is resolved ("Per-tier, read from the entitlement — otherwise Advance has no lever to be worth $10 more") but no `monthly_request_limit`-per-tier mechanism, no reference to `apps/api-bedrock`'s quota table changes, and no release gate for it appears anywhere in the spine — even though INVESTIGATION's own Blast Radius (§7) lists `apps/api-bedrock/src/lib/table.ts` + `quota.ts` as changed "(retire `premium`, per-tier limit)". The retirement of `premium` landed (AD-2); the per-tier limit half of that same line did not. | INVESTIGATION.md:265, 466 | High |
| 5 | **B6's resolved shape — static `/pricing` hydrating over baked fallback copy — is not stated anywhere in the spine.** The spine's paradigm diagram and AD-6 confirm prices are *not* hardcoded and *are* served from `GET /plans`, consistent with option (b), but the specific SEO/no-flash mechanic ("ships baked copy as a fallback and hydrates over it") that justified picking (b) over moving `/pricing` into the account app is dropped. A future implementer reading only the spine could reasonably build a client-rendered-only page, losing the SEO property the fork was decided for. | INVESTIGATION.md:261, 441-444 | Moderate |
| 6 | **AD-8's claim that "upgrades and downgrades go through the portal **or** a server-initiated subscription update" asserts a capability (self-service plan switch inside the Stripe Customer Portal under Managed Payments/merchant-of-record tax handling) that INVESTIGATION never actually verified.** §3's verification table confirms upgrade/downgrade/proration only via the direct Subscriptions API (`POST /v1/subscriptions/{id}`), and confirms Customer Portal *availability* only for the general Interoperability/Link case — it does not confirm that Managed Payments' MoR tax model supports a self-service tier switch inside the portal UI itself. The spine states both paths as equally available with no caveat and no "verify before first commit" gate, unlike the DynamoDB sort-key claim (which at least started as a flagged assumption, even if its gate was also lost — see row 3). | INVESTIGATION.md:76-84 | Moderate |
| 7 | **The "Privilege" tier name, and the fact that INVESTIGATION flagged its absence from the pricing page as an unresolved consequence (§4, point 3), is never closed by a decision.** INVESTIGATION says: "the product brief's third tier (**Privilege**) is absent from the page" as one of "Three consequences" of the premium→tier split, but no D-decision resolves it, and the spine's Deferred entry ("Tier N+1's software capability... perks-only (D12)") never uses the name "Privilege" or states whether tier N+1 *is* Privilege. A reader of the spine alone cannot tell whether "tier N+1" is a placeholder for a yet-unnamed tier or specifically the brief's Privilege tier — the naming thread is dropped, not just deferred. | INVESTIGATION.md:149-152 | Moderate |
| 8 | **D5's household-net-worth/custom-dashboards tier assignment is reduced to a bare capability name with no record of the marketing claims it was meant to make true.** `household_net_worth` appears in AD-1's capability union, but nothing in the spine states (even as a Deferred note) that this capability is what makes Classic's advertised "household net worth" feature true, or that Advance's advertised "custom dashboards" is `ai/home_surface.rs` gated by the existing `hosted_ai` capability with no new capability or operation. Both are correct outcomes of the architecture, but the traceability back to the pricing-page claims they were meant to satisfy (D5) is gone — a later reviewer re-checking "does the pricing copy match the code" has nothing in the spine to check against. | INVESTIGATION.md:287-290 | Low |

---

## b) `../architecture-cloud-profile-billing-2026-11-17/ARCHITECTURE-SPINE.md`

Checked every bullet of its `Deferred → Billing and payments` list against the new spine:

| # | Bullet | Landed? | Severity if not |
|---|---|---|---|
| 1 | checkout and customer portal on the account server | Landed (AD-7, AD-8, account app routes) | — |
| 2 | webhook ingestion and the writer for `ENTITLEMENT` | Landed (AD-5, AD-2) | — |
| 3 | one entitlement home versus `HostedAiTable` | Landed (AD-2, AD-4) | — |
| 4 | the AD-17 signed statement | Landed (AD-9) | — |
| 5 | server-side sync gating | Landed (AD-10) | — |
| 6 | replacing the manual premium runbook | Landed (AD-2) | — |
| 7 | **the per-partition write ceiling on `USER#<sub>`** | **Not landed.** No AD, Stack entry, or Deferred note anywhere in the new spine discusses DynamoDB per-partition throughput for the billing table's `pk = USER#<sub>` — not even as an acknowledged, explicitly deferred risk. This is the one bullet in the parent spine's list that the billing run was supposed to decide and simply never addresses, under any name (`hot partition`, `throughput`, `partition limit`). Moving billing to its own table (AD-4) changes the blast radius of this risk (it no longer shares a partition with `PROFILE`/`AVATAR` writes) but does not retire it: `EVENT#` dedupe writes, webhook-driven `ENTITLEMENT` writes, and statement re-signing on `GET /entitlement` near expiry all still land on the same `pk` per user, and nothing bounds or reasons about burst write rate against a single partition's throughput limit. | **High** |

Also checked its `Deferred → Source-document supersession notes` list (4 bullets: `architecture-entitlements-licensing.md`, `architecture-user-profile.md`, the sync spine's profile/avatar deferred item, `architecture-web.md`'s `/account`/`/login` routes). These are the *profile* spine's own obligations, not billing's — but the billing INVESTIGATION's own ten-document list (§1) does not reference or absorb them, and the new spine has no supersession-notes section at all (see §a-1 above) in which they could have been cross-checked or carried forward. Flagged for completeness; severity folded into §a-1 since the fix is the same (add a supersession-notes section).

---

## c) `../architecture-multi-device-sync-2026-10-13/ARCHITECTURE-SPINE.md`

| # | Omission / contradiction | Input ref | Severity |
|---|---|---|---|
| 1 | **Billing AD-11's "relink, not resume" rule is not declared as an amendment to sync AD-14, even though it narrows/changes AD-14's literal text.** Sync AD-14 states plainly: "regaining the flag resumes sync." Billing AD-11 states: "Regaining `multi_device_sync` after a freeze is a relink, not a resume." These are not the same operation — a resume is an incremental catch-up; a relink re-triggers the CAP-5 link-choice prompt (load cloud copy vs. publish local). The new spine's Inherited Invariants table cites sync AD-14 and binds it to AD-1/AD-10/AD-11 without a "declared departure" callout, unlike every other place this spine narrows an inherited rule (e.g., profile AD-4, profile AD-17 both get an explicit "declared departure" / "closes its stated exception" note). A reader of the sync spine alone would still expect a plain resume on re-entitlement. | sync spine line 160 vs. billing spine AD-11 | Moderate |

AD-14's Frozen-state semantics (no uploads/downloads, cloud copy untouched, local app works normally) are otherwise consistent with billing AD-11 ("transfers stop, the cloud copy is retained, the local app keeps working") and not weakened.

---

## d) `../../product-brief-nixus-2026-10-13.md`

| # | Omission / contradiction | Input ref | Severity |
|---|---|---|---|
| 1 | **The brief's explicit three-tier name — Classic / Advance / Privilege — never appears in the spine; the spine only ever says "(tier N+1)."** This is the same naming gap as §a-7 above, traced to its source: the brief treats "Privilege" as the settled product name for the third tier in two places (MVP Scope and Future Vision), but the spine's Deferred entry for tier N+1 never ties the two together. Not fatal to the architecture (capabilities, not names, are what gate), but it is exactly the kind of quiet, stakeholder-facing detail this reconciliation pass exists to catch. | brief lines 157, 204 | Moderate |

No other tier- or sync-eligibility statement in the brief is dropped: the brief's "gated by a single capability flag, so the future tier mapping needs no sync-code change" (MVP Scope) is honored by AD-1/AD-10; "IAM-level tier enforcement... out of scope for MVP" is exactly what this spine now builds; the frozen/retained-not-deleted lapse behavior matches AD-11.

---

## e) `../../../../docs/project-context.md`

| # | Omission / contradiction | Input ref | Severity |
|---|---|---|---|
| 1 | **No Playwright/E2E release gate for the checkout → system-browser redirect → webhook → entitlement-refresh user flow**, despite project-context's binding testing rule: "Playwright E2E for everything user-flow-shaped." AD-16's release gates are entirely unit/integration-shaped (webhook correctness, statement correctness, tier-model parity, IAM isolation, operability) — there is no gate for the actual user-facing journey (click "Subscribe" → leave the app → Stripe-hosted checkout → return → see the new tier), on either the desktop or the account-app surface. Checkout and the Customer Portal are explicitly surfaces the user clicks through (AD-8); project-context's testing rule would ordinarily require E2E coverage for exactly this. | project-context.md:356, 360-364 vs. spine AD-16 | Moderate |

No other naming, logging, audit-log, file-structure, or i18n convention in the spine contradicts project-context: the no-`audit_log`-row rule for entitlement changes (AD-14) is an explicitly scoped, previously-established exception (profile AD-12/D10), not a new contradiction; snake_case wire/Rust conventions, the `{en,fr}.json` + `/fr/*` pattern, and the SSM-`SecureString`-secrets rule all match project-context's stated patterns.

---

## Summary table (all items, by severity)

| Severity | Count | Items |
|---|---|---|
| Critical | 1 | a-3 (DynamoDB sort-key verification silently downgraded to settled fact) |
| High | 4 | a-1 (ten-doc supersession notes), a-2 (27-4 amendment rewrite timing), a-4 (B10 per-tier quota), b-7 (per-partition write ceiling) |
| Moderate | 5 | a-5 (B6 baked-fallback mechanic), a-6 (unverified portal plan-switch/tax), a-7/d-1 (Privilege naming), c-1 (sync AD-14 relink-vs-resume amendment not declared), e-1 (missing E2E gate) |
| Low | 1 | a-8 (D5 marketing-claim traceability) |
