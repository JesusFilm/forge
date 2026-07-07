---
id: "feat-232"
title: "YouTube mapper arbitrary raw clip matching"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-07-03"
duration: 10
depends_on:
  - "feat-170"
blocks: []
tags:
  - "content-discovery"
  - "yt-video-mapper"
  - "video"
  - "matching"
  - "backend"
  - "evaluation"
---

## Problem

The yt-video-mapper API now accepts raw and multipart uploads, and the mapper can project Admin catalog metadata into its own database, but the current matching algorithm is not strong enough for the real user workflow.
Users will submit arbitrary raw clips that contain JFP content, often cut from the middle of a film, transcoded, muted, cropped, stripped of timing metadata, and without subtitles or external metadata.

The current `official-media-signature-v1` implementation mostly compares structural metadata and bounded byte samples.
That can prove exact or near-exact source bytes in controlled cases, but it is not a robust arbitrary-clip matcher.
The mapper needs segment-level media fingerprints and indexed candidate generation so it can identify source videos from content alone.

## 2026-07-07 Visual V2 Implementation Slice

The first production-ready vertical slice is implemented for deterministic
visual source attribution:

- `official-media-signature-v2` is a separate algorithm version from the v1
  structural byte-sample baseline.
- Uploaded raw clips can be decoded through an injectable FFmpeg frame adapter
  and converted into `visual_frame_phash_v2` hashes without audio, subtitles,
  filenames, or timing metadata.
- Official indexing can decode `CatalogVariant.mediaSourceUrl` through the
  same adapter and write `VISUAL_FRAME` `MediaSignature` rows for direct
  download media sources.
- Matching keeps v1 and v2 signatures isolated, asks the repository for a
  bounded v2 visual shortlist, and re-ranks by Hamming similarity before
  fusion.
- Visual-only source matches keep public confidence conservative until
  variant-specific audio/text evidence is present.
- No-match uploads remain terminal `complete` jobs with `candidates: []`.

Remaining follow-up work in this roadmap item is audio landmarks, temporal
offset consistency, HLS/DASH playlist segment validation, the labeled
evaluation corpus, streaming large uploads without buffering duplicate 100MB
payloads in memory, production-scale `EXPLAIN` verification for the visual
pHash band indexes, and post-deploy smoke with known muted/transcoded
middle-clip fixtures.

## Entry Points - Read These First

1. `docs/roadmap/content-discovery/feat-170-yt-video-mapper-backend-scaffold.md` - original backend scaffold and source attribution boundary.
2. `docs/prototypes/yt-video-mapper/tickets/ytm-004-official-media-signature-indexing.md` - current official signature indexing slice.
3. `docs/prototypes/yt-video-mapper/tickets/ytm-005-replace-placeholders-with-real-matcher.md` - current real-matcher slice and source-anchor guardrails.
4. `docs/prototypes/yt-video-mapper/tickets/ytm-006-evaluation-harness-and-thresholds.md` - evaluation harness to extend with arbitrary clip cases.
5. `docs/plans/2026-06-10-005-feat-official-media-signature-indexing-plan.md` - v1 official signature plan and limits.
6. `docs/plans/2026-06-11-002-feat-ytm-005-real-matcher-plan.md` - matcher design that separates source-anchor evidence from variant-ranking evidence.
7. `docs/solutions/architecture-patterns/mapper-official-media-signature-indexing-pattern.md` - current signature indexing pattern.
8. `docs/solutions/architecture-patterns/mapper-real-match-job-signature-retrieval-pattern.md` - current retrieval and fusion pattern.
9. `apps/yt-video-mapper-backend/prisma/schema.prisma` - `MediaSignature`, `CatalogVariant`, `IndexRun`, and match job tables.
10. `apps/yt-video-mapper-backend/src/services/upload-signal-extraction.ts` - current upload signal extraction.
11. `apps/yt-video-mapper-backend/src/services/media-signature-extraction.ts` - current official signature extraction.
12. `apps/yt-video-mapper-backend/src/services/media-indexing.ts` - current official media indexing pipeline.
13. `apps/yt-video-mapper-backend/src/services/media-signature-matcher.ts` - current matcher and repository boundary.
14. `apps/yt-video-mapper-backend/src/services/retrieval/` - current visual/audio/text retrievers and overlap scoring.

## Grep These

```bash
rg -n "official-media-signature|STRUCTURAL_HINT|VISUAL_FRAME|AUDIO_FINGERPRINT|byteSample|sampledByteHashes|audioFingerprints|visualHashes" apps/yt-video-mapper-backend/src apps/yt-video-mapper-backend/prisma
rg -n "MediaSignatureMatcher|PrismaMediaSignatureMatchRepository|retrieveVisualCandidates|retrieveAudioCandidates|fuseRankedCandidates" apps/yt-video-mapper-backend/src/services
rg -n "ytm-004|ytm-005|ytm-006|arbitrary clip|source-anchor|variant-ranking" docs/prototypes/yt-video-mapper docs/plans docs/solutions
```

## What To Build

1. **Define a v2 media fingerprint contract**
   - Add an algorithm-versioned signature shape for arbitrary raw clips, separate from the current structural byte-sample baseline.
   - Represent visual fingerprints as sampled frame signatures at relative source offsets, such as perceptual hashes with distance scoring.
   - Represent audio fingerprints as time-windowed audio landmarks when audio exists.
   - Keep transcript/text signals optional; the primary workflow must not require subtitles or metadata.
   - Keep Source Anchor Evidence distinct from Variant-Ranking Evidence: visual/audio content can identify the source video, while language/text cues can help choose the likely Dub when present.

   Directional type shape:

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
   ```

2. **Upgrade official media indexing**
   - Decode official catalog media into segment-level visual signatures across the whole duration, not just the first byte range.
   - Extract audio fingerprints when audio exists, but keep muted/no-audio variants indexable through visual signatures.
   - Store signatures in a queryable/indexed form that supports candidate generation without loading all signatures into Node.
   - Use a new algorithm version such as `official-media-signature-v2` so v1 rows can coexist during rollout.
   - Make indexing resumable and observable through `IndexRun` counters and safe failure summaries.

3. **Upgrade upload clip extraction**
   - Decode arbitrary uploaded clips and sample frames across the uploaded clip duration.
   - Extract audio landmarks only when the upload has audio; do not synthesize fake audio fingerprints.
   - Do not depend on uploaded timing metadata, subtitles, filenames, YouTube metadata, or user-provided descriptions.
   - Sniff or validate media type safely enough that raw uploads with sparse headers still fail gracefully rather than hanging the job.

4. **Replace brute-force signature loading with indexed candidate generation**
   - Do not use `findMany` over every indexable signature as the steady-state request path.
   - Generate high-recall candidate windows by nearest-neighbor or inverted-index lookup:
     - visual perceptual hashes by Hamming distance or hash-token overlap,
     - audio fingerprints by landmark overlap and time-offset consistency,
     - text only when text exists,
     - duration as a weak filter or supporting score.
   - Hand only a bounded top-N shortlist of candidate windows to Node for fusion and final ranking.

5. **Add temporal consistency and offset estimation**
   - Estimate likely source offset from repeated frame/audio matches.
   - Reward candidates whose matched frame/audio signatures preserve clip order and consistent source offsets.
   - Split source-video confidence from variant confidence: visual-only clips can strongly identify `coreId` while leaving `videoVariantId` lower confidence or defaulted to the best-supported catalog variant.
   - Return the same public candidate shape unless a separate API ticket expands operator-facing evidence.

6. **Extend evaluation and thresholds**
   - Extend YTM-006 with labeled examples of random middle clips, muted clips, cropped/resized clips, compressed clips, and no-match clips.
   - Measure top-1 accuracy, top-k recall, no-match behavior, and confidence calibration separately for audio-present and no-audio uploads.
   - Set `matchStrength` thresholds from evaluation data, not from hand-picked smoke cases.

7. **Plan production rebuild/reindex**
   - After v2 lands, run a production-safe reindex or rebuild of mapper signatures.
   - Keep Admin as the source of truth; the mapper database remains a projection plus match index.
   - A rebuild is required for v2 media signatures, but current catalog sync does not need to be discarded.

## Constraints

- Do not treat `official-media-signature-v1` byte-sample matching as sufficient for arbitrary user clips.
- Do not require user-provided metadata, uploaded timing offsets, subtitles, filenames, or audio.
- Do not load all production signatures into Node on every match request as the long-term retrieval path.
- Do not make embeddings the primary proof of source identity; embeddings may be a fallback signal, but deterministic media fingerprints should own exact-source attribution.
- Do not query the Admin database at match time. Admin remains source of truth for catalog data; the mapper owns the projection, signatures, jobs, and confidence logic.
- Do not expose internal evidence, source media URLs, secrets, or signed URLs through the public match API in this ticket.
- Do not break the fixed polling contract: zero candidates must still return `status: "complete"` with `candidates: []`.

## Verification

```bash
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
pnpm --filter @forge/yt-video-mapper-backend build
pnpm --filter @forge/yt-video-mapper-backend index:media
```

- Unit tests cover v2 visual signature extraction from frame samples, no-audio extraction, media-type failure paths, and algorithm-version isolation from v1.
- Unit tests cover nearest-neighbor or inverted-index candidate generation so query results are similarity-ranked, not arbitrary first rows.
- Integration tests seed official segment signatures and prove raw clips cut from the middle of the source return the expected `coreId`; require the likely `videoVariantId` only when audio, text, language, or variant-specific evidence is present.
- Integration tests prove muted clips can still match by visual fingerprints.
- Evaluation reports include top-1 accuracy, top-k recall, no-match precision, audio-present results, and no-audio results.
- Performance verification shows candidate generation runs against indexes and does not materialize every production signature in Node.
- Load verification covers concurrent raw and multipart uploads near
  `MAX_UPLOAD_BYTES`, or the upload path is moved to stream directly into
  storage before v2 arbitrary-clip matching is treated as broadly available.
- Production verification after v2 reindex includes:
  - a known middle clip with audio,
  - a known middle clip without audio,
  - a transcoded or resized clip,
  - a no-match clip returning terminal complete with no candidates.
