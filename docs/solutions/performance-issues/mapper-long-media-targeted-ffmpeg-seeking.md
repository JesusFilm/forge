---
title: Mapper long-media targeted FFmpeg seeking
date: 2026-07-22
category: performance-issues
module: apps/yt-video-mapper-backend
problem_type: performance_issue
component: service_object
symptoms:
  - Long-media visual fingerprint extraction took several seconds per video because decoding started at the beginning of the source
  - Large media-signature index runs could not finish in an acceptable operational window
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - background_job
  - testing_framework
tags:
  - yt-video-mapper
  - ffmpeg
  - visual-fingerprints
  - targeted-seeking
  - media-indexing
  - algorithm-versioning
  - performance
  - production-rollout
---

# Mapper long-media targeted FFmpeg seeking

## Problem

The mapper's legacy visual extractor opened one FFmpeg input and selected up to
twelve frames with an `fps` filter. In this optimization session's benchmarks,
long-media extraction cost still grew with duration even though the output stayed
fixed at twelve 8x8 grayscale frames
(`apps/yt-video-mapper-backend/src/services/ffmpeg-visual-frame-extraction.ts`).

Changing the sampling path also changes the fingerprint contract. The payload
remains a perceptual hash, but fingerprints produced under different sampling
semantics must not share an algorithm version. The mapper therefore defines
`official-media-signature-v3` beside v2 and recognizes both as visual signature
versions (`apps/yt-video-mapper-backend/src/services/visual-fingerprint.ts`).

## Symptoms

- A controlled local-file benchmark took a 3507.31 ms median to extract twelve
  fingerprints from a 30-minute fixture.
- A six-minute fixture took 736.15 ms, showing that cost increased with duration
  well before feature-film length.
- Short media was already inexpensive, so applying extra seeking work to every
  input risked regressing the common fallback path.
- Re-running an already populated algorithm version did not guarantee a
  re-fingerprint because normal index discovery skips variants that already have
  signatures for that exact version
  (`apps/yt-video-mapper-backend/src/services/media-indexing.ts`).

## What Didn't Work

Limiting the output to twelve frames did not bound decode work. The single-input
`fps` filter selected sparse output only after FFmpeg had decoded enough of the
source to reach each sample.

An intermediate approach launched one input-seeked FFmpeg process per offset. It
proved that input-level seeking removed the full-decode bottleneck, but twelve
child-process startups still cost a median 515.92 ms on the 30-minute fixture.

Reusing the v2 algorithm label was not valid. V2 rows were created with legacy
sampling, while v3 enables the adaptive path in official indexing and upload
extraction (`apps/yt-video-mapper-backend/src/services/media-indexing.ts` and
`apps/yt-video-mapper-backend/src/services/upload-signal-extraction.ts`). Mixing
both sampling contracts under v2 would make uploaded and indexed fingerprints
incomparable and remove the clean rollback boundary.

## Solution

Enable adaptive seeking only for v3. When duration is known and at least five
minutes, calculate twelve evenly spaced offsets and run one FFmpeg child with
twelve input-level `-ss`/`-i` pairs. Repeat the protocol whitelist for every
input, take one scaled 8x8 grayscale frame from each input, concatenate the
frames in offset order, and emit one raw-video stream
(`apps/yt-video-mapper-backend/src/services/ffmpeg-visual-frame-extraction.ts`).

Treat output as all-or-nothing. The adaptive path expects exactly
`offsets * width * height` bytes and raises `ffmpeg_incomplete_frames` before
hashing when the byte count differs. One consolidated command receives one
timeout budget, so the optimization does not create twelve independently timed
children.

Preserve the existing single-pass path when any of these is true:

- adaptive seeking is disabled;
- duration is unknown;
- duration is below five minutes.

This keeps all v2 extraction on legacy behavior and lets short or
unknown-duration v3 media retain the proven fallback. Tests assert one
consolidated command, twelve ordered seeks, repeated protocol restrictions, one
timeout, exact-output failure, and fallback routing
(`apps/yt-video-mapper-backend/src/services/ffmpeg-visual-frame-extraction.test.ts`).

During this optimization session, a repeated local-file comparison measured a
159.26 ms median for the 30-minute fixture, a 95.5% reduction and 22.02x speedup
over the legacy path. The six-minute fixture fell from 736.15 ms to 115.95 ms
while the short fixture remained effectively unchanged. The checked-in harness
does not rerun that legacy baseline; it reports retained-path timing and verifies
an exact-seek content oracle, deterministic hashes, the six-minute
above-threshold route, one active FFmpeg child, and the short/unknown fallback
(`apps/yt-video-mapper-backend/src/scripts/measure-ffmpeg-seeking.ts`).

### Rollout sequence

1. Run an index with `MEDIA_SIGNATURE_ALGORITHM_VERSION` set to
   `official-media-signature-v3` while retaining v2 rows. Algorithm version is
   part of signature identity, so versions coexist instead of overwriting one
   another (`apps/yt-video-mapper-backend/src/services/media-indexing.ts`).
2. Verify v3 coverage through an independent read path. A normal rerun of an
   already populated v3 version can skip those variants; it is not a forced
   refresh mechanism.
3. Smoke-test a known long source through its signed HTTPS production URL, then
   submit an arbitrary partial clip and confirm it retrieves the expected v3
   candidate.
4. Only after coverage and known-match smoke pass, configure the API and worker
   to select v3 together.
5. Keep v2 rows through the observation window. Roll back by selecting v2 and
   restarting the service; no destructive replacement is required.

The production-origin smoke is required because the benchmark reads local
fixture bytes. It does not prove that the real origin supports twelve repeated
seek inputs with the same connection, throttling, and latency profile. The
production URL path still validates a direct-download HTTPS source before
invoking FFmpeg
(`apps/yt-video-mapper-backend/src/services/ffmpeg-visual-frame-extraction.ts`).

## Why This Works

Input-level seeking lets FFmpeg jump near each requested timestamp before
decoding, bounding useful work around twelve target frames instead of scanning
the movie from the beginning. Consolidating the inputs retains those seeks while
paying child-process startup once. Ordered concatenation plus exact byte-count
validation prevents a missing frame from silently shifting hashes onto the wrong
declared offsets.

The scaling change removes duration-driven sequential decode growth from the
normal long-media path. Remaining extraction cost is bounded by the fixed sample
count but still depends on codec seek behavior and local or remote I/O, which is
why the crossover threshold and production-origin smoke remain operational
measurements rather than assumptions.

Version isolation keeps retrieval coherent. Official indexing and upload
extraction enable adaptive seeking only for v3, and matching queries the selected
algorithm version (`apps/yt-video-mapper-backend/src/services/media-signature-matcher.ts`).
V2 therefore remains a valid fallback rather than a mixture of old and new
sampling behavior.

## Prevention

- Project rule: treat changes to sample offsets, decode path, scaling, or hash
  semantics as a new media-signature algorithm version, even when the JSON shape
  is unchanged.
- Benchmark long, threshold-adjacent, short, and unknown-duration fixtures.
  Require frame count and shape, a content oracle, determinism, route selection,
  child-process count, and short-media regression gates.
- Retune the five-minute threshold only with representative measurements. It is
  an evidence-backed crossover, not a universal FFmpeg constant.
- Keep exact output validation and one bounded child for the adaptive path.
  Partial output must fail rather than create offset/hash misalignment.
- Require a signed HTTPS production-origin smoke before the v3 flip. Local-file
  speed and correctness do not validate range or throttling behavior.
- Index a new version beside the old one, verify coverage and a known match, then
  flip all readers and writers together.

## Related Issues

- [Mapper arbitrary raw clip fingerprinting pattern](../architecture-patterns/mapper-arbitrary-raw-clip-fingerprinting-pattern.md)
- [Mapper official media signature indexing pattern](../architecture-patterns/mapper-official-media-signature-indexing-pattern.md)
- [Mapper real match job signature retrieval pattern](../architecture-patterns/mapper-real-match-job-signature-retrieval-pattern.md)
- [Mocked-shape-vs-real-contract testing discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
