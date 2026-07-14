---
id: "feat-250"
title: "Migrate /forge-seeker onto the dedicated ai-chat lane service key"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-08-03"
duration: 1
depends_on:
  - "feat-241"
blocks: []
tags:
  - "web"
  - "infrastructure"
---

## Problem

feat-241 minted a dedicated lane bearer for the ai-chat read surface: the two
history routes validate only against `AI_CHAT_SERVICE_API_KEYS`, so the shared
`MASTRA_SERVICE_API_KEYS` pool (whose other holders — admin, manager — run
unrelated embedding/eval pipelines) never gains bulk conversation-read access.
The send path, `POST /forge-seeker`, still validates against the shared pool,
so a leaked pool key can still send turns into (and read streamed replies
from) arbitrary resources. Finish the carve-out: move `/forge-seeker` onto the
same lane key so ONE narrow credential covers the whole ai-chat lane and the
pool's blast radius no longer touches conversation data at all.

## Stub — flesh out before starting

Deliberately thin placeholder, not committed work. The expected shape is a
zero-downtime dual-accept rotation (nothing in the data layer references the
key — rotation cannot affect stored threads):

1. Mastra: `/forge-seeker` accepts `AI_CHAT_SERVICE_API_KEYS` **or**
   `MASTRA_SERVICE_API_KEYS` (dual-accept window), deploy.
2. Chat flips to presenting the lane key on the seeker proxy
   (consolidate `SEEKER_MASTRA_API_KEY` into `AI_CHAT_MASTRA_API_KEY`).
3. Any other internal dogfooding callers of `/forge-seeker` (the
   `SEEKER_DEFAULT_RESOURCE_ID` audience) get the lane key.
4. Mastra drops pool acceptance on `/forge-seeker`; the boot-time
   CSV-disjointness assertion from feat-241 stays true throughout.

Grep starters: `MASTRA_SERVICE_API_KEYS`, `AI_CHAT_SERVICE_API_KEYS`,
`SEEKER_MASTRA_API_KEY`, `isValidServiceBearer`. Decision context: feat-241's
plan (`docs/plans/2026-07-13-001-feat-chat-server-history-sidebar-plan.md`,
KTD2) and `docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md`.
