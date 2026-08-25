---
review: data-integrity-and-failure-semantics
target: '../ARCHITECTURE-SPINE.md'
companion: '../../../architecture-cloud-bedrock.md'
lens: 'DynamoDB quota/reservation correctness + streaming protocol failure semantics'
reviewer: adversarial (data-integrity)
date: '2026-08-25'
verdict: CHANGES REQUESTED
blocking_findings: 4
important_findings: 6
minor_findings: 4
---

# Data-Integrity & Failure-Semantics Review — Nixus Cloud Bedrock

## Verdict

**CHANGES REQUESTED** — 4 blocking, 6 important, 4 minor.

The reserve-before-call / refund-before-first-event model is **sound in principle** and the accepted crash-leak is a legitimate trade. Nothing here asks for a redesign, a reconciler, or a change to the adopted semantics. The problem is that the adopted semantics are stated at a level of precision that two independent implementers — or two agents working from AD-5/AD-6/AD-7 — would resolve incompatibly, and three of those resolutions silently corrupt the quota ledger rather than failing loudly.

The four blocking items are all cheap: define which attribute the gate condition reads, name the commit event, pin the period per-request, and make the three counter writes idempotent under SDK retry. Each is one sentence of invariant, no new components.

**Scope note:** this review deliberately keeps request quota (AD-5, one unit = one Bedrock invocation) and token billing (AD-8 ceilings, token aggregates in AD-6) as separate concerns and never argues from one to the other. Where they interact (finding I-4), it says so explicitly.

## Method

Adversarial trace of every mandated scenario against the enforcement sequence in `architecture-cloud-bedrock.md` §Data Architecture and the frame contract in §API & Communication Patterns, reasoning from DynamoDB expression semantics (no arithmetic in `ConditionExpression`; `ADD` treats a missing numeric attribute as 0; `TransactWriteItems` idempotency window via `ClientRequestToken`; `TransactionCanceledException.CancellationReasons[]` shape), Lambda synchronous-invocation semantics (no platform retry from API Gateway; hard sandbox kill at timeout with no catchable in-process event), and `ConverseStream` event semantics (in-band exception events delivered on an already-200 stream).

Findings are graded by whether an implementer following the current text can produce a **wrong ledger** (blocking), a **wrong user-visible outcome** (important), or **an unstated-but-correct-by-luck outcome** (minor).

---

## Blocking

### B-1 — The gate condition has no expressible attribute. `reserved`/`refunded`/`request_count` conflict across the two documents.

**Where.** AD-6 says the `USAGE#<YYYY-MM>` item carries "reserved/completed/refunded counts". The companion's data table names them `request_count`, `completed_count`, `refunded_count`, and its enforcement sequence says the transaction "conditionally increments `request_count` ... only if the resulting count stays below the limit". `GET /v1/ai/status` returns `request_count`. The memlog says "reserved/completed/refunded".

**Failure.** Three attribute names for the reservation counter, and — more importantly — no statement of *which* attribute the `ConditionExpression` compares against the limit, or what a refund does to it. Both readings are broken:

- If refund only increments `refunded_count` and leaves the gate counter alone, **the refund does not refund**. A user whose Bedrock stream fails to establish is permanently charged, and AD-5's "refund the same period" is decorative. `refunded_count` becomes a number nobody can act on.
- If refund decrements the gate counter *and* increments `refunded_count`, the gate counter is non-monotonic and `reserved` no longer means "reservations ever made" — so `reserved = completed + refunded + in_flight` stops holding and the counters lose their only checkable relationship.

The obvious third reading — gate on `reserved - refunded < limit` — **is not expressible in DynamoDB.** Condition expressions support comparators, `attribute_exists`/`attribute_not_exists`, `BETWEEN`/`IN`, and boolean composition. They support **no arithmetic operators.** Arithmetic exists only in update expressions. An implementer who designs the ledger around a two-attribute net computation will discover this at implementation time and improvise a fix (a read-then-write, a Lambda-side subtraction, a second transaction) — every improvisation reopens the race AD-6's transaction exists to close.

**Minimal invariant.** Introduce exactly one gate attribute; keep the existing three as monotonic observability counters; put all of them on the same item so every mutation stays a single-item atomic update.

> `USAGE#<YYYY-MM>` carries one **gate attribute** `charged` — the only attribute any quota `ConditionExpression` reads — plus monotonic observability counters `reserved`, `completed`, `refunded` and the per-operation/token aggregates. Reserve performs, in one update, `ADD charged :one, reserved :one` under `ConditionExpression: attribute_not_exists(charged) OR charged < :limit`. Refund performs `ADD charged :negOne, refunded :one`. `charged = reserved − refunded` holds by construction; `reserved − completed − refunded ≥ 0` is the abandoned/in-flight residual. `GET /v1/ai/status`'s wire field `request_count` is defined as `charged` — the same number the gate reads, never a gross count.

Note the `attribute_not_exists(charged) OR` disjunct is load-bearing, not defensive: a bare `charged < :limit` evaluated against the first request of a new month is compared against a **missing attribute on a missing item**, which fails — turning every user's first call of every calendar month into a spurious `429 quota_exhausted`. The current text ("conditionally increments ... only if the resulting count stays below the limit") does not lead an implementer to this disjunct.

### B-2 — "First valid Bedrock event" is ambiguous exactly where it decides both the charge and whether fallback is legal.

**Where.** AD-5 ("failure before the first valid Bedrock event is received"), AD-7 ("Only once the first Bedrock event arrives does the Lambda commit"), companion §Pre-output vs. mid-stream errors, and the Enforcement Guideline "never emit `meta` until ... the first valid Bedrock event has been received".

**Failure.** `ConverseStream` returns HTTP 200 and then delivers a typed event stream. That stream can carry `internalServerException`, `modelStreamErrorException`, `validationException`, `throttlingException`, or `serviceUnavailableException` **as its first event.** So "the first Bedrock event arrived" and "Bedrock produced output" are different facts, and the documents use the former as the trigger for the latter's consequences. A throttled or immediately-failed invocation produced no tokens and no output, but under a literal reading of AD-7 it is a committed stream: charged forever, `meta` already emitted, in-band `error` frame only, and — per AD-9 — **fallback to BYO is now forbidden.** The user is charged a unit, gets no answer, and is denied the BYO path that would have worked. Under the other reading it refunds and falls back correctly. Both readings are defensible from the text; they differ in money and in whether the product works during a Bedrock throttle event, which is precisely when it matters most.

The word "valid" is carrying the entire distinction and is never defined.

**Minimal invariant.** Name one event as the commit point.

> The **commit event** is the first `messageStart` event received from `ConverseStream`. An in-band exception event (`throttlingException`, `serviceUnavailableException`, `internalServerException`, `modelStreamErrorException`, `validationException`) received **before** `messageStart` is a pre-output failure: refund, emit no `meta`, and return the mapped HTTP status (`503 hosted_unavailable`, or `400 validation`) with no NDJSON body — desktop fallback is legal. Once `messageStart` is received the reservation is committed and every subsequent failure, including an in-band exception event, is an `error` frame with no refund and no fallback.

`messageStart` is the right line rather than the first `contentBlockDelta`: Nixus is already billed the input tokens once the model turn starts, so the invocation genuinely cost money. The invariant is that **one** named event is the boundary, decided once.

**Corollary that must ship with it.** Nothing may be written to the response stream before the commit event. With `streamifyResponse`, status and headers are fixed by the first write; an implementer who opens the stream at reserve time converts every pre-output error into `200` with an empty body, which erases the `quota_exhausted` / `hosted_unavailable` distinction the desktop's cache-invalidation and fallback logic both depend on (AD-9, companion §Status cache).

### B-3 — The period key is re-derived at refund and finalization, so a month boundary can refund the wrong item.

**Where.** Companion §Data Architecture: "`YYYY-MM` is computed in UTC at request time"; "Refund is a second, targeted `UpdateItem` against the same `USAGE#` item".

**Failure.** "Request time" is stated once, but refund and finalization are separate operations that happen at a *later* wall-clock time, and nothing forbids re-deriving "current period" in either. With a 300s Lambda timeout and streaming chat, crossing a UTC month boundary inside one invocation is routine, not exotic. Re-derivation at refund time on the boundary produces: `ADD charged :negOne` on the **new** month's item — creating `charged = -1`, i.e. one free unit next month, permanently, with no reconciler (AD-5) to notice — while the reservation stays charged in the old month. The user is double-penalized in August and silently credited in September, and both errors are invisible.

The same re-derivation at finalization scatters a single request's `completed`, per-operation, and token aggregates across two period items, making both months' aggregates uninterpretable.

**Minimal invariant.**

> The UTC period key is computed **exactly once per request**, before the reservation, and carried as request-scoped state through the reservation, the refund, and the finalization write. No quota mutation ever re-derives the period from the clock. A refund and its reservation always target the same item.

### B-4 — Reserve, refund, and finalization are all non-idempotent `ADD` writes exposed to AWS SDK retry.

**Where.** Companion §Data Architecture (reserve = `TransactWriteItems`, refund = "a second, targeted `UpdateItem`"), plus the implied finalization write for `completed_count` and token aggregates. `client_request_id` is "tracing only — never used for auth or idempotency".

**Failure.** `ADD` is not idempotent, and the AWS SDK v3 retries on its own by default. The classic case is a transient network or 5xx condition where the write **did** land server-side and the client saw a failure: the retry applies the delta twice.

- Retried **reserve** → 2 units charged for 1 Bedrock call, with only one refund path. Silent overcharge.
- Retried **refund** → `charged` decremented twice → free quota, and `charged` can go negative, which then passes the `charged < :limit` gate forever.
- Retried **finalization** → double-counted `completed` and double-counted token aggregates, which is the number used to sanity-check Bedrock spend.

There is currently no idempotency mechanism anywhere on the write path, and the one identifier in the request is explicitly disqualified.

**Minimal invariant.** Use DynamoDB's native transaction idempotency rather than inventing one.

> The Lambda generates one server-side `reservation_id` (UUID) per invocation, never derived from client input. All three quota mutations — reserve, refund, finalization — are issued as `TransactWriteItems` with `ClientRequestToken` set to `<sub>:<period>:<reservation_id>:<reserve|refund|finalize>`, making each mutation idempotent within DynamoDB's ~10-minute window. The refund additionally carries `ConditionExpression: charged > :zero` so no ordering pathology can drive the gate attribute negative.

The 10-minute window covers the whole lifecycle: reserve at t=0, finalization at t ≤ 300s (the AD-4 Lambda timeout).

**Why `client_request_id` must stay disqualified — and why that needs saying out loud.** An implementer hunting for an idempotency token will reach for the only id in the request contract. If `client_request_id` became the reserve token, a client could send N requests all carrying the same id; DynamoDB would idempotently dedupe N reservations into one charge while the Lambda made N Bedrock calls. That is a **denial-of-wallet hole**, and it is the exact control AD-8 and AD-5 were built as independent layers to prevent. The companion says `client_request_id` is not for idempotency; it does not say why, and the why is what stops the mistake.

---

## Important

### I-1 — `TransactionCanceledException` is not triaged, so a config edit mid-reservation is reported as quota exhaustion.

The reserve transaction contains a `ConditionCheck` on `CONFIG` (rechecking `version`/`premium`/`monthly_request_limit`) and a conditional update on `USAGE#`. A cancellation returns **one reason per transaction item**, and the causes have completely different correct responses:

| Cancellation reason, on which item | Actual cause | Correct response |
|---|---|---|
| `ConditionalCheckFailed` on `CONFIG` | admin edited premium/limit between the read and the transaction | re-read `CONFIG`, retry **once**; then `403 premium_required` only if still not entitled |
| `ConditionalCheckFailed` on `USAGE#` | genuinely at the limit | `429 quota_exhausted` |
| `TransactionConflict` on either | concurrent request from the same user touching the same item | bounded jittered retry — not a user-visible error |
| `ThrottlingError` / `ProvisionedThroughputExceeded` | DynamoDB pressure | `503 hosted_unavailable` |

Neither document mentions `CancellationReasons`, and the error table (`quota_exhausted` → 429, `premium_required` → 403) offers no bucket for the middle two rows. The default implementer behavior — treat any cancellation as quota exhaustion — means an admin who *raises* a user's limit causes that user's very next call to report `429 quota_exhausted`, which per AD-9 also invalidates the status cache and silently falls back to BYO. The user experiences a quota failure at the moment their quota grew.

`TransactionConflict` matters concretely here: with reserved concurrency 10 and a chat turn that fires a tool follow-up (AD-5) while a trends refresh runs, two transactions on one user's `USAGE#` item is an ordinary occurrence, not a burst. `TransactionCanceledException` is not blanket-retried by the SDK, precisely because its reasons are mixed.

**Minimal invariant.** State that reserve failures are classified per `CancellationReasons[]` by item, with the four mappings above, and that `TransactionConflict` gets a bounded retry rather than a status code.

### I-2 — The `version` recheck depends on a manual step nothing enforces; the value recheck is the one that works.

FR3 administers premium by hand in the DynamoDB console. A human editing that item will not reliably increment `version`. So a `version`-based `ConditionCheck` fails *open* exactly when it's supposed to catch something (admin changed the limit without bumping `version` → stale limit accepted) and fails *closed* spuriously when the admin does bump it (see I-1). The recheck the companion also specifies — `premium = :true AND monthly_request_limit = :limit_read` by value — is self-sufficient, needs no human discipline, and closes the read-then-write window on its own.

**Minimal invariant.** The `ConditionCheck` recheck asserts `premium` and `monthly_request_limit` **by value against the values just read**. `version` is informational only and is not part of any condition. (Optionally keep `version` in the CONFIG item as an admin-facing changelog aid.)

**While there:** two adjacent behaviors fall out of the value recheck and should be named as expected rather than left for an implementer to "fix":

- **Limit lowered below current usage** (admin sets 100 while `charged = 300`): the gate condition fails for the remainder of the period; the user is hard-stopped, never retroactively refunded, and `charged` is never clamped. Correct — say so, so nobody adds clamping logic.
- **Limit raised mid-period**: takes effect on the next reservation with no migration. Correct — say so.

### I-3 — No terminal-frame guarantee, so a truncated stream has no defined client behavior.

The frame contract is `meta | delta | end | error` with `error` "only possible after `meta` has been sent". It never states that **exactly one** terminal frame is guaranteed, and it defines no client behavior for the case that actually occurs most often in production: **connection EOF after `meta` with neither `end` nor `error`.** That is what a Lambda hard timeout, a sandbox crash, or a gateway-side cutoff produces.

This is a protocol hole with a money consequence. The desktop's rules are "pre-`meta` → fall back" and "post-`meta` → surface the error state". A truncated stream is post-`meta`, so the safe reading is the error state — but an implementer optimizing for user experience will reasonably read "no terminal frame means we never got a real answer, retry" and reintroduce exactly the duplicate-output / duplicate-tool-action hazard AD-7 exists to prevent.

**Minimal invariant.** Exactly one terminal frame (`end` or `error`) is emitted per committed stream. The desktop treats EOF after `meta` without a terminal frame as a terminal in-band failure — identical to an `error` frame — never as a fallback trigger and never as a retry of the same operation against any provider.

**Related verification item, not a finding.** The companion selected Regional REST over HTTP API partly because HTTP API's 30s integration timeout is non-raisable, implying REST's is raisable. Whether the REST integration timeout still bounds the **total duration** of a `ResponseTransferMode=STREAM` response, and at what value, determines whether AD-4's 300s Lambda timeout is even reachable for a long chat. If the gateway cuts at 29s, truncated streams are not an edge case — they are the normal outcome of any chat exceeding 29 seconds, and this invariant becomes the hot path. Verify against current AWS docs before implementation; it changes nothing architecturally either way, but it changes how much the invariant above is exercised.

### I-4 — Lambda timeout and client disconnect desync the counters in a class the accepted-leak decision does not cover.

The user accepted "a Lambda crash mid-flight may leave one reservation un-refunded." That covers exactly one leak class. There is a second, more frequent one that the acceptance statement does not reach, and the two should not be conflated:

- **Class A (accepted, pre-commit).** Crash between reserve and the commit event: `charged = 1`, no output, no refund. One unit lost. Bounded, rare, accepted.
- **Class B (not discussed, post-commit).** Timeout, crash, or client disconnect **after** the commit event: `charged` is correct (the call happened), but the finalization write never runs — so `completed` is never incremented and the token aggregates for that invocation are lost forever. `reserved − completed − refunded` grows an unexplainable residual, and the token aggregates — the only per-user signal for actual Bedrock spend (AD-11 forbids anything richer) — systematically undercount, biased toward exactly the long, expensive streams. AD-5 forbids a reconciler, so nothing ever recovers these.

Two mechanics make Class B the default rather than the exception:

1. **A Lambda timeout is not catchable.** The runtime is stopped; there is no in-process event. Any finalization written as post-loop code simply does not execute.
2. **A client disconnect throws on the response-stream write, not on the Bedrock read.** Finalization placed after a `for await` pump is skipped when the pump throws on a broken pipe. AD-5 correctly says a disconnect stays charged — but "stays charged" and "counters finalized" are different outcomes, and only the first is stated.

**Minimal invariant** — no reconciler, one timer and one code-placement rule:

> The Lambda sets a soft deadline from `context.getRemainingTimeInMillis()` (timeout minus ~5s). On soft deadline, on mid-stream Bedrock failure, on client disconnect, and on normal `messageStop`, the same finalization path runs: abort the Bedrock stream, attempt the terminal frame (best-effort; may fail if the client is gone), and write the idempotent finalization update (`ADD completed :one`, token aggregates, terminal `status`). Finalization is placed so it executes on every post-commit exit path, including a failed response-stream write. A client disconnect observed **before** the commit event is a pre-output failure and refunds normally.

Aborting the Bedrock stream on disconnect also stops paying for output tokens the user will never see — the one place request quota and token billing legitimately meet, and the reason this is important rather than cosmetic.

### I-5 — Fallback is scoped per Bedrock call, but a tool follow-up makes a logical turn span two calls.

AD-5 is right that a tool-calling chat turn consumes two units. The gap is downstream: each call is a separate HTTP request with its own reservation, so the second call can independently hit `429 quota_exhausted` or `503` **pre-output** — which per AD-9 makes fallback legal. The result is one logical chat turn answered half by hosted Claude and half by a different provider, with the tool result interpreted by a model that never saw the same system prompt or tool contract. That is the same duplicate/incoherent-downstream-action hazard AD-7 was written to prevent, displaced one level up: AD-7 guards the *call*, and nothing guards the *turn*.

**Minimal invariant.**

> Provider selection is pinned for the duration of a logical turn. Once a turn has committed hosted output, its subsequent Bedrock calls either continue hosted or the turn fails in-band; a pre-output failure on a follow-up call within a committed turn does **not** trigger provider fallback.

**Accepted consequence to name, not fix.** A user with one unit remaining who starts a tool-requiring turn spends it on call 1 and then cannot complete the turn. Reserving 2 units for tool-capable turns would fix it and is not worth the complexity — state it as accepted so nobody builds speculative multi-unit reservation.

### I-6 — Throttling 429 and quota 429 are indistinguishable to the desktop, and one of them poisons the status cache.

AD-4 sets reserved concurrency 10 for the whole service. Lambda throttling and API Gateway throttling both surface as **HTTP 429 with no typed body** — the same status the desktop uses to conclude "quota exhausted", invalidate `HostedAiState`, and (once a badge exists, per Deferred) tell the user they are out of quota. A ten-concurrent-stream ceiling is reachable by a handful of simultaneous users, so this is not theoretical.

**Minimal invariant.** Quota exhaustion is identified by the typed body code `quota_exhausted`, never by the 429 status alone. A 429 without that typed body is treated as `hosted_unavailable` — eligible for fallback, and it must not invalidate or latch any quota state.

---

## Minor

### M-1 — Status-cache precedence rule and period stamping are unstated.

The companion's cache design (5-minute TTL, invalidate on 403/429) only prevents doomed round-trips if the adapter actually **compares** the cached counter to the limit and skips the hosted attempt. That comparison is never stated. Without it, every AI action for the remainder of an exhausted month makes a full API Gateway round-trip to earn a 429 before falling back — real latency and real per-request cost on every chat message. State it: cached `request_count >= monthly_request_limit` for the current period means "no quota", skip hosted, go straight to fallback. This is a third consumer of B-1's gate-counter definition, alongside the condition expression and the status route — which is what makes B-1 load-bearing rather than cosmetic.

Also stamp the cache with its period and treat an entry whose period ≠ current UTC period as absent. Otherwise a cache entry that is <5 minutes old but from the previous month applies last month's exhausted state to a user who now has a full new quota — a month-boundary-only outage lasting up to 5 minutes.

### M-2 — Status read consistency is unspecified.

The invoke path mandates a strongly consistent `GetItem` on `CONFIG`; `GET /v1/ai/status` says nothing. An eventually consistent read immediately after a 429-driven invalidation can return a stale lower count, so the adapter re-enables hosted and earns another 429. Both items are single reads — make status strongly consistent too; the cost is negligible and it removes an entire class of cache thrash.

### M-3 — Per-operation counters and token aggregates have no stated write point, so the sum invariant is undefined.

AD-6 lists "per-operation counters, token aggregates" without saying whether they are written at reserve or at finalization. Either choice is fine; leaving it open means the same implementer can pick differently in `quota.ts` and `invoke.ts` and the aggregates become uninterpretable. Recommend: per-operation counters increment **inside the reserve transaction** (so they sum to gross `reserved`); token aggregates and `completed` are written **once at finalization** (token usage only arrives on the `ConverseStream` `metadata` event, which is terminal — it is not available earlier). Worth affirming what already holds: all of these live on the one `USAGE#` item, so every mutation is a single-item atomic update and no cross-item consistency problem exists.

### M-4 — Two cosmetic drifts worth correcting so they do not read as disagreement.

- The memlog records the usage key as `USAGE#<sub>#<YYYY-MM>`; the spine and companion both use `pk=USER#<sub>`, `sk=USAGE#<YYYY-MM>`. The spine is correct and authoritative; the memlog line is superseded phrasing. No action beyond not propagating it.
- If refund and finalization move to `TransactWriteItems` per B-4, the IAM grant in §Conventions (`GetItem`/`TransactWriteItems`/`UpdateItem`) already covers it — `UpdateItem` may then be droppable. Verify at implementation rather than pre-deciding.

---

## Mandated scenario matrix

| # | Scenario | Current text | Verdict |
|---|---|---|---|
| 1 | Concurrency at the limit boundary | Conditional `ADD` inside `TransactWriteItems` on one item | **Sound.** DynamoDB serializes per-item writes and evaluates the condition against the committed value — N concurrent requests at limit−1 yield exactly one success. Gap is only the unhandled `TransactionConflict` (I-1). |
| 2 | Config edit during reservation | `ConditionCheck` on `CONFIG` version/premium/limit | **Gap** — I-1 (cancellation-reason triage), I-2 (`version` depends on an unenforceable manual step; value recheck is sufficient). |
| 3 | Month rollover | Period computed "in UTC at request time"; no reset job | **Blocking** — B-3 (period re-derived at refund/finalization). Also B-1's `attribute_not_exists` disjunct, without which every first-call-of-month 429s. |
| 4 | Refund underflow | Not addressed | **Blocking** — B-4 (`charged > :zero` guard + transaction idempotency). |
| 5 | Double refund | Not addressed; `client_request_id` explicitly not an idempotency key | **Blocking** — B-4 (SDK retry of a non-idempotent `ADD`; `ClientRequestToken` from a server-generated `reservation_id`). |
| 6 | First-event ambiguity | "first valid Bedrock event" | **Blocking** — B-2 (in-band exception events; "valid" undefined; decides both charge and fallback legality). |
| 7 | Client disconnect | AD-5: stays charged | **Correct on the charge, gap on the counters** — I-4 Class B (finalization skipped when the response-stream write throws; Bedrock stream not aborted). |
| 8 | Lambda timeout / crash | Accepted as a rare leak, no reconciler | **Partially covered** — Class A accepted and genuinely fine; Class B (post-commit counter desync + lost token aggregates) not covered. I-4's soft deadline fixes it without a reconciler. |
| 9 | completed / refunded / operation / token counter consistency | Attributes listed; no relationships, no write points | **Gap** — B-1 (no stated relationship, conflicting names), M-3 (write points undefined). |
| 10 | Status consistency | 200 + zeroed fields when non-premium; 5-min cache; invalidate on 403/429 | **Route semantics correct and well-argued.** Gaps: I-6 (throttle 429 poisons the cache), M-1 (no precedence comparison, no period stamp), M-2 (read consistency unspecified). |
| 11 | Duplicate requests | `client_request_id` tracing-only; one 401 refresh+retry per call | **Sound at the request level** — the 401 retry is pre-Lambda (authorizer) and consumes no quota; fallback targets a different provider rather than retrying hosted; two user actions legitimately cost two units. Duplicate-charge risk is entirely at the SDK layer (B-4). One case worth naming: a TCP reset after reserve but before headers is indistinguishable from "never reserved", so the desktop falls back per AD-7 and the user is charged one unit *and* served by BYO — a small, acceptable overcharge that should be stated rather than discovered. |
| 12 | Tool follow-up charging | AD-5: two units per tool turn | **Charging model correct.** Gap is fallback scope — I-5 (a turn can split across providers mid-turn). |
| 13 | Framing / pre-output vs. in-band boundary | AD-7 | **Well-designed; two holes** — B-2 corollary (nothing written to the stream before commit, or status is lost), I-3 (no terminal-frame guarantee, no truncated-stream rule). |

---

## Consolidated invariant patch (drop-in)

Applying these resolves all 4 blocking and all 6 important findings without adding a component, a reconciler, or a change to the adopted reserve/refund semantics.

**AD-5 amendments**

1. `USAGE#<YYYY-MM>` carries one gate attribute `charged` — the only attribute a quota `ConditionExpression` reads. `reserved`, `completed`, `refunded` and the per-operation/token aggregates are monotonic observability counters on the same item. `charged = reserved − refunded` by construction; `reserved − completed − refunded ≥ 0` is the abandoned residual.
2. Reserve: `ADD charged :one, reserved :one` under `attribute_not_exists(charged) OR charged < :limit`. Refund: `ADD charged :negOne, refunded :one` under `charged > :zero`.
3. The UTC period key is computed once per request and carried through reservation, refund, and finalization. No quota mutation re-derives the period from the clock.
4. Reserve, refund, and finalization are each a `TransactWriteItems` with `ClientRequestToken` derived from a server-generated `reservation_id`, never from client input.
5. The **commit event** is the first `ConverseStream` `messageStart`. An in-band exception event before it is a pre-output failure (refund, mapped HTTP status, fallback legal). After it, no refund and no fallback.
6. Finalization (`ADD completed :one`, token aggregates, terminal `status`) runs on every post-commit exit path — normal `messageStop`, mid-stream failure, client disconnect, and soft deadline (`getRemainingTimeInMillis()` minus ~5s) — and aborts the Bedrock stream first.

**AD-6 amendments**

7. The reserve `ConditionCheck` asserts `premium` and `monthly_request_limit` **by value** against the values just read; `version` is informational and part of no condition.
8. Reserve failures are classified from `TransactionCanceledException.CancellationReasons[]` per item: `CONFIG`/`ConditionalCheckFailed` → re-read and retry once, then `403`; `USAGE#`/`ConditionalCheckFailed` → `429 quota_exhausted`; `TransactionConflict` → bounded jittered retry; throttling → `503`.
9. `GET /v1/ai/status` reads strongly consistently and its `request_count` field is `charged`.
10. A limit lowered below current `charged` hard-stops the user for the remainder of the period with no retroactive refund and no clamping; a limit raised mid-period takes effect on the next reservation. Both are expected.

**AD-7 amendments**

11. Nothing is written to the response stream before the commit event, so pre-output failures retain a real HTTP status and typed code.
12. Exactly one terminal frame (`end` or `error`) per committed stream. EOF after `meta` without a terminal frame is treated by the desktop as a terminal in-band failure — never a fallback, never a retry.

**AD-9 amendments**

13. Quota exhaustion is identified by the typed body code `quota_exhausted`, never by HTTP 429 alone; an untyped 429 (Lambda/gateway throttle) is `hosted_unavailable` and must not invalidate or latch quota state.
14. The adapter skips the hosted attempt when cached `request_count >= monthly_request_limit` for the current period. `HostedAiState` entries are period-stamped and treated as absent when the period differs.
15. Provider selection is pinned per logical turn: once a turn has committed hosted output, a pre-output failure on a follow-up Bedrock call within that turn does not trigger provider fallback.

**Deferred, unchanged**

The accepted pre-commit crash leak (Class A) stays accepted and still needs no reconciler. Item 6 above removes the *post-commit* desync (Class B) with a timer rather than a reconciliation pass, so the existing Deferred entry — "Usage reconciliation for leaked reservations from Lambda crashes" — remains correctly deferred and now covers a genuinely rare case.
