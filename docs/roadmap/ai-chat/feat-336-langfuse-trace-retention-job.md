---
id: "feat-336"
title: "Langfuse trace retention job (30/180-day sweep)"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-08-10"
duration: 2
depends_on:
  - "feat-321"
blocks:
  - "feat-339"
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

feat-321 exports raw seeker conversations (special-category personal data) to
the `forge-mastra` Langfuse project, and on the current Langfuse tier traces
accumulate with **no expiry** — configurable retention is a paid feature
(Pro, $199/mo) the owner decided against (2026-08-05). The decided policy
mirrors the ai-chat Postgres retention (feat-208): **30 days for anonymous
resources, 180 days for `user:*` resources**, enforced by a self-built daily
sweep. Until this ships, `LANGFUSE_TRACING_ENABLED=true` means indefinite
raw-conversation accumulation in Langfuse — treat this ticket as part of the
enable-in-production precondition set tracked by feat-339.

**Semantics differ from the Postgres purge — do not assume they agree.** The
ai-chat purge keys on ROLLING last-activity (`updatedAt`, bumped by
`saveMessages`); Langfuse's `toTimestamp` filters FIXED per-trace event time.
A thread active for 200 days survives in Postgres while its early turns'
traces are already deleted. Same window numbers, stricter effect here.

**Tier reality — resolve BEFORE building (the sizing input this ticket cannot
assume).** Langfuse rate-limits trace deletion PER ORGANIZATION per day
(published tiers: Hobby 50/day, Core 200/day, Pro+ 1,000/day) and advises
strongly against more than 30-50 trace ids per DELETE request. Hobby/Core
also carry a 30/90-day data-access window, which may make traces older than
the 180-day rung invisible to the listing leg. Confirm the project's actual
tier and current published limits first; the sweep's ceilings derive from
them, not from the ai-chat sweep's shape. Note the tension the vendor names
explicitly: their own guidance is to use the paid retention feature instead
of bulk manual deletion — the DIY decision (2026-08-05) accepts that, so the
job must live inside the quota rather than pretend it away.

Scope note (canonical: `apps/mastra/CLAUDE.md` § "Langfuse-only export"):
Langfuse is the ONLY store this job governs. The feat-321
Langfuse-only decision (2026-08-05) means enabled deployments write no raw
trace copy to the local DuckDB volume, so no local sweep is needed.

## Entry Points — Read These First

0. `apps/mastra/CLAUDE.md` → "Langfuse prompt management" → **Tracing /
   Langfuse-only export** — the CANONICAL statement of what feat-321 exports,
   where, and the explicit "do NOT build a DuckDB sweep / never a bare
   `MastraStorageExporter`" boundaries. Read this first; it names this ticket
   back.
1. `apps/mastra/src/mastra/ai-chat-retention.ts` — the pattern to mirror:
   boot drain + daily timer (the production-only gate lives at the CALL SITE
   in `src/mastra/index.ts`, not in this module), bounded sweeps, oldest-first,
   count-only logging, `canAiChatDataPersist`-style gating. Reuse the
   30/180 constants' SHAPE (`AI_CHAT_ANON_RETENTION_DAYS` /
   `AI_CHAT_USER_RETENTION_DAYS`) — decide at build time whether to import
   them (one policy, one source) or mirror with a cross-reference comment.
2. `apps/mastra/src/services/langfuse-prompt-client.ts` (client posture) +
   `apps/mastra/src/config/env.ts` (where `getLangfuseConfig()` is defined) —
   the house Langfuse HTTP posture (Basic auth from the key pair, host allowlist, byte caps,
   no-throw unions). The sweep's list/delete calls should reuse
   `getLangfuseConfig()` and follow the same client conventions.
3. `apps/mastra/src/mastra/langfuse-tracing.ts` — how traces get their
   `userId` (the memory `resource`: `user:<sub>` / `anon:<uuid>` /
   `seeker-dogfood`) and `sessionId` (threadId). The resource PREFIX is the
   window discriminator, mirroring feat-208 (prefix-check only, never split
   on `:`; `seeker-dogfood` and `anon:*` are both non-`user:` → 30 days).

## Grep These

- `startAiChatRetentionPurge` — boot wiring precedent in `src/mastra/index.ts`
- `AI_CHAT_ANON_RETENTION_DAYS` — the policy constants to align with
- `LANGFUSE_SEEKER_TRACING_MARKER` — the tracing module this governs

## What To Build

A `langfuse-trace-retention` module + boot hook (production runtime only),
sweeping daily:

1. List traces older than the window: `GET /api/public/traces` with
   `toTimestamp` = now − 180d → delete ALL returned (they exceed even the
   long window); then `toTimestamp` = now − 30d and client-side filter to
   rows whose `userId` does NOT start with `user:` → delete those.
   **Pin `fields=core` on every list call** — the endpoint returns ALL fields
   by default, including the `io` group (`input`, `output`, `metadata`),
   which would buffer full raw conversation text into the Mastra heap just to
   read ids and `userId` (violating the repo's byte-cap law and this
   ticket's own never-log-content posture). Apply the house byte cap too.
   Server-side narrowing via the `filter` param's `userId` "starts with"
   condition is a fine alternative to the client-side prefix check.
   **Note:** `GET /api/public/traces` is a Langfuse-classified DEPRECATED
   read API with the tightest read bucket (~15/min Hobby, 30 Core, 100 Pro);
   check for a successor endpoint at build time.
2. Delete via the batch endpoint (`DELETE /api/public/traces`, body
   `{ traceIds }`), **≤50 ids per request** (vendor advisory) and with the
   per-run total derived from the tier's daily deletion quota — NOT the
   ai-chat sweep's 500/sweep × 20 shape, which at ≤50 ids/request would need
   ~200 DELETE calls/day: 4× a Hobby day's entire quota, 100% of Core's, and
   zero headroom for feat-337's erasure (same bucket, same key pair).
   **Reserve headroom for erasure** — a subject-erasure request must never be
   starved by a retention sweep (GDPR "without undue delay"); prefer yielding
   the sweep to a pending erasure over the reverse.
3. **Verify-by-requery:** Langfuse deletion is asynchronous ("usually within
   15 minutes", no completion event) — the NEXT run must re-encounter-check
   previously deleted ids (or re-query the window) and log a loud
   plain-string line if deletion is not converging.
   **Quota exhaustion (HTTP 429 + `Retry-After`) is a first-class outcome**,
   not an error to swallow: a quota-capped run that under-deletes forever is
   exactly the silent failure this job exists to avoid. Log it loudly with a
   distinct enum reason and carry the backlog to the next run.
4. Logging: enum/count-only plain-string
   `[langfuse-retention] event=sweep_complete deleted=<n> ...` — never trace
   content, user ids, or exception text.
5. Failure posture: silent-failure is the known risk of DIY retention — a
   sweep that cannot list or delete must log loudly every run, never
   half-succeed quietly. (An alerting hook can come later; the loud log line
   is the floor.)

Verify exact endpoint/filter shapes against the live API before building
(`npx langfuse-cli api traces --help` — the resource is PLURAL; the
singular form silently falls through to generic help and reads like success —
or GET the OpenAPI) — do not trust this
ticket's parameter names over the API's.

## Constraints

- Single-instance assumption (same as ai-chat retention) — Mastra runs one
  replica; add a leader guard before scaling out.
- Never require new env vars at boot; the job no-ops (with one quiet line)
  when the Langfuse credential trio is absent or tracing has never been
  enabled. `.optional()` posture throughout.
- Uses the existing full-access key pair — no new credentials.
- Do NOT build a DuckDB sweep — Langfuse-only export makes it unnecessary
  (see Problem).

## Verification

- Unit: window math per resource prefix (user:/anon:/seeker-dogfood), sweep
  bounds, no-config no-op, loud-failure branch — each anti-vacuous.
- Opt-in real-credential smoke (mirror `LANGFUSE_PROMPT_SMOKE_TEST`'s
  `describe.skipIf` pattern) covering LIST+DELETE+requery on a sentinel
  trace. Age IS fakeable — Langfuse ingestion accepts a client-supplied
  `timestamp` on `TraceBody` — so backdate a sentinel and smoke the window
  filter directly too.
- `pnpm --filter @forge/mastra test` green.
