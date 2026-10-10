---
title: "Serial curated metadata reads consume the cold-start delivery budget"
date: "2026-09-15"
category: "performance-issues"
module: "Admin source-free recommendation delivery"
problem_type: "performance_issue"
component: "service_object"
severity: "high"
symptoms:
  - "Cold-start delivery expires in curated_candidates or issuance after an Admin restart."
  - "The same language succeeds once startup load subsides."
root_cause: "async_timing"
resolution_type: "code_fix"
tags: ["recommendations", "curation", "postgresql", "round-trips", "deadline"]
---

## Cause

Production trace `6aa892480000000032b6ea5e97a96d41` on revision `dfbea3507...`
exceeded a remaining 642 ms curated transaction budget. Expanded spans show
separate pointer, generation, locale-pool and membership reads around live
video hydration. Trace `6aa89241000000006ef6975c861bba33` completed curated
retrieval in 730 ms, leaving too little time for atomic issuance. The latter
already batches served items into one INSERT: per-card inserts were a rejected
hypothesis, not the cause.

Small SQL statements still incurred tens of milliseconds of round-trip and
runtime overhead under startup load. Repeated metadata calls consumed the
1.5-second overall delivery budget despite no individual expensive query.
Later steady-state English/Spanish production probes served six cards in
761–892 ms including network transit; that did not disprove the cold failures.

## Fix

`apps/admin/src/services/recommendations/curated-pools.runtime.ts` reads the
active generation, at most nine exact locale/audio pools and relevant
membership metadata in one PostgreSQL statement. The service derives interest
support and editorial ranks from that snapshot. Pool order, starter reserve,
exact-language matching, requested count and canonical deduplication are
unchanged. Every request still hydrates current video publication, restrictions,
playback, artwork and embedding identity. No publication cache, schema change,
new identity behavior or deadline increase is introduced.

The native Prisma cold-start path uses five SQL statements including BEGIN,
local timeout configuration and COMMIT, down from eight. With the production
Postgres adapter, Prisma's query events omit BEGIN: cold-start events fall from
seven to four and interest-bearing reads from eight to four. Do not mix these
counting methods when reporting the result.

## Verification

A local restored catalog returned identical complete 64-candidate responses
from old and new services for English, French and Hindi, both with and without
interest inputs. An unavailable Spanish context in that local snapshot also
returned identical empty results; it is not evidence of production coverage.

With 35 ms injected into each real Postgres response to model round-trip cost:

| Context           | Previous | Combined read |
| ----------------- | -------: | ------------: |
| English cold      |   576 ms |        340 ms |
| English interests |   501 ms |        352 ms |
| French cold       |   420 ms |        296 ms |
| French interests  |   454 ms |        304 ms |
| Hindi cold        |   762 ms |        307 ms |
| Hindi interests   |   458 ms |        308 ms |

These are sequential local samples, not a production percentile forecast. A
separate 400 ms deadline experiment with the same delay failed in the previous
service (551 ms to the handled transaction error) and succeeded in the new one
(387 ms, 64 candidates). No wider deadline was used.

The real-Postgres suite covers empty/inactive pointers, import/activation,
interest ordering, exact locale/audio filtering, publication/artwork/restriction
drift, rollback order/provenance, six-item atomic issuance and audit rollback.
It now guards the five-statement cold-read budget. All 6,594 Admin tests,
production build/types and scoped lint/format checks pass. The rebuilt Web/Admin
six-card selection, 36-second playback, feedback and homepage-return journey
passes with no JavaScript errors. Production deployment
and fixed-window observation remain separate verification gates.

## Prevention

Inspect complete traces and SQL counts before increasing deadlines. Expand
transaction spans: a condensed trace can hide the relevant queries. Prefer one
bounded metadata read where identities are immutable, while keeping mutable
publication checks live. Record failed optimization experiments as well as
successful ones; faster typical latency alone does not establish reliability.

Related: `contextual-recommendations-repeat-catalog-work-20260915.md`,
`watch-etag-hashing-starves-recommendation-admission-20260915.md`, and
`redis-clock-sample-can-expire-admission-early-20260915.md`.
