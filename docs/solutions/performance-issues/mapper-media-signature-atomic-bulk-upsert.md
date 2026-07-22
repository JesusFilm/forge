---
title: Mapper media-signature atomic bulk upsert
date: 2026-07-22
category: performance-issues
module: apps/yt-video-mapper-backend
problem_type: performance_issue
component: database
symptoms:
  - Media-signature persistence issued one Prisma upsert per signature and made query and transaction boundaries a measurable persistence cost
  - Persisting 288 signatures across 24 variants produced 336 Prisma query-log events in the baseline PostgreSQL benchmark
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - background_job
  - service_object
  - testing_framework
tags:
  - yt-video-mapper
  - media-signatures
  - bulk-upsert
  - postgres
  - prisma
  - on-conflict
  - atomic-write
  - performance
---

# Mapper media-signature atomic bulk upsert

## Problem

Media-signature extraction produces several rows for each catalog video variant.
Persisting those rows through individual Prisma upserts made client/database
boundaries a measurable cost in the isolated persistence path after media
extraction became faster.

During this optimization session, the Prisma query log recorded 336 events for
24 variants: 288 row upserts plus 24 `BEGIN` and 24 `COMMIT` statements. The
three-run median was 102.71 ms on PostgreSQL. This established query-boundary
amplification in the persistence path; it did not independently measure
end-to-end indexing impact.

## Symptoms

- Persistence work scaled with signature count because each signature generated
  its own upsert.
- Optimizing FFmpeg extraction exposed database chatter as the next persistence
  bottleneck to measure.
- Unit tests could prove generated SQL shape but could not prove PostgreSQL enum
  casts, conflict behavior, or statement atomicity.

## What Didn't Work

The per-signature Prisma API kept Prisma's typed upsert interface but still
issued one upsert per signature. The indexer already passes one variant's
signatures to the repository together, providing the batch boundary
(`apps/yt-video-mapper-backend/src/services/media-indexing.ts`).

In this optimization session's local 24-variant, 12-signature-per-variant
benchmark, typed-array `UNNEST` measured a 13.39 ms median versus 14.09 ms for
the retained multi-row `VALUES` design. Both used 24 statements and passed the
same checks. The 5% difference did not clear the predeclared 10% threshold, so
the experiment was reverted because its positional-array coupling and casts
were not justified here. This is not evidence that `VALUES` universally
outperforms `UNNEST`; remeasure when batch size, payload shape, client, or
network changes.

## Solution

### Deduplicate against the database identity

Before building SQL, deduplicate input rows with a structured tuple containing:

1. `coreId`;
2. `videoVariantId`;
3. `signatureType`;
4. `algorithmVersion`;
5. `offsetMilliseconds`.

The tuple is serialized with `JSON.stringify` and inserted into a `Map`, giving
expected O(n) deduplication time and O(u) additional memory for n inputs and u
unique identities. Later assignments replace earlier values, so duplicate input
follows an explicit last-input-wins rule without delimiter-collision risk
(`apps/yt-video-mapper-backend/src/services/media-indexing.ts`). This tuple
matches the Prisma unique constraint
(`apps/yt-video-mapper-backend/prisma/schema.prisma`).

Pre-deduplication prevents repeated identities in replay data from raising a
PostgreSQL cardinality error: one `INSERT ... ON CONFLICT` statement cannot
affect the same conflict row twice.

### Execute one bound statement per variant

The current indexer calls the repository once per variant. The default visual
extractor caps that call at 12 signatures, or at most 120 bindings, but the
repository does not enforce that limit. SQL construction and bind payload size
therefore grow linearly with unique rows supplied by future callers. The
repository maps the deduplicated rows into `Prisma.sql` fragments, combines them
with `Prisma.join`, and executes one parameterized multi-row statement
(`apps/yt-video-mapper-backend/src/services/media-indexing.ts`):

```sql
INSERT INTO mapper_media_signature (...)
VALUES (...), (...), (...)
ON CONFLICT (
  core_id,
  video_variant_id,
  signature_type,
  algorithm_version,
  offset_milliseconds
) DO UPDATE SET
  duration_milliseconds = EXCLUDED.duration_milliseconds,
  signature = EXCLUDED.signature,
  source_media_url = EXCLUDED.source_media_url,
  source_media_hash = EXCLUDED.source_media_hash;
```

Every dynamic value remains a Prisma binding. Signature types are mapped to
their database enum spellings and cast to `signature_type`; serialized payloads
are cast to `jsonb`. New rows receive an explicit UUID, while `created_at` uses
its database default.

The conflict update changes only mutable extraction and provenance fields. It
does not update `id` or `created_at`, so re-indexing the same identity refreshes
the payload without identity churn. The schema already had the matching unique
constraint and column types, so this optimization required no migration
(`apps/yt-video-mapper-backend/prisma/schema.prisma`). Empty input remains a
no-op.

### Keep one variant atomic

Because the indexer persists each variant in one SQL statement, PostgreSQL
accepts or rejects the whole variant write without an application-managed
transaction.

The executable harness proves that behavior by combining a valid row and an
out-of-range integer in one call, observing statement rejection, and confirming
that the variant retains zero rows. It also verifies:

- exact inserted rows;
- replay updates with stable `id` and `created_at`;
- nullable values being cleared;
- last-input-wins duplicates;
- hostile-looking text being stored as data rather than SQL;
- database operation count reported beside variants persisted.

Those checks run through `PrismaMediaIndexRepository` against PostgreSQL
(`apps/yt-video-mapper-backend/src/scripts/measure-signature-persistence.ts`).
The faster recording-client test separately checks one-call execution, enum and
JSON casts, explicit IDs, null bindings, parameterization, and duplicate behavior
(`apps/yt-video-mapper-backend/src/services/media-indexing.prisma.test.ts`).

During the optimization session, PostgreSQL 18.4 measured the retained design at
a 14.09 ms median and 24 query-log events for 24 variants and 288 signatures.
That was an 86.3% reduction and 7.29x speedup over the 102.71 ms, 336-event
baseline. Across three local runs, baseline and retained relative spreads were
19.21% and 43.29%. The harness used sequential writes against a freshly recreated
table without production foreign keys, secondary indexes, network latency,
extraction, or indexing concurrency. Treat the timing as session-local evidence;
the 336-to-24 query-boundary reduction and reported correctness checks are the
durable result.

## Why This Works

The original cost came from repeated client/database work, not PostgreSQL's
ability to insert a few hundred small rows. Batching amortizes query construction,
network exchange, planning, and execution across all signatures for a variant
while preserving the same conflict identity.

Explicit casts make the raw-SQL boundary visible, and parameterized `Prisma.sql`
fragments keep data out of SQL text. A restricted update list preserves immutable
row identity and creation time. A variant-sized statement gives each variant an
all-or-nothing persistence result: either every signature produced for that
variant is durable, or none is.

For this benchmark, query-log event count is the durable performance signal.
Wall-clock measurements below 20 ms were noisy, while the measured boundary fell
from 336 events to one statement per variant. Batching removes client/query
boundary amplification; serialization, bind payload, conflict checking, and
server row work still scale with unique signature count.

## Prevention

- Keep the conflict identity synchronized across the Prisma unique constraint,
  the in-memory deduplication tuple, and the SQL `ON CONFLICT` target. Test all
  three when any identity field changes.
- Preserve last-input-wins deduplication before a multi-row upsert. Duplicate
  conflict keys in one statement are an error, not an implicit merge rule.
- Keep dynamic values in `Prisma.sql` bindings and retain explicit enum and
  `jsonb` casts. SQL-shape tests should prove hostile-looking values never enter
  SQL text.
- Require a real-PostgreSQL smoke for raw-SQL changes. A recording client cannot
  validate casts, constraints, conflicts, or engine atomicity.
- Keep one variant as the statement boundary while signature counts remain
  bounded. Each unique row currently contributes ten bindings. If a variant can
  approach active Prisma/PostgreSQL bind or practical payload limits, chunk only
  inside one transaction so all chunks commit or roll back together. Independent
  chunk commits are unsafe while resume logic treats any existing signature row
  as a completed variant; they require an explicit completeness marker or a
  redesigned skip contract first.
- Re-measure before replacing `VALUES` with `UNNEST`. Positional arrays earn
  their complexity only when a representative benchmark shows a material gain.
- Track query-log event count beside elapsed time so sub-20 ms noise cannot hide
  a regression back to row-oriented writes. Also monitor unique rows and bound
  payload size per variant as new signature types are added.

## Related Issues

- [Mapper long-media targeted FFmpeg seeking](mapper-long-media-targeted-ffmpeg-seeking.md)
- [Mapper official media signature indexing pattern](../architecture-patterns/mapper-official-media-signature-indexing-pattern.md)
- [pgvector bulk INSERT with ON CONFLICT](../database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md)
- [Admin Core Sync high-volume bulk upsert pattern](admin-core-sync-high-volume-root-phase-bulk-upsert-20260507.md)
- [Core Sync bulk UPDATE via temp table](../cms/core-sync-bulk-update-temp-table-pattern.md)
- [Prisma raw-SQL invariant assertions](../best-practices/prisma-raw-sql-invariant-assertions-20260423.md)
- [Prisma raw-SQL enum mapping seam](../database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md)
- [PostgreSQL prepared-statement bind limit](../database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md)
- [Mocked-shape-vs-real-contract testing discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
