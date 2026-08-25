# Review — Adversarial Divergence Lens (AD-Compliant-but-Incompatible Pairs)

- **Reviewed:** `ARCHITECTURE-SPINE.md` (Nixus Cloud Bedrock, status: draft, 2026-08-25)
- **Grounding:** `_bmad-output/planning-artifacts/architecture-cloud-bedrock.md` (companion), `architecture/architecture-nixus-2026-08-25/.memlog.md`, and a read-only sweep of the live code the spine retrofits: `apps/desktop/src-tauri/src/ai/{mod,chat,cc_parser,project_advice,trends_insight}.rs`, `commands/{chat,import,projects,spending_trends,settings,auth}.rs`, `error.rs`, `credentials.rs`, `apps/desktop/src/hooks/useChat.ts`, `packages/shared/src/types/api-error.ts`, `.github/workflows/{web-ci,release}.yml`
- **Lens:** Attack the spine as an adversary. Construct two units one level down (independent stories/agents) that each obey **every AD to the letter** yet still build **incompatibly** — clashing shared-data shapes, two owners of one entity, two owners of one decision point, conflicting state-mutation paths. Every constructible pair is a hole to close with a new or tightened AD.
- **Adversary model:** competent, well-intentioned, independent implementers. Each reads the spine (and the companion, where the spine points at it), obeys it literally, does not consult the other, and makes the locally-sensible choice where the spine is silent. No malice, no laziness, no AD violations. Where the spine and the companion disagree, each unit is entitled to follow either — the companion's own Implementation Handoff says the spine wins "where the two overlap," which does not resolve cases where only one of them speaks.
- **Date:** 2026-08-25
- **Verdict:** **CHANGES REQUESTED (blocking).** The paradigm is right and unusually well-chosen: server-brokered, credential-free-on-device, ports-and-adapters, with two independent denial-of-wallet controls and an explicit commit boundary. The spine is also genuinely strong on *prohibitions* (AD-1, AD-4, AD-11, AD-8's closed enum) — those are unambiguous and cannot be misread. But the spine is **not yet build-safe for parallel story execution across the cloud/desktop seam.** Seventeen constructible divergence pairs were found. Two are S1 (**H12** silently destroys every premium assignment and every usage counter, with no other source of truth and no repair path; **H4** can leave the monthly limit unenforced, i.e. unbounded Bedrock spend, with no compile-time or runtime signal). Nine are S2 breaks a user reaches. Four are direct **AD-vs-AD or AD-vs-convention contradictions** (**H7** fallback eligibility, **H8** scope enforcement ownership, **H9** status-cache invalidation deadlock, **H15** two token-expiry predicates), and one (**H2**) blocks the companion's own stated *first* implementation priority — `packages/shared/src/types/cloud-ai.ts` cannot be written, because the spine names two mutually incompatible Bedrock APIs one paragraph apart. Three holes (**H15**, **H16**, **H17**) are only visible against the live code and were confirmed there.

**Why this lens fires hard on this particular spine.** Three structural choices multiply the divergence surface:

1. **The contract crosses a language boundary with no generator and no version.** `packages/shared/src/types/cloud-ai.ts` is authoritative for TypeScript; the Rust side is a hand-written "mirrored Rust wire model" (companion, step 3). Two owners of one schema, in two languages, with no schema version field and no unknown-field policy.
2. **The two sides of that contract have deliberately asymmetric release cadence.** AD-12 auto-deploys the server on every push to the default branch; the Service Boundaries section states each app "keeps its own release cadence," and the desktop is an unforced auto-updater in the field. The server and the client are therefore **never version-locked**, yet no AD imposes a compatibility obligation in either direction.
3. **Every load-bearing runtime decision is expressed as a *predicate over an event* rather than a *named value*** — "the first valid Bedrock event," "pre-output," "prior configured provider," "has quota," "older than 5 minutes." Predicates are exactly what two competent implementers evaluate differently. The spine is precise about *sequence* (AD-5, AD-7) and imprecise about *the terms the sequence is written in*, and H2–H11 all trace back to that one pattern.

A fourth, quieter amplifier: **DynamoDB is schemaless and the entitlement record is hand-edited.** An attribute-name or attribute-arithmetic divergence between two cloud stories produces neither a compile error nor a runtime error — it produces `undefined → 0`. That is the mechanism behind H4 and part of H12.

**Live-code grounding that changes the reading of several ADs.** Four facts from the current tree matter to the constructions below, and three of them contradict an assumption the spine appears to make:

- **There is no `AiBackend`-shaped seam to retrofit onto — there are five.** `ai/mod.rs` defines a bare `enum AiProvider { Bedrock(..), OpenAI(..) }`, not a trait, and each surface re-declares its own local dispatch enum (`ai/project_advice.rs:26` `ProviderClient`, `ai/trends_insight.rs:23` `ProviderClient`, `commands/settings.rs:182` `ProviderKind`), with chat and statement import hard-rejecting OpenAI at their call sites (`commands/chat.rs:216`, `commands/import.rs:292`). The companion's Important Gap ("whether a suitable seam already exists … should be confirmed by reading the current code") resolves to **no** — AD-9's port is new construction across five sites, not four. See H17.
- **`AppError`'s wire JSON is hand-serialised per variant**, not derived (`error.rs:33 impl Serialize for AppError`, e.g. `error.rs:57-63` for `ai_service`), and two arms synthesise a `setup_url` field that has no Rust counterpart. Meanwhile `packages/shared/src/types/cloud-ai.ts` would join exactly one existing shared wire type — `types/api-error.ts`, shaped `{ error: { type, message, field? } }` — which is **already incompatible** with the desktop's flat `{ type, message, recoverable }`. There is no `ts-rs`/`typeshare`/`specta` in the repo and no zod/valibot, so the companion's "mirrored Rust wire models" is definitively a hand-copy. This makes H1 and H14 concrete rather than hypothetical.
- **Nothing on the desktop can cancel an in-flight AI stream, and nothing sets an output-token limit.** `stream_chat_response` (`ai/chat.rs:245`) takes no cancellation token; `send_chat_message` is a single awaited `invoke()`; `useChat.ts` has no abort wiring; and no `.inference_config(...)` / `max_tokens` appears anywhere in `ai/*.rs`. AD-8 therefore introduces a ceiling the client has never had, and AD-5's "charged regardless of outcome" meets a client that cannot stop what it is being charged for. See H5(b) and H16.
- **The existing session-expiry predicate deliberately has zero skew and the refresh path deliberately has zero retries.** `auth.rs:762 is_session_expired(expires_at, now) { now >= expires_at }` carries a comment saying the exactness is intentional and is covered by a test; `refresh_session` collapses every failure to `Ok(None) → Expired`. AD-10 mandates a 120-second skew and one retry. See H15.


---

## Severity key

| Sev | Meaning |
| --- | --- |
| **S1** | Silent unrecoverable loss of the only copy of entitlement/usage state, or unbounded uncapped spend. Ship-blocking. |
| **S2** | Functional break, split-brain state, or wrong-provider/wrong-charge outcome a user can reach. Ship-blocking. |
| **S3** | Integration break caught at first integration, or a correctness gap that silently degrades a stated capability. Fix before sharding into parallel stories. |

---

## Hole index

| # | Hole | Surface attacked | Sev |
| --- | --- | --- | --- |
| H1 | No schema version, no unknown-field policy, two hand-mirrored owners of one contract, asymmetric deploy cadence | API frame schema / versioning | S2 |
| H2 | The spine names two different, incompatible Bedrock APIs — `messages` shape is unresolvable | Desktop/cloud request shape | S2 |
| H3 | "First valid Bedrock event" is two different events → opposite charge *and* opposite fallback for one failure | First-byte / refund boundary | S2 |
| H4 | Reserve-counter attribute name and refund arithmetic have two literal readings; DynamoDB makes the clash silent | Quota transaction semantics | S1 |
| H5 | No terminal-frame requirement — EOF without `end`/`error` is success to one unit, failure to the other | API frame schema | S2 |
| H6 | Nothing binds the client's base URL, the stage name, or the `/v1` prefix; API Gateway's own 403 maps to `premium_required` | Deployment outputs / config injection | S2 |
| H7 | Fallback eligibility set contradicts itself across AD-7 / AD-9 / AD-10; the per-surface fallback matrix is unfixed | Provider fallback | S2 |
| H8 | Scope enforcement has two candidate owners and AD-3's *Prevents* clause discourages both → zero owners | Auth scope | S2 |
| H9 | `HostedAiState` is process-wide and identity-unkeyed; its only legal invalidator cannot see the invalidating event | Status-cache identity ownership | S2 |
| H10 | Unreachable/unknown status routes hosted-first in one unit and BYO-first in the other; no single-flight, no timeout | Status-cache ownership | S2 |
| H11 | Payload ceilings have no canonical measurement and no stated scope (hosted-only vs product-wide) | Model / payload limits | S3 |
| H12 | No `Retain` policy on the table that is the sole record of who is premium; CI auto-deploys stack changes unattended | CI deploy coordination | S1 |
| H13 | Copying the `web-ci.yml` precedent structurally imports `cancel-in-progress: true` onto a `sam deploy` | CI deploy coordination | S2 |
| H14 | One `streamifyResponse` router, two response-writing conventions; two incompatible error envelopes already in the repo; Lambda throttle indistinguishable from `quota_exhausted` | Transport / error mapping | S2 |
| H15 | AD-10's 120-second skew collides with a deliberately zero-skew existing predicate → two live definitions of "expired" | Auth scope / token lifecycle | S2 |
| H16 | Client disconnect and stream cancellation are unspecified, and the client cannot cancel at all | First-byte / refund boundary | S2 |
| H17 | AD-9 binds "all four surfaces" but there are five concrete provider call sites | Provider fallback | S3 |

---

## H1 — One contract, two hand-written owners, no version, and two deploy cadences that can never be locked — S2

**The hole.** AD-7 fixes the *frame names* (`meta | delta | end | error`) and AD-8 fixes the *operation enum*. Neither fixes a field set, and nothing anywhere fixes a **schema version** or an **unknown-field policy**. The companion's contract listing is literally `{"type":"meta", ...}` — the ellipsis is in the source document. The TypeScript side is authored in `packages/shared/src/types/cloud-ai.ts`; the Rust side is a hand-written mirror (companion, implementation step 3). AD-12 then deploys the server automatically on merge, while the desktop ships on its own cadence to an unforced auto-updater. So the two owners of one schema are separated by a language boundary, a hand-copy, and an unbounded version skew — with no field in the wire format that lets either side detect the skew.

**Unit A — "Shared contract + Lambda invoke handler" story.** Obeys AD-7 (four frame types), AD-8 (closed enum, server-owned ceilings), AD-11 (no content logged), and the snake_case convention. Emits:

```
{"type":"meta","operation":"chat","period":"2026-08","request_count":41}
{"type":"delta","text":"Your "}
{"type":"end","usage":{"input_tokens":1204,"output_tokens":88}}
```

Putting `usage` on `end` is not a liberty — AD-6 *requires* token aggregates to be persisted and AD-11 explicitly permits token usage, so a competent implementer surfaces it on the terminal frame. `meta` carries the quota position because it is free to send and saves the desktop a `/status` round-trip.

**Unit B — "Desktop `hosted_bedrock.rs` NDJSON reader" story.** Obeys the same ADs and the "strict TypeScript / typed errors" convention, which a Rust implementer honours as a strict serde enum:

```rust
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum CloudAiFrame {
    Meta { model_id: String, request_id: String },
    Delta { text: String },
    End,
    Error { code: CloudAiErrorCode, message: String },
}
```

`deny_unknown_fields` is the locally-correct choice for a wire type you do not control, and `Meta { model_id, request_id }` is the locally-obvious content of a "meta" frame. Result: **every hosted call fails at the first frame** with a deserialization error — after Unit A has already committed and charged the quota unit (AD-5: post-commit failures are never refunded). Because the failure is post-`meta`-emission on the server and pre-`meta`-parse on the client, AD-7 forbids fallback: the user is charged, gets no answer, and gets no BYO retry. Both units are fully compliant.

**Second construction from the same hole — the optionality clash.** The companion's request contract shows `"media": [...] | null` — key present, value nullable. Unit A's validator therefore requires the key. Unit B (Rust) writes `#[serde(skip_serializing_if = "Option::is_none")]` — the idiomatic Rust default — and omits the key entirely for `chat`. AD-8 says only "Desktop sends finalized messages/system/media plus a client request ID." Both readings are literal. Result: `400 validation` on every chat call. This one is caught at first integration (S3), but it is the same root cause and it is the *cheap* symptom of H1; the expensive symptom is the first post-launch server change.

**Third construction — the skew that cannot be detected.** A later cloud story adds a fifth operation, or a `ping` keepalive frame (a real need: `statement_import` has an 8192-token ceiling and can go many seconds before its first delta, and nothing in the spine gives either side an idle-timeout rule). AD-12 deploys it the moment it merges. Every desktop already in the field has `deny_unknown_fields` and a closed frame enum. There is no `schema_version`, no `min_client_version`, no negotiated `Accept` version, and the route is `/v1` on both sides of the change — so **neither side can even name the incompatibility**, let alone degrade gracefully.

**AD to tighten — AD-7 (new sub-rules), plus one new AD:**
1. **AD-7** must fix the **exact field set of all four frames**, by name and type, with no ellipsis, and state where token usage rides (`end`) and where the quota position rides (or that it rides nowhere).
2. **AD-7** must state the **evolution rule in both directions**: readers on both sides MUST ignore unknown object fields (no `deny_unknown_fields`, no exhaustive-field assumptions) and MUST treat an unknown `type` value as ignorable-and-skipped rather than fatal; only additive changes are permitted within `/v1`. This is the single cheapest rule in this review and it closes the whole third construction.
3. **New AD — contract provenance and skew detection.** Name `packages/shared/src/types/cloud-ai.ts` the single source of truth, state whether the Rust mirror is generated or hand-written, and if hand-written require a `schema_version` integer in the invoke request and in the `meta` frame plus a stated behaviour when they disagree (server: serve the highest version it supports ≤ the client's; client: on a `meta` version it does not recognise, continue reading `delta`/`end` and ignore the rest). Without a version field on the wire, AD-12's auto-deploy and the desktop's independent cadence are structurally unsafe, and no amount of care in individual stories fixes it.

---

## H2 — The spine names two different Bedrock APIs one paragraph apart, so the `messages` shape cannot be written — S2

**The hole.** AD-5's Rule says the Lambda "calls `ConverseStream`." The Stack Seed, the IAM convention, and the Capability Map all say `bedrock:InvokeModelWithResponseStream` / `Bedrock InvokeModelWithResponseStream`. The IAM *action* is the same for both, which is exactly why the collision survives review — but the **request and response shapes are completely different**. `ConverseStream` takes a provider-normalised `messages` array and emits normalised `messageStart`/`contentBlockDelta`/`messageStop`/`metadata` events. `InvokeModelWithResponseStream` takes a model-native body (for Anthropic: `anthropic_version`, `max_tokens`, `messages` with the Anthropic content-block shape) and emits model-native chunks. The desktop's `messages` payload is *the* shared data structure of this feature, and the spine specifies two irreconcilable shapes for it.

The Format convention makes it worse, not better: "Wire JSON: `snake_case` throughout the invoke contract … so the shape never has to be transformed as it crosses from cloud to desktop," while the companion says "the Lambda does not re-derive prompts, **it forwards them to Bedrock**." Both Bedrock APIs use camelCase (`contentBlockDelta`, `inferenceConfig`, `additionalModelRequestFields`) or Anthropic-native keys. "snake_case throughout" and "forward verbatim to Bedrock" are mutually exclusive at the `messages` leaf, and the spine asserts both.

**Unit A — "`lib/bedrock-client.ts`" story.** Reads the Stack Seed + IAM convention as authoritative for the API, and "forwards them to Bedrock" as authoritative for the shape. Implements `InvokeModelWithResponseStream` with an Anthropic-native body assembled from a pass-through `messages` array, and defines `CloudAiInvokeRequest.messages` as the Anthropic content-block shape. Compliant with AD-1, AD-8, AD-11, and every Stack Seed row.

**Unit B — "Shared contract + desktop request builder" story.** Reads AD-5's `ConverseStream` as authoritative and the snake_case Format convention as binding, and defines `messages` as a Nixus-shaped snake_case array (`[{"role":"user","content":[{"text":"…"}]}]`, media as `{"image":{"format":"png","source":{"bytes":"<base64>"}}}` rewritten to snake_case). Compliant with AD-5, AD-8, and the Format convention.

Neither unit violates anything. They cannot interoperate, and — critically — **neither is even wrong**: the spine authorises both. This blocks the companion's own stated first implementation priority ("drafting `packages/shared/src/types/cloud-ai.ts` — every other component depends on that contract existing first"), so it is not a late-integration surprise; it is a day-one deadlock between the two stories that must go first.

A secondary consequence: whichever API is chosen determines whether the server can enforce AD-8's output-token ceiling at all in the same place. Under `ConverseStream` the ceiling is `inferenceConfig.maxTokens` (server-set, client-invisible — clean). Under `InvokeModelWithResponseStream` the ceiling is `max_tokens` *inside the client-supplied body*, so a pass-through implementation must strip/override a client-supplied field to satisfy AD-8's "never client input" — a rule AD-8 states but does not tell the implementer how to enforce for a body it was told to forward verbatim.

**AD to tighten — AD-5 and AD-8:**
1. **AD-5** must name exactly one Bedrock API (`ConverseStream` is the right choice: normalised events make AD-7's "first valid Bedrock event" nameable, and it keeps the model id swappable without a contract change), and the Stack Seed / Capability Map / IAM rows must be corrected to say `ConverseStream` — noting the IAM action is `bedrock:InvokeModelWithResponseStream` — so no unit can read them as an API choice.
2. **AD-8** must state that `messages`/`system`/`media` are carried in **exactly the Bedrock Converse content-block shape, in its native casing**, as a named exception to the snake_case Format convention (the envelope stays snake_case; the inference payload does not) — or, alternatively, that they are a Nixus-owned snake_case shape the Lambda **maps** to Converse. Either is fine; the spine must pick, because "forward verbatim" and "snake_case throughout" cannot both hold.
3. **AD-8** must state that the server sets `inferenceConfig` (model, `maxTokens`) itself and that any inference-config-bearing field present in the client payload is **rejected with `400 validation`, not silently overridden** — otherwise Unit A strips it and Unit B trusts the strip, and a third unit passes it through.

---

## H3 — "The first valid Bedrock event" is two different events → the same upstream failure is charged-and-terminal in one unit and refunded-and-fallback-eligible in the other — S2

**The hole.** AD-5 and AD-7 both hinge on one predicate: "the first valid Bedrock event." Under `ConverseStream` the first event is `messageStart` — pure metadata, zero model output. The first *output-bearing* event is a `contentBlockDelta`. The spine's own supporting phrases point in opposite directions: AD-7's *Prevents* clause says "committing to a stream before Bedrock has actually started" (favours `messageStart`), while the memlog's adopted wording is "before any Bedrock response event/**output**" and the companion says "before **any hosted output byte** is emitted" (favours the first delta). Both readings are literal, and the two readings live in two different files owned by two different stories.

**Unit A — "`lib/bedrock-client.ts`" story.** Exposes `streamConverse(...): { onFirstEvent, events }` where `onFirstEvent` fires on the first item yielded by the SDK's async iterable — `messageStart`. Rationale: "the stream has actually started" is precisely AD-7's *Prevents* wording. A `ThrottlingException` or `modelStreamErrorException` arriving immediately after `messageStart` is therefore **post-commit**: no refund (AD-5), in-band `error` frame (AD-7), no fallback (AD-9). The user is charged a quota unit for zero tokens and sees a hard error while a perfectly good BYO provider sits unused.

**Unit B — "`handlers/invoke.ts`" story.** Treats "valid" as "output-bearing" and commits on the first `contentBlockDelta`, per the companion's "output byte" wording. The same `ThrottlingException` is now **pre-commit**: refund, `503 hosted_unavailable`, no NDJSON body, desktop falls back to BYO. Correct-feeling, and equally compliant.

These are two different files in the directory delta, i.e. two different stories. If Unit A's `onFirstEvent` fires at `messageStart` and Unit B's refund logic assumes the commit point is the first delta, the composed system **both refunds and streams** — it emits `meta`, refunds the reservation, and then continues streaming, producing the one outcome AD-5 exists to prevent (a served invocation that is not charged), with no test that can catch it because each unit's own unit tests mock the other's boundary to its own reading.

**Second construction from the same hole — the refund arithmetic.** AD-6 mandates three counters (`reserved`/`completed`/`refunded`) but AD-5 never states the arithmetic relating them. Unit A's `refundQuotaUnit` decrements `reserved` **and** increments `refunded` (so `reserved` is always the live outstanding count and `refunded` is informational). Unit B's reads it as an append-only ledger: `reserved` never decreases, `refunded` accumulates, and remaining is `limit - (reserved - refunded)`. Compose Unit A's writer with Unit B's reader (or with a condition expression written to Unit B's model) and **every refund grants the user one extra quota unit** — refunds are double-counted. Both readings are literal from "reserved/completed/refunded counts."

**Third construction — who writes `completed` and the token aggregates, and when.** AD-6 requires them; AD-5 and AD-7 never name a write point. Unit A writes them after emitting `end` and `await`s the `UpdateItem` before returning. Unit B fires the write without awaiting so the terminal frame is not delayed — and because Lambda freezes the execution environment once the response completes, that write is lost non-deterministically. `completed_count` and the token aggregates become silently unreliable, which matters because they are the only data on which `monthly_request_limit` defaults will ever be tuned (the companion's Cost section says to re-check pricing before changing them).

**AD to tighten — AD-5 and AD-7:**
1. **AD-5/AD-7** must replace "the first valid Bedrock event" with the **named event**: "the first `contentBlockDelta` event carrying model output" (recommended — it is the only definition under which the desktop's fallback is actually safe, because a `messageStart`-only stream has produced no output to duplicate). Every occurrence, in both documents.
2. **AD-5** must state the **commit point is owned by exactly one module** (`handlers/invoke.ts`), that `lib/bedrock-client.ts` exposes raw events only and makes no commit/refund decision, and that emitting `meta` and abandoning the refund are a single indivisible step in that one module.
3. **AD-5** must state the **counter arithmetic as an invariant**: which single attribute the reserve condition expression tests, whether refund decrements it, and the exact formula for "remaining." One line closes it.
4. **AD-5** must name the **post-stream write point** for `completed` and token aggregates and require it to be awaited before the terminal frame is flushed.

---

## H4 — The reserve counter has two names and DynamoDB will not tell you — S1

**The hole.** The spine's AD-6 names the USAGE attributes "reserved/completed/refunded counts, per-operation counters, token aggregates." The companion's data table names them `request_count`, `completed_count`, `refunded_count`. The status response contract returns `request_count`. So the attribute that *is the quota* is called `reserved` in the enforceable document and `request_count` in the contract document, and the spine's Implementation Handoff rule ("the spine's AD wording is the enforceable statement") tells an implementer to prefer `reserved` — while the API contract an adjacent story implements says `request_count`. **DynamoDB items are schemaless**, so this divergence produces no compile error, no runtime error, and no log line. It produces `undefined`, which every reasonable implementation coalesces to `0`.

**Unit A — "`lib/quota.ts` reserve/refund" story.** Follows the spine verbatim: `TransactWriteItems` with a conditional `ADD reserved :one` guarded on `reserved < :limit`, plus the `CONFIG.version`/`premium`/`limit` recheck. Fully compliant with AD-5 and AD-6.

**Unit B — "`handlers/status.ts`" story.** Follows the companion's contract verbatim: reads the USAGE item and returns `{ premium, monthly_request_limit, request_count: item.request_count ?? 0, period }`. Fully compliant with AD-6's status clause and the stated route contract.

Composed, `/v1/ai/status` reports `request_count: 0` **forever**. Now trace it through the desktop: `HostedAiState` caches `0/500`; AD-9's precedence test ("a signed-in premium user has quota") is satisfied on every call for the rest of the month; the server correctly 429s once `reserved` hits the limit; AD-7/the companion require the desktop to **invalidate the cache on a 429**; the next call re-fetches status, gets `0/500` again, and attempts hosted again. **Every AI call for the rest of the billing month pays a full hosted round-trip (API Gateway request + strongly-consistent `GetItem` + a failed `TransactWriteItems`) before falling back to BYO** — permanent latency doubling on all four surfaces, permanent cost floor, and a thrash loop no unit test can see because each unit's tests are internally consistent.

**Second construction — the same clash with the counters swapped, and this one is the S1.** Unit A′ is a *later* story implementing AD-6's mandated "per-operation counters and token aggregates" post-stream write, authored from the companion, so it writes `request_count`, `completed_count`, per-operation counters. Unit B′ is the reserve path authored from the spine, condition-checking `reserved`. If the two stories land in either order and the *condition expression* ends up testing an attribute that the *increment* does not update — which is exactly what an attribute-name divergence produces — then **the monthly limit is never enforced at all**. `reserved` stays at 1, or `request_count` stays at 0, the condition always passes, and every premium user has unlimited Bedrock access. This is the denial-of-wallet outcome AD-5 exists to prevent, reached without violating a single AD, with no alarm (the CloudWatch alarm is a deferred nice-to-have) and no admin UI to notice it. The first signal is the AWS bill.

**Third construction — `premium: true, limit: 0`.** AD-6 says the invoke path fails closed when `limit<=0`, and that "the same condition returns `200` with zeroed non-premium fields" on status. Unit A returns the record as stored (`premium: true, monthly_request_limit: 0`) because only the *quota* fields are zeroed; Unit B zeroes `premium` too, because the clause says "zeroed non-premium fields." A desktop keying precedence off `premium` alone (AD-9's literal wording) enters the same permanent thrash loop against Unit A's response and never attempts hosted against Unit B's.

**AD to tighten — AD-6:**
1. **AD-6** must name the **exact attribute names**, once, as the enforceable list, and the companion's table must be corrected to match (`reserved` vs `request_count` — pick one; `request_count` is the better name only if the status contract keeps it, in which case the spine must stop saying "reserved").
2. **AD-6** must state that **one named attribute is the quota authority**, that the reserve condition expression tests that attribute and no other, and that any additional counter (`completed`, `refunded`, per-operation, tokens) is **observational and never load-bearing for enforcement**.
3. **AD-6** must resolve the `premium: true / limit: 0` status response explicitly — state field-by-field what `GET /v1/ai/status` returns for each of (missing config, malformed config, `premium=false`, `limit<=0`), and state that the desktop's precedence test is `premium && remaining > 0` using the named remaining formula, never `premium` alone.

---

## H5 — No terminal frame is required, so a truncated stream is success to one unit and failure to the other — S2

**The hole.** AD-7 names `end` as the "terminal success frame" and `error` as the "terminal in-band failure," but **nothing states that a terminal frame is mandatory for a response to be valid**, and nothing states what a reader does on EOF with neither. This case is not exotic — it is the expected outcome of a Lambda timeout (AD-4 sets 300s, which the API Gateway integration timeout will cut short well before), a Lambda crash mid-stream, a dropped connection, or an OOM at 512 MB while accumulating a large `statement_import` response.

**Unit A — "`hosted_bedrock.rs` chat streaming" story.** Treats EOF-without-terminal as a failure: if `meta` was seen, surface the standard AI error state (AD-9 forbids fallback post-`meta`); if not, treat as never-committed and fall back. Locally correct, and it is the reading AD-7's commit boundary implies.

**Unit B — "buffered surfaces adapter" story (`project_advice`, `trends_insight`, `statement_import`).** The spine and companion both tell this implementer that the non-chat surfaces "typically emit one accumulated delta before `end`," so the natural implementation is *accumulate deltas until the stream closes, then parse*. EOF is simply the end of accumulation. Nothing in AD-7 says otherwise. Result: a truncated response is handed to the statement-import parser as a complete one. For `statement_import` — the surface that writes transactions into the user's finance database — this is a partial-result-accepted-as-complete path: at best a parse error surfaced as a confusing validation message, at worst a silently short transaction list imported as if the statement had been fully read. The user has no way to know the import was truncated, and the quota unit is charged either way (post-`meta`, AD-5).

Both units are compliant. The divergence is not even visible between them, because they are two adapters over one reader and each one's tests assert its own reading.

**Second construction (b) — the server knows the response was truncated and has nowhere to say so.** AD-8 imposes output-token ceilings (chat 4096, `statement_import` 8192) that **the live desktop has never had** — no `.inference_config(...)` or `max_tokens` appears anywhere in `ai/*.rs`, so today every BYO call runs to the model's own default. Under the hosted path, a large statement will hit 8192 and Bedrock will end the stream with `stopReason: max_tokens`. AD-7's `end` frame carries **no `stop_reason` field**, so the server — which knows for a fact that the answer is incomplete — has no way to say so, and the desktop cannot distinguish a complete answer from a ceiling-truncated one. Unit A (Lambda) emits `end` on `max_tokens` because it is a successful stream. Unit B (Lambda) emits an `error` frame with a `hosted_unavailable`-ish code because a truncated answer is a failure. Both are literal; the first silently hands a truncated transaction list to the import parser, and the second charges the quota unit and forbids fallback for a condition the BYO path would have handled.

**Third construction (c) — the desktop's own terminal signal has no error channel.** The live chat surface delivers tokens with a global Tauri event carrying a completion sentinel: `app.emit("chat:response-chunk", ChatResponseChunk { chunk, done })` (`ai/chat.rs:287-316`), consumed by `useChat.ts:82`. There is **no error variant in that payload**. So an in-band `error` frame arriving after `meta` (AD-7's only post-commit failure channel) has no representation in the existing event. Unit A emits `done: true` to close the UI state — the frontend renders the truncated text as a complete answer. Unit B returns `Err(AppError::AiService{..})` from `send_chat_message` — but the chunks are already rendered, so the user sees a complete-looking answer *and* an error toast. AD-7 defines the wire and is silent on the desktop's internal event, so both are compliant and neither is what anyone wants.

**AD to tighten — AD-7:**
1. **AD-7** must state that **exactly one terminal frame (`end` or `error`) is required** for a committed response, that a stream closing without one is a failure for every consumer, and that accumulated `delta` content **must be discarded, never parsed**, unless `end` was received.
2. **AD-7** must add a **`stop_reason` (or `truncated: bool`) field to the `end` frame**, and state which value the buffered surfaces must refuse to parse. Without it AD-8's ceilings are a silent-corruption source on `statement_import`, precisely because the desktop has no equivalent ceiling today and its parsers have never had to consider truncation.
3. **AD-7** must give the reader an **idle-frame timeout** (a named number) and state whether the server emits keepalives — and if it does not, that number must exceed the worst-case time-to-first-delta for the 8192-token `statement_import` ceiling, or the two units will pick 30s and 300s respectively and disagree about which perfectly healthy long call is dead.
4. **AD-7 (or the desktop conventions)** must state that the existing `chat:response-chunk` payload **gains an explicit failure discriminator**, and that `done: true` means "completed successfully" and nothing else — otherwise the wire-level distinction AD-7 works hard to establish is erased at the IPC boundary.

---

## H6 — Nothing binds the client's base URL, the stage name, or where `/v1` lives; API Gateway's own 403 then maps to `premium_required` — S2

**The hole.** The spine names two routes, `GET /v1/ai/status` and `POST /v1/ai/invoke`, and never says how the desktop learns the origin they hang off. The companion leaves the custom domain contingent ("if a Route53 hosted zone/ACM certificate already exist … otherwise ship on the default execute-api URL and revisit") and asserts this can be done "later without changing any route contract" — which is true of the *path* and false of the *origin the client is compiled with*. There is no named stack output, no named build-time variable, no named source of truth.

**Unit A — "SAM template" story.** Names the API stage `v1` and the resources `/ai/status`, `/ai/invoke`, producing `https://{id}.execute-api.us-east-1.amazonaws.com/v1/ai/invoke` — the spine's path, exactly. Exports a `CloudFormation` output. Compliant with AD-2.

**Unit B — "`hosted_bedrock.rs`" story.** Reads the same spine, reasonably concludes `/v1` is part of the API's resource path (that is how it is written), and builds its client against the companion's aspirational origin: `https://api.nixusapp.com` + `/v1/ai/invoke`. Or, being more careful, against `{execute-api host}/prod/v1/ai/invoke` with the conventional `prod` stage. Compliant with everything.

Any of these mismatches produces the same result, and the result is the interesting part: **API Gateway answers an unmatched path with `403` and `{"message":"Missing Authentication Token"}`**. The companion's error table maps `403` to `premium_required`. So a deployment/config mismatch presents to the desktop as *"you are not premium"* — which (per the companion) invalidates `HostedAiState`, and (per AD-9's literal fallback set — see H7) is **not** fallback-eligible. A misconfigured base URL therefore manifests as every premium user being told they are not premium, on every surface, with no fallback, and no log distinguishable from a genuine entitlement problem.

**AD to tighten — AD-2, plus AD-12:**
1. **AD-2** must fix the **stage name and the full invoke path**, and state unambiguously whether `/v1` is the stage or a path segment.
2. **New sub-rule (AD-2 or AD-12):** name the **single source of truth for the client's base URL** — the stack output name, how it reaches the desktop build (env var name, config constant, or checked-in constant), and that the custom-domain migration changes only that one value. State that the desktop never constructs the origin from parts.
3. **AD-7's error mapping** must state that a `403` **without** a recognised pre-output error body is *not* `premium_required` — see H14; `premium_required` must be identified by the body `code`, so a routing/authorizer failure cannot masquerade as an entitlement decision.

---

## H7 — Three ADs give three different fallback-eligibility sets, and the per-surface fallback matrix is never fixed — S2

**The hole.** Three ADs speak about when the desktop may fall back, and they do not agree:

- **AD-7:** "the Lambda … returns a real pre-output HTTP status (400/401/403/413/429/503) with no NDJSON body — **desktop fallback is legal here**." That sentence authorises fallback on *all six* statuses, including `400 validation` and `413 payload_too_large`.
- **AD-9:** "**Pre-output quota/outage** falls back to the prior configured provider." That is 429 and 503 only.
- **AD-10:** "one 401 refresh+retry per call **before falling back or erroring**." That makes 401 fallback-eligible, which AD-9's wording excludes.

**Unit A — "`ai/backend.rs` fallback" story.** Implements AD-7 literally: any pre-output HTTP error → try the prior configured provider. Consequence: a `413` falls back, and the BYO path has no payload ceiling — so **AD-8's server-owned ceilings are unenforceable for exactly the users they were written for**. A premium user with BYO Bedrock configured routes every oversized statement around the hosted ceiling silently, on their own AWS bill, with no notice. A `400 validation` (i.e. an H1-class contract skew) also falls back, which means a contract break presents as "hosted quietly never works" rather than an error anyone reports.

**Unit B — same story, authored from AD-9 + the companion's explicit list.** Falls back only on `429`/`503`; `401`, `403`, `413`, `400` are terminal typed errors. Consequence: a user whose access token lacks the new scope (the expected state of **every existing session** after this ships, per the companion's Authentication section) gets a hard AI error on all four surfaces instead of their previously-working BYO path — a direct NFR1 violation ("hosted-service unavailability degrades to BYO/typed error, never blocks"), reached by obeying AD-9 literally. Same for the formerly-premium user whose `CONFIG` was edited to `premium=false`: `403`, no fallback, no AI at all, despite working BYO credentials sitting in the keyring.

Both are compliant. They are opposite. And the choice is not cosmetic: one of them nullifies AD-8, the other nullifies NFR1.

**Second construction — the per-surface fallback matrix.** AD-9 says "Bedrock-only surfaces require BYO Bedrock or return a typed error" without naming which surfaces those are. The companion names `statement_import`'s multimodal path. Unit A (the statement-import story) treats `statement_import` as Bedrock-only. Unit B (the generic `backend.rs` routing story) builds a surface→provider capability matrix and lists OpenAI as valid for `statement_import`, since OpenAI's current multimodal models accept images — a defensible, locally-correct call. The matrix is *the* shared data structure of AD-9 and neither unit owns it, so both build one.

**Third construction — "the prior configured provider."** Unit A reads it as *the per-dataset configured provider setting* (static config). Unit B reads it as *the provider used on the last successful call for that surface* (last-used), which after any successful hosted call is hosted — producing either a self-referential retry or no fallback at all. Nothing in AD-9 distinguishes them.

**AD to tighten — AD-7, AD-9, AD-10:**
1. **AD-9** must carry the **complete, closed fallback-eligibility table**: one row per pre-output status (400, 401, 403, 413, 429, 503) plus transport failure and terminal-frame-absent, each marked fallback-eligible or terminal. AD-7's "desktop fallback is legal here" must be deleted or narrowed to point at that table, because as written it contradicts AD-9.
2. **AD-9** must state that `413` and `400` are **terminal, never fallback-eligible**, or explicitly accept that AD-8's ceilings are hosted-path-only advisories — one or the other, stated.
3. **AD-9** must fix the **surface→provider capability matrix** by name (which of the four surfaces accept OpenAI as a fallback, which require BYO Bedrock) and name its single owning module.
4. **AD-9** must define "**prior configured provider**" as the statically configured per-dataset provider, never a last-used value.

---

## H8 — Scope enforcement has two candidate owners, and AD-3's own *Prevents* clause talks both of them out of it — S2

**The hole.** AD-3's Rule: "Cognito user-pool authorizer validates the access token and derives `sub` from verified context; **token must carry resource-server scope `nixus-api/ai.invoke`**." It states the requirement and never states **who checks it**. Its *Prevents* clause — "custom JWT verification code" — actively discourages the Lambda from inspecting claims, because a competent implementer reads "do not verify tokens yourself" as "do not go poking at the token yourself; that is the authorizer's job."

**Unit A — "SAM template" story.** Configures `AWS::Serverless::Api` with the Cognito user-pool authorizer and, reading AD-3's Rule as fully describing the authorizer's job ("validates the access token and derives `sub`"), does **not** set `AuthorizationScopes` on the methods — nothing in AD-3 mentions that property, and the authorizer does validate the token without it. Compliant with AD-2 and AD-3 as written.

**Unit B — "`handlers/invoke.ts`" story.** Derives `sub` exclusively from `event.requestContext.authorizer.claims` (AD-3: never trust a body-supplied identifier), and does **not** re-check the `scope` claim, because AD-3's *Prevents* clause reads as a prohibition on doing auth work in the Lambda. Compliant with AD-3.

Composed: **the scope is enforced by nobody.** Any signed-in Cognito user with any valid access token from that app client reaches `POST /v1/ai/invoke`. Premium is still enforced (AD-6 fails closed), so this is not immediately a spend hole — but the entire "add a scope, not a second identity system" control from AD-3 is silently absent, and the state the companion calls a one-time expected re-auth ("existing sessions lack the scope and must sign in again") simply never happens, so the defect is invisible in testing precisely because everything appears to work.

**Second construction — who detects the missing scope, and the refresh path that can never fix it.** AD-10 gives the desktop "one 401 refresh+retry per call." A refresh token minted before the resource-server scope existed **cannot** mint an access token carrying it, so refresh+retry is guaranteed to fail for every pre-existing session. Unit A (the `commands/auth.rs` story) compares the granted scope set against a required-scope constant at session load and forces one re-authentication — the behaviour the companion describes. Unit B (the `hosted_bedrock.rs` story) discovers it lazily via `401 → refresh → 401 → fall back`, per AD-10 exactly. Under Unit B, every existing premium user is **permanently and silently** on BYO until they happen to sign out by hand: no prompt, no error, no log distinguishable from a healthy fallback. AD-3 and AD-10 both describe part of this path and neither assigns the detection.

**Third construction — where the scope string lives.** The literal `nixus-api/ai.invoke` must appear in the SAM template's `AuthorizationScopes`, in the desktop's `COGNITO_SCOPES` login constant (per the memlog), and arguably in the shared contract. Three units, three copies, no named source of truth, and a drift between any two of them produces a permanent 401 that AD-10's retry cannot heal.

**AD to tighten — AD-3:**
1. **AD-3** must name **API Gateway method-level `AuthorizationScopes` as the sole enforcement point** for the scope, and state that the Lambda neither re-checks nor may rely on the `scope` claim. That makes the requirement owned exactly once and keeps the *Prevents* clause intact.
2. **AD-3** must assign the **scope-shortfall detection** to `commands/auth.rs` at session load (compare granted scopes to the required set; force one re-auth), and state explicitly that AD-10's 401 refresh+retry is **not** a remedy for a missing scope.
3. **AD-3** must name the **single source of truth for the scope string** and which files copy it.

---

## H9 — `HostedAiState` is process-wide and identity-unkeyed, and the convention forbids its only possible invalidator from touching it — S2

**The hole.** The Conventions section and the companion make `HostedAiState` a "process-wide" in-memory cache of the last `/v1/ai/status` response, and then state a hard boundary: "`ai/hosted_state.rs` is the sole owner of `HostedAiState`; **only** `ai/hosted_bedrock.rs` reads or invalidates it — no Tauri command and no frontend hook." Meanwhile AD-6 keys every piece of hosted state by Cognito `sub`, and AD-10 keeps Cognito session lifecycle owned by `commands/auth.rs`.

The cache holds a **per-`sub` fact in a process-global slot with no `sub` in it**, and the events that must invalidate it (sign-out, sign-in as a different user) are owned by a module that the convention forbids from invalidating it.

**Unit A — "`ai/hosted_state.rs`" story.** Implements exactly what is specified: `static HOSTED_AI_STATE: Mutex<Option<CachedStatus>>`, refreshed once after login and once after launch, lazily refreshed past 5 minutes, invalidated on 403/429, never called while logged out. Nothing about logout clearing it — the spine says only that no *fetch* happens while logged out, which Unit A honours. Compliant with every listed rule.

**Unit B — "`commands/auth.rs` sign-out" story.** Implements sign-out as clearing the Cognito session via `credentials.rs` (AD-10: sole keyring accessor) and emitting the existing session-changed signal. It does **not** clear `HostedAiState`, because the convention explicitly says only `ai/hosted_bedrock.rs` may invalidate it. Compliant with AD-10 and the convention.

Composed: user X (premium, limit 500, count 12) signs out; user Y signs in on the same machine within five minutes. `HostedAiState` still says premium-with-quota. `HostedBedrockAdapter` selects hosted for Y (AD-9), sends Y's token, and the server correctly enforces against Y's `sub` — so the *charge* is right, but the *routing decision was made from another user's entitlement*, and if Y is premium with a lower limit the desktop reasons about Y's quota using X's counts until the TTL lapses. The convention deadlock is the real finding: **no unit can legally implement session-change invalidation**, so both units correctly implement nothing, and the bug is a consequence of the rules rather than a lapse in following them.

**AD to tighten — AD-6/AD-10 and the `HostedAiState` convention:**
1. The cache must be **keyed by the Cognito `sub` it was fetched for**, and a read whose key does not match the current session's `sub` must be treated as absent — that alone makes the deadlock harmless.
2. The convention must be **amended to permit exactly one additional invalidator**: a session-change signal from `commands/auth.rs` clears the cache (or the cache is dropped implicitly because its key no longer matches). Name it, or the "sole invalidator" rule silently forbids the correct behaviour.
3. State whether the cache survives across datasets/profiles — it is machine-level Cognito state (AD-10) sitting next to per-dataset BYO credentials, and one unit will scope it per dataset if nobody says.

---

## H10 — An unreachable status endpoint routes hosted-first in one unit and BYO-first in the other, and the lazy refresh has no single-flight and no timeout — S2

**The hole.** Two ADs answer "what do we do when we do not know the user's status?" and they answer differently. **AD-6:** "a status read is **not** an enforcement gate." **AD-9:** hosted has precedence "**whenever** a signed-in premium user has quota." Neither says what happens when the status fetch fails or has never succeeded.

**Unit A — conservative reading (AD-9).** Unknown status means we cannot establish "premium with quota," so hosted is not selected; route to BYO/OpenAI. Consequence: any transient DNS or network hiccup silently drops premium users to BYO — including to OpenAI on the surfaces that support it, spending the user's own money — which inverts AD-9's stated intent that premium means "it just works."

**Unit B — permissive reading (AD-6).** Status is explicitly not a gate, and the server is the real gate (AD-6 fails closed), so attempt hosted and let the server decide. Consequence: non-premium users hit `POST /v1/ai/invoke` on every AI call, and the pre-`meta` fallback path adds a full round-trip of latency to every call for every non-premium signed-in user.

Both readings are literal; they produce opposite routing for the same condition, and they produce different *quota consumption* and different *cost profiles*.

**Second construction — concurrency on the lazy refresh.** "Before any AI call, if the cache is absent or older than 5 minutes, lazily refresh it first." The four surfaces are not serialised — a dashboard mount can fire `trends_insight` and `project_advice` while a chat turn is in flight. Unit A implements check-then-refresh with no single-flight: N concurrent `/v1/ai/status` calls, N API Gateway requests, N strongly-consistent reads, and N possible different answers written over each other. Unit B holds the state mutex across the network call: every AI surface serialises behind one HTTP request, and because **no timeout is specified anywhere**, a hung connection blocks all four AI surfaces indefinitely — reachable, user-visible, and arguably an NFR1 violation.

**Third construction — does the desktop decrement locally?** Unit A decrements the cached `request_count` after each successful hosted invocation so it stops attempting hosted once the limit is locally known to be reached. Unit B treats the cache as read-only server truth. The two produce different numbers of hosted attempts, different fallback timing, and different quota consumption over a month. Nothing forbids either.

**AD to tighten — AD-6 and the cache convention:**
1. State the **unknown-status routing rule** in one place: recommended — absent-or-failed status is treated as *attempt hosted* (AD-6's "not an enforcement gate" is the honest posture), with the caveat below.
2. State that the status refresh **must not block an AI call**: give it a named timeout, require single-flight (one in-flight refresh per process, joiners await the same future), require the mutex to be released across the network call, and state that a refresh failure proceeds with the stale or absent value rather than erroring.
3. State whether the desktop may **locally mutate** the cached counts. One line, either way.

---

## H11 — The payload ceilings have no canonical measurement and no stated scope — S3

**The hole.** AD-8 makes ceilings server-owned; the companion gives numbers ("1 MiB serialized JSON" for chat; "256 KiB **excl. media**" for `statement_import`; "raw statement media (**pre-base64**) capped at 4 MiB and rejected **before base64 encoding**"). Neither document says **how the number is measured**, or **whether the ceiling is a hosted-path rule or a product rule**.

**Unit A — "`handlers/invoke.ts` validation" story.** Measures `Buffer.byteLength(JSON.stringify({ ...body, media: undefined }))` for the excl.-media ceiling, and infers raw media size from the decoded base64 length.

**Unit B — same story, different implementer.** Measures `rawBody.byteLength - Σ(base64 media field lengths)`, which is a different number for the same payload (key ordering, whitespace, and `\uXXXX` escaping of non-ASCII merchant names all move it), and a payload sitting near the line is accepted by one and `413`'d by the other. Note also that the Lambda **cannot observe "pre-base64" bytes at all** — only the desktop can, so "rejected before base64 encoding" is a rule the named enforcer is structurally unable to apply, and the desktop is never told it owns a ceiling.

**Third unit — the desktop.** Some unit must pre-check to avoid burning a doomed round-trip. If it measures differently from the Lambda it either sends payloads the server will reject or self-rejects payloads the server would accept — and then the scope question bites: is the ceiling **hosted-only** (an oversized statement silently routes to BYO Bedrock, a different model, the user's own bill, no notice — see H7) or **product-wide** (a hard error even though BYO could have handled it)? Two units, two opposite user-visible behaviours, both literal.

Worth noting alongside: 4 MiB raw ≈ 5.46 MiB base64, plus 256 KiB of envelope, JSON-escaped inside an `AWS_PROXY` event — that sits close enough to Lambda's 6 MB synchronous event limit that a *compliant* upload can be rejected by the platform before the handler runs, producing an API-Gateway-shaped error the desktop's typed-error table does not describe (see H14).

**AD to tighten — AD-8:**
1. **AD-8** must name the **canonical measurement**: which bytes are counted (recommended: the raw request body's byte length for a single total ceiling, with media counted as its base64 length — one number, measurable identically on both sides, no re-serialisation).
2. **AD-8** must state **who enforces which ceiling** — the desktop pre-checks raw media before encoding, the Lambda enforces the total body ceiling — and that the two numbers are derived from one shared constant in `cloud-ai.ts`.
3. **AD-8** must state whether the ceilings are **hosted-only or product-wide**, and therefore whether `413` falls back (cross-reference H7).

---

## H12 — Nothing keeps the table that is the sole record of who is premium from being replaced by an unattended CI deploy — S1

**The hole.** Three facts compose into an unrecoverable one. (1) AD-6 puts premium and quota in one DynamoDB table. (2) FR3 / the Deferred list make that record **hand-edited in the console, with no admin UI, no billing system, no export, and no second copy anywhere** — the table *is* the entitlement system. (3) AD-12 **auto-deploys the SAM stack on every push to the default branch**, unattended. Nothing in AD-6 or AD-12 says `DeletionPolicy: Retain`, `UpdateReplacePolicy: Retain`, point-in-time recovery, or "the table's logical id and key schema are frozen."

**Unit A — "SAM template" story.** Declares `AWS::Serverless::SimpleTable` / `AWS::DynamoDB::Table` with `PAY_PER_REQUEST` and the `pk`/`sk` schema from AD-6. No `DeletionPolicy` — the spine does not mention one, and SAM's default is `Delete`. Fully compliant with AD-6 and the Stack Seed.

**Unit B — a later story that touches the table's definition.** Any of: adding a GSI for the deferred admin/reporting need, renaming the logical resource id while reorganising the template, switching from `SimpleTable` to `Table` to express the sort key more explicitly, or adjusting the key schema. Several of these force a **CloudFormation replacement**, and one of them (`SimpleTable` → `Table`) is the natural consequence of AD-6's two-sort-key design. Unit B is compliant with AD-6 too — AD-6 describes the shape, not the resource's immutability.

Composed with AD-12: the replacement happens **on merge, unattended, in production, with no staging stack** (Deferred: "v1 ships one production stack"). Every `USER#<sub>` `CONFIG` item — the only record that anyone is premium — and every mid-month `USAGE#` counter is deleted. There is no repair path: no admin UI, no billing source to re-derive from, no backup requirement stated, and the deferred reconciler would not help. Recovery is "ask each premium user whether they were premium."

**Second construction — the deploy principal.** AD-12 requires "a separately scoped SAM deploy IAM principal," which is right, and does not say **what it may not do**. Unit A provisions it broadly enough for CloudFormation to manage the stack (which necessarily includes deleting stack resources). Unit B (the CI story) runs `sam deploy` with the default rollback behaviour. Neither unit is wrong; together they mean an ordinary failed deploy can roll back through a resource replacement.

**AD to tighten — AD-6 and AD-12:**
1. **AD-6** must state `DeletionPolicy: Retain` **and** `UpdateReplacePolicy: Retain` on the table, point-in-time recovery **on**, and that the table's **logical id and key schema are frozen** — any change requiring replacement is a manual, out-of-band migration, never a CI deploy.
2. **AD-12** must state that the auto-deploy path may not perform a **stateful-resource replacement or deletion**: name a CloudFormation **stack policy** (or an explicit deny on `dynamodb:DeleteTable` in the deploy principal) so the pipeline structurally cannot do it, rather than relying on every future story noticing.
3. **AD-6** must name a **recovery posture** for hand-assigned premium state, given there is no second source of truth — even "PITR plus an exported item list" is enough; nothing is not.

---

## H13 — Copying the `web-ci.yml` precedent structurally imports `cancel-in-progress: true` onto a CloudFormation deploy — S2

**The hole.** AD-12 requires a dedicated `.github/workflows/api-bedrock-ci.yml` and the companion instructs that it follow `web-ci.yml` "structurally (checkout → pnpm setup → verify job → gated deploy job using `aws-actions/configure-aws-credentials@v4` in `us-east-1`)". The live precedent is:

```yaml
concurrency:
  group: web-ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

For `apps/web` that is correct and harmless — the deploy is `aws s3 sync` + `cloudfront create-invalidation`, both idempotent and interruptible. For a `sam deploy` it is not: cancelling a GitHub job mid-`deploy` kills the poller, not the CloudFormation operation, and leaves the stack in `UPDATE_IN_PROGRESS` / `UPDATE_ROLLBACK_IN_PROGRESS`. The next push's deploy then fails on a wedged stack, and with **one production stack and no staging** (Deferred), every hosted AI surface is down until someone intervenes by hand.

**Unit A — "`api-bedrock-ci.yml`" story.** Follows the companion's instruction faithfully and copies the precedent's concurrency block with the group renamed. Compliant with AD-12 and with the explicit instruction to mirror `web-ci.yml`'s structure.

**Unit B — same story, an implementer who has wedged a stack before.** Uses `cancel-in-progress: false` and scopes the group to the stack rather than the ref, so two rapid merges queue instead of colliding. Also compliant.

Unit A is the *more* obedient reading, and it is the dangerous one — this is the rare case where following the named precedent is the defect. Note also that `web-ci.yml`'s group key includes `github.ref`, so two different refs get no mutual exclusion at all; for a single-stack service the group must be the **stack**, not the ref.

**Second construction — the paths filter.** The precedent's filter is `apps/web/**`, `packages/shared/**`, the workflow file, and `pnpm-lock.yaml`. Copied faithfully with `apps/web` swapped for `apps/api-bedrock`, that filter *does* cover the shared contract — so this risk is lower than it looks. But neither the spine nor the companion says which paths, only "paths-filtered," so a unit that filters on `apps/api-bedrock/**` alone (the locally-obvious choice for a self-contained deployable) silently stops verifying and deploying every change to `packages/shared/src/types/cloud-ai.ts` — the one file the companion itself calls the blocking cross-component dependency. That is H1's version skew given a concrete trigger.

**Third construction — the deploy credential mechanism.** The repo has **no OIDC anywhere**: `web-ci.yml` uses static `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` secrets and neither workflow declares `permissions: id-token: write`. The companion names static secrets (`AWS_INFRA_DEPLOY_ACCESS_KEY_ID`/`_SECRET`), so a unit following it provisions a long-lived key with CloudFormation/Lambda/IAM/DynamoDB mutation rights; a unit reading AD-12's "separately scoped SAM deploy IAM principal" as an invitation to do it properly provisions an OIDC role and adds the `id-token` permission. Both satisfy AD-12's stated intent, and the resulting secret names and trust models are incompatible — which matters because whoever wires the repo secrets is a third party to both.

**AD to tighten — AD-12:**
1. **AD-12** must state the **concurrency group is per-stack with `cancel-in-progress: false`**, and explicitly note this as a **deliberate divergence from `web-ci.yml`**, so the "follow the precedent structurally" instruction cannot be read as covering it.
2. **AD-12** must state the **paths filter** by name (`apps/api-bedrock/**`, `packages/shared/**`, the workflow file, `pnpm-lock.yaml`) rather than "paths-filtered."
3. **AD-12** must pick the **credential mechanism** — static scoped keys (matching the repo's only precedent) or OIDC role assumption (which would be the repo's first) — and name the secrets/role, because there is no existing pattern for a SAM deploy in this repo to fall back on: `apps/api-bedrock` is the first SAM/IaC deployable here, and `apps/api-licensing`, `template.yaml`, and `samconfig.toml` are all absent today.

---

## H14 — One streaming router, two response conventions; and a Lambda concurrency throttle is indistinguishable from `quota_exhausted` — S3

**The hole (a).** AD-2 puts `ResponseTransferMode: RESPONSE_STREAM` on "one Lambda AWS_PROXY integration **per route**" — both routes — while AD-4 and the Conventions make `src/functions/api.ts` the sole `streamifyResponse` handler for both. A streaming-mode handler cannot return a buffered `{ statusCode, body }` object; status and headers must be written through the streaming metadata prelude.

**Unit A — "`functions/api.ts`" story.** Implements one convention: both routes write through `HttpResponseStream.from(stream, { statusCode, headers })`. **Unit B — "`handlers/status.ts`" story.** Returns a plain `{ statusCode: 200, body: JSON.stringify(...) }`, because that is what an API Gateway handler returns and AD-2's streaming rule reads as an invoke-path concern. Composed, `GET /v1/ai/status` returns a malformed or empty response. Caught at first integration — but it is a two-story clash the spine could have prevented with one sentence, and it also bears on H6/H7, since a botched status route presents as unknown-status routing (H10).

**The hole (b) — two incompatible error envelopes already exist in this repo, and the spine points at both.** The Conventions say "typed errors mapped into existing `AppError` philosophy on desktop," and the companion says the new variant follows "the existing discriminated-union JSON convention (`{ "type": "...", "message": "...", "recoverable": true }`)". Live code confirms that shape — but it is produced by a **hand-written `impl Serialize for AppError` with one manually-built map per variant** (`error.rs:33`, `error.rs:57-63`), where two arms even inject a `setup_url` key that has no Rust field. Meanwhile the shared package `cloud-ai.ts` is being added to contains exactly one existing wire type: `types/api-error.ts`, shaped `{ error: { type, message, field? } }` — a **different envelope with a different `type` vocabulary**, already divergent from the desktop's today.

Unit A ("`handlers/invoke.ts`" story) emits pre-output errors in the shape of the shared package's only existing error type, `{ error: { type, message } }` — the locally-obvious choice when you are adding a file next to `api-error.ts` in the same package. Unit B ("desktop error mapping" story) parses `{ code, message }` per the companion's error table and maps into `AppError::AiService { message, recoverable }` by hand-writing a new `Serialize` arm. Neither violates anything; the bodies never parse, so every pre-output error degrades to whatever the desktop's parse-failure branch does — and because that branch is written by Unit B, it will be a generic error, which per AD-9's literal fallback set may not fall back (H7). A contract intended to make failures *typed* produces exclusively untyped ones.

**The hole (c) — the 429 collision.** AD-4 sets **reserved concurrency 10**. Lambda throttling under an `AWS_PROXY` integration surfaces to the client as a `429` **with no `code` in the body** — byte-indistinguishable from AD-5's `quota_exhausted` if the desktop maps by status alone, which the companion's error table invites. Unit A maps every `429` to `quota_exhausted`: it invalidates `HostedAiState` and falls back — so a *transient capacity event* is recorded as an entitlement event, and with H4's zeroed counters it re-enters the thrash loop. Unit B maps by body `code` and cannot classify a body-less `429` at all, so it surfaces a generic error and (per AD-9's literal set) may not fall back. The same collision exists for API Gateway's own `401` (authorizer), `403` (unmatched route — H6), `413`, `502` (Lambda crash), and `504`, none of which appear in the error table.

**AD to tighten — AD-2, AD-7:**
1. **AD-2** must state that **both routes' responses are written through the same streaming metadata path**, or exempt `GET /v1/ai/status` from `RESPONSE_STREAM` and say so.
2. **AD-7** must require every **Lambda-generated pre-output error to carry a single-line JSON body with a `code`** from the closed error set, name that envelope explicitly (flat `{ code, message }`, *not* the shared package's existing `{ error: { … } }` shape), and state that `types/api-error.ts` is unrelated to this boundary — otherwise the two existing envelopes in this repo guarantee a third.
3. **AD-7** must give the **default mapping for body-less statuses generated by API Gateway or Lambda itself** (401/403/413/429/502/504) — explicitly *not* `premium_required` and *not* `quota_exhausted`, but a transport-level `hosted_unavailable`-class outcome. That single rule closes the H6 cascade and the 429 collision at once.

---

## H15 — AD-10's 120-second skew collides with a deliberately zero-skew existing predicate, producing two live definitions of "expired" — S2

**The hole.** AD-10's Rule: "`commands/auth.rs` provides a call-time access token refreshed with a **120-second skew**; one 401 refresh+retry per call." The live code it binds does the opposite, **on purpose**: `auth.rs:762` is `fn is_session_expired(expires_at: i64, now_unix: i64) -> bool { now_unix >= expires_at }`, carrying a comment stating the exactness is deliberate and traceable to an acceptance criterion ("still in the future"), with a test asserting it. And `refresh_session` (`auth.rs:853`) collapses **every** failure — transport error, non-2xx, unparseable body — to `Ok(None)`, which `resolve_session` turns into `ResolvedSession::Expired`, i.e. force interactive re-login. There is no retry and no backoff anywhere. AD-10 mandates both a skew and a retry, and does not say whether it is amending the inherited behaviour or adding a parallel one.

**Unit A — "`commands/auth.rs` call-time token" story, global reading.** Implements the skew where the predicate lives: `is_session_expired` gains the 120-second buffer. Every consumer of session state — including `get_auth_session`, the Tauri command the whole frontend auth surface reads — now reports "expired" two minutes early and triggers refreshes that the login architecture's AC explicitly said should not happen. This is compliant with AD-10 and **breaks an inherited invariant** the spine claims to leave untouched ("this feature adds one OAuth scope to that existing system; it does not touch the auth flow itself").

**Unit B — "`hosted_bedrock.rs` adapter" story, local reading.** Adds the skew only inside the new `get_hosted_ai_token()` helper, leaving `is_session_expired` and its test untouched — which is the *correct* respect for AD-10's sibling constraint that this feature not disturb `architecture-login.md`. Now **two predicates for "is this session usable" coexist in one module**: for 120 seconds before expiry, `get_auth_session` reports a live session to the frontend while `get_hosted_ai_token` reports it expired and forces a refresh. If the refresh fails (and per the live code, one transport hiccup is enough), Unit B's helper has no session while the rest of the app believes it does — and AD-10's "one 401 refresh+retry" is unreachable because the refresh already failed locally, before any 401 existed.

Both are compliant. They produce different behaviour for the frontend, different refresh volumes against Cognito, and different failure modes — and the divergence is invisible in either unit's tests.

**Second construction — "one 401 refresh+retry" has no retry to build on.** AD-10 assumes a refresh primitive that reports failure distinguishably. The live one does not: it returns `Ok(None)` for a network blip and for a genuinely revoked token alike. Unit A therefore treats a failed refresh as "session expired → surface auth error / force login" (matching live semantics); Unit B treats it as "hosted unavailable → fall back to BYO" (matching NFR1). A single transient network failure thus either logs the user out or silently drops them to BYO, depending on which story owned the line.

**AD to tighten — AD-10:**
1. **AD-10** must state **explicitly whether it amends `is_session_expired` or adds a separate hosted-token predicate**, and if the latter, that exactly two predicates are permitted and which consumers use which. Given the inherited AC and its test, the honest answer is a **separate, hosted-only** freshness check — but it must be said, because Unit A's reading is the simpler one and it breaks an inherited invariant.
2. **AD-10** must require the refresh primitive to **distinguish "token rejected" from "refresh could not be attempted"**, and state that only the former ends the session while the latter is a `hosted_unavailable`-class condition. Without that distinction, "one 401 refresh+retry per call before falling back or erroring" cannot be implemented consistently by two people.

---

## H16 — Client disconnect is unspecified on both sides, and the live client cannot cancel at all — S2

**The hole.** AD-5 says that once the first Bedrock event arrives, "the reservation stays charged regardless of outcome," and AD-7 says post-commit failures are in-band `error` frames. Neither AD mentions **client disconnect** — the single most common way a streaming response ends abnormally. And the live desktop makes it worse than a gap: `stream_chat_response` (`ai/chat.rs:245`) accepts no cancellation token, `send_chat_message` is one awaited `invoke()`, and `useChat.ts` has no abort wiring — so **there is no path by which a user closing the chat can stop the request**, and no path by which the desktop can signal the server that nobody is listening.

**Unit A — "`handlers/invoke.ts`" story.** Writes each frame to the response stream and, on a write error (broken pipe), stops consuming the Bedrock stream, logs `status: client_disconnected`, and returns. Quota stays charged per AD-5. Locally sensible, and it stops the token meter.

**Unit B — same story, different implementer.** Ignores write errors and drains the Bedrock stream to completion, because AD-6 **requires** the USAGE item to carry token aggregates and AD-5 requires `completed` accounting — and you cannot record the `metadata` event's token counts if you abandon the stream early. Also locally sensible, also compliant, and it means **an abandoned chat turn is billed for its full output-token cost** at the model's ceiling (4096 for chat, 8192 for `statement_import`). Given AD-5's quota unit counts *invocations, not tokens*, and the companion states Bedrock tokens are "the dominant, unbounded-if-uncapped cost," Unit B converts every abandoned turn into a maximum-cost turn — while the quota control that is supposed to bound cost registers exactly the same single unit either way.

**Second construction — the desktop side of the same event.** Unit C ("`hosted_bedrock.rs`" story) holds the NDJSON reader inside the awaited command, so an abandoned UI still drives the read to completion (matching the live no-cancellation reality). Unit D adds a cancellation token while wiring the adapter — a natural thing to do when you are already touching the streaming path — and drops the reader, closing the socket. Under Unit A's server this saves real money; under Unit B's server it saves nothing and merely makes the desktop's `completed`/token accounting diverge from the server's. Four compliant combinations, three different cost profiles.

**AD to tighten — AD-5 and AD-7:**
1. **AD-5** must state the **client-disconnect rule** explicitly: the reservation stays charged (consistent with the existing wording) **and** the Lambda must abandon the Bedrock stream on the first write failure, accepting that token aggregates are best-effort for disconnected calls. Say which of the two obligations wins, because AD-6's mandated token aggregates are what push a careful implementer into Unit B.
2. **AD-7** must state whether **stream cancellation is in scope for v1 or deferred**. Given the live code has none, "deferred" is a legitimate answer — but it must be written down, because AD-8's ceilings plus AD-5's per-invocation unit plus no cancellation is the one combination where the feature's stated dominant cost driver is entirely uncontrolled for abandoned turns, and a reader of the current spine would reasonably assume otherwise.

---

## H17 — AD-9 binds "all four surfaces," but there are five concrete provider call sites — S3

**The hole.** AD-9's Rule: "all four surfaces depend on one `AiBackend` port," and the companion states "none of the four call sites talks to a concrete AWS or OpenAI client directly anymore." The live tree has a **fifth**: `commands/settings.rs:182` declares its own `ProviderKind` enum and `test_ai_connection` builds its own Bedrock/OpenAI client inline (`settings.rs:53-101`), duplicating the construction logic in `ai/mod.rs:64-98`. It is not one of the four AI surfaces, and AD-9 therefore does not bind it — literally.

**Unit A — "`AiBackend` port + retrofit" story.** Retrofits exactly the four surfaces AD-9 names, leaving `test_ai_connection` on its own concrete client. Fully compliant: AD-9 says four, and AD-9's *Prevents* clause ("two divergent AI call paths") is satisfied for the four surfaces it binds.

**Unit B — "settings / provider configuration" story.** Leaves `test_ai_connection` alone too, for the same reason, and because touching it is out of its scope.

Composed, the fifth path survives — and it is the one path whose entire purpose is to tell the user whether their AI is working. For a premium user, "Test AI connection" now validates **BYO credentials that the app will not use** (AD-9 gives hosted precedence even over an explicitly configured provider), and reports failure for a user whose AI works perfectly, or success for a user whose hosted path is broken. The port exists, the precedence rule exists, and the one surface that reports provider health is outside both.

A second, smaller consequence: the model id `us.anthropic.claude-sonnet-4-6` is copy-pasted into four constants across three files (`ai/chat.rs:10`, `ai/cc_parser.rs:12`, `ai/project_advice.rs:22`, `ai/trends_insight.rs:19`) with no shared constant. The Stack Seed pins the same string server-side. That is five copies across two languages with nothing tying them together, so the hosted and BYO paths will silently drift to different models the first time either side is updated — and because AD-8 makes the model server-owned and invisible on the wire, no unit can detect the drift.

**AD to tighten — AD-9:**
1. **AD-9** must bind **every** concrete provider-client construction site, not "the four surfaces" — name `commands/settings.rs::test_ai_connection` explicitly and state what it does under hosted precedence (recommended: it reports on the provider the port would actually select, hosted included).
2. **AD-9 or AD-8** must state that **client construction happens in exactly one place** and that the duplicated model-id constants collapse to one, so the port cannot be bypassed by the next surface that needs a client.

---

## What is already closed (and worth not weakening)

For balance — the following were attacked and held, and the tightenings above should not disturb them:

- **AD-1 / AD-11** are airtight prohibitions with no compliant-but-divergent reading. No unit can obey them and still leak a credential or persist content. This is the model the rest of the spine should follow.
- **AD-4**'s "never a Lambda per route or per operation" and the closed operation enum in **AD-8** cannot be misread; the anti-pattern is named explicitly in the companion.
- **AD-6**'s deliberate 403-vs-200 asymmetry between `invoke` and `status` is stated twice, with the reason, in both documents — a genuine divergence risk that the spine already closed on purpose.
- **AD-5**'s ordering (consistent config read → conditional transaction → invoke) closes the same-user read-then-write race properly, and the `CONFIG.version` recheck is the right mechanism. The gaps in H3/H4 are about *names and terms*, not about the sequence.
- **AD-10**'s "`credentials.rs` is the sole keyring accessor" is inherited, restated, and reinforced by an enforcement guideline naming the forbidden call (`keyring_core::Entry`). Nothing constructible gets around it.

## Recommended gate

Do not shard this into parallel cloud/desktop stories until **H1, H2, H3, H4, H12** are closed in the spine text — H2 blocks the contract that both sides' first stories depend on, H4 and H12 are the two S1s, and H1/H3 are the two invariants every later story silently assumes. **H6, H7, H8, H9, H15** should be closed in the same pass: each is a contradiction between ADs (or between an AD and live, deliberate, test-covered behaviour) rather than a silence, so each will otherwise be resolved differently by whichever story reaches it first — and H15 in particular risks an inherited invariant from `architecture-login.md` that this spine claims not to touch. H5, H10, H11, H13, H14, H16, H17 can be closed as sub-rules during the same edit at near-zero cost.

Two closing observations. First, the spine's problem is not its shape: it is that its load-bearing terms are **predicates instead of names** ("the first valid Bedrock event," "pre-output," "prior configured provider," "has quota," "expired"). Almost every tightening above is one sentence that replaces a predicate with a name, a number, or an owner. Second, the companion's two "Important Gaps (non-blocking)" are both understated: the `AiBackend` seam gap resolves to **five** concrete call sites and no existing trait (H17), and the custom-domain gap is not just a template parameter but the client's compiled-in origin with a `403 → premium_required` failure mode (H6). Neither is blocking on its own; both are load-bearing enough to belong in the spine rather than in a gap list.

