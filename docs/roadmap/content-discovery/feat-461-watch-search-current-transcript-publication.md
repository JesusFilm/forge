---
id: "feat-461"
title: "Watch search current transcript publication"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-03"
duration: 1
depends_on:
  - "feat-451"
blocks: []
tags:
  - "admin"
  - "search"
  - "embeddings"
  - "typesense"
---

## Problem

Watch Search already has a shared active transcript collection, but Admin does
not yet publish changed canonical transcripts into it incrementally. Without a
transactional outbox, dedicated publisher, and real readback verification,
transcript changes stay invisible to the real Watch Search reader unless a
larger rebuild or candidate flow runs.

## Entry Points — Read These First

1. `apps/admin/src/services/transcript-embedding-ingest.service.ts` — canonical transcript ingest transaction and outbox event creation.
2. `apps/admin/src/services/transcript-embedding.service.ts` — transcript replacement write path, stable chunk ids, and stale-chunk detection.
3. `apps/admin/src/services/typesense-watch-search-transcript-publication.ts` — claim, publish, read back, fingerprint, and projection advancement flow.
4. `apps/admin/src/services/typesense-watch-search.service.ts` — real Watch Search reader that must see the published transcript afterward.
5. `apps/admin/prisma/migrations/0077_watch_search_current_transcript_publication/migration.sql` and `apps/admin/prisma/schema.prisma` — `source_generation`, projection state, and publication event schema.
6. `apps/admin/src/services/typesense-watch-search-transcript-publication.db.test.ts` — real Postgres plus controlled Typesense seam coverage for ingest-to-search behavior.

## Grep These

- `sourceGeneration`
- `watchSearchCurrentTranscriptPublicationEvent`
- `WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED`
- `publishOneCurrentTranscriptToWatchSearch`
- `projectionRevision`

## What To Build

- Increment `video_transcript.source_generation` whenever canonical transcript
  content changes, and commit the replacement plus one publication event in the
  same transaction.
- Persist publication events with transcript identity, exact compatibility
  evidence, current chunk document ids, and stale chunk document ids, but never
  copy vectors into the outbox.
- Add a disabled-by-default worker that claims the latest event batch for one
  transcript, reloads canonical chunks from Postgres, upserts them into the
  active Typesense transcript collection, validates every JSONL response line,
  independently reads the exact documents back, and removes stale ids.
- Advance exactly one current transcript projection revision only when canonical
  and projected fingerprints match, and complete the claimed event batch
  atomically.
- Prove the real Watch Search reader cannot retrieve the fixture before
  publication and can retrieve it afterward without rebuild, shadow
  collections, qualification, or promotion.

## Constraints

- Do not rebuild or rotate the shared transcript collection for this slice.
- Do not copy vectors into the publication-event payload.
- Do not qualify or promote a Watch Search candidate to publish the current
  transcript path.
- Do not hand-edit generated GraphQL artifacts.

## Verification

```bash
WATCH_SEARCH_DB_TEST=1 pnpm --filter @forge/admin test -- src/services/typesense-watch-search-transcript-publication.db.test.ts
pnpm --filter @forge/admin test -- src/services/typesense-client.test.ts src/instrumentation.test.ts
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin db:migrate:deploy
pnpm prettier --check docs/roadmap/content-discovery/feat-451-watch-search-candidate-exact-compatibility-identities.md docs/roadmap/content-discovery/feat-461-watch-search-current-transcript-publication.md
```
