---
id: "feat-202"
title: "Seeker RAG runtime hardening — RAG response byte-cap + agent step-budget floor"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-06-18"
duration: 1
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-06-29 on branch `feat/seeker-rag-hardening` (PR _pending_ — fill the number at merge). Single-PR arc.

**What landed.** Built ① the RAG response byte-cap and ③ the agent step-budget floor; deliberately deferred ② in-memory `Memory` eviction to feat-208 (the Postgres move eliminates the heap-OOM risk rather than relocating it) and left `firecrawl-client.ts`'s identical gap to its owners. The byte-cap is a streamed, byte-counted read (`readJsonBodyCapped`) applied to **both** reads in `jesusfilm-rag-client.ts` (success body + `readUpstreamReason`): it aborts the stream (`reader.cancel()`) past a 2 MiB default ceiling and degrades over-cap into the **existing** `parse_error → unavailable` path — no throw, no new branch — with a structural no-throw boundary (reader acquired inside `try`, `releaseLock()` guarded in `finally`) to keep `NO-THROW LEAK CONTROL` intact. The cap knob `JESUSFILM_RAG_MAX_RESPONSE_BYTES` is `.optional()` with a runtime fallback — zero new required-at-boot env vars. The step floor sets `defaultOptions: { maxSteps: STEP_CAPS.toolCallingTurn }` on the seeker `Agent` (the vNext field, verified against the vendored `@mastra/core@1.36.0` runtime), reusing the `/forge-seeker` route's shared constant so the two paths can't diverge; plus an honor-system `/forge-seeker`-not-`/api/agents` routing-convention note in `apps/mastra/CLAUDE.md`. 765 tests green; typecheck + lint clean.

**Compound docs.** Created [`buffered-http-response-byte-cap-oom-guard-20260629.md`](../../solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md); added a worked-instance row to [`mocked-shape-vs-real-contract-discipline-20260506.md`](../../solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) and a space-axis cross-reference to [`outbound-timeout-shorter-than-caller-budget-20260506.md`](../../solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md); registered the pattern in root `CLAUDE.md` "Known Patterns".

**Residual risk / follow-ups.**

- A body-read abort _after_ a 200 (the request `AbortSignal` firing mid-body) is classified as `parse_error` (non-retryable) rather than `timeout` — **pre-existing** behavior (the prior `await response.json().catch(() => undefined)` had identical semantics), left unchanged: fixing it would alter the typed result-union the brief froze.
- `firecrawl-client.ts` carries the identical uncapped-read OOM gap — accepted, left to its owners.
- The direct `/api/agents/seekerAgent` path keeps no wall-clock bound and no auth; containment stays the network/gateway boundary.
- In-memory `Memory` eviction is deferred to **feat-208** (Postgres-persisted seeker memory), which eliminates the heap-OOM risk rather than relocating it.

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
