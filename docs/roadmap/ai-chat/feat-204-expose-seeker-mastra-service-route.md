---
id: "feat-204"
title: "Expose Seeker agent via internal Mastra SSE service route"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-06-24"
duration: 3
depends_on:
  - "feat-199"
blocks:
  - "feat-205"
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

`seekerAgent` (feat-198/feat-199) runs in Mastra Studio but is deliberately kept off every custom `/forge-*` route — `apps/mastra/src/mastra/seeker-route-isolation.test.ts` enforces this. No consuming app can exercise Seeker over a stable, bearer-gated contract; the only thing exposing it today is Mastra's built-in, code-unauthenticated `/api/agents/*` surface, which is not something a consumer should build against.

This adds a guarded `/forge-seeker` SSE service route so the chat app (the first consumer) can dogfood Seeker end-to-end, **internally**, behind the existing private-network + service-bearer boundary and **without** crossing the documented production release gates (full safety/crisis guardrails, gateway-access decision, Postgres-persisted memory). The new route is _more_ locked down than the already-open built-in surface, not less.

Full requirements + decisions: `docs/brainstorms/2026-06-24-expose-seeker-agent-mastra-route-requirements.md`.

## Entry Points — Read These First

1. `docs/brainstorms/2026-06-24-expose-seeker-agent-mastra-route-requirements.md` — the brainstorm; R1–R13, flows, acceptance examples, and the key technical risk all live here.
2. `apps/mastra/src/mastra/agents/experience-chat-route.ts` — the SSE streaming handler to mirror (frame vocabulary `token_delta`/`result`/`error`, abort/budget composition, bearer check). NOTE: it threads no `threadId`/`resourceId` and reads only `output.textStream` — memory keying AND tool-result (`sources[]`) extraction are net-new here.
3. `apps/mastra/src/mastra/index.ts` — `apiRoutes` + `registerApiRoute`, the `getMastra()` thunk lookup pattern, `serviceKeys` from `MASTRA_SERVICE_API_KEYS`.
4. `apps/mastra/src/mastra/agents/seeker-agent.ts` — `id: "seekerAgent"`, single `retrieveAnswer` tool, attached in-memory `Memory`, lazy OpenRouter key read at generate time.
5. `apps/mastra/src/mastra/memory.ts` + `memory.test.ts` — `getSeekerMemory()` singleton; `recall` on a never-created thread **throws**, so first-turn thread creation must be handled.
6. `apps/mastra/src/mastra/tools/retrieve-answer.ts` — RAG tool output `{ status, sources, message? }`, each source `.strict()` `{ text, sourceName, title, url, score }`.
7. `apps/mastra/src/server/service-bearer.ts` — `isValidServiceBearer`.
8. `apps/mastra/src/config/env.ts` — `getOpenRouterApiKey()` (`OPENROUTER_API_PAID_KEY ?? OPENROUTER_API_KEY`); both optional at boot.
9. `apps/mastra/src/mastra/budgets.ts` — `TIME_BUDGET_MS.chatTurn` (90s), `STEP_CAPS.toolCallingTurn` (8).

## Grep These

- `registerApiRoute` / `apiRoutes` in `index.ts` — where the route registers.
- `seekerAgent` in `index.ts` — currently 2 occurrences; the isolation test asserts exactly that and must move to allow the new route.
- `handleExperienceChatRouteRequest` / `text/event-stream` — the streaming template.
- `getOpenRouterApiKey` — the accessor the preflight (R11) must call, NOT the bare `OPENROUTER_API_KEY`.
- `recall` / `saveThread` in `memory.test.ts` — the throw-on-missing-thread behavior.

## What To Build

A `POST /forge-seeker` service route in `apps/mastra/src/mastra/index.ts`'s `apiRoutes`, mirroring `/forge-experience-chat`:

- Body: required `prompt` + `threadId`, optional `resourceId` (forwarded opaquely, never interpreted). Missing `prompt`/`threadId` → 400; absent `resourceId` accepted. (R2, R7, R8)
- Service-bearer auth via `isValidServiceBearer` against `MASTRA_SERVICE_API_KEYS`; no CORS (server-to-server only). (R5, R6)
- First-use preflight: if `getOpenRouterApiKey()` resolves nothing → 503 `model_key_missing` before opening the stream. (R11)
- SSE stream: `token_delta` frames + terminal `result { text, sources }` (sanitized) + `error` frames; bounded by abort/time budget + step cap; honor inbound abort signal. (R3, R9, R10, R12)
- Thread the `threadId` (and `resourceId` if present) into `agent.stream(...)` for per-session memory; handle first-turn thread creation. **Key risk:** the `agent.stream(...)` memory-keying + tool-result-extraction contract is unverified against this Mastra version — probe it first. If memory keying can't be made to work, the accepted v1 fallback is stateless dogfooding (AE3/AE3c waived). (R7)
- Output sanitization: `error` frames carry a fixed-vocabulary `reason` only; `sources[]` emits consumer-facing fields only — no raw exception text / internal hostnames. (R12)
- Update `seeker-route-isolation.test.ts` deliberately to pin the new intended exposure (exactly one `/forge-seeker` route, still no other route references; `seekerAgent` occurrences move 2 → 3 via lookup-by-id, no new import). (R13)

## Constraints

- **Internal dogfooding only — do NOT cross the release gates.** Safety/crisis guardrails and Postgres-persisted memory stay deferred; this is gated behind private networking + the consuming-app feature flag, not productionized.
- **Server-to-server is the chosen model**, not a stepping stone — no CORS, no browser-direct path.
- **No new required-at-boot env var.** `OPENROUTER_API_KEY` stays optional; the route-level preflight handles its absence.
- **Do not weaken the isolation guard** — update it as a reviewed decision, don't delete it.
- Chat-app wiring is out of scope (separate work). That work must mint/scope `threadId`s server-side and not forward browser-supplied ones — see the brainstorm's Scope Boundaries.

## Verification

- `pnpm --filter @forge/mastra test` — add route cases mirroring the brainstorm's acceptance examples: 401 on missing bearer (AE1); 400 on missing `threadId` (AE2); request accepted with no `resourceId` (AE3b); same-`threadId` recall works (AE3c, contingent); `token_delta`→`result{text,sources}` shape (AE4); abort cancels mid-stream (AE5); 503 before stream when no OpenRouter key resolves (AE6); updated isolation-guard assertions (R13).
- `pnpm --filter @forge/mastra typecheck && pnpm --filter @forge/mastra lint`.
- Confirm `assertMastraRuntimeEnv` gains no new required env var.
- Manually probe the `agent.stream(...)` memory + `sources[]` contract before locking the implementation shape.
