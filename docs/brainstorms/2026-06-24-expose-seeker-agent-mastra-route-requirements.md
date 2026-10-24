---
date: "2026-06-24"
topic: "expose-seeker-agent-mastra-route"
---

# Expose the Seeker Agent via a Mastra Service Route

## Summary

Add a new internal Mastra service route (e.g. `/forge-seeker`) that streams the existing `seekerAgent` over Server-Sent Events, behind the existing `MASTRA_SERVICE_API_KEYS` service-bearer auth. It is called server-to-server by another app's backend (the chat app is the first consumer), carries a required `threadId` (and an optional `resourceId`) per request for per-session conversation isolation, and mirrors the existing `/forge-experience-chat` route. This unlocks end-to-end internal dogfooding of Seeker without crossing the documented production safety gate.

## Problem Frame

`seekerAgent` exists and is exercised through Mastra Studio. `apps/mastra/src/mastra/seeker-route-isolation.test.ts` asserts it is absent from the custom route region and referenced exactly twice in `index.ts` — but that guard only proves "no custom `/forge-*` route wires it up." It does **not** prove the agent is unreachable: Mastra's framework auto-exposes every registered agent on a built-in, code-unauthenticated `/api/agents/*` surface (generate/stream), and this app attaches no global auth there. So Seeker is already reachable, without a bearer, to anything that can reach the Mastra endpoint. The real containment today is the network boundary (see Dependencies / Assumptions), not the isolation test. `apps/mastra/CLAUDE.md` documents three release gates (full safety/crisis guardrails, a gateway-access decision, and Postgres-persisted memory) before Seeker is exposed to real users.

The cost today is that no consuming app can exercise Seeker over a _stable, bearer-gated contract_ — only the raw, unauthenticated built-in surface exists, which is not something a consumer should build against. This work adds a guarded `/forge-seeker` route for **internal** dogfooding while keeping the production gates closed. Notably, the new route is _more_ locked down than the surface that already exists, not less.

## Key Decisions

- **Internal dogfooding only; stay behind the safety gate.** The route is for trusted internal callers exercising Seeker end-to-end. The deferred guardrails (crisis routing, anti-fabrication, AI-disclosure) and Postgres-persisted memory remain out of scope. This is not productionizing Seeker.

- **Server-to-server is the chosen access model — not a stepping stone.** The route is an internal service surface authenticated by service bearer, called by a consuming app's backend (matching how admin calls `/forge-experience-chat`). The service bearer never reaches a browser, and the route adds no CORS. Browser-direct access is not a planned future direction; if it were ever needed it would be a separate decision made on its own merits, not something this work anticipates or builds toward.

- **SSE streaming, mirroring `/forge-experience-chat`.** Seeker is conversational, so the route streams `token_delta` frames as the agent generates and a final `result` frame, with `error` frames on failure. The streaming transport (ReadableStream, frame vocabulary, abort/budget composition) is copied from the chat route rather than reinvented. **One caveat:** the chat route passes only `{ maxSteps, abortSignal }` to `agent.stream(...)` and threads no `threadId`/`resourceId` — so per-session memory keying is _not_ inherited from the template and is net-new work for this route (see Outstanding Questions — it is the key technical risk).

- **`resourceId` is an optional, opaque forward-compatibility seam.** `threadId` is required (it drives memory isolation); `resourceId` is **optional** — the route forwards it into the agent call if present and interprets it never. It is not required for v1 because nothing consumes it yet, so callers aren't forced to invent a placeholder. When real user auth lands, the consumer starts passing the authenticated user id as `resourceId` with no change to the route contract.

- **Reversing the isolation guard is explicit, not bypassed.** Wiring the route necessarily changes `seeker-route-isolation.test.ts`. That test is updated as a deliberate, reviewed decision that records the new "Seeker is internally exposed, still gated from public" intent — it is not deleted or silently relaxed.

## Requirements

**Route and contract**

- R1. A new POST service route (working name `/forge-seeker`) is registered in `apps/mastra/src/mastra/index.ts`'s `apiRoutes`, following the existing `registerApiRoute(...)` pattern.
- R2. The route accepts a JSON body containing a required `prompt` (the seeker's message) and a required `threadId`, plus an optional `resourceId`. Missing or empty `prompt` or `threadId` produces a 400 before the agent is invoked; an absent `resourceId` is accepted.
- R3. The route responds with an SSE stream emitting `token_delta` frames during generation and a terminal `result` frame that carries both the assistant text and the `sources[]` returned by `retrieveAnswer` (so a dogfooder can see whether the answer is grounded in real cited passages). Failures emit an `error` frame.
- R4. The route looks up the agent via the Mastra instance by id (`seekerAgent`) rather than importing it directly into the handler, consistent with the `getMastra()` thunk pattern used by the chat route.

**Auth and access**

- R5. The route validates the `Authorization: Bearer <key>` header against `MASTRA_SERVICE_API_KEYS` using the existing `isValidServiceBearer` check; an invalid or missing bearer returns 401 before any agent work.
- R6. The route adds no CORS headers — it is server-to-server only.

**Conversation state**

- R7. The required `threadId` (and the `resourceId` if present) is threaded into the agent invocation so each conversation has isolated multi-turn memory and no cross-session history bleed through the shared in-memory singleton. The exact `agent.stream(...)` mechanism for passing these (and whether the thread must be created before first recall) is net-new versus the chat-route template and rests on an unverified Mastra API contract — see Outstanding Questions. If `agent.stream(...)` turns out not to honor per-thread memory, the accepted fallback for v1 is stateless / no-memory dogfooding (each turn independent) rather than blocking the route; AE3 is therefore contingent on that contract holding. Even under that fallback the route still earns its build cost — it gives consumers a stable, bearer-gated contract to build against instead of the raw unauthenticated `/api/agents/*` surface (see Problem Frame) — multi-turn memory is the upside, not the whole justification.
- R8. The route treats `resourceId` as opaque and never branches on its value; `threadId` is the field that drives memory isolation. Isolation holds only if callers send distinct, non-colliding `threadId`s — the route does not namespace or validate ownership of them. This is a **conscious v1 decision**: for the single-trusted-consumer dogfooding phase (Dependencies / Assumptions) the route accepts that any bearer holder supplying another session's `threadId` can read it. The named hardening path, required before a second caller joins the bearer allowlist, is either a dedicated per-route key or route-level `threadId` namespacing (e.g. caller-id prefix) — see Dependencies / Assumptions.

**Generation safety limits**

- R9. The generation is bounded by an abort/time budget and a step cap, consistent with how the chat route bounds `agent.stream(...)` (`TIME_BUDGET_MS` + `STEP_CAPS`). Reusing the existing chat budget or adding a seeker-specific constant is a planning decision.
- R10. The inbound request's abort signal is honored so a disconnected caller cancels in-flight generation.
- R11. Before opening the SSE stream, the route checks the model-key **accessor** (`getOpenRouterApiKey()`, which resolves `OPENROUTER_API_PAID_KEY ?? OPENROUTER_API_KEY`) — not the bare `OPENROUTER_API_KEY` var, which would false-trip when only the paid key is set. If no key resolves, the route returns a clean upfront error (e.g. 503 with a fixed reason like `model_key_missing`) and does not start streaming or invoke the agent. The key stays **optional at boot** — other agents fall back to OpenAI, so a blanket boot requirement would needlessly brick deploys that don't use Seeker. This is a route-level, first-use precondition so a misconfigured Seeker fails early and legibly rather than mid-stream.

**Output safety**

- R12. Caller-facing frames carry no internal topology. `error` frames expose a fixed-vocabulary `reason`, not raw exception text (RAG base URL, internal hostnames, upstream provider error bodies) — raw detail goes to server-side logs only. The same constraint applies to `sources[]` in the `result` frame: only the source fields a consumer needs (e.g. title, public URL, snippet, score) are emitted, not internal retrieval-infrastructure detail. The exact emitted-field set and reason vocabulary is a planning detail; that _some_ sanitization happens is a requirement. (The leak surface is already small: `retrieveAnswer` returns a `.strict()` envelope `{ status, sources, message? }` where each source is itself `.strict()` — `{ text, sourceName, title, url, score }` — with internal fields excluded at the tool boundary, so R12 mainly ensures the route doesn't widen it.)

**Isolation guard**

- R13. `apps/mastra/src/mastra/seeker-route-isolation.test.ts` is updated to reflect that `seekerAgent` is now intentionally wired into one service route, with assertions that still pin the intended exposure (e.g. exactly one `/forge-seeker` route, still no other route references) rather than removing the guard.

## Key Flows

- F1. Internal seeker turn (happy path)
  - **Trigger:** A consuming app's backend receives a user message and POSTs to `/forge-seeker`.
  - **Actors:** consuming-app backend (caller), Mastra route handler, `seekerAgent`, `retrieveAnswer` RAG tool.
  - **Steps:** Caller sends `{ prompt, threadId, resourceId? }` with a service bearer → route validates bearer → route validates body → route looks up `seekerAgent` → `agent.stream(...)` runs under the abort/budget signal, calling `retrieveAnswer` → handler relays `token_delta` frames, then a `result` frame carrying text + sanitized `sources[]`.
  - **Covered by:** R1, R2, R3, R4, R5, R7, R9, R10, R12.

- F2. Rejected/failed calls
  - **Trigger:** Missing bearer, malformed body, missing model key, a first-turn thread-creation failure, or a generation error/timeout.
  - **Steps:** Invalid bearer → 401; missing `prompt` or `threadId` → 400; model key absent → 503 upfront (no stream opened, agent not invoked); if the supplied `threadId` has no existing thread and the route/`stream()` does not create it, the first turn surfaces as an `error` frame (this is the common path, not an edge case — see Outstanding Questions); mid-stream failure or budget timeout → terminal `error` frame with a sanitized `reason`.
  - **Covered by:** R2, R3, R5, R10, R11, R12.

## Acceptance Examples

- AE1. Covers R5. **Given** a request with no `Authorization` header, **when** it hits `/forge-seeker`, **then** the response is 401 and the agent is never invoked.
- AE2. Covers R2. **Given** a valid bearer but a body missing `threadId`, **when** the route runs, **then** it returns 400 before invoking the agent.
- AE3. Covers R7. **Given** two requests with different `threadId`s in the same process, **when** both converse, **then** neither sees the other's prior turns. (Contingent on `agent.stream(...)` honoring per-thread memory — see R7; if the contract does not hold, the v1 fallback is stateless dogfooding and this example is waived.)
- AE3b. Covers R2. **Given** a valid bearer and a valid `prompt` + `threadId` but **no** `resourceId`, **when** the route runs, **then** the request is accepted and the agent is invoked (`resourceId` is optional).
- AE3c. Covers R7 (the positive case). **Given** two turns sent on the **same** `threadId`, **when** the second turn arrives, **then** the agent can recall context from the first. This is the real proof that multi-turn memory works — AE3's non-bleed check passes vacuously even with no memory, so AE3c is what distinguishes working memory from the stateless fallback. Like AE3, it is contingent on the `agent.stream(...)` memory contract.
- AE4. Covers R3. **Given** a valid request, **when** the agent generates, **then** the caller receives one or more `token_delta` frames followed by exactly one `result` frame carrying both the assistant text and `sources[]`.
- AE5. Covers R10. **Given** the caller aborts mid-stream, **when** the abort propagates, **then** in-flight generation is cancelled.
- AE6. Covers R11. **Given** no OpenRouter key resolves (neither `OPENROUTER_API_PAID_KEY` nor `OPENROUTER_API_KEY` set), **when** a valid request hits `/forge-seeker`, **then** the route returns a 503 with a fixed reason before opening the stream, and the agent is never invoked.

## Scope Boundaries

**Deferred for later (not v1, but plausible next)**

- Postgres-persisted Seeker memory — conversations remain in-memory and are lost on Mastra restart/redeploy. Acceptable for dogfooding; the durable path is a separate release gate.
- Full safety/crisis guardrails (crisis routing, anti-fabrication, AI-disclosure) — a hard gate on **who may reach Seeker**, not just on "public launch." Required before Seeker is reachable by anyone outside the dev/product dogfooding circle. Enforcing that boundary (e.g. a default-off feature flag gating Seeker vs. the stub agent, scoped to allowlisted users) is consuming-app work, but this route must not be opened wider until the guardrail gate is met. The risk this addresses is accidental exposure — a shared link or a flag defaulting on — reaching a vulnerable user before crisis handling exists.
- A Mastra-side `SEEKER_ROUTE_ENABLED`-style env flag (default off) as belt-and-suspenders defense-in-depth — possible later hardening, not a v1 requirement. The primary access control for this phase lives on the consuming-app side (it decides whether a human's message reaches Seeker at all). A route-side flag would NOT close the already-open unauthenticated `/api/agents/*` path (that needs separate global-auth work that previously broke Studio), so it is intentionally out of scope here rather than relied upon.

**Outside this work's identity**

- Browser-direct access and CORS — server-to-server is the deliberate model (Key Decisions), not a phase-one limitation.
- A gateway-access / public-exposure decision — owned by the documented gateway gate, not this route.
- All chat-app-side wiring (what the consumer sends as `resourceId`, UI, transport) — separate work on the consuming app. **Reminder for that work:** the consumer must mint/scope `threadId`s server-side (e.g. a UUID generated at "new conversation", bound to the user/session, with ownership re-checked on reuse) and must **not** forward browser-supplied `threadId`s verbatim — otherwise a user can supply or enumerate another session's `threadId` and read its conversation (the route treats `threadId` opaquely per R8 and cannot prevent this).

## Dependencies / Assumptions

- **Outer boundary is `apps/mastra`'s private-only Railway networking.** The `@forge/mastra` Railway service has no public domain — it is reachable only from within Railway's private network, not the public internet. This is the load-bearing control that makes "internal" real; the service bearer is a second layer on top. A future reader who enables public networking on this service has changed a foundational assumption and must revisit the whole exposure model. Concretely, before public networking is enabled the built-in unauthenticated `/api/agents/*` surface must be auth-gated (or `seekerAgent` de-registered from auto-exposure) — otherwise Seeker becomes publicly reachable with no bearer regardless of R5. This route's bearer gate does not cover that path.
- **The shared bearer's blast radius is accepted.** `MASTRA_SERVICE_API_KEYS` is one CSV allowlist shared across all `/forge-*` routes; this work adds Seeker to that radius without a dedicated per-route key. Acceptable for dogfooding behind the private-network boundary; a dedicated bearer is a possible later hardening, not a v1 requirement.
- Assumes the consuming app has a server-side surface that can hold the service bearer and proxy browser traffic (the chat app's backend is the intended first caller). The route makes no assumption about who that caller is beyond a valid bearer.
- **Assumes a single trusted consumer (consciously accepted for v1).** `threadId` isolation rests on callers sending distinct ids; with one trusted backend (chat) inside the private network this holds. It is not a guarantee against a second bearer-holder reusing or guessing another thread's id. This is accepted as a v1 decision, not deferred indefinitely: before a second caller is added to `MASTRA_SERVICE_API_KEYS`, the route must adopt a dedicated per-route key or `threadId` namespacing (R8).
- Assumes the in-memory singleton memory is acceptable for dogfooding: conversations are not durable across restarts, and `resourceId` carries no real identity until auth exists.
- Assumes `MASTRA_SERVICE_API_KEYS` is provisioned for the environments where the route is exercised (optional in dev, required in production per `assertMastraRuntimeEnv()`).
- Seeker's model (`openrouter/google/gemma-4-31b-it:free`) needs an OpenRouter key (`OPENROUTER_API_PAID_KEY` or `OPENROUTER_API_KEY`), but it stays optional at boot (other agents fall back to OpenAI). Its absence is caught by the route's first-use preflight (R11) as an upfront 503, not deferred to a mid-stream failure or enforced as a blanket boot requirement.

## Outstanding Questions

**Deferred to Planning**

- **Key technical risk — verify first.** Two facets of `agent.stream(...)` are both net-new versus the chat-route template (which consumes only `output.textStream`) and must be probed against Mastra's API before committing to the implementation shape: (1) **memory keying** — how `stream(...)` accepts `threadId`/`resourceId`, and whether a thread needs explicit creation before first recall (the memory tests show `recall` on a never-created thread _throws_ rather than returning empty, so a fresh-thread first turn could crash unless the route or `stream()` creates it); and (2) **tool-result extraction** — how to surface `retrieveAnswer`'s `sources[]` (R3) from the stream return value, since the mirrored template never reads tool results. Do not assume either falls out of the text-stream relay.
- Whether the route reuses the existing `TIME_BUDGET_MS.chatTurn` (90s) and `STEP_CAPS.toolCallingTurn` (8) or introduces seeker-specific constants. If a seeker-specific budget is added, the `error`-frame reason classification (`timeout` vs `generation_failed`) must travel with it.
- Final route name (`/forge-seeker` is the working name) and request body field names.
- The exact emitted-field set for `sources[]` in the `result` frame and the `error`-frame `reason` vocabulary (R3 fixes that sources are included and R12 fixes that both are sanitized; the precise field layout and reason strings are planning details).
- Exact reshaping of `seeker-route-isolation.test.ts` assertions to pin the new intended exposure (R4's lookup-by-id implies no new import, so the `seekerAgent` occurrence count moves 2 → 3).

## Sources / Research

- `apps/mastra/src/mastra/index.ts` — Mastra instance, agent registry, `apiRoutes` registration pattern (`registerApiRoute`), `getMastra()` thunk, `serviceKeys` from `MASTRA_SERVICE_API_KEYS`.
- `apps/mastra/src/mastra/agents/experience-chat-route.ts` — the SSE streaming handler to mirror (frames, abort/budget signals, bearer check).
- `apps/mastra/src/mastra/agents/seeker-agent.ts` — Seeker definition (`id: "seekerAgent"`, single `retrieveAnswer` tool, attached memory, deferred guardrail attach-point).
- `apps/mastra/src/mastra/tools/retrieve-answer.ts` — RAG tool I/O schema (`status`, `sources[]`, `message`).
- `apps/mastra/src/server/service-bearer.ts` — `isValidServiceBearer` timing-safe allowlist check.
- `apps/mastra/src/mastra/memory.ts` — in-memory Seeker memory singleton (no Postgres; per-session isolation needs distinct `threadId`).
- `apps/mastra/src/mastra/budgets.ts` — `TIME_BUDGET_MS`, `STEP_CAPS`.
- `apps/mastra/src/mastra/seeker-route-isolation.test.ts` — the guard this work intentionally updates.
- `apps/mastra/CLAUDE.md` — service-bearer convention and the three documented release gates (guardrails, gateway, persisted memory).
