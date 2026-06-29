---
id: "feat-202"
title: "Seeker RAG runtime hardening — RAG response byte-cap + agent step-budget floor"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-06-18"
duration: 1
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

The feat-198/feat-199 seeker skeleton (PR #1279) shipped clean for a Studio-only,
release-gated prototype, but a code review surfaced three latent defense-in-depth
gaps. A scoping investigation (2026-06-29) reshaped the ticket — see
`docs/brainstorms/2026-06-29-seeker-rag-runtime-hardening-requirements.md` for the
full rationale and the two-round doc review behind it. Net:

1. **Build now — RAG response byte-cap.** Both reads in
   `jesusfilm-rag-client.ts` (`await response.json()`) buffer the full upstream
   body into the heap before slicing. A misbehaving (not hostile) upstream
   returning a multi-GB body can OOM the single Node process that runs **every**
   Mastra agent and workflow — a risk independent of the seeker's exposure level,
   so worth closing now.
2. **Deferred to feat-208 — in-memory `Memory` eviction.** `getSeekerMemory()` is
   an unbounded process-lifetime `InMemoryStore`, but feat-208 moves seeker memory
   to Postgres, which **eliminates** the heap-OOM risk rather than relocating it.
   Building in-memory eviction now would be throwaway. Not built here; see the
   retention note on feat-208.
3. **Build now — agent step-budget floor.** The `/forge-seeker` route already
   sets `maxSteps`/budget, but the code-unauthenticated built-in
   `/api/agents/seekerAgent` surface (reachable by any in-network caller) runs the
   agent with no default ceiling. A constructor-level default closes that gap.

**Out of scope:** `firecrawl-client.ts` (identical risk, but out-of-lane —
consciously accepted and left to its owners, no ticket); extracting the shared
HTTP helpers; in-memory eviction; a per-request wall-clock budget on the direct
`/api/agents/*` path.

## Entry Points — Read These First

1. `docs/brainstorms/2026-06-29-seeker-rag-runtime-hardening-requirements.md` —
   the authoritative scope + rationale for this ticket. Read first.
2. `apps/mastra/src/services/jesusfilm-rag-client.ts` — the two uncapped reads:
   success body `await response.json()` (`:217`, before `.slice(0, RAG_TOP_K)` at
   `:235`) and the error path `readUpstreamReason` (`:123`). Both get the byte-cap.
3. `apps/mastra/src/mastra/agents/seeker-agent.ts` — the `Agent` constructor has
   no `defaultOptions`/`maxSteps` today; the step-budget floor lands here.
4. `apps/mastra/src/mastra/agents/seeker-route.ts` — `STEP_CAPS.toolCallingTurn`
   (`:272`) is the shared constant the constructor floor must reuse; `:19` documents
   the built-in surface as "unauthenticated".
5. `apps/mastra/src/config/env.ts` — `JESUSFILM_RAG_TIMEOUT_MS` (5s default,
   `.max(30_000)`); the byte-cap's optional env knob follows the same discipline.
6. `apps/mastra/CLAUDE.md` — the seeker "Containment" / "Service route" sections,
   where the `/forge-seeker`-not-`/api/agents` routing-convention note lands.

## Grep These

- `response.json()` in `apps/mastra/src/services/jesusfilm-rag-client.ts` — the
  two uncapped ingress sites (RAG client only; do not touch firecrawl).
- `STEP_CAPS` / `TIME_BUDGET_MS` in `apps/mastra/src/mastra/` — the shared budget
  constants; the constructor floor reuses `STEP_CAPS.toolCallingTurn`.
- `defaultOptions` / `maxSteps` in `apps/mastra/src/mastra/agents/` — absent on the
  seeker agent today; verifies the gap.

## What To Build

- **Byte-cap the RAG response body**, applied to **both** read sites in
  `jesusfilm-rag-client.ts` — success (`:217`) and error path (`readUpstreamReason`,
  `:123`), since a multi-GB error body OOMs the shared process identically. Stream
  the body with a byte counter (don't trust `Content-Length` alone — absent/wrong);
  on hitting the cap, **cancel/abort the underlying stream** (not merely stop
  reading) so the socket can't keep filling. A body over the cap maps to the
  existing `parse_error → unavailable` path, never a throw. Default ceiling: a low
  single-digit MB, sized above a measured/contract-derived legitimate `topK=5`
  payload (≈ max passage text × 5 + citation overhead), with an `.optional()` env
  override.
- **A step-budget floor on the seeker agent**: set
  `defaultOptions: { maxSteps: STEP_CAPS.toolCallingTurn }` on the `Agent`
  constructor (the vNext field, NOT `defaultStreamOptionsLegacy`), reusing the
  route's shared constant so the two paths can't diverge. This is a default floor
  (deep-merge lets an explicit per-call value win), not an un-overridable ceiling.
- **A routing-convention note** in `apps/mastra/CLAUDE.md`: apps/services must call
  the bearer-gated `/forge-seeker` route, never the built-in
  `/api/agents/seekerAgent` surface (unauthenticated, unbudgeted). State plainly
  it's an honor-system note, not enforcement — the binding containment is the
  network/gateway boundary.

## Constraints

- **Do not** touch `firecrawl-client.ts`, and **do not** extract the shared HTTP
  helpers (`endpoint`/`safeReason`/`readUpstreamReason`) into a common module —
  the duplication is deliberate; extraction would couple an out-of-lane client into
  chat-lane work (the wrong abstraction).
- **Do not** add any required-at-boot env var — new knobs are `.optional()` with
  runtime fallback (the skeleton added zero required vars; keep it so).
- **Do not** change the typed no-throw result-union contract or the
  `{ status, sources, message? }` tool shape — hardening additions, not a redesign.
- **Do not** introduce Postgres-persisted memory or in-memory eviction here
  (deferred to feat-208).
- The constructor floor covers the step dimension only; the direct `/api/agents/*`
  path keeps no wall-clock bound (out of scope) — its containment is the network
  boundary.

## Verification

- `pnpm --filter @forge/mastra test` — add cases: an oversized body maps to the
  graceful `unavailable` path on **both** the success body and the error path
  (`readUpstreamReason`), tested against real over-cap behavior (not a mocked
  branch); and the seeker agent's `maxSteps` default takes effect when no per-call
  value is passed (verify against the `mastra build` output path, since the server
  is re-bundled at build).
- `pnpm --filter @forge/mastra typecheck && pnpm --filter @forge/mastra lint`.
- Grep `response.json()` in `apps/mastra/src/services/jesusfilm-rag-client.ts` and
  confirm both call sites are byte-bounded.
- Confirm `apps/mastra/CLAUDE.md` carries the `/forge-seeker`-not-`/api/agents`
  routing-convention note next to the seeker Containment / Service route sections.
- Confirm no new entry in the production `missing` env list in
  `assertMastraRuntimeEnv` (no new boot requirement).
