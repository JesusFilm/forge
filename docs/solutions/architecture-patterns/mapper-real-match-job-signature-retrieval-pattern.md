---
title: "Mapper real match job signature retrieval pattern"
date: 2026-06-11
category: architecture-patterns
module: "apps/yt-video-mapper-backend"
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - "Replacing a placeholder mapper with real local signature retrieval"
  - "Uploaded media signals need to be compared against mapper-owned MediaSignature rows"
  - "A matcher must keep source-video evidence separate from variant-ranking evidence"
  - "Public candidates must stay limited while internal evidence can evolve"
tags:
  - yt-video-mapper
  - media-signatures
  - match-jobs
  - retrieval
  - fusion-scoring
  - source-anchor
related_components:
  - database
  - background_job
  - testing_framework
---

# Mapper real match job signature retrieval pattern

## Context

YTM-005 replaced the prototype `NoopMatcher` and placeholder upload extractor
with a deterministic matcher over local mapper data. Earlier slices already
created the Mapper Catalog projection and official `MediaSignature` index, so
the missing step was the live bridge from uploaded media bytes to ranked
`coreId + videoVariantId` candidates.

The tempting shortcut is to treat every matching signal as variant evidence and
let fusion choose the highest single row. That breaks the product model:
visual or structural evidence usually proves the source video, while audio,
text, and language evidence choose the likely variant under that source.

## Guidance

Wire production matching as service-layer composition:

```text
uploaded bytes
  -> deterministic upload signal extraction
  -> repository-backed MediaSignature retrieval
  -> source-anchor and variant-ranking signal projection
  -> fusion keyed by coreId + videoVariantId
  -> public candidates only
```

Keep the upload extractor honest and version-aligned with the official
signature algorithm. For the first deterministic slice, bounded byte-sample
hashes and parseable duration are real structural evidence. Subtitle text is
real evidence only when the uploaded source is text. Audio fingerprints should
remain absent until a real local extractor or library is selected.

Retrieve official signatures through a repository that has already filtered by
algorithm version and active `CatalogVariant` rows. Project structural
byte-sample signatures into source-anchor retrieval. Project text and audio
signatures into variant-ranking retrieval only when the upload also has that
signal family. Compute duration as supporting structure, not as a source proof.

Use `coreId + videoVariantId` everywhere a signal, signature, candidate, or
fusion row is grouped. `videoVariantId` alone is not enough because the matcher
must never merge evidence from two source videos that happen to expose the same
variant-looking identifier.

When source-anchor evidence identifies a `coreId`, propagate that source anchor
to strong text or audio evidence under the same `coreId` so the variant can win.
Do not propagate the anchor across source videos. Do not let weak same-source
variant evidence suppress an exact source-only fallback; keep a threshold before
variant evidence replaces the fallback row.

Keep the public boundary narrow. Matchers may calculate or retain detailed
evidence internally for future debugging surfaces, but route responses and
stored public candidates should expose only:

```json
{
  "coreId": "core-video-id",
  "videoVariantId": "core-video-variant-id",
  "confidence": 0.913,
  "matchStrength": "high"
}
```

## Why This Matters

The mapper's answer has two levels. The source video is the analytics anchor,
and the variant is the likely Dub or language-specific media row. If the matcher
lets text-only or audio-only evidence create high-strength candidates without
source support, it can confidently attribute to the wrong source. If it treats
visual evidence as variant-only, it can miss the correct variant when dialogue
or subtitles point to another Dub under the same source.

Keeping retrieval local to mapper-owned catalog and signature rows also
preserves the source-of-truth boundary. Admin remains authoritative for catalog
metadata, while the mapper owns the match index, match jobs, and confidence
logic.

## When to Apply

- Replacing a placeholder matcher with a first production matcher over local
  signatures.
- Adding a new signal family to the video mapper and deciding whether it is
  source-anchor evidence or variant-ranking evidence.
- Reviewing matcher code that groups, merges, or fuses candidates.
- Testing disagreement cases where visual or structural evidence conflicts with
  text or audio.

## Examples

Good matcher shape:

```text
source anchors:
  structural byte sample -> core-a / variant-en

variant evidence:
  transcript overlap -> core-a / variant-es

fusion:
  propagate core-a source anchor to variant-es
  rank core-a / variant-es above the source-only fallback
```

Good guardrail test cases:

- An uploaded sample with matching structural signatures returns a non-empty
  candidate from seeded official signatures.
- Shared `videoVariantId` values under different `coreId` values do not merge.
- Text or audio from a different `coreId` cannot outrank strong source-anchor
  evidence.
- Text-only or audio-only evidence is capped below high strength.
- Weak same-source variant evidence does not replace an exact source fallback.

Avoid these shortcuts:

- Defaulting the production server to a no-op matcher or placeholder extractor.
- Treating metadata search as the source of attribution.
- Generating fake audio fingerprints to make a sparse matcher look multimodal.
- Grouping retrieval or fusion by `videoVariantId` without `coreId`.
- Exposing internal evidence in the public response before the API contract
  calls for it.

## Related

- [Mapper official media signature indexing pattern](./mapper-official-media-signature-indexing-pattern.md)
- [Mapper Admin catalog sync local projection pattern](./mapper-admin-catalog-sync-local-projection-pattern.md)
- [yt-video-mapper backend app durable match job upload poll process pattern](../platform/yt-video-mapper-backend-app-durable-match-job-upload-poll-process-pattern.md)
- [Mocked-vs-real testing discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
