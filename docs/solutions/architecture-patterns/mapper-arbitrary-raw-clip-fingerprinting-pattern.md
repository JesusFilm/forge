---
title: "Mapper arbitrary raw clip fingerprinting pattern"
date: 2026-07-03
last_updated: 2026-07-07
category: architecture-patterns
module: "apps/yt-video-mapper-backend"
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Users upload arbitrary raw or multipart JFP clips without metadata, timing, subtitles, or audio"
  - "The matcher must identify source videos from visual clip content rather than v1 structural hints"
  - "Official indexing and upload extraction need versioned VISUAL_FRAME media signatures"
  - "A completed attribution attempt may have zero candidates and still be terminal"
  - "V2 visual matching requires a reindex to populate visual_frame_phash_v2 signatures"
tags:
  - yt-video-mapper
  - media-fingerprints
  - visual-fingerprints
  - arbitrary-clips
  - candidate-generation
  - source-anchor
  - evaluation
  - v2-reindex
related_components:
  - database
  - background_job
  - testing_framework
related:
  - "docs/roadmap/content-discovery/feat-232-yt-video-mapper-arbitrary-raw-clip-matching.md"
  - "docs/solutions/architecture-patterns/mapper-official-media-signature-indexing-pattern.md"
  - "docs/solutions/architecture-patterns/mapper-real-match-job-signature-retrieval-pattern.md"
  - "docs/solutions/architecture-patterns/mapper-admin-catalog-sync-local-projection-pattern.md"
---

# Mapper Arbitrary Raw Clip Fingerprinting Pattern

## Context

The yt-video-mapper accepts raw request-body uploads and multipart uploads,
persists durable match jobs, syncs Admin catalog data into mapper-owned
projection tables, and compares uploads against `MediaSignature` rows. That
endpoint contract is real, but catalog projection is not the same thing as
usable media evidence. A production catalog can contain the right `coreId` and
`videoVariantId` rows while still returning no useful candidates for arbitrary
clip matching if the indexed signatures do not overlap the submitted clip.

The production symptom behind this pattern was polling that appeared to stall
or return no candidates for raw clips even though the catalog projection had
synced. The first durable fix was to make zero-candidate matches terminal:
an attribution attempt that finds no candidates must complete with
`candidates: []` rather than leaving callers polling indefinitely. A later
production smoke proved the upload and polling contract with v1 indexed byte
samples for both raw and multipart submissions, but that smoke only proved the
endpoint/job path and exact/range byte-signature baseline.

Arbitrary JFP clips are often cut from the middle of a film, transcoded,
resized, cropped, muted, stripped of timing metadata, and missing subtitles or
filenames that describe the source. The v1 structural byte-sample signature
shape is deterministic and useful for exact or range comparisons against
official media bytes. It is not robust proof that an arbitrary transformed
middle clip came from a longer source video.

## Guidance

Treat arbitrary raw clip matching as segment-level fingerprint retrieval, not
as metadata search and not as whole-file byte matching. The official-side
indexer should decode each indexable catalog variant into many source-offset
signals, and the upload extractor should decode the submitted clip into the
same signal families without needing user metadata.

A directional v2 media fingerprint contract can look like this:

```ts
type MediaFingerprintV2 =
  | {
      signatureType: "VISUAL_FRAME"
      algorithmVersion: "official-media-signature-v2"
      offsetMilliseconds: number
      signature: {
        kind: "visual_frame_phash_v2"
        phash: string
        frameWidth: number
        frameHeight: number
      }
    }
  | {
      signatureType: "AUDIO_FINGERPRINT"
      algorithmVersion: "official-media-signature-v2"
      offsetMilliseconds: number
      signature: {
        kind: "audio_landmark_v2"
        landmarkHash: string
      }
    }
  }
```

Visual frame fingerprints are primary Source Anchor Evidence. They should be
able to identify the source `coreId` even when the clip has no audio, subtitle
text, filename, timing offset, or language hint. Audio landmarks are also
media-derived evidence when audio exists, and they can improve source
confidence plus help choose the likely Dub when the audio is variant-specific.
Transcript, language, and subtitle signals are optional Variant-Ranking
Evidence; they should not be required for the core arbitrary-clip workflow.

Do not use a steady-state request path that loads all production signatures
into Node and then scores them. Build candidate generation around an index or
nearest-neighbor lookup that produces a high-recall, bounded shortlist:

```text
uploaded clip fingerprints
  -> visual pHash band shortlist
  -> Hamming-distance re-rank by visual similarity
  -> audio landmark overlap lookup when audio exists
  -> temporal consistency and source-offset estimation
  -> bounded top-N candidate windows
  -> Node fusion and public candidate ranking
```

The shortlist must be similarity-ranked, not an arbitrary first page. In the
current v2 visual slice, repository-level candidate generation filters by pHash
bands and Node re-ranks the bounded shortlist with Hamming distance. That keeps
the matcher from pulling every signature or accepting the first 200 rows as if
storage order were evidence.

Keep source confidence separate from variant confidence. A visual-only clip can
strongly identify `coreId` while leaving `videoVariantId` lower confidence or
defaulted to the best-supported catalog variant. Only raise variant confidence
when variant-specific evidence exists, such as audio-language landmarks,
subtitle/text overlap, language hints, or a catalog-specific media path.

Keep the existing polling contract fixed. A completed attribution attempt with
no matches is still terminal:

```json
{
  "status": "complete",
  "candidates": []
}
```

## Implemented Visual V2 Slice

As of the 2026-07-07 visual slice, the mapper has a concrete
`official-media-signature-v2` path for visual source attribution:

- `visual_frame_phash_v2` payloads are stored as `VISUAL_FRAME`
  `MediaSignature` rows under `official-media-signature-v2`.
- Upload extraction and official indexing share an injectable FFmpeg adapter
  that outputs low-resolution grayscale raw frames and computes deterministic
  perceptual hashes in TypeScript.
- Unit tests inject the FFmpeg command runner, so normal backend tests do not
  require a local FFmpeg binary.
- V2 matching uses repository-level visual candidate generation before fusion.
  The Prisma path filters candidates by indexed byte-wide pHash bands and Node
  re-ranks the bounded shortlist by Hamming similarity; v1 continues using the
  older structural path. Production-scale `EXPLAIN` checks are still required
  before treating this as the final nearest-neighbor architecture.
- The first official v2 indexer decodes direct `DOWNLOAD` media sources.
  HLS/DASH playlist inputs are rejected until the mapper has a hardened
  playlist/segment downloader that validates every nested URL before FFmpeg
  reads it.
- Production indexing requires `MEDIA_INDEX_ALLOWED_HOSTS` so official media
  URL fetches and FFmpeg extraction stay scoped to known media hosts.
- Visual-only v2 candidates keep public confidence conservative unless audio
  or text evidence supports the specific variant.
- Production smoke on v1 indexed byte samples succeeded for both raw and
  multipart uploads, proving the endpoint contract and durable job lifecycle
  while v2 reindex remains the next production step for arbitrary transformed
  clip attribution.

Rollout keeps v1 useful while v2 is backfilled:

```sh
pnpm --filter @forge/yt-video-mapper-backend index:media
MEDIA_SIGNATURE_ALGORITHM_VERSION=official-media-signature-v2 pnpm --filter @forge/yt-video-mapper-backend index:media
```

The v2 reindex creates new rows beside v1 rows. It does not require discarding
the mapper catalog projection that was synced from Admin.

## Why This Matters

Catalog sync, v1 byte signatures, and v2 visual fingerprints solve different
problems. Catalog sync ensures the mapper has official `coreId +
videoVariantId` projection rows from Admin. V1 byte-sample signatures give a
safe deterministic baseline for controlled media inputs and exact/range
official media bytes. V2 visual pHash signatures give the mapper media-derived
evidence that can survive common transforms in arbitrary middle clips.

The wrong architecture can look green in smoke tests while failing the real
workflow. Exact-file or first-byte examples may return candidates, but a muted
middle clip can still return zero because no indexed segment evidence overlaps
the uploaded clip. Loading all signatures can also work locally and collapse in
production as the catalog grows.

Segment fingerprints keep the proof media-derived and deterministic. They are
not text embeddings, and they do not depend on user-provided metadata. Embedding
signals can be useful as a fallback or review signal, but source attribution
should be owned by media fingerprints that survive common transforms.

## When to Apply

- Planning or implementing `official-media-signature-v2`.
- Reviewing matcher code for arbitrary raw video uploads.
- Debugging production uploads that produce no candidates or long polling.
- Distinguishing catalog projection readiness from media-signature readiness.
- Designing candidate generation for production-sized signature tables.
- Evaluating muted, cropped, resized, transcoded, middle-of-film, or
  no-metadata clips.
- Deciding whether a v2 reindex or rebuild is required after extractor changes.

## Examples

Good source-vs-variant behavior:

```json
{
  "input": "muted middle clip from source-video-a",
  "sourceEvidence": {
    "kind": "visual_frame_phash_v2",
    "matchedOffsets": [642000, 646000, 650000],
    "coreId": "source-video-a"
  },
  "candidate": {
    "coreId": "source-video-a",
    "videoVariantId": "best-supported-catalog-variant",
    "confidence": 0.88,
    "matchStrength": "high"
  },
  "variantConfidence": "low"
}
```

Good candidate-generation query shape:

```sql
-- Directional sketch only: generate a bounded visual shortlist by similarity.
SELECT
  core_id,
  video_variant_id,
  offset_milliseconds,
  hamming_distance(phash, :query_phash) AS distance
FROM media_signatures
WHERE algorithm_version = 'official-media-signature-v2'
  AND signature_type = 'VISUAL_FRAME'
  AND hamming_distance(phash, :query_phash) <= :max_distance
ORDER BY distance ASC
LIMIT :per_frame_limit;
```

Good zero-candidate polling result:

```json
{
  "status": "complete",
  "candidates": []
}
```

Avoid these shortcuts:

- Treating `official-media-signature-v1` byte samples as sufficient for random
  transformed user clips.
- Assuming Admin catalog projection means useful clip-matching signatures
  already exist.
- Requiring filenames, YouTube metadata, subtitles, timing offsets, or audio.
- Loading every production signature into Node for every match request.
- Taking the first page of signatures as candidates without similarity-ranked
  retrieval.
- Returning a high-confidence `videoVariantId` from visual-only evidence alone.
- Treating a zero-candidate result as an incomplete job.

## Related

- [YouTube mapper arbitrary raw clip matching](../../roadmap/content-discovery/feat-232-yt-video-mapper-arbitrary-raw-clip-matching.md)
- [Mapper official media signature indexing pattern](./mapper-official-media-signature-indexing-pattern.md)
- [Mapper real match job signature retrieval pattern](./mapper-real-match-job-signature-retrieval-pattern.md)
- [Mapper Admin catalog sync local projection pattern](./mapper-admin-catalog-sync-local-projection-pattern.md)
