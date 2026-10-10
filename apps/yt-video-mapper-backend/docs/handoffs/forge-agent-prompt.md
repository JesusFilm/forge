# Forge Agent Handoff Prompt

We want to build a video-to-source mapper inside the Forge monorepo as
`apps/yt-video-mapper-backend`.

Product goal:
Create an async backend workflow that accepts a downloaded external/re-uploaded
video file and maps it back to official Jesus Film Core identifiers. The purpose
is analytics attribution, not suspicious-video detection, enforcement, or
moderation. Given an uploaded video, the system should identify which official
source video and likely language/audio variant it came from, even if the
uploader changed title, metadata, compression, crop, overlays, or edits.

Current manual workflow:
A person watches the external video, then manually searches through Jesus Film
videos and language variants until they find similar scenes. The product should
reduce this to a short ranked candidate list.

Core/Forge ID vocabulary:

- Public API `coreId` = Forge/Admin `Video.coreId`.
- Public API `videoVariantId` = Core `videoVariant.id`, stored in Forge/Admin
  as `VideoDub.coreId`.
- Forge uses `VideoDub` internally because Core video variants usually vary by
  audio language, not frames.
- `VideoEdition` represents the cut/edition and owns subtitle tracks.
- `VideoSubtitle` attaches to `VideoEdition`; subtitles can help identify the
  audio language/variant.

Preferred v1 input:
A downloaded video file uploaded to the API. YouTube URL ingestion can be added
later as a convenience layer, but the core matcher should operate on media bytes
so it does not depend on YouTube titles, descriptions, channels, thumbnails, or
downloader behavior.

Preferred v1 flow:

1. Upload video file.
2. Return a job ID.
3. Process the video asynchronously.
4. Poll job status.
5. Return ranked candidates when complete.

Preferred v1 output:

```ts
type MatchResponse = {
  candidates: Array<{
    coreId: string
    videoVariantId: string
    confidence: number
    matchStrength: "high" | "medium" | "low"
  }>
}
```

No `bestMatch` field for v1. The first candidate is the highest-ranked result.
Evidence breakdown stays internal for now and can be exposed later.

Recommended matching stance:
Use one fused ranking, not separate visual and audio answers.

- Visual/scene signal answers: which source `coreId` do these frames resemble?
- Audio language/transcript signal answers: which Core `videoVariantId` /
  Forge `VideoDub.coreId` is this likely to be?
- Duration/structure signal helps rank full re-uploads, trimmed clips, and
  edited sequences.

Fusion should be visual-first and agreement-aware:

1. Visual/scene signal anchors likely `coreId`.
2. Audio language/transcript signal ranks likely `videoVariantId` under that
   source.
3. Agreement between visual and audio evidence raises confidence and
   `matchStrength`.
4. If visual evidence is strong but audio is fuzzy, return the top two or three
   likely variants under the same `coreId`.
5. If visual and audio disagree, lower confidence rather than returning two
   separate answers.

Retrieval architecture:
Do not build classic RAG as the core identity matcher. Build media-signature
retrieval plus fusion scoring. The official-media indexer should read
Forge/Admin catalog references, process official media into compact timecoded
signatures, and store those signatures in the mapper's match index. A match job
should extract comparable signals from the uploaded video, retrieve likely
official candidates, then run the fusion scorer over that bounded set.

Recommended retrieval stages:

1. Coarse source retrieval from visual/scene signatures to identify likely
   `coreId` candidates.
2. Variant ranking from audio language, audio fingerprints, transcript overlap,
   and subtitle similarity to rank likely `videoVariantId` candidates.
3. Fusion scoring to produce the final candidate list.

Storage/indexing stance:
Do not duplicate the full Forge catalog. Forge/Admin remains the source of truth
for `Video`, `VideoDub`, `VideoEdition`, subtitles, durations, and media URLs.
The mapper may own its own database for async job state, match results, internal
evidence, and compact official-media indexes. Do not store raw uploaded videos
long-term unless a later review workflow explicitly requires it.

Existing Forge embeddings:
Forge/Admin and Mastra already have semantic scene/transcript embeddings. Those
may help a prototype shortlist, but the mapper may need a different
identity-oriented index because the input is a source video file and the goal is
to identify derivation from exact media, not only semantic similarity.

Open questions to resolve before planning:

- What upload size and duration limits should v1 support?
- How many candidates should the API return by default?
- What thresholds map `confidence` to `high`, `medium`, and `low`?
- Which official media source seeds the first prototype index: HLS, downloads,
  Mux playback, or another approved source?
- How long should job results and internal evidence be retained?
- Which visual/audio fingerprinting libraries or services should be evaluated?
