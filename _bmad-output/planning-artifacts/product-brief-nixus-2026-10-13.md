---
stepsCompleted: [1, 2, 3, 4, 5, 6]
status: complete
inputDocuments:
  - _bmad-output/planning-artifacts/research/technical-local-first-multi-device-sync-research-2026-10-13.md
  - _bmad-output/planning-artifacts/research/pricing-model-competitive-analysis-2026-08-12.md
  - _bmad-output/planning-artifacts/product-brief-addendum-mobile-cloud-differentiation-2026-08-12.md
  - docs/business-vision.md
  - docs/project-overview.md
  - docs/project-context.md
date: 2026-10-13
author: dev
---

# Product Brief: nixus

<!-- Content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

Nixus is a local-first desktop app: your records live on your own computer in a local database, which is why it is fast and works offline. Today, signing in with a Nixus Cloud account does not carry your data to another computer. A second machine starts with an empty, separate database, so Nixus can only really be used on one computer.

**Nixus Cloud Sync** closes that gap. Log in with your Nixus Cloud account on a brand-new computer and, within seconds, your data loads and stays in step with your other computers. The app stays local: every click reads and writes the on-device database, with no server call per action, so speed and offline use are unchanged. Sync runs quietly in the background, using private cloud storage as a shared mailbox between your devices.

Sync is a **premium Nixus Cloud capability** (the Advance and Privilege tiers once the tier lineup exists; premium accounts for now). It supersedes the August 2026 addendum's position that Nixus Cloud never carries the ledger. The full ledger is stored in Nixus-operated cloud storage for users who opt in. Local-only users are unaffected, and the "your records stay on your machine" promise is restated honestly as: *unless you opt in to sync*.

**Mandatory speed requirement:** from completing login on a brand-new computer, the user's data is usable within **5 seconds on a 10 Mbps connection**, for datasets up to about 10 MB (images excluded), once the first device has completed its initial upload. (Modeled at about 1.2 s at 100 Mbps, 2.1 s at 25 Mbps, 4.1 s at 10 Mbps for a very heavy year of data; to be verified end to end.)

---

## Core Vision

### Problem Statement

A Nixus user who owns more than one computer cannot use Nixus on both. The Nixus Cloud login exists, but it gates nothing: signing in on a second machine gives you an empty app, because each computer keeps its own unconnected database. The builder hit this directly: he wanted to show Nixus running on his own data on another computer and could not.

### Problem Impact

- **Demos and sharing fall flat.** You cannot show your real setup on another machine.
- **Replacing a computer is manual and risky.** The only transfer path is a backup file copied by hand.
- **The Cloud login has no payoff.** It is a premium identity with no premium benefit tied to the user's own data.
- **Pre-alpha credibility.** Beta testers who run Nixus on a laptop and a desktop get two disagreeing datasets.

### Why Existing Solutions Fall Short

- **Cloud-first apps (YNAB, Monarch, Copilot)** solve multi-device by holding your history on their servers, and every action depends on the network. That is the opposite of Nixus's local-first, offline-capable promise.
- **Local-first peers (Actual Budget, Sumhouse, MeasuredMoney)** are either single-machine or need self-hosting or paid hosting to sync; none gives a seamless "log in and it appears" experience.
- **Manual backup and restore** (what Nixus offers today) is a one-time copy, not continuity; it silently forks the data the moment both computers are used.

### Proposed Solution

Log in with your Nixus Cloud account on any computer and your data is there within seconds, then stays in sync as you work.

- **Local first, always.** The app keeps reading and writing its local database. Sync is a background task and never blocks the screen.
- **Offline works.** Edit anywhere with no connection; changes merge when you are back online, without a merge dialog.
- **Predictable rules.** The first device you sync from is the source of truth. Field edits merge by latest change, deletes win (recoverable for 30 days), and account balances combine as additions and subtractions, so spending on two computers never loses money.
- **No server in the loop.** Computers exchange changes through private, per-account cloud storage, with no application server answering each action.
- **Fast on a new computer.** A new device downloads one compressed snapshot plus a small catch-up, with large images fetched later, so the app is usable in seconds.

### Key Differentiators

- **Local-first speed with cloud portability.** Competitors with cloud-first architectures cannot copy this without rebuilding from scratch.
- **Offline-capable multi-device.** It works on a plane.
- **Low-cost to operate.** Estimated cloud cost is under about $0.10 per user per month (illustrative, to be validated), which supports an honest premium price point.
- **Fits the platform ambition.** The same mechanism can later carry a mobile companion, because it is device-independent.

### Honest Trade-offs

- Synced data is stored in Nixus-operated cloud storage (encrypted at rest by AWS) and is technically accessible to Nixus. Privacy messaging must be updated for synced data.
- This reverses the addendum's "ledger never touches a server" claim for opted-in users; the pricing for the Cloud tiers needs to be revisited.

---

## Target Users

### Primary Users

**The multi-computer power user** (core persona; premium Nixus Cloud account; two or more computers)
Tracks their whole financial picture in Nixus instead of a spreadsheet. Owns a desktop at home and a laptop (or more) and wants the same data on all of them. Chose Nixus over cloud-first apps because they want local speed and control of their records, and accepts sync as an opt-in exception. Pain today: every additional computer is empty, so they run Nixus on one machine only or carry a backup file by hand. Success looks like logging in on any computer and seeing their data within seconds. There is no limit on the number of computers.

**The computer replacer** (same user, a different moment)
Buys a new laptop or reinstalls. Today, getting Nixus back means finding a backup file. Success is installing Nixus, logging in, and being back where they were. Removing or uninstalling Nixus on a computer has no effect on the cloud data.

**The demo-er / beta tester** (includes the builder)
Wants to show Nixus on their own real data on another machine, or runs it on two machines during the beta. A multi-machine beta tester currently ends up with disagreeing datasets. The builder hit this first-hand.

Platforms: macOS and Windows are both launch audiences.

### Secondary Users

- **Nixus (builder/support):** needs to diagnose sync problems without opening the user's data, so a redacted diagnostics export is required.
- **Partner / household member (not served in v1):** the product is single-user; sharing one account's data with another person is out of scope.
- **Advisors / accountants (future channel, not served by this feature):** the August addendum plans an advisor channel; sync does not give advisors access to a client's data.

### User Journey

1. **Discovery.** A premium user sees "Sync across your computers" in Cloud settings, or hits an empty second computer and finds the sign-in prompt.
2. **Turn on sync (first computer).** Opts in and keeps working while the data uploads in the background. This computer is the source of truth.
3. **Sign in on a new computer.** Logs in with the Nixus Cloud account and the data loads within seconds (the 5-second requirement). If that computer already has local data, the user chooses: replace it with the cloud copy (the old file is kept as a backup) or stay separate.
4. **Daily use.** Works as always. Sync is invisible apart from a small status indicator.
5. **Offline.** Edits made offline merge when the connection returns, and nothing is lost.
6. **The surprise moment.** An item edited on another computer is flagged as "changed on another device", and a deleted item can be restored for 30 days.
7. **Long term.** Replacing a computer is painless. Uninstalling or abandoning a computer needs no cleanup, because the cloud keeps a log of actions rather than a list of computers.
8. **Exit.** If the user leaves the premium tier, sync stops and the cloud copy is retained indefinitely (frozen, not deleted); the local app keeps working normally. Re-upgrading resumes from the retained data.

### Policy Decisions Recorded From Discovery

- **No device limit and no device registry.** The cloud holds an ordered log of actions; computers are not user-visible objects. (Architecture note: the technical design currently uses an internal per-install ID and acknowledgements between devices for cleanup; with no registry, cleanup must be time- and size-based instead, and stale internal IDs must expire automatically.)
- **Downgrade or cancellation: cloud data is frozen, never deleted.** Storage is cheap, so no deletion clock. (To confirm in the PRD: whether "readable" means the user can still restore from the frozen copy on demand.)
- **No self-serve deletion of cloud data in v1.** Uninstalling the app does nothing to cloud data. (Risk to check before launch: privacy law, such as PIPEDA and Quebec Law 25, may require a way to have personal data erased on request; a manual support-handled erasure path is likely needed even if there is no self-serve button.)

---

## Success Metrics

### User Success

| Outcome | Target | How we know |
|---|---|---|
| New computer shows my data fast | Usable within 5 s on a 10 Mbps connection, for datasets up to ~10 MB (images excluded), measured from login complete | Automated timing test in CI against a heavy-year dataset; beta-tester stopwatch check |
| Nothing is lost | 0 lost edits across all multi-device scenarios | Convergence simulator (randomized offline edits, reordering, dropped/duplicated uploads) with 0 failures; no user-reported data loss |
| Balances stay right | Account balances equal the sum of all changes on every computer after sync | Simulator property check; beta spot-checks |
| Works offline | App fully usable with sync off or network blocked | Automated test with network blocked |
| No slowdown from sync | Local writes stay imperceptible (measured: about +18 us per insert) | Performance gate in CI against the measured baseline |
| Changes appear on my other computer | Typically within about one poll interval plus a few seconds, when both are online | Beta-tester check; timing test |
| Replacing a computer is painless | Install, log in, and be back in under a minute of total user effort | Beta-tester walkthrough |

### Business Objectives

- **Give the premium Nixus Cloud tier a real, defensible benefit** tied to the user's own data, supporting a sustainable subscription.
- **Learn whether multi-computer users value it enough to pay:** use the pre-alpha beta window to test demand before building the full tier lineup.
- **Keep the marginal cost per user low:** estimated cloud cost under about $0.10 per user per month (illustrative; validate against a real bill).
- **Reinforce the product's differentiation:** local-first speed with cloud portability, which cloud-first competitors cannot copy.
- _Business targets for the next 3 and 12 months are not yet set (open item for the owner)._

### Key Performance Indicators

| KPI | Target | Type | Source |
|---|---|---|---|
| Time from login to usable data on a new computer | <= 5 s (10 Mbps) | Leading, product quality | CI timing test; beta |
| Lost-edit incidents | 0 | Safety | Support reports; simulator |
| Cross-account data access incidents | 0 (release gate: user A can never read user B's data) | Safety | Automated IAM test |
| Cloud cost per active sync user | < $0.10 / month | Financial | AWS billing, per-active-user |
| Share of invited beta testers with 2+ computers who turn sync on | to be set after the first beta cohort | Adoption | Beta follow-up (no telemetry needed) |
| Beta testers who say "I would pay for this" | to be set | Willingness to pay | Beta interview |
| Sync-related support requests per active sync user | trend down release over release | Quality | Support inbox |

_Open items: whether to add anonymous, opt-in sync diagnostics (success/failure and timing only, never content); and whether "within about one poll interval" is acceptable propagation latency, since near-instant propagation would need a push channel and therefore a server._

---

## MVP Scope

### Core Features

**Milestone 1: "Log in on a new computer and my data is there"**
- Opt-in "Sync across your computers" for premium Nixus Cloud accounts (gated by a single capability flag, so the future Classic / Advance / Privilege tier mapping needs no sync-code change).
- The first computer to turn sync on becomes the source of truth and uploads an initial snapshot in the background.
- Login on any new computer downloads the latest snapshot and loads it in seconds (<= 5 s at 10 Mbps for up to about 10 MB, images excluded).
- A computer that already has local data chooses: replace it with the cloud copy (old file kept as a dated backup) or stay separate.
- Large project images are fetched lazily; thumbnails arrive with the snapshot.
- Private per-account cloud storage with no application server in the path; S3 default encryption (SSE-S3); strict per-user isolation.
- Sync status indicator (idle, syncing, offline, update needed, error) that never blocks the UI.

**Milestone 2: "Edit on any computer, offline or online"**
- Every change on a computer is captured automatically and shared in the background; other computers apply it.
- Deterministic merging with no merge dialogs: field edits resolve to the latest change; account balances combine as additions and subtractions; deletes win and are restorable for 30 days.
- Works fully offline; changes merge on reconnect.
- Safe handling of out-of-order arrival: related records that arrive before their parent are held and applied when complete.
- Computers on different app versions keep working; changes from a newer version wait until the app updates.
- Periodic compaction so the cloud log and new-computer download stay small (snapshot-first).
- Premium downgrade or cancellation freezes the cloud copy (never deleted); the local app keeps working.

**Quality gates (part of the MVP, not extras)**
- Randomized multi-computer convergence simulator with 0 failures.
- Automated test proving one account can never read another's data.
- Performance gate: sync adds no perceptible delay to local actions.
- Updated README, Privacy Policy and Terms describing synced data honestly.

### Out of Scope for MVP

- Client-side or passphrase encryption (a format reserve allows adding it later).
- Merging two computers that each already have different local data into one dataset (v1 picks one as the base).
- Peer-to-peer or LAN sync; any push or real-time server channel.
- Mobile companion app, partner or household sharing, advisor access to client data.
- A computer registry or per-computer management screens; self-serve deletion of cloud data (a manual, support-handled erasure path is to be defined for privacy-law reasons).
- IAM-level tier enforcement and the final Classic / Advance / Privilege pricing.
- Selective sync (only some modules or accounts), version history or time travel.

### MVP Success Criteria

- The builder and the beta testers with two or more computers can log in on a new computer and see their data within the 5-second target.
- Two computers edited independently, including offline, converge with no lost edits and correct balances.
- 0 lost-edit incidents and 0 cross-account access incidents during the beta.
- Measured cloud cost per active sync user stays under about $0.10 per month.
- Beta testers say sync is something they would pay for (collected by interview; the target is to be set).
- Go/no-go for broader release: the quality gates above pass and the beta shows no unresolved data-integrity issue.

### Future Vision

- A device-independent sync layer that also carries a **mobile companion** (capture and notification), so a phone can feed the same account.
- Optional **client-side encryption tier** for users who want Nixus unable to read their data.
- **Merge of divergent datasets** with duplicate detection, **selective sync**, and **LAN sync** for offline households.
- **Tier-based enablement** (Advance and Privilege) with the entitlements system, and revisited Cloud pricing once the real infrastructure bill is known.
- Foundation for **household or advisor sharing**, if those ever become product directions.
