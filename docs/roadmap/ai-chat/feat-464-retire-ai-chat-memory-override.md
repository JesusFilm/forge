---
id: "feat-464"
title: "Retire the AI-chat memory override"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-09-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

`AI_CHAT_MEMORY_BACKEND` can override the shared Mastra storage policy and put
AI-chat conversations into process memory even while the UI presents durable
history. That mode can hide existing Postgres history, disable rename, and
restore the heap-growth risk that the Postgres migration removed. Production
does not use the override, so retaining it creates operational ambiguity
without supporting the deployed configuration.

The implementation-ready contract is
`docs/plans/2026-09-08-0350-refactor-ai-chat-memory-override-plan.md`. It retires
the override without changing the dedicated `ai_chat` schema, stored rows,
retention, erasure, ownership, or thread-key contracts.

## Entry Points — Read These First

1. `docs/plans/2026-09-08-0350-refactor-ai-chat-memory-override-plan.md` — the
   authoritative product and implementation contract; execute U1–U4 after this
   roadmap record exists.
2. `apps/mastra/src/config/env.ts` — the shared backend parser, retired override
   resolver, persistence predicate, and production memory-backend assertion.
3. `apps/mastra/src/mastra/ai-chat-memory.ts` — the dedicated Postgres and
   in-memory store construction that must keep the `ai_chat` boundary.
4. `apps/mastra/src/mastra/ai-chat-history-write-route.ts` — the rename gate
   whose `writes_disabled` response must remain stable under shared memory mode.
5. `apps/mastra/src/mastra/ai-chat-retention.ts`,
   `apps/mastra/src/mastra/workflows/title-repair.ts`, and
   `apps/mastra/src/mastra/ai-chat-erasure.ts` — lifecycle consumers with
   distinct durable-store obligations.
6. `docs/solutions/workflow-issues/mechanism-retirement-docs-prose-sweep.md` —
   the active-versus-historical documentation classification pattern.

## Grep These

- `AI_CHAT_MEMORY_BACKEND` — remove executable and active-guidance references;
  classify intentional historical references with adjacent dated supersession
  notes.
- `resolveAiChatMemoryBackend|canAiChatDataPersist` — collapse backend selection
  to the shared setting while preserving the named persistence predicate.
- `MASTRA_STORAGE_BACKEND` — the sole AI-chat storage selector after this work.
- `writes_disabled|persistence_unavailable` — preserve the rename contract and
  retire the unreachable title-repair skip reason.
- `SEEKER_ROUTE_ENABLED` — the supported incident stop for the custom Forge
  AI-chat routes, not an ephemeral-storage substitute.

## What To Build

- Remove `AI_CHAT_MEMORY_BACKEND` from parsed configuration and executable
  selection. Derive AI-chat memory mode only from `MASTRA_STORAGE_BACKEND`.
- Preserve the dedicated `PostgresStore` identity and `ai_chat` schema in
  Postgres mode, and the dedicated process-local `InMemoryStore` in shared
  memory mode. Never fall back to memory after a Postgres failure.
- Keep shared-memory local behavior construction-free for Postgres-only rename,
  retention, and title-repair paths. Keep erasure explicitly targeting durable
  Postgres rows with an explicit `DATABASE_URL`.
- Rewrite current comments, app guidance, and solution guidance to name the
  shared selector. Preserve completed tickets and plans as historical records,
  adding a dated supersession note wherever retired operational advice could be
  mistaken for current behavior.
- Document deployment cleanup: no schema or row migration is needed; a stale
  deployed `AI_CHAT_MEMORY_BACKEND` is inert and should be removed to avoid
  false operator confidence. `SEEKER_ROUTE_ENABLED=false` remains the incident
  stop for custom Forge AI-chat routes, while the native Mastra agent surface
  remains contained by the existing network and gateway boundary.

## Constraints

- Do not reuse the general Mastra runtime store for AI-chat data or change the
  `ai_chat` schema, store identity, pool cap, lazy singleton, thread keys, or
  cross-agent sharing contract.
- Do not add an automatic Postgres-to-memory fallback or another production
  persistence kill switch.
- Do not change stored rows, retention policy, erasure behavior, ownership,
  rename response vocabulary, history APIs, or UI disclosures.
- Do not rewrite historical rationale as though the retired mechanism never
  existed; classify it according to present authority.

## Verification

- Run `pnpm --filter @forge/mastra test`, `typecheck`, `lint`, and `build`.
- Run the plan's focused environment, memory, fail-mode, history-write,
  retention, title-repair, erasure, and Seeker-agent tests.
- Prove a stale `AI_CHAT_MEMORY_BACKEND=memory` value cannot override
  `MASTRA_STORAGE_BACKEND=postgres`, and that production still rejects the
  shared memory backend.
- Prove Postgres mode retains the dedicated `ai_chat` store and fails without
  in-memory fallback; prove shared memory mode constructs no Postgres store or
  pool on paths that must skip or refuse.
- Sweep living guidance for retired-selector advice and confirm every retained
  historical reference has an adjacent dated supersession note.
- Confirm no schema, migration, lockfile, or generated artifact changed, then
  complete this ticket with a Resolution and update this lane index in the code
  PR.

## Resolution

- Removed `AI_CHAT_MEMORY_BACKEND` from application configuration and made
  `MASTRA_STORAGE_BACKEND` the sole AI-chat storage selector. Postgres mode
  still uses the dedicated `ai_chat` schema; local and CI memory mode still
  uses the dedicated process-local AI-chat store.
- Preserved fail-closed Postgres behavior, rename's `writes_disabled` contract,
  ownership enforcement, retention, title repair, and explicit durable-store
  erasure. No schema, row, migration, lockfile, or generated artifact changed.
- Updated living guidance and added dated supersession notes to historical
  records. Production was confirmed not to set the retired variable; any stale
  value in another deployed environment is inert and should be removed to avoid
  false operator confidence.
- Verified the Mastra package with 3,111 passing tests (32 opt-in smoke tests
  skipped), type-check, lint, and production build. The Compound code review
  found no actionable defects, and the Codex-agent security verdict was READY
  with no high-confidence vulnerability or public-repository exposure finding.
