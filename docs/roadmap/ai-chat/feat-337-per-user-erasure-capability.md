---
id: "feat-337"
title: "Per-user erasure across Langfuse traces and ai_chat Postgres"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-08-10"
duration: 3
depends_on:
  - "feat-321"
blocks:
  - "feat-339"
  - "feat-356"
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-08-17 via [PR #1946](https://github.com/JesusFilm/forge/pull/1946) (`feat(mastra): per-user erasure CLI — Postgres half + operator runbook`) and [#1951](https://github.com/JesusFilm/forge/pull/1951) (`feat(mastra): per-user erasure CLI — Langfuse half + completion docs`).

**What landed.** The proposed one-ticket/two-PR arc, as planned. PR 1: the
`erase-user` CLI over the reusable `ai-chat-erasure.ts` module — key-equality
Postgres erasure with per-row ownership re-checks failing closed
(`filter_mismatch`/`unreadable_rows`), collect-then-delete, connectivity
probes so a store fault can never read as "no data", the
`--execute --confirm-database=<hash>` gate pinning both stores AND the
subject (sha256, preview-only emission), the rewritten request-lifecycle
runbook in `apps/mastra/CLAUDE.md`, and the opt-in real-Postgres smoke
(`AI_CHAT_ERASURE_SMOKE_TEST`). PR 2: the Langfuse half —
list→re-check→dedupe→batch-delete (≤10 requests/run, the erasure headroom
share of the org's 50/day quota) →ONE read-only requery, the KTD11 egress pin
(https + allowlisted host, pinned `cloud.langfuse.com` fallback), the full
exit-code map (0 clean incl. "submitted; N still visible" and both-stores
no-data; 2 incomplete-safe-rerun incl. quota/cap/trio-absent; 1 hard
refusal/fault), the runbook end-state sweep, and the read-only Langfuse smoke
(`AI_CHAT_ERASURE_LANGFUSE_SMOKE_TEST`). Notable deviations from the brief:
no project-identity probe (owner ruling 2026-08-17 — Langfuse keys are
project-scoped, so the confirm hash pins the HOST only and the key-pair
assumption is an accepted limitation); a LIST-stage Langfuse failure deletes
NOTHING (divergent from the retention sweep, which deletes what it collected
— documented at the decision site in `ai-chat-erasure.ts`: erasure's scarce
delete headroom must not be spent into a currently-failing upstream). Measured
traces-per-userId spread from the credentialed read smoke (2026-08-17, 3
users / 185 observations sampled): `traces_per_user_max=9`,
`traces_per_user_p95=9` — two orders of magnitude under one run's
500-trace headroom, so F2's completion horizon at dogfood volume is a
single run, quota permitting.

**Residual risk / follow-ups.** The accepted limitations recorded in the
runbook (`apps/mastra/CLAUDE.md` § "Operator erasure runbook" → "Accepted
limitations"): erasure is per KEY, never per person (multi-resource subjects,
unreachable `anon:*` keys, the refused shared `seeker-dogfood` fallback);
deleted-account `sub`s are unrecoverable; the DuckDB store retains redacted
identifier/timing spans; the Langfuse half sees only v2-indexed observations;
and the environment's key pair determines the target project (workstation
hygiene assumption). feat-339 owns the processing-register lines; the
apps/auth account-deletion cascade is deferred to feat-356, which calls this
module's typed per-store outcomes. Two owner-decided deferrals (2026-08-17):
the mismatched-row counter coexists with `no_data` by design (revisit only on
a resource-key format migration — noted at the claim site in
`ai-chat-erasure.ts`), and the module/test files' passing of the
1000-line-split threshold is accepted as-is — split only as a follow-up if it
becomes real friction, never as a drive-by.

**Unblocked.** feat-339, feat-356.

## Problem

A subject-erasure request ("delete my data") must delete a specific user's
seeker data everywhere it lives. With feat-321 enabled that is TWO stores:
the `ai_chat` Postgres schema (threads + messages, keyed by
`resourceId = user:<sub>` / `anon:<uuid>`) and the `forge-mastra` Langfuse
project (traces keyed by the same value in `userId`). Today only the Postgres
half exists, and only as a manual SQL runbook in `apps/mastra/CLAUDE.md`
("Operator deletion runbook"). Owner decision (2026-08-05): build a proper
per-user erasure capability covering BOTH stores.

Scope note (canonical: `apps/mastra/CLAUDE.md` § "Langfuse-only export"):
the local DuckDB observability store is deliberately OUT of scope — the feat-321 Langfuse-only decision means it holds no seeker
conversation content (redacted spans only, all agents).

## Entry Points — Read These First

0. `apps/mastra/CLAUDE.md` → "Langfuse prompt management" → **Tracing /
   Langfuse-only export** — the CANONICAL statement of what feat-321 exports,
   where, and the explicit "do NOT build a DuckDB sweep / never a bare
   `MastraStorageExporter`" boundaries. Read this first; it names this ticket
   back.
1. `apps/mastra/CLAUDE.md` → "Operator erasure runbook (subject-erasure
   requests)" — rewritten by this ticket's PR 1 (2026-08-12; formerly the
   one-bullet "Operator deletion runbook"). It now opens with the request
   lifecycle and keeps the raw Postgres SQL this capability automates as the
   break-glass fallback. (`ai_chat.mastra_resources` does not exist — working
   memory never landed — and `deleteThread` does not touch it.)
2. `apps/mastra/src/mastra/ai-chat-retention.ts` — deletion mechanics over
   the persisted `ai_chat` store (how it acquires the store, bounded deletes,
   count-only logging).
3. `apps/mastra/src/services/langfuse-prompt-client.ts` (client posture) +
   `getLangfuseConfig()` (defined in `apps/mastra/src/config/env.ts`) — the house Langfuse HTTP posture for the trace
   half (list by `userId`, batch delete, verify-by-requery — Langfuse
   deletion is async with no completion event).
4. feat-336 (Langfuse trace retention job) — same Langfuse list/delete
   mechanics; build the shared client surface once and let both consume it.
5. `docs/plans/2026-08-11-003-feat-per-user-erasure-capability-plan.md` —
   the implementation-ready plan this ticket is being built from. It
   supersedes the proposals below wherever the two differ; the corrections
   already folded back into this file are flagged in place.

## Grep These

- `resourceId` in `src/mastra/ai-chat-*` — the erasure key's shape and the
  prefix-only convention (never split on `:`)
- `authorizeAiChatThreadAccess` — how resource ownership is modeled

## What To Build

Proposed structure (owner left one-vs-two open on 2026-08-05; this ticket
proposes ONE ticket, TWO PRs — revise here if that changes):

- **PR 1 — Postgres half:** an operator CLI script
  (`pnpm --filter @forge/mastra erase-user -- --resource=user:<sub>`) over a
  reusable module (`apps/mastra/src/mastra/ai-chat-erasure.ts`) that deletes
  the resource's threads + messages from `ai_chat`, prints count-only
  output, and gates deletion behind `--execute --confirm-database=<hash>`. A
  CLI (not an HTTP route) keeps the destructive surface off the network
  entirely. The docs deliverables ride this PR.
- **PR 2 — Langfuse half:** extend the same module to list the resource's
  traces via `GET /api/public/v2/observations` with an exact-match `userId`
  filter and `fields=core,basic` (verified 2026-08-12 against the vendor's
  OpenAPI spec plus the `@langfuse/core` 5.10.0 generated typings: `userId`
  is returned only under the `basic` field group, and the `io` group — the
  only one carrying conversation text — is never requested, so the listing
  still never buffers raw content). **The deprecated `GET /api/public/traces`
  LIST endpoint this ticket originally named must NOT be used** — it sits in
  the vendor's tightest rate bucket and feat-336's retention client bans it;
  the DELETE verb on that path is a different, still-current surface and is
  what the batch delete uses (≤50 ids per request, vendor advisory). Re-check
  every listed row's own `userId` client-side before its id may enter a
  delete batch, then submit and report per-store counts. Shares the Langfuse
  client surface with feat-336. **Quota interaction:** trace deletion is
  rate-limited per ORGANIZATION per day and shared with feat-336's sweep — an
  erasure request must never be starved by retention (GDPR "without undue
  delay"). feat-336 caps itself at 40 of the org's 50/day, leaving ≥10/day
  headroom by convention (not enforced preemption).
- Update the CLAUDE.md runbook to point at the script (keep the raw SQL as
  the break-glass fallback), and record the verify-by-requery caveat.

## Constraints

- Erasure is keyed by full `resourceId` value equality — never pattern or
  prefix deletion across users.
- Count-only output and logs; never conversation text, titles, or trace
  content.
- No new env vars; runs with the existing `DATABASE_URL` + Langfuse trio.
- Self-serve (user-initiated) deletion stays deferred — this is the
  operator capability that makes requests honorable; the product surface is
  a later ticket.

## Verification

- Unit: key-equality scoping (a `user:abc` erasure never touches
  `user:abcd`), confirm-gate refusal, per-store count reporting, requery
  bounds.
- Real-Postgres smoke against a seeded throwaway resource — a NET-NEW
  opt-in suite (`ai-chat-erasure.smoke.test.ts`, gated
  `AI_CHAT_ERASURE_SMOKE_TEST=1`, caller-supplied throwaway
  `DATABASE_URL`). **Not** the `ai-chat-pg-failmode-contract.test.ts`
  "harness pattern" this ticket originally cited: that file is an
  unreachable-STORE contract test, and no seeded real-Postgres harness
  exists in `apps/mastra` to reuse.
- Opt-in real-credential Langfuse smoke that is **READ-ONLY**. The original
  "seed a sentinel trace under a throwaway `userId`, erase, verify-by-requery
  it is gone" design is impossible: observations ingested via the legacy
  batch API never materialize on the v2 observations read surface (verified
  2026-08-11 during feat-336's first real-API contact), so a seeded sentinel
  can never be listed back. The smoke instead proves the real listing
  contract — that `fields=core,basic` genuinely returns `userId` — against
  real project data, at zero delete-quota cost. The delete surface stays
  proven by feat-336's smoke plus unit wire-shape tests.
