---
id: "feat-331"
title: "Devotional video matcher calls a deleted admin search endpoint"
owner: "unassigned"
priority: "P2"
status: "not-started"
start_date: "2026-09-01"
duration: 2
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "search"
---

## Problem

The daily-devotional pipeline's video matcher
(`apps/mastra/src/services/devotional/video-matcher.ts`) resolves its clip via
`callAdminEvalSearch`, which posts to `ADMIN_SEARCH_EVAL_SEARCH_URL` — admin's
offline-search-eval search route. That route was DELETED in PR
[#1622](https://github.com/JesusFilm/forge/pull/1622) (only `candidates` and
`catalog-context` remain under `apps/admin/src/app/api/internal/search-eval/`).
The matcher's never-throw design means every run silently 404s and degrades to
the configured `DEVOTIONAL_DEFAULT_VIDEO_ID` fallback clip — devotionals ship
with the same default video every day and nothing alerts. The offline
search-eval workflow (`apps/mastra/src/services/offline-search-eval/`) is dead
against production for the same reason.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/video-matcher.ts` — the always-a-clip
   fallback ladder (`search` → `fallback` → `none`) and the never-throw
   degradation hiding the 404.
2. `apps/mastra/src/services/admin-search-eval-client.ts` —
   `callAdminEvalSearch` (the dead transport).
3. `apps/mastra/src/config/env.ts` — `ADMIN_SEARCH_EVAL_SEARCH_URL` +
   `getDevotionalVideoSearchConfig`.
4. `apps/admin/src/app/api/internal/search-eval/` — what actually remains.
5. `apps/admin/src/services/experience-ai/agent-tools.service.ts` — the live
   bearer-gated search surface (`/api/internal/agent-tools/search-videos`,
   watchSearch-backed) — the obvious repoint target, provisioned end-to-end
   since 2026-07-29.

## Grep These

- `callAdminEvalSearch` (all callers — matcher + offline eval runner)
- `ADMIN_SEARCH_EVAL_SEARCH_URL` (env + config plumbing)
- `videoMatch` / `fallbackResult` in the devotional services
- `search-eval` under `apps/admin/src/app/api/internal/`

## What To Build

Repoint the devotional video matcher at a LIVE search surface — the
agent-tools search-videos endpoint is the natural candidate (bearer-gated,
watchSearch-backed, already returns playable rows with `playbackId` +
`availability.kind`). Decide and document:

- Whether the matcher's relevance-threshold semantics map onto watchSearch
  scores, or the threshold needs recalibration.
- Whether the offline-search-eval loop is repointed in the same change or
  explicitly retired (if retired, follow the retirement prose-sweep
  discipline for its docs/env rows).
- Add a degradation SIGNAL: the silent-404→fallback path should log an
  enum event so a dead endpoint is observable next time.

## Constraints

- Keep the always-a-clip contract: search failure still degrades to the
  configured fallback, never a thrown error.
- Receiver-first key discipline if a new bearer lane is involved.
- Do not resurrect the deleted admin route.

## Verification

- A real-service smoke: the matcher returns a genuine search hit (not the
  fallback) for a query with an obvious library match.
- Unit fixtures cover: live hit above threshold, below threshold →
  fallback, endpoint failure → fallback + the new degradation log.
- Env/docs sweep: `ADMIN_SEARCH_EVAL_SEARCH_URL` rows in
  `apps/mastra/CLAUDE.md` updated to match the outcome.
