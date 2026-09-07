# ADR-0017 — Bounded concurrent document ingestion

- Status: Accepted
- Date: 2026-08-07
- Issue/PR: —
- Related: [ADR-0003](./0003-data-access-drizzle-query-builder.md) (persistence
  mechanism superseded in Forge),
  [ADR-0015](./0015-embedding-gateway-primary-openrouter-fallback.md)

**Forge migration note.** Forge names this context `indexing`. The worker-pool
policy lives in `src/indexing/ingest.ts`; the CLI bounds concurrency to 1–4 in
`scripts/lib/maintenance-args.ts`; Prisma plus bounded raw SQL implements the
transactional replacement and bulk inserts.

## Context

`ingestPending` processed each raw document completely before starting the next:
dedup read, embedding request, atomic corpus replacement, then staging-row update.
Recent production jobs took 18–27 minutes for 60–130 documents. A controlled local
benchmark confirmed that the serialized external waits dominate wall time and that
the adapter also paid two sequential SQL inserts per chunk.

## Decision

Ingestion processes distinct `(sourceKey, canonicalUrl)` identities through a
configurable bounded worker pool. It upserts every participating source before
releasing workers, preserves input order for duplicate rows targeting the same
canonical identity, stops scheduling after the first failure, waits for already
running work, and marks each raw row only after its own document finishes.

`replaceDocument` keeps its existing per-document delete-and-replace transaction,
but writes all chunks in one multi-row insert and all embeddings in a second
multi-row insert. Initial concurrency must remain below the five-connection
Postgres pool; production starts conservatively and is raised only from measured
embedding-provider and database telemetry.

## Alternatives rejected

- **Keep strictly sequential ingestion** — simplest failure ordering, but leaves
  embedding and database round-trip latency completely unpipelined; the prototype
  improved the representative workload from 7.11 to about 30 documents/second.
- **Unbounded `Promise.all` over documents** — maximizes overlap but provides no
  backpressure for the embed server, fallback provider, database pool, or memory.
- **Combine chunks from multiple documents into shared embedding requests** — may
  fill provider batches better, but expands one request failure across documents
  and complicates vector-to-document mapping. Bounded document calls capture most
  of the measured gain while retaining per-document failure isolation.
- **Batch staging marks across documents** — saves a small update cost but widens
  the crash window in which successful documents remain pending. Per-row marking
  is retained because replacement is already the materially expensive operation.

## Consequences

- (+) Embedding and database waits overlap with explicit backpressure; the local
  60-document prototype was about 4.2× faster end to end than the original loop.
- (+) Bulk inserts remove per-chunk database round trips without weakening the
  atomic delete-and-replace invariant.
- (+) Source readiness, duplicate identity ordering, and failure-drain semantics
  are explicit and testable rather than incidental properties of a `for` loop.
- (−) Progress lines complete out of input order, and simultaneous retries or
  provider fallbacks can amplify load up to the configured concurrency.
- (−) The safe production cap is operational, not universal: provider capacity,
  document size, database contention, and the connection pool must be observed.
