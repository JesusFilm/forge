# PostgreSQL catalog map for recommendation curation

Rebuilt the map directly from **15 catalog tables**, preserving raw records before applying any recommendation filters. It contains **1,175 videos, 2,321 languages, 212,171 dubs, and 1,605 parent/child links**. All **208 editorial choices and 233 primary/alternate Core references** resolve to Admin videos and their language inventories.

The source is the isolated restored database `forge_feat477_20260910`, extracted in a read-only, repeatable-read transaction at **2026-09-10 03:52:38 UTC**. It is not today's production catalog. All video, language, dub, and display rows have source tier `core`; their newest sync timestamps are August 3 for videos/display text, September 3 for languages, and September 5 for dubs. The complete timestamp ranges are in [pg-catalog-summary.json](pg-catalog-summary.json).

## Start with these maps

| Artifact                                                                                                                                     | Contents                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Language map](pg-catalog-languages.csv)                                                                                                     | All 2,321 language rows: canonical names, legacy name mirror, IDs, sync/deletion state, raw video counts, declared HLS/Mux sources, curated references and distinct editorial choices, uncurated inventory, prior current recommendation counts. |
| [Video map](pg-catalog-videos.csv)                                                                                                           | All 1,175 videos: Admin/Core IDs, stored type, title, own source declarations, edition IDs, parents/children, publication/restriction state, display locales, keywords, transcript metadata, editorial membership.                               |
| [Editorial map](pg-catalog-editorial-map.csv)                                                                                                | Every primary/alternate reference, its parent editorial choice, themes, review hold, rationale, and all languages with published declared sources.                                                                                               |
| [Uncurated candidates](pg-catalog-uncurated-candidates.csv)                                                                                  | 834 leaf-labelled videos outside the current manifest with at least one published declared source: 106 shorts, 431 episodes, 292 segments, five stored feature-film records. These are candidates for review, not approved additions.            |
| [Parent/child links](pg-catalog-relations.csv), [edition links](pg-catalog-edition-links.csv), [keyword links](pg-catalog-keyword-links.csv) | Normalized relationships retaining exact IDs and ordering.                                                                                                                                                                                       |
| [Display locale summary](pg-catalog-display-locales.csv)                                                                                     | Exact PG locale keys, raw/published/deleted rows, and videos with published nonempty titles.                                                                                                                                                     |

The complete normalized **212,171-row dub map**, including HLS/DASH URLs, Mux playback IDs, nullable joins, lifecycle fields, editorial membership and explicitly scoped historical health observations, is:

`/home/nisal/.cache/forge-477-preview/pg-catalog-map/pg-catalog-all-dubs.csv`

[Raw manifest](pg-catalog-raw-manifest.json) records every export's absolute path, byte count, row count and SHA-256. Raw JSONL files preserve display text, canonical language names, images, editions, subtitles and other catalog metadata. No vectors, transcript bodies, individual viewing history or analytics were exported.

## Raw inventory is different from recommendation eligibility

| Selected audio        | PG leaf videos with published declared sources | Approved editorial choices with declared sources | Uncurated leaf videos | Prior current homepage cards |
| --------------------- | ---------------------------------------------: | -----------------------------------------------: | --------------------: | ---------------------------: |
| English               |                                          1,067 |                                              197 |                   834 |                          191 |
| Tamil                 |                                            315 |                                              121 |                   164 |                            0 |
| Telugu                |                                            236 |                                               91 |                   119 |                            0 |
| Mandarin China        |                                            570 |                                              156 |                   381 |                            0 |
| Māori                 |                                             62 |                                               34 |                    27 |                            0 |
| Persian Sign Language |                                             62 |                                               34 |                    27 |                            1 |
| Arabic Najdi          |                                              9 |                                                5 |                     3 |                            5 |

“Declared sources” means a published, nondeleted dub of a nondeleted video/language/edition with a nonempty direct HLS URL or nondeleted Mux playback declaration. It does **not** establish network health, suitable artwork, translated card text, canonical deduplication, or editorial suitability. Raw columns retain rows outside even that definition. Distinct video IDs, distinct editorial choices, and dub-row counts have separate columns; alternate cuts cannot silently inflate editorial-choice counts.

The old coverage files remain useful as records of **current recommendation eligibility**. They should not be used as the catalog: the Mux and exact display-locale filters removed real audio inventory before it was counted. The 200 display-blocked homepage languages have substantial declared audio inventory. Their additional curation options are now directly inspectable without pretending that additional videos solve missing card translations.

Persian Sign Language illustrates the playback distinction: PG contains 62 declared HLS sources, including 61 without active Mux metadata. The existing exact-variant observations from **03:39:11 UTC** show one successful manifest and 61 failed chapter endpoints. They are mapped by exact variant Core ID, not inferred from video or language names. No streams were probed again. The earlier 233 English video/language-pair checks are separately marked as pair-level evidence because they do not identify every dub sharing that pair. Everything outside recorded observations remains untested. See [delivery boundaries](catalog-delivery-boundaries.md) and [Persian stream evidence](video-variants-persian-sign-stream-health.json).

## Types, relationships and identity

Stored video types are 47 collections, 61 series, 486 episodes, 398 segments, 171 shorts and 12 feature films. A parent/child link does not itself classify a container. Own sources are recorded independently: the `Perfect` collection has two published source-bearing dubs, and series `7_0-nfs01` has one.

Local labels also differ from today's saved Core responses. Two Rescue Project records stored as leaves are now series in Core, explaining Tamil's local 315 versus fresh 313 leaf count without disappearing streams. Four further records changed segment to episode. Keep these source snapshots separate; [label cross-check](catalog-source-label-cross-check.json) lists the exact six IDs.

There are no broken nonnull video/language/edition/Mux joins or relationship/image/keyword/transcript references, and no mismatches between linked display-language IDs and their slug/Core-ID mirrors. **478 dubs have a null language link** and remain an unmapped bucket; no language was inferred from an identifier prefix. Of 2,321 raw language rows, three named rows are deleted and one has no slug, leaving 2,317 nondeleted named languages. See [identity exceptions](catalog-identity-exceptions-summary.json).

The join rules are explicit in [pg_catalog_map.ts](pg_catalog_map.ts): `video_dub.video_id → video.id`, optional `language_id → language.id`, `video_edition_id → video_edition.id`, and `mux_video_id → mux_video.id`, all through LEFT joins. Editions link to videos through dubs and transcript metadata; no invented edition-to-video ownership is assumed. `video_relation` supplies ordered parent/child links; `video_keyword → keyword` supplies content tags. `video_locale` owns display text; `language_locale` owns canonical localized language names, with `language.name` retained separately as the legacy mirror. Images, subtitles and origins retain their own IDs and lifecycle state. Transcript/chunk tables contribute metadata/counts only.

## Validation and reproduction

Passed: hashes and row counts for all 15 exports, 212,171 unique dub IDs, independent SQL comparisons for every one of 2,321 languages, distinct video/language pair totals, all Core reference resolutions, orphan checks, transcript/chunk totals, and all 62 exact Persian observation matches. [Independent verification](catalog-map-independent-validation.json) also checks the compact maps, identities, relationships, health annotations and prior eligibility joins.

From `apps/admin`, using the isolated `.env`:

```bash
pnpm exec tsx --env-file=.env ../../docs/recommendations/curation/2026-09-10/pg_catalog_map.ts --raw-dir=/home/nisal/.cache/forge-477-preview/pg-catalog-map
```

From the worktree root:

```bash
python3 docs/recommendations/curation/2026-09-10/pg_catalog_map.py --raw-dir=/home/nisal/.cache/forge-477-preview/pg-catalog-map
```

The extractor checks the exact local host, port and database, uses a read-only transaction, and exports before filtering. The normalizer rebuilds all maps from those exports and overlays existing editorial, recommendation and dated health evidence. Neither script changes catalog data, runtime eligibility, language fallback or pool publication.
