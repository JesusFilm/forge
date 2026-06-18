---
id: "feat-202"
title: "Seeker RAG runtime hardening — body byte-cap, memory eviction, agent step/timeout budget"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-06-18"
duration: 2
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

The feat-198/feat-199 seeker skeleton (PR #1279) shipped clean for a Studio-only,
release-gated prototype, but a code review surfaced three latent
defense-in-depth gaps in the runtime path. None blocks the skeleton, none is
externally triggerable today (the RAG upstream is a trusted, host-allowlisted,
bearer-authed first-party service and the agent is network-gated), but all three
should be closed before the seeker is promoted toward a real, higher-traffic, or
public surface. Tracking them together so they aren't lost.

1. **Unbounded response-body ingress (shared with firecrawl-client).** Both
   single-service HTTP clients call `await response.json()` with no
   `Content-Length` / max-bytes guard — the full upstream body is buffered into
   the heap _before_ `RAG_TOP_K`/`MAX_PASSAGE_CODEPOINTS` slicing applies. A
   misbehaving (not necessarily hostile) upstream returning a multi-GB body, or
   a fast large body inside the 5s timeout, can OOM the single Node process that
   runs **every** Mastra agent and workflow. The client header comment claims
   protection against "huge bodies" that only holds post-parse.

2. **Process-lifetime in-memory `Memory` with no eviction.** `getSeekerMemory()`
   is a process-lifetime `InMemoryStore` singleton with no `lastMessages` cap,
   thread TTL, or per-resource eviction. Sustained traffic across many
   `threadId`s grows heap monotonically until a Railway restart — same shared
   blast radius as (1).

3. **Caller-budget rule rests on an undeclared ceiling.** `JESUSFILM_RAG_TIMEOUT_MS`
   is schema-capped at 30s and documented (config/env.ts:192-203) to stay
   strictly below the Mastra agent tool-call budget, but `seeker-agent.ts` sets
   no explicit `maxSteps` / per-tool timeout, so the upstream ceiling is a
   `@mastra/core` runtime default rather than a code-visible constant. A 30s
   override paired with a tight future runtime budget lets the inner call
   outlive the caller while the (currently dead) `retryable` flags invite the
   retry-storm shape the team's own learning warns about.

## Entry Points — Read These First

1. `apps/mastra/src/services/jesusfilm-rag-client.ts` — `readUpstreamReason`
   (`response.json()`), `searchJesusfilmRag` success-body `await response.json()`
   before the `.slice(0, RAG_TOP_K)`. The `endpoint`/`safeReason`/
   `readUpstreamReason` helpers are byte-identical twins of firecrawl-client.ts
   (currently duplicated, not extracted — see the convention doc's note), so a
   byte-cap helper should be shared the same way.
2. `apps/mastra/src/services/firecrawl-client.ts` — same uncapped
   `await response.json()` pattern (two call sites). Fix both clients together.
3. `apps/mastra/src/mastra/memory.ts` — `getSeekerMemory()` singleton +
   `InMemoryStore`; this is where a `lastMessages` cap / TTL lands.
4. `apps/mastra/src/mastra/agents/seeker-agent.ts` — the `Agent` constructor has
   no `maxSteps` / per-tool timeout today.
5. `apps/mastra/src/config/env.ts` (lines 192-203) — the `JESUSFILM_RAG_TIMEOUT_MS`
   caller-budget comment that this work makes code-enforced rather than asserted.
6. `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`
   — the governing learning for (3).
7. `docs/solutions/conventions/single-service-http-client-result-union-convention.md`
   — the convention both clients follow; a shared byte-cap belongs here.

## Grep These

- `response.json()` in `apps/mastra/src/services/` — every uncapped ingress.
- `InMemoryStore` / `getSeekerMemory` — memory construction.
- `maxSteps` / `maxOutputTokens` across `apps/mastra/src/mastra/agents/` — should
  be absent today; verifies the gap.
- `JESUSFILM_RAG_TIMEOUT_MS` — the cap whose ceiling this makes explicit.

## What To Build

- A shared max-bytes guard for the HTTP-client body read (read the stream with a
  byte ceiling, or check `Content-Length` and bound the buffered read), applied
  to **both** `jesusfilm-rag-client.ts` and `firecrawl-client.ts`. A body over
  the cap maps to the existing graceful failure (`parse_error` / equivalent →
  `unavailable`), never a throw. Pick a sane default (e.g. low single-digit MB)
  with an `.optional()` env override per the env-var discipline.
- A bound on the seeker `Memory`: a `lastMessages` cap and/or thread/TTL eviction
  so heap can't grow without limit. Keep it in-memory (Postgres persistence stays
  deferred per the skeleton's scope).
- An explicit `maxSteps` / per-tool timeout on the seeker agent (or an asserted,
  code-visible upstream ceiling constant) so the RAG timeout cap is _provably_
  below the caller budget. Consider lowering the 30s schema cap if the chosen
  runtime budget is tighter.

## Constraints

- **Do not** add any required-at-boot env var — all new knobs are `.optional()`
  with runtime fallback (the skeleton added zero required vars; keep it so).
- **Do not** change the typed no-throw result-union contract or the
  `{ status, sources, message? }` tool shape — these are hardening additions, not
  a redesign.
- The byte-cap is a natural moment to extract the shared helpers
  (`endpoint`/`safeReason`/`readUpstreamReason`) into one module rather than add a
  third copy — see the convention doc's note on duplication-vs-extraction.
- In-memory only — do not introduce Postgres-persisted memory here.

## Verification

- `pnpm --filter @forge/mastra test` — add cases: an oversized body maps to the
  graceful unavailable path (both clients); memory growth across many threads
  stays bounded; the agent exposes an explicit step/timeout budget.
- `pnpm --filter @forge/mastra typecheck && pnpm --filter @forge/mastra lint`.
- Grep `response.json()` in `apps/mastra/src/services/` and confirm every call
  site is byte-bounded.
- Confirm no new entry in the production `missing` env list in
  `assertMastraRuntimeEnv` (no new boot requirement).
