---
id: "feat-756"
title: "Watch search transcript publication health evidence"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-10-22"
duration: 1
depends_on:
  - "feat-465"
blocks: []
tags:
  - "admin"
  - "search"
  - "embeddings"
  - "typesense"
  - "reliability"
---

## Problem

The incremental transcript publication outbox (feat-462, feat-465) durably
records whether an accepted canonical transcript replacement reached
Typesense, but no operator-facing surface reads that evidence. Operators have
no way to see the current projection revision, whether the outbox is
draining, how old the oldest pending event is, or which transcripts are
dead-lettered — the exact "operators currently lack durable evidence" gap the
parent incremental-publication epic names.

## Entry Points — Read These First

1. `apps/admin/src/services/typesense-watch-search-transcript-publication.ts` —
   `loadWatchSearchTranscriptPublicationHealth` reads the outbox and
   projection tables read-only.
2. `apps/admin/src/app/dashboard/search/transcript-publication/page.tsx` — the
   read-only operator dashboard.
3. `apps/admin/src/app/dashboard/search/page.tsx` — "Publication health" link.
4. `apps/admin/prisma/schema.prisma` —
   `WatchSearchCurrentTranscriptPublicationEvent` and
   `WatchSearchCurrentTranscriptProjection` (unchanged by this slice).

## Grep These

- `loadWatchSearchTranscriptPublicationHealth`
- `WATCH_SEARCH_TRANSCRIPT_PUBLICATION_STALE_MS`
- `recentDeadLetters`

## What To Build

- A read-only health query over the existing outbox/projection tables:
  current projection revision and binding, pending/claimed/dead-letter counts,
  oldest pending event age, a 15-minute staleness flag, and up to 20 most
  recent dead-lettered transcripts by identity (transcript/video/edition/
  language), work kind, attempt count, and already-redacted error-class code.
- A dashboard page rendering that evidence for operators, linked from the
  existing Watch Search dashboard.

## Constraints

- Read-only: never claim, mutate, or retry outbox rows from this surface.
- Never surface vectors, transcript text, document ids, or raw error messages
  — only identity, counts, timestamps, and the already-redacted error-class
  code the publisher persists.
- Do not change the publication, convergence, or dead-letter mechanics built
  by feat-462/feat-465.

## Verification

- `pnpm --filter @forge/admin test -- src/services/typesense-watch-search-transcript-publication.test.ts src/app/dashboard/search/transcript-publication/page.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
