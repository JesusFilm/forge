---
id: "feat-208"
title: "Postgres-persisted Seeker memory + conversation persistence"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-07-10"
duration: 5
depends_on:
  - "feat-205"
blocks:
  - "feat-209"
tags:
  - "ai-pipeline"
  - "infrastructure"
---

> **Thin stub — not yet investigated.** Needs its own brainstorm/plan before
> implementation. It captures the persistence follow-on surfaced during the
> feat-205 brainstorm. Read
> `docs/brainstorms/2026-06-25-chat-wire-seeker-route-requirements.md`
> (Scope Boundaries, Dependencies / Assumptions) first.

## Problem

Seeker memory is an in-memory singleton today (lost on Mastra restart), and the
chat app keeps conversation history client-side (lost on browser refresh). So
multi-turn recall is fragile and there is no sidebar of past conversations. This is
a documented deferred release gate in `apps/mastra/CLAUDE.md` and feat-204.

## What this unlocks (carried over from the feat-205 brainstorm)

- **Durable Seeker memory** on Postgres (admin already proves the path for the
  experience-chat agent), keyed by `(resourceId, threadId)`.
- **Conversation persistence** — because Mastra's persisted memory is a queryable
  per-`(resourceId, threadId)` message store (`getThreadById`, list-threads-by-
  resource), it can double as the store that rebuilds a user's sidebar of past
  conversations and restores a conversation on load — likely with no separate
  chat-side database.
- Resolves the feat-205 multi-turn-recall contingency (the never-created-thread
  throw + Mastra-restart-drops-thread failure modes) by giving threads a durable
  home.

## Constraints

- Mastra-owned generation/storage split stays as documented; admin/Mastra ownership
  boundaries unchanged.
- Genuinely useful only once `resourceId = userId` exists — pairs with feat-207
  (auth), though it can land technically under the shared default resource first.
- **Consider (non-binding):** decide whether seeker memory needs a retention/prune
  policy at all (thread TTL and/or per-thread message cap) — or whether we simply
  keep all conversations indefinitely, which is a valid choice. This is the residue
  of feat-202's deferred in-memory eviction (item ②): moving to Postgres eliminates
  the heap-OOM risk, leaving only ordinary table growth. Not a release gate — flag
  the question for this ticket's own brainstorm. See
  `docs/brainstorms/2026-06-29-seeker-rag-runtime-hardening-requirements.md`.

## Verification

- To be defined in this ticket's own brainstorm/plan.
