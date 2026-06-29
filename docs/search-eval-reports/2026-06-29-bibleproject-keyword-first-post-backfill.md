# BibleProject Keyword-First Post-Backfill Search Eval

Date/time: 2026-06-29T21:08:46.731Z to 2026-06-29T21:08:49.928Z

Related roadmap: `docs/roadmap/content-discovery/feat-198-keyword-first-brand-entity-search.md`

## Environment And Harness

- Environment/data source: production Admin internal eval endpoint backed by production Admin data.
- Endpoint: `https://admin.jesusfilm.org/api/internal/search-eval/search`
- Harness identified: Mastra offline search eval runner calls the same Admin internal endpoint and supports `searchMode: "keyword-first"`; this focused run used the endpoint directly to avoid changing the prompt set before ranking is fixed.
- Request shape: `locale="en"`, `languageSlug="english"`, `limit=20`, `contentType="video"`, `mode="keyword-first"`.
- Search mode under test: explicitly `keyword-first`. The response field `searchMode` was `hybrid` for every case, which means the query embedding succeeded; it is not the pipeline selector.
- No embedding rows were deleted. No embedding backfill was run.

## Transcript Evidence Check

Semantic-video remains transcript-backed in this checkout:

- `apps/admin/src/services/hybrid-search-retrievers.ts` builds `searchVideoSemantic` from `WITH transcript_source AS (...)` and `FROM video_transcript_chunk vtc`.
- The same SQL no longer contains `scene_source AS` or `FROM video_scene_locale`.
- Existing retriever tests assert that the semantic SQL contains `transcript_source AS` and does not contain `scene_source AS` or `FROM video_scene_locale`.
- A diagnostic `mode="semantic-only"` call for `Bible Project` succeeded against production and returned timed video rows, but the public/eval response does not expose the evidence table name. Source confirmation is therefore by code/test inspection plus the diagnostic call, not by a response field.

## Query Set

Core brand queries:

- `Bible Project`
- `the Bible project`
- `BibleProject`

Discoverable aliases covered:

- `BibleProject Collection`
- `The BibleProject Collection`
- `Thanks to BibleProject`
- `Bible Project videos`

The `Thanks to BibleProject` alias was discovered from current BibleProject corpus result snippets. Collection aliases were discovered from the known collection title/slug.

## Top Results

### `Bible Project`

| Rank | Title | Slug | Score | BP evidence | Rescue evidence |
| ---: | --- | --- | ---: | --- | --- |
| 1 | The BibleProject Collection | `the-bibleproject-collection` | 0.750 | yes | no |
| 2 | Jesus Fulfills the Law | `jesus-fulfills-the-law` | 0.473 | yes | no |
| 3 | Advent Series | `advent-series` | 0.470 | yes | no |
| 4 | The Lord's Prayer | `the-lord-prayer-bp` | 0.464 | yes | no |
| 5 | Intro to Sermon on the Mount | `intro-to-sermon-on-the-mount` | 0.459 | yes | no |

Pass note: collection and known BibleProject rows dominate the top slots. Leakage note: Rescue Project rows still appear at ranks 14, 15, 17, and 18, above a later known BibleProject row at rank 16.

### `the Bible project`

| Rank | Title | Slug | Score | BP evidence | Rescue evidence |
| ---: | --- | --- | ---: | --- | --- |
| 1 | The BibleProject Collection | `the-bibleproject-collection` | 0.750 | yes | no |
| 2 | Relationship Trumps Fame | `relationship-trumps-fame` | 0.441 | no | no |
| 3 | Gospel Part 4 - Call to Repentance | `gospel-part-4-call-to-repentance` | 0.392 | no | yes |
| 4 | Gospel Part 2 - Jesus | `gospel-part-2-jesus` | 0.386 | no | yes |
| 5 | The Lord's Prayer | `the-lord-prayer-bp` | 0.246 | yes | no |

Fail note: the collection is first, but Rescue Project rows at ranks 3 and 4 outrank known BibleProject corpus rows starting at rank 5.

### `BibleProject`

| Rank | Title | Slug | Score | BP evidence | Rescue evidence |
| ---: | --- | --- | ---: | --- | --- |
| 1 | The BibleProject Collection | `the-bibleproject-collection` | 0.667 | yes | no |
| 2 | The Lord's Prayer | `the-lord-prayer-bp` | 0.328 | yes | no |
| 3 | Jesus Fulfills the Law | `jesus-fulfills-the-law` | 0.323 | yes | no |
| 4 | The Choice | `the-choice` | 0.318 | yes | no |
| 5 | Wealth and Worry | `wealth-and-worry` | 0.313 | yes | no |

Pass note: joined CamelCase brand intent is strong. No Rescue Project rows appeared in the top 20.

### `BibleProject Collection`

| Rank | Title | Slug | Score | BP evidence | Rescue evidence |
| ---: | --- | --- | ---: | --- | --- |
| 1 | The BibleProject Collection | `the-bibleproject-collection` | 0.667 | yes | no |
| 2 | StoryClubs: Jesus Calms the Storm | `storyclubs-jesus-calms-the-storm` | 0.167 | no | no |
| 3 | Finding A Video | `finding-a-video` | 0.164 | no | no |
| 4 | Getting Started Is Easy | `getting-started-is-easy` | 0.161 | no | no |
| 5 | Jesus Vision - John | `jesus-vision-john` | 0.159 | no | no |

Mixed note: exact collection alias ranks the collection first, but generic semantic fill starts immediately at rank 2 instead of continuing with BibleProject children.

### `The BibleProject Collection`

| Rank | Title | Slug | Score | BP evidence | Rescue evidence |
| ---: | --- | --- | ---: | --- | --- |
| 1 | The BibleProject Collection | `the-bibleproject-collection` | 0.667 | yes | no |
| 2 | The Story of the Bible (Episode 2) | `bp-story-of-bible-episode-2` | 0.328 | yes | no |
| 3 | StoryClubs: Jesus Calms the Storm | `storyclubs-jesus-calms-the-storm` | 0.167 | no | no |
| 4 | Jesus Vision - John | `jesus-vision-john` | 0.164 | no | no |
| 5 | Venia | `venia` | 0.159 | no | no |

Mixed note: the collection and one known child lead, but generic semantic fill starts at rank 3.

### `Thanks to BibleProject`

| Rank | Title | Slug | Score | BP evidence | Rescue evidence |
| ---: | --- | --- | ---: | --- | --- |
| 1 | StoryClubs: Jesus Calms the Storm | `storyclubs-jesus-calms-the-storm` | 0.500 | no | no |
| 2 | The BibleProject Collection | `the-bibleproject-collection` | 0.500 | yes | no |
| 3 | Jesus Vision - John | `jesus-vision-john` | 0.492 | no | no |
| 4 | The Lord's Prayer | `the-lord-prayer-bp` | 0.492 | yes | no |
| 5 | Jesus Fulfills the Law | `jesus-fulfills-the-law` | 0.484 | yes | no |

Fail note: a source-credit alias still lets an unrelated semantic hit tie and sort above the collection.

### `Bible Project videos`

| Rank | Title | Slug | Score | BP evidence | Rescue evidence |
| ---: | --- | --- | ---: | --- | --- |
| 1 | Getting Started Is Easy | `getting-started-is-easy` | 0.333 | no | no |
| 2 | Meod / Strength | `meod-strength` | 0.333 | yes | no |
| 3 | The BibleProject Collection | `the-bibleproject-collection` | 0.333 | yes | no |
| 4 | Finding A Video | `finding-a-video` | 0.328 | no | no |
| 5 | Seeing Opportunities | `seeing-opportunities` | 0.323 | no | no |

Fail note: brand-plus-modifier intent is not protected. Generic "videos/app usage" results outrank the collection.

## Pass/Fail Summary

| Case | Result |
| --- | --- |
| `Bible Project` | Pass for top slot and top-12 corpus dominance; fail for later Rescue interleaving above a known BibleProject row. |
| `the Bible project` | Fail. Collection is first, but Rescue Project rows outrank known BibleProject corpus rows. |
| `BibleProject` | Pass. |
| `BibleProject Collection` | Mixed. Collection is first; entity set is not filled before generic semantic results. |
| `The BibleProject Collection` | Mixed. Collection and one known child lead; generic semantic fill starts too early. |
| `Thanks to BibleProject` | Fail. Unrelated semantic result ties and sorts above the collection. |
| `Bible Project videos` | Fail. Generic video/app results outrank the collection. |

## Concrete Relevance Issues

1. The current keyword-first branch is strong for exact core brand forms, especially `BibleProject`, but it is not yet an entity-set ranker.
2. Leading articles and modifier words can still let generic semantic or description-only matches interleave ahead of known BibleProject corpus rows.
3. Rescue Project leakage remains visible for `the Bible project`, where Rescue rows rank 3 and 4 above known BibleProject rows at ranks 5 and lower.
4. Source-credit aliases such as `Thanks to BibleProject` are not recognized as BibleProject entity intent.
5. Collection aliases do not consistently fill with known collection/source children before generic semantic results.

## Recommended Next Step Under feat-198

Implement the smallest brand/entity guard before generic RRF output:

1. Normalize known BibleProject aliases (`bible project`, `the bible project`, `bibleproject`, `bibleproject collection`, source-credit phrases containing `thanks to bibleproject`).
2. Build a BibleProject entity candidate set from collection title/slug, `bp-*` and `*-bp` slugs, and description/source-credit evidence.
3. Rank that entity set first for matched aliases, then append generic semantic fill after the entity set is exhausted.
4. Keep semantic-video retrieval transcript-backed; do not re-enable scene retrieval.
5. Add automated keyword-first eval coverage for the failing aliases above, with explicit checks that Rescue Project rows do not outrank known BibleProject corpus rows for BibleProject intent.

No ranking tune was applied in this pass. The failures above should remain visible until feat-198 implements entity-set ranking.
