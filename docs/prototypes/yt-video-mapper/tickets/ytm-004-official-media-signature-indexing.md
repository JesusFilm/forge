---
id: YTM-004
title: "Index official media signatures for catalog variants"
status: complete
priority: P1
depends_on:
  - YTM-003
---

# YTM-004: Index official media signatures for catalog variants

## Goal

Build the official-side index that makes content-first retrieval possible.

## Scope

- Add an indexing job over indexable `CatalogVariant` rows.
- Fetch or stream official media from the chosen source URL.
- Generate compact timecoded signatures for:
  - sampled visual frames or scenes
  - audio fingerprints and audio language hints
  - subtitle/transcript text segments where available
  - duration and structural hints
- Store signatures in `MediaSignature` with algorithm version, offset, duration,
  and source media hash when available.
- Record `IndexRun` status, counters, cursor, and failure summary.
- Make indexing resumable by cursor or by already-indexed variant/signature
  checks.

## Acceptance Criteria

- Indexing can run over a broad catalog without manual per-video selection.
- Per-variant failures do not fail the entire run unless the run itself is
  unrecoverable.
- Signatures are versioned so future algorithms can coexist or be rebuilt.
- Retrieval tests have seeded official signatures to search against.

## Verification

```sh
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
```
