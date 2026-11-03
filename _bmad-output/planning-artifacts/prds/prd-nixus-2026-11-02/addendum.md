# Addendum — AI-Generated Home Dashboard

Technical-how, prior art, and rejected-alternative rationale that belongs here rather than in `prd.md`. For downstream architecture work, not for the PRD's own narrative.

## Prior art this design borrows from

- **A2UI (a2ui.org, Google, Apache 2.0)** — a JSON-based, streaming, declarative UI protocol for agent-to-client rendering. Core idea: the agent emits a component tree (by name, from a catalog) plus a separate data model, and the client renders using its own trusted components. Four message types in the full protocol: `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`. Nixus does **not** need the full streaming/multi-surface/transport-negotiation machinery (single-user desktop app, one surface per profile) — it borrows the *separation of structure from data* and the *closed catalog* idea, not the wire protocol.
- **CopilotKit's custom-catalog pattern** (`@copilotkit/a2ui-renderer`, blog: "Build Generative UI Apps with A2UI & CopilotKit Agents") — demonstrates defining a custom catalog as `{ ComponentName: { description, props: zodSchema } }`, mapping each to a real React component, and passing the catalog to the agent's prompt so the `description` field guides when the model reaches for that component. The Zod/schema validates the props the model returns. This is the direct model for Nixus's Component Catalog (§4.1) and Data Source Whitelist (§4.2). **Correction from the first draft:** "any custom component your frontend already renders" does *not* mean Nixus's existing recharts-backed charts are already catalog-shaped. Verified against the codebase: only `packages/shared/src/ui/table.tsx` (Table) and the `Stat`/`SubStat` primitives in `packages/shared/src/ui/stat.tsx` (Metric) are genuinely reusable as-is. `NetWorthTrendChart`, `SpendingTrendChart`, and `ProjectionChart` are three bespoke, single-domain components — LineChart/BarChart/AreaChart need to be extracted as series-agnostic primitives from them, not registered. `PieChart` exists nowhere in the codebase and must be built new. See prd.md §4.1's "Build-cost honesty" block.
- **Self-healing / graceful failure** — CopilotKit's blog explicitly calls out "invalid generations are caught and the specific errors go back for a correction... when retries are exhausted, the surface resolves to a short message and the conversation continues instead of dying in an error state." FR-5's Self-Healing Retry directly mirrors this.

## Options considered

### Full A2UI protocol adoption vs. custom subset (chosen: custom subset)

- **Full protocol**: adopt `createSurface`/`updateComponents`/`updateDataModel`/`deleteSurface` wire messages, multiple surfaces, streaming incremental rendering, bi-directional `actionResponse` for interactive components.
- **Custom subset (chosen)**: one surface per profile, one-shot generation (not streamed component-by-component), no bi-directional interactivity in v1. Rationale: Nixus is a single-user local desktop app, not a multi-surface agent platform; the chat/tool-call loop already exists and is synchronous-per-turn, so the generation flow should ride on it rather than build a second streaming transport. Bi-directional interactivity (date pickers, filters inside a Widget) is a real A2UI capability but adds a second return channel the existing architecture has no analog for — explicitly deferred (PRD §5 Non-Goals).

### AI sees real data vs. AI sees only schema/metadata (chosen: schema/metadata only)

- Considered giving the AI the resolved data (e.g. "net worth was $42,100 in January...") so it could make smarter layout choices (e.g. pick a log scale, or decide a metric is "trending down" and color it accordingly).
- Rejected for v1: this would mean the user's actual financial figures leave the device as part of every dashboard-generation request, which conflicts with Nixus's existing documented stance that AI features only transmit "the content of that one request" and nothing else. Trend coloring, scale choices, etc. are rendering decisions the client can make locally once it resolves the Data Binding — they don't require giving the model the numbers.

### Which existing pipeline to extend (chosen: the confirm-then-persist action pipeline, not the read-only tool-call pipeline)

**Correction from the first draft:** these are two separate mechanisms in two separate files, and the first draft of this addendum conflated them. They are, correctly:

- **Read-only query pipeline** — `apps/desktop/src-tauri/src/ai/chat.rs`. `parse_tool_call` reads a fenced ` ```tool_call ``` ` block out of the model's response, used for queries like `query_expenses` / `query_maintenance_status`. There is no `ACTION_TYPES` anywhere in this file, and nothing here persists a mutation.
- **Confirm-then-persist write-action pipeline** — spans three files. `apps/desktop/src-tauri/src/commands/chat.rs` defines `ACTION_TYPES` (a closed 6-entry array, e.g. `create_expense`, `create_budget_category`, `batch_actions`, `update_balance`, `create_account`, `update_asset_value`) and enforces it server-side before executing a confirmed action. `apps/desktop/src/components/chat/ChatMessageBubble.tsx` parses a *different* fence — ` ```action ``` ` — client-side, to render the confirmation card. `apps/desktop/src/lib/chatActions.ts` mirrors the type set as `CHAT_ACTION_TYPES` and owns query-key invalidation per action type.

**Decision:** the Home Surface generation flow extends the second pipeline (confirm-then-persist), not the first. A Widget add/modify/remove is a persisted mutation, the same shape as `create_expense`, not a read-only lookup — so it gets its own new `action_type` (e.g. `propose_home_surface_change`) added to the closed `ACTION_TYPES` set in `commands/chat.rs`, parsed from the existing ` ```action ``` ` fence, and mirrored into `CHAT_ACTION_TYPES` in `chatActions.ts` with its own query-key invalidation (a `home-surface` key). This is also why prd.md's FR-4 now describes a confirmation card before persistence, rather than an immediate, silent write — that confirmation step is a property of the pipeline being extended, not a separate UX decision layered on top. FR-7's graceful-degradation behavior is inherited from this same pipeline's existing hosted/BYO error handling, with one explicit carve-out: see "Premium-only, hosted-only" below.

### Premium-only, hosted-only (by explicit product decision, not a technical default)

Home is gated to Nixus Cloud premium accounts and does not fall back to BYO at all (prd.md §4.6 FR-11). This is a real deviation from how the port normally behaves for the other three generic AI surfaces: `backend.rs`'s `fallback_for("premium_required")` currently returns `FallbackDecision::FallBackToByo` — i.e. today, a non-premium user hitting chat, project advice, or trends insight automatically falls back to their own configured provider. Home must **not** do that.

The precedent for a surface that intentionally skips the generic fallback lookup already exists: statement import is hardcoded Bedrock-only in `ai/backend.rs` precisely because "OpenAI is never a valid fallback there" for that surface (per `docs/project-context.md`). Home's generation call needs the same shape of special-case — check premium/quota eligibility first (reusing the existing `HostedAiStatus`/`is_eligible` logic in `ai/hosted_state.rs`, which already combines `premium && remaining quota > 0`), and on a `premium_required` (or exhausted-quota) outcome, return the locked/upsell state defined in FR-11 instead of calling `fallback_for` and dropping through to BYO. Concretely: Home's command handler should branch on eligibility *before* reaching the point in `ai/backend.rs` where other surfaces consult `fallback_for`, not add a new case inside `fallback_for` itself (which would change behavior for every surface that shares it).

## Sketch: what a generated Widget description might look like (illustrative, not a committed schema)

```json
{
  "id": "net_worth_trend",
  "component": "LineChart",
  "title": "Net Worth, Last 6 Months",
  "dataBinding": {
    "source": "net_worth_history",
    "params": { "months": 6 }
  }
}
```

Note what's absent: no dollar figures, no dates with actual balances — those are resolved locally against `source: "net_worth_history"` at render time. The AI only ever produces the shape above; Surface Validation checks `component` is in the Component Catalog, `dataBinding.source` is in the Data Source Whitelist, and `params` match that source's accepted shape.

## Open mechanism question for architecture phase

Where Surface Validation should run (client TS vs. Rust/Tauri command layer) is an architecture decision, not a PRD one — but given Nixus's existing pattern of keeping DB/query logic in `db/` (Rust) and the desire to never let a malformed AI response even reach a TanStack Query cache, validating in Rust before the command returns to the frontend is the leading candidate.

## Keep the catalog out of the general chat system prompt (pattern from the CopilotKit/A2UI blog, not yet reflected elsewhere in this PRD)

The blog post names a specific benefit of routing Generative UI through a dedicated flow rather than the main agent: *"Generation in a dedicated sub-agent: the catalog and protocol rules stay out of your main agent's context window, and the surface streams to the client as the sub-agent produces it."*

This matters for Nixus concretely. `ai/chat.rs`'s existing system prompt already carries the `tool_call` schema, the maintenance-tool documentation, and multiple paragraphs of usage instructions (see `ai/chat.rs` lines ~43-79) — and that prompt is sent on *every* chat turn, regardless of what the user is asking about. The Component Catalog (6 entries) and Data Source Whitelist (7 entries) together are comparably sized to what's already there. Injecting both into the same always-on system prompt would grow it further for every ordinary chat message that has nothing to do with Home — worse latency and token cost on the hosted-AI per-invocation quota (project-context.md's cost model) for zero benefit on turns that never touch the Dashboard Composer.

**Recommendation for architecture:** the Home Surface generation turn (the new `action_type`'s proposal step, §4.3) should assemble its own, separate prompt containing the Catalog/Whitelist schemas — scoped to that one generation call — rather than appending them to the shared system prompt used by ordinary chat, maintenance queries, and the existing action types. This is consistent with the existing closed-set, per-surface pattern Nixus already uses (`project_advice.rs` and `trends_insight.rs` are each their own prompt-construction path, not additions to the general chat prompt) — the Home Surface flow should be the fourth such dedicated path, not a fifth paragraph bolted onto the first one.
