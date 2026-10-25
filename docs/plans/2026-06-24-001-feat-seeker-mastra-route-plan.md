---
title: "feat: Expose Seeker agent via internal /forge-seeker Mastra SSE service route"
date: "2026-06-24"
type: feat
status: planned
origin: docs/brainstorms/2026-06-24-expose-seeker-agent-mastra-route-requirements.md
roadmap: docs/roadmap/ai-chat/feat-204-expose-seeker-mastra-service-route.md
depth: standard
---

# feat: Expose Seeker agent via internal `/forge-seeker` Mastra SSE service route

## Summary

Add a single new bearer-gated SSE service route, `POST /forge-seeker`, to
`apps/mastra` that streams the existing `seekerAgent` for **internal,
server-to-server dogfooding**. The route mirrors the existing
`/forge-experience-chat` streaming handler but adds two things that template
does not have: per-session memory keying (`threadId` / optional `resourceId`
threaded into `agent.stream(...)`) and extraction of the `retrieveAnswer`
tool's `sources[]` for the terminal `result` frame. It stays behind the
documented production gates — no guardrails, no Postgres-persisted memory, no
public exposure, no CORS — and is **more** locked down than the built-in
unauthenticated `/api/agents/*` surface that already reaches the agent.

Scope is **`apps/mastra` only**. All chat-app wiring is feat-205.

---

## Problem Frame

`seekerAgent` (feat-198/feat-199) runs in Mastra Studio and is deliberately
kept off every custom `/forge-*` route — `seeker-route-isolation.test.ts`
enforces that. No consuming app can exercise Seeker over a stable, bearer-gated
contract: the only thing exposing it today is Mastra's built-in,
code-unauthenticated `/api/agents/*` surface, which is not a contract a consumer
should build against. This work adds a guarded `/forge-seeker` route so the chat
app (first consumer, feat-205) can dogfood Seeker end-to-end without crossing
the production release gates (see origin:
`docs/brainstorms/2026-06-24-expose-seeker-agent-mastra-route-requirements.md`).

**Key technical risk — probed against the installed `@mastra/core@1.36.0`**;
both facets resolve, with one correction surfaced in doc review (memory requires
a `resourceId`, see facet 1). This is why no stateless fallback is planned:

1. **Memory keying works, but `resourceId` is required at runtime.** Pass
   `agent.stream(prompt, { memory: { thread, resource } })`. The `.d.ts` type
   `AgentMemoryOption` (`dist/agent/types.d.ts`) marks `resource?` optional —
   but the **compiled runtime guards it as required whenever a memory instance
   is attached** (the seeker agent has one). The agent memory-prep block runs
   when `memory && (threadId || resourceId)`; inside it,
   `if (!threadId || !resourceId) throw AGENT_MEMORY_MISSING_RESOURCE_ID`
   (`chunk-AM3IOVFX.js` ~L24682, modern-stream twin ~L26979) fires BEFORE any
   thread work. Only AFTER that guard passes does it run get-or-create
   (`getThreadById` → `createThread` if absent, `chunk-AM3IOVFX.js` ~L24700 /
   ~L26996), so a fresh-thread first turn **auto-creates** rather than throwing
   the "No thread found" error that direct `memory.recall()` raises (see
   `memory.test.ts`). Consequence: the route must always supply a `resourceId`
   even when the caller omits one (KTD3 — constant default). With that, AE3 /
   AE3c are in scope, not waived. **Because this contract lives in the runtime,
   not the type, typecheck cannot catch a regression** — a real-agent smoke test
   is required (U1).
2. **`sources[]` extraction works.** `MastraModelOutput` exposes
   `get toolResults(): Promise<ToolResultChunk[]>`
   (`dist/stream/base/output.d.ts`), a delayed promise resolved at stream finish.
   Each `ToolResultChunk.payload` is `{ toolName, result, ... }`
   (`dist/stream/types.d.ts`). After draining `output.textStream`,
   `await output.toolResults`, filter `toolName === "retrieveAnswer"`, and read
   `result.sources` (the tool's `{ status, sources, message? }` output shape).

---

## Requirements Traceability

All requirements are from the origin brainstorm (R1–R13) and its acceptance
examples (AE1–AE6). Coverage:

| Req                                                                            | Where covered |
| ------------------------------------------------------------------------------ | ------------- |
| R1 (route registered in `apiRoutes`)                                           | U2            |
| R2 (body: `prompt`+`threadId` required, `resourceId` optional to callers; 400) | U1            |
| R3 (SSE `token_delta` + terminal `result{text,sources}`; `error` frames)       | U1            |
| R4 (agent lookup by id, not import)                                            | U1            |
| R5 (service-bearer auth; 401)                                                  | U1            |
| R6 (no CORS)                                                                   | U1, U2        |
| R7 (thread/resource threaded into `agent.stream`; first-turn create)           | U1            |
| R8 (`resourceId` opaque; `threadId` drives isolation)                          | U1            |
| R9 (abort/time budget + step cap)                                              | U1            |
| R10 (inbound abort signal honored)                                             | U1, U2        |
| R11 (model-key preflight via `getOpenRouterApiKey()`; 503)                     | U1            |
| R12 (sanitized `error` reasons + `sources[]` allowlist projection)             | U1            |
| R13 (isolation guard re-pinned)                                                | U3            |

Acceptance examples → covering test (all in `seeker-route.test.ts` unless noted):

| AE                                                   | Covering test                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| AE1 (no bearer → 401, agent not invoked)             | U1                                                               |
| AE2 (missing `threadId` → 400)                       | U1                                                               |
| AE3 (distinct `threadId`s → no cross-session bleed)  | U1 (distinct-thread fake-agent)                                  |
| AE3b (no `resourceId` → accepted, agent invoked)     | U1 (asserts route supplies the constant default; does NOT throw) |
| AE3c (same `threadId` → turn-2 recalls turn-1)       | U1 real-agent smoke (route→stream→memory recall)                 |
| AE4 (`token_delta`… then one `result{text,sources}`) | U1                                                               |
| AE5 (caller abort cancels generation)                | U1                                                               |
| AE6 (no OpenRouter key → 503 before stream)          | U1                                                               |

Beyond-origin item pulled into v1 by review decision: a default-off
`SEEKER_ROUTE_ENABLED` gate (the origin listed this under "Deferred for later";
it is now in scope as defense-in-depth — see KTD7 and Scope Boundaries).

---

## Key Technical Decisions

**KTD1 — Separate handler module, agent looked up by string id.**
Create `apps/mastra/src/mastra/agents/seeker-route.ts` mirroring
`experience-chat-route.ts`. The handler resolves the agent via
`getMastra().getAgentById("seekerAgent")` (R4), with the id held in a
module-local `SEEKER_AGENT_ID` constant — exactly as the chat route holds
`CHAT_AGENT_ID = "experience-default-chat"`. Consequence: **`index.ts` keeps
exactly 2 textual `seekerAgent` occurrences** (the import + the agents-map
registration), NOT 3. The origin ticket loosely predicted 2→3; mirroring the
established separate-handler/lookup-by-string pattern is cleaner and a _stronger_
guard (the route provably does not import the agent). The isolation test is
re-pinned accordingly (U3, KTD5) — this is the deliberate, reviewed deviation
R13 calls for, not an unplanned drift.

**KTD2 — Reuse existing budgets; no new constants.**
Use `TIME_BUDGET_MS.chatTurn` (90s) + `STEP_CAPS.toolCallingTurn` (8), identical
to the chat route. A seeker turn (one RAG tool round-trip + synthesis) is
budget-equivalent to a chat turn, and 90s sits under the ~100s Cloudflare 524
ceiling. Because the budget is reused, the existing `error`-frame reason split
(`timeout` when the budget signal aborted, else `generation_failed`) travels
unchanged — no new reason classification needed (resolves the origin's open
budget question).

**KTD3 — Memory option threaded per request; `resourceId` always supplied.**
Pass `memory: { thread: threadId, resource: resourceId ?? SEEKER_DEFAULT_RESOURCE_ID }`
to `agent.stream(...)`. `thread` is always set (required). **`resource` is
ALWAYS set** — to the caller's `resourceId` when present, else to a module-local
constant `SEEKER_DEFAULT_RESOURCE_ID` (e.g. `"seeker-dogfood"`). This is forced
by the runtime guard documented in Problem Frame risk #1: a memory-configured
agent throws `AGENT_MEMORY_MISSING_RESOURCE_ID` if `threadId` is given without a
`resourceId`. The constant default keeps `resourceId` **optional to callers**
(preserving origin R8) while satisfying the runtime contract. `resourceId`
remains opaque — never branched on (R8). Isolation still rides on `threadId`,
which is verified-safe: `memory.test.ts` already proves two threads under the
**same** `resourceId` do not bleed, which is exactly the constant-default shape.
When real auth lands (feat-205+), the consumer passes the authenticated user id
as `resourceId` with no route change. No explicit `saveThread`/`recall` call in
the route — the agent stream path get-or-creates the thread after the resourceId
guard passes (Problem Frame risk #1).

**KTD4 — `sources[]` is an allowlist projection, not a passthrough; plus a
`grounded` flag.**
Build each emitted source field-by-field — `{ sourceName, title, url, score,
snippet }` where `snippet` is the tool's already-capped `text` — rather than
spreading the tool result. R12: a future addition to the tool's source shape
cannot silently widen the wire. The tool output is already `.strict()`
`{ text, sourceName, title, url, score }` with internal fields excluded at the
tool boundary, so this mainly guarantees the route does not re-widen it.
Additionally emit `grounded: boolean` on the `result` frame — `true` only when a
`retrieveAnswer` tool result with `status === "ok"` was seen. This lets a
dogfooder distinguish "retrieval ran and grounded the answer" from "model
answered without calling the tool" or "retrieval returned empty/unavailable" —
all three otherwise collapse to `sources: []` and defeat R3's grounding-
visibility goal (the agent's "always call" instruction is a soft LLM nudge, not
a guarantee).

**KTD5 — Isolation test flips from absence to pinned-exposure.**
The current test asserts "no custom route wires seeker." That intent is now
false. Re-pin (U3) to assert: (a) seeker still registered in the agents map
(positive anti-vacuous check, kept); (b) `/forge-seeker` is registered exactly
once in the `apiRoutes` region and wired to the seeker handler import; (c) no
OTHER `/forge-*` route references the seeker; (d) the whole-source
`seekerAgent` occurrence count stays exactly 2 (now meaning "the route did not
smuggle in an agent import"). Do not delete the guard.

**KTD6 — Plain-string `event=` logging, ENUM values only (no log injection).**
Server-side logs use the `[seeker-route] event=<name> reason=<enum>`
plain-string format — never `JSON.stringify` (Railway logsV2 silences it, see
`docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`),
matching the existing `[seeker] event=rag_retrieval_unavailable` convention in
`retrieve-answer.ts`. **Critically, only fixed-vocabulary enum values go into the
`key=value` fields.** Raw, attacker/RAG-influenceable text (exception messages,
upstream provider error bodies, RAG host) must NOT be interpolated as additional
`key=value` pairs — that text can carry newlines and `key=value` fragments and
forge/split log lines (the exact log-injection vector `retrieve-answer.ts`'s
`logRetrievalUnavailable` already defends against by logging enums only). If raw
detail must be captured at all, strip newlines/control characters and append it
LAST as a single free-form `detail=<sanitized>` token (or a separate non-
`key=value` line), never as structured pairs. Nothing raw reaches the client
(R12).

**KTD7 — Default-off `SEEKER_ROUTE_ENABLED` gate (defense-in-depth).**
Add an optional env var `SEEKER_ROUTE_ENABLED` (Zod `.optional()`, default
**off** — unset means disabled). The route's FIRST precondition: if the flag is
not truthy, return `404` and do no further work (no bearer check, no agent
lookup, no stream). This is the belt-and-suspenders the origin listed under
"Deferred for later" but which review pulled into v1: it fails the
**`/forge-seeker` surface** closed by default, so the route is unreachable unless
an operator explicitly enables it. (It does NOT close the already-open built-in
`/api/agents/*` surface — that needs separate global-auth work and is out of
scope; the private-network boundary remains the load-bearing control for that
path.) Resolve via a small accessor `isSeekerRouteEnabled()` in `config/env.ts`
so the gate is testable without env mutation. **Use the repo's string-boolean
convention `env.SEEKER_ROUTE_ENABLED === "true"`** (matching `AI_GATEWAY_CHAT_ENABLED`
at `config/env.ts:147` and its consumers) — NOT JS truthiness, which would treat
`SEEKER_ROUTE_ENABLED="false"` as enabled and invert the safety default.
**No new required-at-boot env var** — it stays optional, honoring the constraint;
the deviation from the origin (flag was deferred) is deliberate and recorded here
and in Scope Boundaries.

---

## High-Level Technical Design

Request lifecycle for `POST /forge-seeker` (mirrors chat route; new legs marked ★):

```mermaid
flowchart TD
    A[POST /forge-seeker + Bearer] --> Z{SEEKER_ROUTE_ENABLED? ★KTD7}
    Z -- no/unset --> Z1[404 JSON]
    Z -- yes --> B{isValidServiceBearer?}
    B -- no --> B1[401 JSON]
    B -- yes --> C{body has prompt AND threadId?}
    C -- no --> C1[400 JSON]
    C -- yes --> D{getOpenRouterApiKey resolves? ★R11}
    D -- no --> D1[503 JSON reason=model_key_missing]
    D -- yes --> E[open SSE ReadableStream]
    E --> F["agent.stream(prompt, { maxSteps, abortSignal,\n memory:{ thread: threadId,\n resource: resourceId ?? DEFAULT } }) ★R7/KTD3"]
    F --> G[drain output.textStream\n → token_delta frames]
    G --> H[await output.toolResults ★R3\n find retrieveAnswer → sources]
    H --> I[result frame {text, sources projected, grounded ★KTD4}]
    F -. throws/timeout .-> J[error frame {reason enum}]
    K[inbound abort / disconnect] -. cancel .-> F
```

Abort composition (unchanged from chat route): an internal
`AbortSignal.timeout(TIME_BUDGET_MS.chatTurn)` is `AbortSignal.any`-composed
with the inbound `requestSignal`; `reader.cancel()` on stream `cancel()` stops
the run on client disconnect (R10).

---

## Implementation Units

### U1. Seeker SSE route handler module

**Goal:** A pure, testable handler `handleSeekerRouteRequest(...)` that performs
enable-gate → auth → body validation → model-key preflight → memory-keyed
streaming → sanitized terminal frames. Also adds the
`SEEKER_ROUTE_ENABLED` env var + `isSeekerRouteEnabled()` accessor and the
`SEEKER_DEFAULT_RESOURCE_ID` constant.

**Requirements:** R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12 (+ KTD3, KTD4
`grounded`, KTD6, KTD7).

**Dependencies:** none (uses existing `service-bearer`, `budgets`, `env`,
`retrieve-answer` types).

**Files:**

- `apps/mastra/src/mastra/agents/seeker-route.ts` (create)
- `apps/mastra/src/mastra/agents/seeker-route.test.ts` (create)
- `apps/mastra/src/config/env.ts` (modify — add `SEEKER_ROUTE_ENABLED`
  `.optional()` to the schema + the `emptyToUndefined(process.env...)` mapping,
  and an `isSeekerRouteEnabled()` accessor next to `getOpenRouterApiKey`)
- `apps/mastra/CLAUDE.md` (modify — document `SEEKER_ROUTE_ENABLED` in the env
  table + a short "Seeker service route" note)

**Approach:**

- Copy the structural skeleton of `experience-chat-route.ts`:
  `sseFrame`, `jsonResponse`, the `ReadableStream` start/cancel shape, the
  `AbortSignal.any([requestSignal, budgetSignal])` composition, the
  `budgetSignal.aborted ? "timeout" : "generation_failed"` reason split.
- Module constants: `SEEKER_AGENT_ID = "seekerAgent"` (KTD1) and
  `SEEKER_DEFAULT_RESOURCE_ID = "seeker-dogfood"` (KTD3).
- **Enable gate FIRST (KTD7):** `if (!isSeekerRouteEnabled()) return
jsonResponse(404, { error: "Not found" })` — before bearer, body, agent. Inject
  via a `getEnabled?: () => boolean` seam defaulting to `isSeekerRouteEnabled` so
  tests drive it without env mutation.
- **Auth (R5):** validate `authHeader` against `serviceKeys` via
  `isValidServiceBearer`; invalid/missing → `jsonResponse(401)` before any agent
  work or body read.
- Body guard `isSeekerBody(value)`: object with non-empty string `prompt` AND
  non-empty string `threadId` (the template's `isPromptBody` only checks
  `prompt` — add the symmetric `threadId.length > 0` check); `resourceId`
  accepted only when it is a non-empty string (absent/empty → treated as not
  provided, never rejected). Invalid → `jsonResponse(400)`.
- Preflight (R11): `if (getModelKey() == null) return jsonResponse(503,
{ reason: "model_key_missing" })` — BEFORE opening the stream / invoking the
  agent. `getModelKey` defaults to `getOpenRouterApiKey` (from `../../config/env`).
- Define a narrow structural agent type `SeekerStreamAgent` whose `stream`
  accepts `{ maxSteps?, abortSignal?, memory? }` and returns
  `{ textStream: ReadableStream<string>; toolResults: Promise<ToolResultChunk[]> }`
  (mirrors the chat route's `ChatStreamAgent` narrowing). Type `memory` as
  `{ thread: string; resource: string }` (resource is always set — KTD3) and
  `toolResults`' element loosely as
  `{ payload?: { toolName?: string; result?: unknown } }`, narrowing at use.
- Build memory option (KTD3): `const memory = { thread: threadId, resource:
resourceId ?? SEEKER_DEFAULT_RESOURCE_ID }`; pass into `agent.stream`.
  `resource` is ALWAYS present (the runtime guard requires it — Problem Frame
  risk #1).
- Stream body: drain `output.textStream` → `token_delta { text }` per chunk,
  accumulating `full`. After the read loop, `await output.toolResults`, take the
  LAST chunk with `payload.toolName === "retrieveAnswer"`, read
  `payload.result.sources` (guard shape; default `[]`) and `payload.result.status`.
  Project each source via the KTD4 allowlist into
  `{ sourceName, title, url, score, snippet }`. Set `grounded = (status === "ok")`
  (KTD4). Emit terminal
  `result { text: full, sources, grounded, producedBy: SEEKER_AGENT_ID }`.
- `toolResults` extraction wrapped in its own try/catch so an extraction failure
  (incl. a rejected `toolResults` promise after a successful `textStream` drain)
  degrades to `sources: [], grounded: false` and still emits `result` with text
  — never turns a successful generation into an `error` frame.
- Errors (R12, KTD6): catch → `error { reason }` with `reason` from the budget
  split; log server-side via `[seeker-route] event=stream_error reason=<enum>`
  plain-string, ENUM values only (no raw text interpolated as `key=value`). Do
  NOT put `error.message` on the wire (the chat route includes `message`; the
  seeker route deliberately omits it per R12 — fixed-vocabulary `reason` only).
- Response headers identical to chat route (`text/event-stream`, no CORS — R6).
- Handler input type mirrors `ExperienceChatRouteHandlerInput`:
  `{ authHeader, serviceKeys, readJson, getMastra, requestSignal? }` plus seams
  `getModelKey?: () => string | undefined` (defaults to `getOpenRouterApiKey`)
  and `getEnabled?: () => boolean` (defaults to `isSeekerRouteEnabled`).

**Patterns to follow:** `experience-chat-route.ts` (whole file);
`retrieve-answer.ts` `logRetrievalUnavailable` (ENUM-only plain-string log
shape); the `getOpenRouterApiKey` accessor + `emptyToUndefined` env mapping in
`config/env.ts`.

**Execution note:** Start from a failing test for the 404/401/400/503
precondition ladder (no streaming), then add the streaming/memory/sources
scenarios, then the real-agent smoke last.

**Test scenarios** (`seeker-route.test.ts`):

_Precondition ladder (fake agent injected via `getMastra`):_

- Covers KTD7. `getEnabled` returns false → 404, bearer never checked, agent
  never invoked (spy `getAgentById` not called), no SSE stream opened.
- KTD7 env semantics (in `env.test.ts` or alongside): `SEEKER_ROUTE_ENABLED`
  unset → `isSeekerRouteEnabled()` false; `= "false"` → false; `= "true"` → true
  (guards against JS-truthiness inverting the safety default).
- Covers AE1. Enabled, missing/invalid `Authorization` → 401, agent never
  invoked.
- Covers AE2. Enabled + valid bearer, body missing `threadId` → 400 before agent
  invoked. Body missing `prompt` → 400. Empty-string `prompt` or `threadId` → 400.
- Covers AE6. Enabled + valid bearer + valid body, `getModelKey` returns
  undefined → 503 `{ reason: "model_key_missing" }`, agent never invoked, no SSE
  stream opened (response content-type JSON, not event-stream).

_Memory keying (fake agent — proves the route THREADS the option):_

- Covers AE3b. Valid request, NO `resourceId` → agent invoked; assert `stream`
  received `memory.thread === threadId` AND `memory.resource ===
SEEKER_DEFAULT_RESOURCE_ID` (NOT undefined — the route supplies the default).
- `resourceId` present → `memory.resource === resourceId`; handler never branches
  on its value (R8: two different `resourceId`s → same code path / same frames).
- Covers AE3. Two requests with DIFFERENT `threadId`s → each `stream` call
  receives its own `memory.thread`; with a fake agent backed by a shared keyed
  map, turn on thread B does not see thread A's recorded id (route-level non-bleed).

_Streaming + sources (fake agent):_

- Covers AE4. `textStream` yields two chunks + `toolResults` resolves a
  `retrieveAnswer` chunk (`status: "ok"`, 2 sources) → exactly two `token_delta`
  frames then exactly one `result` frame carrying `text` (joined), `sources`
  (length 2, only allowlisted fields — assert internal fields absent), and
  `grounded: true`.
- `result` projection: a source carrying an extra internal field → that field is
  absent from the emitted source (KTD4).
- `retrieveAnswer` result `status: "empty"` (0 sources) → `result` with
  `sources: []`, `grounded: false`.
- No `retrieveAnswer` tool call in `toolResults` → `result` with `sources: []`,
  `grounded: false`.
- `toolResults` rejects after a successful `textStream` drain → `result` still
  emitted with `sources: []`, `grounded: false` (extraction failure ≠ `error`).
- Covers AE5. `requestSignal` aborts mid-stream → `reader.cancel()` path runs
  (assert the fake reader's `cancel` was called).
- Stream throws after budget abort → `error { reason: "timeout" }`, NO `message`
  field on the wire. Stream throws without budget abort →
  `error { reason: "generation_failed" }`, NO `message` field.

\*Real-memory smoke (a freshly-constructed `Agent` with `memory: getSeekerMemory()`

- a stub language model so no network call — see Problem Frame risk #1 / KTD3):\*

Stub mechanism (pin this — do NOT hand-wave): construct a NEW `Agent` in the test
with the real `getSeekerMemory()` and a minimal stub `MastraLanguageModel` (a
local object satisfying the model interface that yields a fixed `textStream` and
resolves `toolResults`), then route it through `handleSeekerRouteRequest` via the
`getMastra` seam. This exercises the SAME runtime memory-prep guard
(`AGENT_MEMORY_MISSING_RESOURCE_ID` + get-or-create) that the exported
`seekerAgent` would, WITHOUT depending on `@mastra/core` internal model-swap APIs
(`Agent.__updateModel` / `InnerAgentExecutionOptions.model` are `@internal`) or
the exported singleton's hardcoded OpenRouter model. The test is named
"real-memory" rather than "real-seekerAgent" to be honest about what it covers:
the route → `agent.stream({ memory })` → `getSeekerMemory` composition, not the
literal singleton. **Fail-loud guard:** if the stub model cannot be installed (a
future `@mastra/core` shape change), the test must FAIL, never skip — otherwise
the P0 verification silently becomes a no-op.

- Covers AE3b (contract). A request with NO `resourceId` against the
  memory-configured agent does NOT throw `AGENT_MEMORY_MISSING_RESOURCE_ID` — the
  constant default satisfies the runtime guard and the turn streams a `result`.
  (This is the assertion typecheck + fake-agent tests cannot provide — the guard
  is runtime-only.)
- Covers AE3c. Two turns on the SAME `threadId` (real memory): turn-2's assembled
  prompt/context includes turn-1's content — recall actually happened end-to-end
  through `route → agent.stream({ memory }) → getSeekerMemory`.

**Verification:** `pnpm --filter @forge/mastra test seeker-route` green;
`error`/`result` wire payloads contain no internal topology fields; the
real-agent smoke proves the resourceId-default + recall contract.

---

### U2. Register `/forge-seeker` in the Mastra instance

**Goal:** Wire the handler into `apiRoutes` so the route is reachable, following
the exact `registerApiRoute` shape used by `/forge-experience-chat`.

**Requirements:** R1, R6, R10. (R4's lookup-by-id is satisfied in U1; U2 only
passes the `getMastra` thunk the handler resolves the agent through.)

**Dependencies:** U1.

**Files:**

- `apps/mastra/src/mastra/index.ts` (modify — import + one `registerApiRoute`)

**Approach:**

- Add `import { handleSeekerRouteRequest } from "./agents/seeker-route"` next to
  the existing `handleExperienceChatRouteRequest` import (and the route's
  Mastra-shape type if one is exported, e.g. `SeekerRouteMastra`).
- Register inside `apiRoutes` mirroring the chat block:
  `registerApiRoute("/forge-seeker", { method: "POST", handler: async (c) =>
handleSeekerRouteRequest({ authHeader: c.req.header("authorization"),
serviceKeys, readJson: () => c.req.json(), getMastra: () => mastra as
unknown as SeekerRouteMastra, requestSignal: c.req.raw.signal }) })`.
- No CORS config added anywhere (R6). The handler references the agent only by
  string id (KTD1), so this block contains no `seekerAgent` token.

**Patterns to follow:** the `/forge-experience-chat` registration block
(`index.ts` ~L351-361).

**Test scenarios:** `Test expectation: none -- wiring only; behavior is covered
by U1's handler tests and U3's isolation assertions.` (A full Mastra-instance
boot test is out of scope — `index.ts` eagerly constructs the whole runtime, the
documented reason the isolation guard uses source-text inspection.)

**Verification:** `pnpm --filter @forge/mastra typecheck` clean; U3 isolation
test sees the new route.

---

### U3. Re-pin the seeker route-isolation guard (R13)

**Goal:** Update `seeker-route-isolation.test.ts` so it records the new intended
exposure — exactly one `/forge-seeker` route wires the seeker, no others — and
still fails loudly on any unintended new reference.

**Requirements:** R13.

**Dependencies:** U2.

**Files:**

- `apps/mastra/src/mastra/seeker-route-isolation.test.ts` (modify)

**Approach (KTD5):**

- Update the file header to state the new invariant: seeker is now exposed via
  exactly one custom route (`/forge-seeker`); the network/gateway boundary
  remains the real containment.
- Keep the positive registration check (`seekerAgent` in the agents map).
- Keep the "non-empty `apiRoutes` region" anti-vacuous check.
- REPLACE the "does NOT wire seekerAgent into any custom apiRoute" assertion
  with: the `apiRoutes` region contains `"/forge-seeker"` exactly once AND
  contains `handleSeekerRouteRequest`.
- ADD: the region still does NOT contain the literal `seekerAgent` (the route
  looks up by string id in the handler file, so the agent token must not appear
  in `index.ts`'s route region) — this preserves the "no smuggled import" guard
  under the new pattern.
- Keep the whole-source occurrence-count assertion but reword its comment: the
  count remains exactly 2 (import + agents-map registration); a 3rd occurrence
  means someone imported the agent into a route and must re-review isolation.
- Add a regression note that `handleSeekerRouteRequest` is imported exactly once.

**Patterns to follow:** the existing test's `extractApiRoutesRegion`
bracket-matcher and assertion style (do not rewrite the matcher).

**Test scenarios** (the test file IS the spec):

- seeker registered in agents map (kept, positive).
- `apiRoutes` region non-empty and contains `registerApiRoute` (kept).
- `apiRoutes` region contains `/forge-seeker` exactly once.
- `apiRoutes` region contains `handleSeekerRouteRequest`.
- `apiRoutes` region does NOT contain `seekerAgent`.
- whole-source `seekerAgent` occurrence count is exactly 2.

**Verification:** `pnpm --filter @forge/mastra test seeker-route-isolation`
green; deliberately renaming the route locally makes it fail (guard is live).

---

## Scope Boundaries

**In scope:** the `/forge-seeker` route handler (incl. the default-off
`SEEKER_ROUTE_ENABLED` gate), its registration, the isolation-guard re-pin, and
their tests — all in `apps/mastra`.

**Deviation from origin (review decision):** the `SEEKER_ROUTE_ENABLED`
default-off flag, which the origin listed under "Deferred for later", is **pulled
into v1** as defense-in-depth (KTD7). It fails the `/forge-seeker` surface closed
by default. It still does NOT close the built-in `/api/agents/*` path (that needs
separate global-auth work) — so the private-network boundary remains load-bearing
for that surface; the flag is additive insurance for the new route only.

### Deferred for later (origin "Deferred for later")

- Postgres-persisted Seeker memory (stays in-memory; lost on restart).
- Full safety/crisis guardrails (crisis routing, anti-fabrication,
  AI-disclosure) — a hard gate before Seeker reaches anyone outside the
  dogfooding circle.

### Outside this work's identity (origin "Outside this work's identity")

- Browser-direct access and CORS — server-to-server is the deliberate model.
- Any gateway-access / public-exposure decision — owned by the gateway gate.
- All chat-app wiring (feat-205): the consumer mints/scopes `threadId`s
  server-side and must not forward browser-supplied ones (the route treats
  `threadId` opaquely per R8 and cannot prevent enumeration).

### Deferred to Follow-Up Work (plan-local)

- Dedicated per-route bearer or `threadId` namespacing — required before a
  SECOND caller joins `MASTRA_SERVICE_API_KEYS` (origin Dependencies). Not
  needed for the single-trusted-consumer v1.

---

## System-Wide Impact

- **No new required-at-boot env var** (constraint + R11). `OPENROUTER_API_*` AND
  the new `SEEKER_ROUTE_ENABLED` all stay `.optional()`; the route-level
  preflight/gate handles absence. Confirm `assertMastraRuntimeEnv()` gains no
  required var.
- **Route off by default** (KTD7): unless `SEEKER_ROUTE_ENABLED` is truthy,
  `/forge-seeker` returns 404. Dogfooding requires explicitly enabling it in the
  target environment.
- **Shared bearer blast radius:** adds Seeker to the `MASTRA_SERVICE_API_KEYS`
  allowlist radius — accepted for dogfooding behind private networking.
- **Outer boundary unchanged:** relies on `apps/mastra`'s private-only Railway
  networking as the load-bearing control; the bearer is the second layer. The
  built-in `/api/agents/*` surface remains open — this route does not change
  that (and is stricter than it).

---

## Risks & Mitigations

- **Memory contract lives in the runtime, not the type (highest risk).** The
  `resourceId`-required guard is a compiled runtime check; the `.d.ts` marks it
  optional, so typecheck and fake-agent unit tests pass green even if the route
  threads memory wrong. Mitigation: KTD3 always supplies a `resourceId`, and U1's
  **real-memory smoke test** (fresh `Agent` + real `getSeekerMemory` + stub model,
  fail-loud if the stub can't install) is the only test that exercises the actual
  guard + recall — it is required, not optional, and must not silently skip.
- **`agent.stream` memory/toolResults contract drift on a future
  `@mastra/core` bump.** Mitigation: the narrow structural `SeekerStreamAgent`
  type localizes the contract; the real-memory smoke catches runtime-only drift
  (e.g. `result` getting wrapped, which would silently empty `sources[]`) that
  typecheck cannot. The smoke deliberately avoids `@mastra/core` internal
  model-swap APIs (it builds a fresh `Agent` with a stub model rather than
  mutating the exported singleton) so the test harness itself is not coupled to
  internal surfaces.
- **Tool-result extraction throwing and failing an otherwise-good turn.**
  Mitigation: KTD4/U1 degrade extraction failure to `sources: [], grounded: false`
  and still emit `result`.
- **Empty `sources[]` ambiguity** — model may skip `retrieveAnswer` despite the
  "always call" instruction. Mitigation: the `grounded` flag (KTD4) distinguishes
  grounded answers from ungrounded/skipped, preserving R3's dogfooding value.
- **Log injection via RAG/upstream text** (KTD6). Mitigation: ENUM-only
  `key=value` logging; raw detail, if logged, is control-char-stripped and
  appended as a single free-form `detail=` token.
- **Unbounded per-bearer RAG/LLM spend** — only per-request caps (90s, 8 steps)
  exist; no volume/rate limit. Accepted for v1 (private network + single trusted
  consumer); flag this alongside the "second caller" hardening trigger below.
- **`threadId` enumeration by a bearer holder** (R8 accepted limitation).
  Mitigation: documented in Scope Boundaries + the deferred per-route-key path;
  out of scope for single-consumer v1.
- **Unguarded agent reaching a vulnerable user** (safety). The route exposes
  Seeker with no crisis-handling. Mitigation: the default-off `SEEKER_ROUTE_ENABLED`
  gate (KTD7) + private networking + the consuming-app feature flag; the
  Verification block below makes the networking + flag preconditions checkable
  before ship, not just prose.
- **Outbound timeout vs caller budget** (institutional learning): the route's
  90s internal `AbortSignal.timeout` is the ceiling; the consuming app (feat-205)
  must set its own client budget strictly larger so it does not misclassify a
  route timeout as a network error. Noted for feat-205, not enforced here.

---

## Verification

- `pnpm --filter @forge/mastra test` — new `seeker-route.test.ts` (KTD7 gate,
  AE1, AE2, AE3, AE3b, AE3c, AE4, AE5, AE6, incl. the real-memory smoke) and
  updated `seeker-route-isolation.test.ts` (R13) all green.
- `pnpm --filter @forge/mastra typecheck && pnpm --filter @forge/mastra lint`.
- Confirm `assertMastraRuntimeEnv()` gained no new required env var
  (`SEEKER_ROUTE_ENABLED` is `.optional()`).
- **Ship preconditions (safety — must hold before the route is enabled in any
  shared environment):**
  1. `SEEKER_ROUTE_ENABLED` is unset/false everywhere except a deliberately
     enabled dogfooding environment.
  2. The `@forge/mastra` Railway service exposes no public domain (private
     networking is the load-bearing control).
  3. The consuming app's Seeker feature flag (feat-205) defaults OFF.
- Manual sanity (behind real keys + `MASTRA_STORAGE_BACKEND=memory` +
  `SEEKER_ROUTE_ENABLED=true`): POST `/forge-seeker` with a bearer +
  `{prompt, threadId}`, observe `token_delta` frames + a `result` frame with
  cited `sources` and `grounded:true`; repeat on the same `threadId` to see recall;
  POST without `SEEKER_ROUTE_ENABLED` → 404.

---

## Sources & Research

- Origin requirements:
  `docs/brainstorms/2026-06-24-expose-seeker-agent-mastra-route-requirements.md`
- Roadmap ticket:
  `docs/roadmap/ai-chat/feat-204-expose-seeker-mastra-service-route.md`
- Template handler: `apps/mastra/src/mastra/agents/experience-chat-route.ts`
- Registration pattern + `serviceKeys`: `apps/mastra/src/mastra/index.ts`
- Agent + tool: `apps/mastra/src/mastra/agents/seeker-agent.ts`,
  `apps/mastra/src/mastra/tools/retrieve-answer.ts`
- Memory contract: `apps/mastra/src/mastra/memory.ts`,
  `apps/mastra/src/mastra/memory.test.ts`
- Budgets: `apps/mastra/src/mastra/budgets.ts`
- Bearer check: `apps/mastra/src/server/service-bearer.ts`
- Model-key accessor + env mapping: `apps/mastra/src/config/env.ts`
  (`getOpenRouterApiKey`, `emptyToUndefined`) — also where `SEEKER_ROUTE_ENABLED`
  - `isSeekerRouteEnabled()` are added (U1)
- `@mastra/core@1.36.0` API contract verified in
  `node_modules/.pnpm/@mastra+core@1.36.0_*/node_modules/@mastra/core`:
  `dist/agent/types.d.ts` (`AgentMemoryOption` — note `resource?` is optional in
  the TYPE only),
  `dist/stream/base/output.d.ts` (`toolResults: Promise<ToolResultChunk[]>`),
  `dist/stream/types.d.ts` (`ToolResultChunk`/`ToolResultPayload {toolName,result}`),
  `dist/chunk-AM3IOVFX.js`: the **runtime** `resourceId`-required guard
  `if (!threadId || !resourceId) throw AGENT_MEMORY_MISSING_RESOURCE_ID`
  (~L24682 / ~L26979) and the get-or-create that follows it
  (`getThreadById` → `createThread`, ~L24700 / ~L26996). The memory-prep block is
  entered when `memory && (threadId || resourceId)` (~L24656).
- Institutional learnings:
  `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`
  (plain-string logging),
  `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`
  (caller budget note for feat-205),
  `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`
  (keep keys optional at boot)
