# Fresh videoVariants check: video inventory versus recommendation eligibility

**All 200 languages previously blocked by card translations have substantial
published video inventory: 48–568 distinct videos with HLS or Mux playback data.**
Calling them “unavailable languages” obscured the actual problem. They fail the
current recommendation display-text rule, not the audio-variant count.

This follow-up queried public Core `videoVariants` directly for all **244**
previously flagged audio slugs: 236 below six curated cards and eight below the
planned reserve. Requests ran on **2026-09-10, 03:32:52–03:35:03 UTC**, using the
exact Core language ID, `onlyPublished: true`, and complete pagination. Every
returned language ID and slug was checked against the requested identity.

## What the fresh source says

| Language        | Published variant rows | Distinct leaf videos with HLS or Mux data | Existing curated candidates with English UI |
| --------------- | ---------------------: | ----------------------------------------: | ------------------------------------------: |
| Tamil           |                    354 |                                       313 |                                         117 |
| Telugu          |                    273 |                                       234 |                                          87 |
| Malayalam       |                    327 |                                       289 |                                         104 |
| Mandarin, China |                    631 |                                       568 |                                         152 |
| Cantonese       |                    349 |                                       308 |                                         109 |
| Italian         |                    506 |                                       448 |                                         134 |
| Dutch           |                    339 |                                       304 |                                         106 |
| Māori           |                     76 |                                        62 |                                          33 |

The last column uses the existing local Admin audit with only the display locale
changed to English; it preserves the selected audio language. All 200 contexts
have 31–152 eligible curated candidates under that diagnostic. Their normal
homepage display locale produces zero because published text is missing under
the exact required key. This is evidence isolating the display filter, not an
authorization or implementation of English fallback. Chinese cases also include
the previously identified `zh`/script-key and casing differences.

“With playback data” means a published variant of a feature film, short film,
episode or segment with a nonempty HLS URL or Mux playback ID. It does not prove
that the endpoint responds, that card text exists, or that canonical deduplication
and Watch restrictions pass. Some series also have streams; their counts are
reported separately rather than silently treated as independent leaf videos.

## Why raw variant counts can mislead

`videoVariants` includes collection and series entries. A published variant row
does not necessarily represent another independently playable video.

| Language                  | Published rows | Videos with playback data | Remaining rows                            |
| ------------------------- | -------------: | ------------------------: | ----------------------------------------- |
| New Zealand Sign Language |              8 |                         1 | Seven collections, no HLS or Mux playback |
| American Sign Language    |              9 |                         2 | Seven collections, no HLS or Mux playback |
| Yiddish                   |              8 |                         1 | Seven collections, no HLS or Mux playback |

New Zealand Sign Language has the full JESUS film. American Sign Language also
has The Pilgrim’s Progress. Collection entries such as Classic, Interests and
Grow Your Faith must not inflate the count to six playable recommendations.

Of the 35 contexts previously described as having insufficient eligible Admin
inventory, **34 still have fewer than six leaf videos with playback data in the
fresh Core response**. Persian Sign Language requires a separate explanation.

## Persian Sign Language: streams exist in metadata, but the extra links fail

Core returns **76 published variant rows: 62 leaf videos with HLS data and 14
non-stream collection entries**. Only the full JESUS film has a Mux playback ID;
61 chapters use `https://arc.gt/…` HLS links with no Mux playback ID.

All 62 corresponding variants already exist in the local Admin database. All
have published English display text and no Watch restriction; 61 lack usable
Mux playback metadata. This is **not missing variant ingestion**. The older Core
snapshot also contained these same variant IDs and 62 HLS declarations.

The current curated hydration SQL requires a Mux playback ID, which explains
the local count of one. The normal Watch player can accept `variant.hls` when
Mux playback is absent. However, relaxing the recommendation requirement alone
would not make these chapter links usable:

- GET checks of all 62 declared streams completed at **03:39:11 UTC**.
- The full-film Mux manifest passed.
- All 61 chapter links failed with HTTP 302 redirect errors before returning an
  HLS playlist. An independent check of `https://arc.gt/hhhph` repeatedly received
  a redirect to the identical URL.

The result is recorded in
[video-variants-persian-sign-stream-health.json](video-variants-persian-sign-stream-health.json).
Repair the stream targets and establish valid playback before counting these
chapters as launch-ready recommendations. Supporting valid HLS-only sources is
a separate contract/eligibility change; no fake Mux ID should be synthesized.

Relevant implementation: `apps/admin/src/services/recommendations/curated-pools.catalog.ts`
requires Mux metadata in the dub join; `apps/web/src/components/watch/HeroPlayer.tsx`
uses the HLS source when `playbackId` is absent.

## What this means for the release decision

The largest group needs display-text/locale work, not additional video curation
or invented audio inventory. Preserve the original local audit as a record of
current eligibility, but use this fresh comparison to explain each blocker.
Arabic Najdi still has nine videos with playback data and five curated starters;
the eight reserve-only contexts all have at least six videos with playback data.
The 34 genuinely small source inventories and Persian Sign Language's failing
chapter links remain concrete exceptions. Production Admin publication and the
release checks remain unverified by these public Core requests.

## Evidence and reproduction

- [Per-language comparison for all 244 contexts](video-variants-cross-check.csv):
  previous local classification/counts beside fresh variant, leaf, stream and
  collection counts, timestamps and per-response hashes.
- [Query, source scope and aggregate results](video-variants-cross-check-summary.json).
- Raw per-language responses, reduced to stream-presence booleans, are retained
  in `/home/nisal/.cache/forge-477-preview/fresh-video-variants/`.

From the worktree root:

```bash
python3 docs/recommendations/curation/2026-09-10/check_video_variants.py \
  --raw-dir=/home/nisal/.cache/forge-477-preview/fresh-video-variants-new
```

The script uses four concurrent read-only requests, bounded retries and page
limits, rejects duplicate variant IDs and mismatched language identity, and
requires a terminal page for every language. It writes a new observation to the
comparison artifacts. Offset pagination is not a transaction snapshot. No
catalog data, pool activation, language fallback or runtime eligibility changed.
