---
id: "feat-337"
title: "Per-user erasure across Langfuse traces and ai_chat Postgres"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-08-10"
duration: 3
depends_on:
  - "feat-321"
blocks:
  - "feat-339"
tags:
  - "ai-pipeline"
  - "infrastructure"
---

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
1. `apps/mastra/CLAUDE.md` → "Operator deletion runbook" — the existing
   Postgres SQL this capability replaces/automates (threads + messages by
   `resourceId`; plus `ai_chat.mastra_resources` if working memory ever
   lands).
2. `apps/mastra/src/mastra/ai-chat-retention.ts` — deletion mechanics over
   the persisted `ai_chat` store (how it acquires the store, bounded deletes,
   count-only logging).
3. `apps/mastra/src/services/langfuse-prompt-client.ts` (client posture) +
   `getLangfuseConfig()` (defined in `apps/mastra/src/config/env.ts`) — the house Langfuse HTTP posture for the trace
   half (list by `userId`, batch delete, verify-by-requery — Langfuse
   deletion is async with no completion event).
4. feat-336 (Langfuse trace retention job) — same Langfuse list/delete
   mechanics; build the shared client surface once and let both consume it.

## Grep These

- `resourceId` in `src/mastra/ai-chat-*` — the erasure key's shape and the
  prefix-only convention (never split on `:`)
- `authorizeAiChatThreadAccess` — how resource ownership is modeled

## What To Build

Proposed structure (owner left one-vs-two open on 2026-08-05; this ticket
proposes ONE ticket, TWO PRs — revise here if that changes):

- **PR 1 — Postgres half:** an operator CLI script
  (`pnpm --filter @forge/mastra erase-user -- --resource "user:<sub>"`)
  that deletes the resource's threads + messages from `ai_chat`, prints
  count-only output, and requires an explicit `--confirm` token. A CLI (not
  an HTTP route) keeps the destructive surface off the network entirely.
- **PR 2 — Langfuse half:** extend the same script to list the resource's
  traces (`GET /api/public/traces?userId=...` — an EXACT-match filter, which
  is what makes the key-equality constraint below expressible; paginate, and
  pin `fields=core` so the listing never buffers raw conversation text),
  batch-delete them (≤50 ids per request, vendor advisory), then re-query
  until empty or a bounded retry ceiling (async deletion), reporting
  per-store counts. Shares the Langfuse client surface with feat-336.
  **Quota interaction:** trace deletion is rate-limited per ORGANIZATION per
  day and shared with feat-336's sweep — an erasure request must never be
  starved by retention (GDPR "without undue delay"). Reserve headroom or
  have the sweep yield; confirm the project's tier limits at build time.
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
  `user:abcd`), confirm-token gate, per-store count reporting, requery loop
  bounds.
- Real-Postgres smoke against a seeded throwaway resource (the
  `ai-chat-pg-failmode-contract.test.ts` harness pattern).
- Opt-in real-credential Langfuse smoke: seed a sentinel trace under a
  throwaway `userId`, erase, verify-by-requery it is gone.
