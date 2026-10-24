---
title: "Mapper official media signature indexing pattern"
date: 2026-06-10
category: architecture-patterns
module: "apps/yt-video-mapper-backend"
problem_type: architecture_pattern
component: background_job
severity: medium
applies_when:
  - "A mapper service needs local official-media signatures for future content-first retrieval"
  - "Official catalog media metadata has already been synced into mapper-owned projection rows"
  - "Indexing must be idempotent, resumable, and safe around signed media URLs"
  - "A first indexing slice needs deterministic signatures before full visual/audio libraries are selected"
tags:
  - yt-video-mapper
  - media-indexing
  - prisma
  - background-job
  - safe-failures
  - ssrf
related_components:
  - database
  - service_object
  - tooling
---

# Mapper official media signature indexing pattern

## Context

YTM-004 builds the official-side media index for the YouTube Video Mapper after
Admin catalog sync has populated local `CatalogVideo` and `CatalogVariant`
projection rows. The indexer needs to convert broad official media rows into
versioned `MediaSignature` rows without turning Admin into the mapper database
or making match-time retrieval depend on live media fetches.

The tempting shortcuts are to fetch media directly during matching, persist raw
signed URLs as provenance, write placeholder audio/visual signatures without a
real extractor, or treat a failed media row as a failed run. Those shortcuts
make broad indexing unsafe and make future matcher behavior hard to reason
about.

## Guidance

Keep official media indexing as service-layer background work over the mapper's
local projection. Select only `CatalogVariant` rows Admin already marked
indexable and that have a media source URL. Store `IndexRun` as durable state
with the algorithm version, cursor, counters, timestamps, and bounded failure
summary.

Use the composite identity everywhere:

```text
coreId + videoVariantId
```

Batch existing-signature checks per variant page instead of counting one
variant at a time. The production repository can fetch existing
`MediaSignature` keys by `algorithmVersion + coreId + videoVariantId`, while
the service decides whether a variant is skipped for that algorithm version.
Use a database index that matches that lookup.

Make signature writes idempotent under the media-signature key:

```text
coreId + videoVariantId + signatureType + algorithmVersion + offsetMilliseconds
```

For the first deterministic algorithm, prefer honest compact signatures over
fake media evidence. A structural hint signature can contain duration,
dimensions, locale/language hints, and a bounded byte-sample hash. Text
segments are emitted only when a caller supplies transcript or subtitle source
data. Audio fingerprints and visual frame signatures should wait until a real
extractor or local library is selected.

Treat official media fetches as untrusted network I/O even when the URL came
from Admin. Require HTTPS, reject localhost and private literal IP hosts, set a
timeout, request a bounded range, stream up to the byte budget, cancel the
reader once enough bytes have been collected, and disable automatic redirects.
When production media hosts are known, configure an exact host allowlist.

Do not persist raw signed media URLs in `MediaSignature` rows. Store a
queryless provenance URL such as `origin + pathname`, a URL fingerprint, or
`null`, and store the source media hash separately when available. Failure
summaries should include bounded `coreId`, `videoVariantId`, variant id, code,
and redacted message. Never store bearer tokens, request headers, raw payloads,
or signed URL query strings in an `IndexRun` failure summary.

## Why This Matters

Content-first matching needs a local official-side index that can be searched
without refetching official media for every uploaded match job. Versioned
signatures let future algorithms coexist and let operators rebuild by
algorithm version instead of destructively replacing evidence.

Safe media fetch handling matters because catalog media URLs can be signed,
large, stream-oriented, or unexpectedly pointed at unsafe locations. A broad
indexer that follows redirects, buffers entire responses, or records full URLs
can become an availability or secret-leak problem even though it is not a
public route.

Idempotent per-variant processing keeps long indexing runs restartable. A
single bad URL, empty media response, or extractor failure should count against
that variant, advance the cursor, and leave a safe diagnostic summary rather
than stopping the whole catalog run.

## When to Apply

- A matcher, search service, or analytics system needs official-media
  signatures built from locally synced catalog projection rows.
- The service needs broad indexing with resumable run state and per-row failure
  tolerance.
- Source media URLs may be signed, remote, or stream-oriented.
- The first indexing algorithm is intentionally modest and deterministic.

## Examples

Good indexing shape:

```text
create IndexRun
  list indexable CatalogVariant page after cursor
  batch load existing MediaSignature variant keys for algorithm version
  for each variant
    skip when same algorithm already has signatures
    validate and bounded-fetch official media bytes
    generate compact deterministic signatures
    upsert signatures by composite signature key
    checkpoint cursor and counters
complete IndexRun
```

Avoid these shortcuts:

- Fetching official media during match-time retrieval instead of pre-indexing.
- Treating raw signed media URLs as safe durable provenance.
- Generating fake audio fingerprints or visual frames without an actual media
  extractor.
- Counting one existing signature query per variant when the page can be
  checked in one repository call.
- Letting one media fetch failure fail the whole indexing run.
- Following redirects or buffering full media responses before applying the
  byte budget.

Tests should cover:

- Filtering to only indexable variants with media source URLs.
- Same-version idempotence and new-version coexistence.
- Per-variant failures, empty fetches, bounded failure summaries, and cursor
  advancement.
- HTTPS/private-host/allowlist validation and signed URL provenance stripping.
- Bounded stream reading, timeout wiring, and full-vs-partial hash metadata.
- Retrieval fixtures shaped like stored `MediaSignature` rows, without
  implementing final matching.

## Related

- [Mapper Admin catalog sync local projection pattern](./mapper-admin-catalog-sync-local-projection-pattern.md)
- [yt-video-mapper backend app durable match job upload poll process pattern](../platform/yt-video-mapper-backend-app-durable-match-job-upload-poll-process-pattern.md)
- [SSRF defense streaming proxy and CodeQL false positive](../security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md)
- [Outbound timeout shorter than caller budget](../best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md)
- [Mocked-vs-real testing discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
