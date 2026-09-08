---
id: "feat-465"
title: "Watch search transcript publication convergence"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-08"
duration: 1
depends_on:
  - "feat-462"
blocks: []
tags:
  - "admin"
  - "search"
  - "embeddings"
  - "typesense"
  - "reliability"
---

## Problem

Incremental transcript publication has a durable outbox and verified Typesense
readback, but its terminal and deletion paths do not yet form a complete
convergence protocol. Candidate evaluation contention currently happens after
claim mutation, permanently failing work can retry forever, and the canonical
transcript foreign-key cascade can erase the only exact document evidence
needed to remove an already published transcript.

## Entry Points — Read These First

1. `apps/admin/src/services/typesense-watch-search-transcript-publication.ts` — skip-locked claims, Typesense mutation ordering, verification, retry release, and fenced completion.
2. `apps/admin/src/services/transcript-embedding-ingest.service.ts` — replacement transaction, source generation, and immutable current/stale document evidence.
3. `apps/admin/src/services/typesense-client.ts` — exact JSONL import result validation.
4. `apps/admin/src/services/typesense-watch-search-candidate-generation.ts` — candidate evaluation leases that fence current publication.
5. `apps/admin/prisma/schema.prisma` and `apps/admin/prisma/migrations/0081_watch_search_transcript_publication_convergence/migration.sql` — terminal state and lifecycle evidence retention.
6. `apps/admin/src/services/typesense-watch-search-transcript-publication.db.test.ts` — real PostgreSQL concurrency and controlled Typesense failure seam.

## Grep These

- `claimNextTranscriptPublicationBatch`
- `leaseGeneration|leaseTokenHash|FOR UPDATE SKIP LOCKED`
- `currentDocumentIds|staleDocumentIds|sourceGeneration`
- `importDocuments|deleteStaleTranscriptDocuments|readBackTranscriptDocuments`
- `assertCurrentPublicationAllowed|WatchSearchCandidateLease`
- `DEAD_LETTER|LIFECYCLE`

## What To Build

- Coalesce claimable events by transcript around the newest canonical source
  generation, while carrying the union of exact stale-document evidence until
  a verified cleanup completes.
- Keep replacement ordering as complete current-document upsert followed by
  exact stale deletion. Treat any failed JSONL result, delete failure, or
  independent readback mismatch as a failed attempt that cannot complete or
  advance the projection.
- Fence completion by skip-locked claim generation and token so an expired
  worker cannot commit after a newer claim. Reconcile ambiguous PostgreSQL
  completion acknowledgements and replay proven rollbacks idempotently so one
  source publication advances one revision exactly once.
- Check active evaluation leases before claim mutation. Return and record the
  blocked duration, leave attempts and event state untouched, and schedule the
  worker after the lease expiry.
- Move bounded repeated failures to a dead-letter status while retaining every
  immutable identity and exact cleanup document id for a later superseding
  repair.
- Detach publication evidence from the canonical transcript cascade. On
  canonical transcript deletion, persist lifecycle cleanup work carrying the
  video, edition, language, transcript, embedding-contract, chunking, and exact
  document identities, then delete and verify those Typesense documents
  idempotently.

## Constraints

- Never delete stale ids until every current chunk upsert result succeeded.
- Never advance the durable projection before complete independent readback.
- Do not put vectors or transcript text in publication events.
- Preserve the shared PostgreSQL publication lock and candidate lease fencing.
- Dead-lettering is terminal for automatic retries, not evidence deletion.
- Canonical deletion prefers a temporary search gap over retaining a document
  that can no longer be repaired from canonical Postgres.

## Verification

- Run `WATCH_SEARCH_DB_TEST=1 pnpm --filter @forge/admin test -- src/services/typesense-watch-search-transcript-publication.db.test.ts` against real PostgreSQL.
- Run focused transcript publication, ingest, Typesense client, candidate lease,
  Prisma schema, migration, lint, and typecheck checks.
- Exercise partial JSONL success, delete failure, readback drift, crash reclaim,
  lease takeover, database completion failure, evaluation contention,
  dead-lettering, superseding repair, and canonical cascade lifecycle cleanup.
- Run `pnpm --filter roadmap generate:readme` and
  `pnpm --filter roadmap lint` after roadmap metadata changes.
