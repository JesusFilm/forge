# JFP Semantic Search — Current State and Improvement Plan

**Author:** Generated with Claude (collaborative session with Nisal)
**Date:** 2026-04-28
**Scope:** `apps/cms` semantic search service, `scene_embeddings` table, `apps/web` consumers, and the planned TV app search UI (`feat-106`).

---

## 1. How the Semantic Search API Works Today

### 1.1 Entry points

- **GraphQL (primary)** — `Query.semanticSearch`, registered in `apps/cms/src/graphql/search.ts:48`.
  - Args: `query: String!`, `locale: String!`, `limit: Int`, `offset: Int`, `type: String` (`"video" | "experience"`).
  - Auth-disabled (`resolversConfig: { "Query.semanticSearch": { auth: false } }`).
  - IP rate-limited via `SEARCH_RATE_LIMIT` (shared bucket key with the REST middleware so a caller can't bypass the limit by alternating endpoints).
  - Empty/whitespace queries return `BAD_USER_INPUT`; downstream failures are wrapped as `SERVICE_UNAVAILABLE`.
- **REST** — uses the same `search()` service in `apps/cms/src/api/search/services/search.ts:161`.

### 1.2 Response shape

```ts
type SearchResponse = {
  results: SearchResult[]
  hasMore: boolean
  query: string
  searchMode: "hybrid" | "keyword-only"
}

type SearchResult = {
  type: "video" | "experience"
  id: number
  slug: string
  title: string
  imageUrl: string | null
  snippet: string
  startSeconds: number | null // null for experiences and keyword-only video matches
  playbackId: string | null // null for experiences and keyword-only video matches
  score: number
}
```

`searchMode` is the explicit degraded-mode signal: `"keyword-only"` means OpenRouter's embedding call failed and the response was assembled from keyword retrieval alone. Clients can render an "advanced search temporarily unavailable" affordance when this fires.

### 1.3 Pipeline (`search.ts:161`)

1. **Embed query** via `embedQuery()` (OpenRouter). Failure is non-fatal — it logs `query_embedding_failure`, calls `recordAttempt` / `recordFailure` (process counters surfaced at `/api/search/health`), and falls back to keyword-only.
2. **Parallel retrieval** with `Promise.allSettled` over up to 4 lists, each over-fetched at `limit * 3`:
   - `searchBySemantic` — video scenes via pgvector cosine similarity.
   - `searchByKeyword` — video Postgres FTS.
   - `searchByExperienceSemantic` — experience-level pgvector.
   - `searchByExperienceKeyword` — experience-level FTS.
   - The `type` arg gates which lists actually fire. Per-list failures degrade to `[]` so one broken retrieval doesn't kill the response.
3. **Reciprocal Rank Fusion** (`fuseRankedLists`, `RRF_K = 60`). Empty lists are filtered out first, otherwise RRF's 1/N normalization gets diluted.
4. **Deduplicate** — 3-layer for videos (multi-scene hits collapse to one row per video), pass-through for experiences. Dedup fetches `offset + limit + 1` to compute `hasMore` without a count query.
5. **Paginate + map** to the `SearchResult` contract.

### 1.4 Filtering by content type

The `type` arg (`search.ts:173-178`) controls which retrievals run:

- `type: "video"` — video semantic + video keyword only.
- `type: "experience"` — experience semantic + experience keyword only.
- omitted / empty — all four lists, fused together so video scenes and experience pages can interleave in one ranked stream by RRF score.

Validation lives at the GraphQL boundary; anything other than `"video"` / `"experience"` returns `BAD_USER_INPUT`.

---

## 2. How Videos Are Embedded

CMS does not compute embeddings — it only persists them. The Manager service (the AI pipeline) segments videos into scenes, generates per-scene metadata + an embedding vector, and POSTs the batch to CMS. CMS writes via `indexSceneEmbeddings()` in `apps/cms/src/api/scene-embedding/services/indexer.ts:267`.

### 2.1 Index-time flow

1. Manager segments video into scenes and produces, per scene: a description, theme/verse/demographic/spiritual-context facets, Mux playback metadata, and an embedding vector (default model `text-embedding-3-small`).
2. Manager POSTs the batch keyed by `videoId` or `videoDocumentId`. Unpublished videos are rejected (`unpublished_video`).
3. CMS opens a transaction, **deletes existing rows** for that `video_id`, then bulk-inserts in batches of 30 rows (~480 bindings, well under PG's 65535 param ceiling). Re-indexing a video is destructive/atomic — there is no partial update path.

### 2.2 `scene_embeddings` table

Columns inserted at `indexer.ts:325-332`:

| Column                                        | Type / Source                                             |
| --------------------------------------------- | --------------------------------------------------------- |
| `video_id`                                    | FK to `videos.id`                                         |
| `core_id`                                     | optional cross-system identifier                          |
| `mux_asset_id`, `playback_id`                 | for Mux deep-links from the client                        |
| `scene_index`, `start_seconds`, `end_seconds` | scene timestamp (drives the deep-link)                    |
| `description`                                 | per-scene natural-language summary; returned in `snippet` |
| `themes`                                      | `text[]` facet                                            |
| `bible_verses`                                | `text[]` facet                                            |
| `demographics`                                | `text[]` facet                                            |
| `spiritual_context`                           | `text[]` facet                                            |
| `chapter_title`                               | optional                                                  |
| `embedding`                                   | pgvector `vector` column                                  |
| `model`                                       | embedding model name (default `text-embedding-3-small`)   |
| `language`                                    | source language of the description (default `en`)         |

### 2.3 What ends up in the embedding

Manager builds the embedded text from the **scene description plus its facets**: `themes`, `bible_verses`, `demographics`, `spiritual_context`, `chapter_title`. The embedding is **scene-level**, not video-level — and crucially the parent video's title is **not** in the vector today.

At query time (`semantic-search.ts:56`), the SQL is:

```sql
1 - (se.embedding <=> ?::vector) AS similarity
... ORDER BY se.video_id, se.embedding <=> ?::vector
```

with `DISTINCT ON (se.video_id)` to return the single best-matching scene per video. Locale filtering joins through `video_variants → video_variants_language_lnk → languages.bcp_47` — a video only surfaces if it has a published variant in the requested locale.

Experience embeddings are page-level (one vector per experience), which is why experience hits never carry timestamps.

---

## 3. What the Current Search Does Well

- **Thematic / topical recall** — "forgiveness," "the prodigal son," "facing doubt" land well because description + theme facets dominate the embedded text.
- **Bible-reference queries** — "Luke 15," "John 3:16" hit the `bible_verses` facet directly via the embedding.
- **Audience / context queries** — "for teenagers," "for grief" match via the `demographics` and `spiritual_context` facets.
- **Scene-precision deep-links** — semantic matches return `startSeconds` + `playbackId`, enabling "jump to the moment."
- **Graceful degradation** — embedding outages flip to `searchMode: "keyword-only"`. The product still works; the client knows it's degraded.
- **Partial-failure resilience** — `Promise.allSettled` over the four retrievals means one slow/broken path can't take down the response.
- **Locale correctness** — non-English locales never see videos that lack a published variant in that locale.

---

## 4. What the Current Search Does Poorly

These are the gaps that show up when comparing to an "Algolia-quality" experience.

### Worked example — `"the Bible project"`

A user searching `"the Bible project"` (a well-known video series) gets a mix of Bible Project videos and unrelated videos containing the word "project." Algolia, configured against the same catalog, would return a clean Bible Project set on page 1. Three of the gaps below combine to cause this:

- `plainto_tsquery('simple', 'the Bible project')` flattens to `bible & project` — phrase adjacency is lost, so any video whose title or description contains both words anywhere ranks.
- The keyword tsvector is `to_tsvector('simple', title || ' ' || description)` — a description hit on "project" weighs the same as a title hit on "Bible project."
- The semantic retriever has no notion of phrases — for `"the Bible project"` it pulls in videos thematically near "bible" + "ministry" + "project," not just The Bible Project series. RRF then fuses the diluted lists and the tail leaks into the top results.

**The "Algolia-quality" target for this query is concrete:** every result on page 1 is from the Bible Project series, and no non-matching title outranks a matching one. This is the canonical failure mode the §6 work is designed to close.

### The full gap list

- **No typo tolerance.** "frgive" returns nothing. Postgres FTS doesn't fuzzy-match and we don't run `pg_trgm`.
- **No prefix matching.** "for" doesn't match "forgiveness" — kills the as-you-type feel.
- **Title is invisible to the embedding.** Proper-noun queries ("Zacchaeus", a film name) rely entirely on the keyword path; if the keyword path doesn't match exactly, the result is buried.
- **No exact-title boost.** A video whose title is literally the query can rank below a thematically-adjacent semantic match.
- **No business-ranking layer.** No popularity, recency, or editorial-boost signal — RRF score is the only ordering. Results feel "clever" rather than "intentional."
- **Single-video flooding.** `DISTINCT ON video_id` is enforced _within_ the semantic list, but after fusion + dedup a popular video can still dominate the page if the dedup bound is loose.
- **Locale ranking is monolingual under the hood.** Filtering is locale-aware, but the embedded text is the English description regardless of the user's language. Spanish queries get correct filtering but English-quality ranking.
- **No synonyms.** Salvation/saved, gospel/good news, Christ/Jesus/Messiah, scripture/Bible/Word — Postgres doesn't know any of these. Ministry vocabulary needs an explicit dictionary.
- **No facets / filters in the response.** Clients can't render "filter by theme / verse / demographic" UI without doing a second query.
- **No telemetry.** Queries, returned IDs, and click-throughs are not logged. Every tuning change is a guess.
- **One vector per scene.** Description + facets are blended into a single vector — "what happens" and "what it's about" dilute each other.
- **Destructive reindex.** Re-indexing a video deletes all its rows in one transaction. Bigger libraries will eventually want partial / incremental update paths.

---

## 5. Extending the Demographics / Persona Signal

The current `demographics` and `spiritual_context` columns are flat `text[]`s — fine for a handful of values, painful when personas get structured (e.g. "age 25–34, post-evangelical, parent, struggling with anxiety"). A two-tier approach:

### 5.1 Tier 1 — Personas as first-class facets

- Add a `Persona` content type in CMS: `slug`, `label`, `description`, optional `parent` for hierarchy.
- Add a `personas text[]` column to `scene_embeddings` (and the experience equivalent), populated by Manager from the controlled vocabulary.
- Backfill existing rows the same way `bible_verses` was added.
- Expose `personas` in the `filters` arg (Section 6.2) so clients can hard-filter and facet-count by persona.
- **Concatenate persona labels + descriptions into the embedded text** so semantic queries like "videos for someone questioning their faith" surface persona-tagged scenes even without an explicit filter — same lever that already makes `themes` and `spiritual_context` pull weight.

### 5.2 Tier 2 — Persona-aware ranking (query-time blend)

- Embed each `Persona` record's description once and store it on the persona row.
- At query time, blend the user's selected persona vector into the query vector:
  `query_vec = normalize(0.7 * query + 0.3 * persona)`.
- No schema change to `scene_embeddings`, no extra retrieval, no re-index cycle. Weight is A/B-tunable in code.
- This is also the seam for future "user profile" personalization without rebuilding the index.

### 5.3 What to avoid

- **No free-text persona field.** Facet counts collapse and Algolia-style filter UI becomes impossible. Always controlled vocabulary in CMS.
- **Don't make personas a hard SQL `WHERE` filter as the only signal.** Hard filters kill recall; the embedding-blend approach degrades gracefully when no scene matches the persona perfectly.
- **No nested JSONB persona blob.** Flat `text[]` of persona slugs + a separate `Persona` content type for the metadata is much cheaper to query, index, and facet.

### 5.4 Suggested order

1. Add `Persona` content type + `personas text[]` column + backfill (1–2 days).
2. Wire personas into the embedded text on next reindex.
3. (Section 6) Ship facets + trigram + grouped results — personas come along for free as another facet.
4. Only then evaluate query-time persona-vector blending and the document-level index.

---

## 6. Adding Algolia-like Functionality

Two questions to separate: **does it return Algolia-quality results?** and **does it look like Algolia to clients?** This section covers both, but the _result quality_ changes are where the real wins are.

The operational definition of "Algolia-like" we're targeting is the worked example in §4: when a user types a known title — `"the Bible project"` is the canonical case — every result on page 1 should be from that series, and no non-matching title should outrank a matching one. Each subsection below addresses one piece of that gap.

### 6.1 Result quality (the changes that actually matter)

#### Lexical layer — close the typo / prefix / exact-match gaps

- **Typo tolerance via `pg_trgm`.** Add the extension via the existing `bootstrap/ensure-pgvector.ts` pattern. GIN trigram indexes on `videos.title`, `scene_embeddings.description`, plus per-field similarity scoring. Approximates Algolia's "1 typo for ≥4 chars, 2 for ≥8."
- **Prefix matching.** Append `:*` to the trailing token in `to_tsquery`, or use `text_pattern_ops` on lowercased title.
- **Exact-phrase boost.** If the raw query string appears verbatim in `title`, that hit gets a fixed bonus _after_ RRF (RRF normalizes away the magnitude that makes exact-match special).
- **Searchable-attribute weighting.** Run keyword as three ranked lists — title-trigram, description-FTS, facets-FTS — weighted ~3× / 1× / 0.5×. Today they collapse into one undifferentiated keyword list.

#### Business ranking — make results feel curated

- Add `popularity_score`, `editorial_boost`, expose `published_at` on `videos` (and `experiences`).
- Recompute `popularity_score` nightly from view/play/completion counts.
- After RRF + dedup, **re-sort within score bands** (results within ~5% RRF score of each other) by `editorial_boost DESC, popularity_score DESC, published_at DESC`. This is Algolia's `customRanking` analog and is the single biggest "feels intentional" lever.

#### Stop letting one strong semantic hit bury obvious matches

- **Hard floor for exact-token title matches.** If any video's title contains all query tokens, it's guaranteed a top-N slot regardless of semantic score.
- **Demote semantic-only hits without lexical overlap.** A result that appears _only_ in the semantic list and below similarity ~0.55 is demoted. Algolia would never return a "vibes match" with no lexical signal.
- **Per-video diversity across the fused page.** Cap any single video to one hit in the page (best scene wins), not just within the semantic list.

#### Make the embedded text look more like what people type

- **Append the parent video's title to every scene's embedded text** before embedding. One-line change in Manager's prompt, then a full reindex. Massively improves proper-noun queries.
- **Two vectors per scene** (longer-term): one for "what happens" (description), one for "what it's about" (themes + verses + spiritual_context). Store both, query both, take the max similarity. Today they dilute each other in one vector.

#### Locale + variant handling

- Short term: keyword-search the localized `video_variant.title` / `video_variant.description` columns when present, weight those above the English scene description for non-English queries.
- Longer term: per-locale embeddings. The `language` column on `scene_embeddings` already exists; Manager generates one row per (scene, locale). Expensive but it's the only way "search in Spanish" feels Algolia-quality.

#### Synonyms + stopwords

- Small `search_synonyms` content type in CMS (or a Postgres dictionary). Rewrite the query string before _both_ the keyword path and the embedding call. ~2 days of work, probably worth ~10% of perceived quality.
- Strip ministry-specific stopwords ("video," "watch," "about") that users type but don't help retrieval.

#### Telemetry — so tuning isn't a guess

- Log every query + the top 10 returned `objectID`s + which one (if any) the user clicked.
- Weekly "queries with zero clicks" report — finds ranking failures.
- Weekly "queries where the click was below position 5" — finds near-misses to tune.

### 6.2 API shape — backwards-compatible additions

Most clients (and most third-party Algolia widgets) want richer per-hit and per-response data. Add to the existing `semanticSearch` query as nullable fields:

- `filters: { themes?, demographics?, personas?, bibleVerses? }` — composed into both retrieval SQLs.
- `facets: [String!]` — opt-in facet counts; returned as a new optional `facets` field on `SearchResponse` shaped `Record<facetName, Record<value, count>>`.
- `mode: "instant" | "full"` — fast-path that skips `embedQuery()` and trims over-fetch, for as-you-type calls.

A second sibling resolver pair is justified for:

- `searchSuggestions` — autocomplete for the search box (top queries, top titles, prefix completions). Different ranking goals than result search.
- `recordSearchClick` — telemetry mutation. Has to be separate because it's a write.

### 6.3 Order of operations (biggest perceived-quality jumps first)

1. Synonyms + title-in-embedding + exact-title boost — ~1 week. Transforms proper-noun search.
2. Trigram typo tolerance + prefix matching — ~1 week. Kills the "I made a typo and got nothing" failure.
3. `popularity_score` + `editorial_boost` re-sort within score bands — ~1 week. Makes results feel intentional.
4. Per-video cap in fused page + semantic-only floor — ~½ day. Removes the most jarring wrong-result moments.
5. Telemetry — ~½ week. Unlocks every tuning decision after this.
6. Per-locale embeddings — only after the above are in place and you can measure that locale ranking is the next bottleneck.

---

## 7. Extend, Don't Fork

All of Section 6 is an **extension of the existing `semanticSearch` query and the existing `search()` orchestrator**. A second API would mean two pipelines to keep in sync, two rate-limit buckets, two health endpoints, two client integrations — and the underlying retrieval (`scene_embeddings` + `video_variants` joins) is exactly what you'd reuse anyway.

Where each change lands inside `apps/cms/src/api/search/`:

| Change                                                   | File / location                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Synonyms (query rewrite)                                 | new `search-synonyms.ts`, called at top of `search()` before `embedQuery()` and keyword fan-out                        |
| Title-in-embedding                                       | Manager prompt change + reindex via existing `indexSceneEmbeddings()` — no CMS code change                             |
| Exact-title boost / semantic-only floor / per-video cap  | new `rerank.ts`, inserted between `fuseRankedLists()` and `deduplicateResults()` (`search.ts:263`)                     |
| Business ranking (`popularity_score`, `editorial_boost`) | new columns on `videos` / `experiences` + nightly job; rerank step reads via single `WHERE id = ANY(...)`              |
| Trigram + prefix + per-attribute weighting               | rewrite of `keyword-search.ts` and `experience-keyword-search.ts`; add `pg_trgm` via new `bootstrap/ensure-pg-trgm.ts` |
| Per-locale embeddings                                    | use existing `language` column; add `WHERE language = ?` in `searchBySemantic`                                         |
| Telemetry                                                | new `search_queries` log table + thin write at end of `search()`                                                       |
| `filters` / `facets` / `mode` args                       | nullable additions on existing `Query.semanticSearch` resolver                                                         |
| `searchSuggestions` / `recordSearchClick`                | sibling resolvers in `graphql/search.ts`                                                                               |

The pipeline already has the right shape — embed → parallel retrieval → fuse → dedup → paginate. We're inserting a re-rank step, swapping the keyword implementation, and adding query rewriting at the front. That's an evolution of one service, not a parallel system.

---

## 8. Other Improvements Worth Considering

Beyond the Algolia parity work, these are smaller-footprint changes that compound:

- **Query embedding cache.** A short-TTL (e.g. 15 min) Redis or in-process LRU keyed on the normalized query string. Repeat queries from the floating search bar dominate traffic and OpenRouter cost.
- **HNSW or IVFFlat index on `scene_embeddings.embedding`.** Today's pgvector queries likely scan more than they need to once the table grows past a few hundred thousand scenes. HNSW is the modern default; IVFFlat needs `lists` tuned to row count.
- **Health endpoint surfacing.** The `recordAttempt` / `recordFailure` counters are exposed at `/api/search/health` but nothing alerts on them. Wire to whatever monitoring stack JFP uses; an extended `keyword-only` window should page someone.
- **Partial / incremental reindex.** Today a single scene change re-deletes and re-inserts every scene for the video. A `(video_id, scene_index)` upsert path would let Manager update one scene at a time.
- **Embedding model versioning.** The `model` column exists but isn't used at query time. Mixed-model rows in the same table will quietly degrade results. Either enforce single-model-per-table or constrain queries to the active model.
- **Result caching at the orchestrator.** Identical (query, locale, filters, type, page) tuples are common. A 60-second cache layer on `search()` would cheaply handle bursts (TV app idle screens, popular landing pages).
- **Search request batching for the TV app.** `feat-106` will likely need both a "all" and per-type render — accept `types: [String!]` and return one response with grouped lists, instead of forcing the client to make N calls.
- **Schema-level `search_documents` view (longer term).** Not a separate API, but a unifying SQL view across `scene_embeddings` + `experience_embeddings` (+ future `articles`, `devotionals`) so cross-type ranking has a single source. Only worth it once a third indexable type lands.
- **Embedding regeneration playbook.** When the embedded text recipe changes (adding title, adding personas, switching models), the cost of a full reindex needs an owner, a budget, and a Manager runbook. Today this is tribal knowledge.
- **Quality regression tests.** A small "golden set" of (query → expected top-5 video IDs) pairs, run in CI against staging. Catches "the rerank tweak broke the 'forgiveness' result" before users do.

---

## 9. Going Multilingual

Locale handling today is **filter-correct, ranking-monolingual**: a Spanish user only sees videos with a published Spanish variant, but the meaning vector and the keyword index are both built from the English scene description. So semantic match quality drops sharply outside English, and keyword search outside English depends entirely on whether localized variant titles/descriptions exist.

True multilingual search means three independent things, in roughly this order of leverage:

### 9.1 Multilingual embedding model

`text-embedding-3-small` is multilingual but uneven across languages. Two paths:

- **Use a single multilingual embedding model end-to-end.** Stay with `text-embedding-3-small` (or upgrade to `text-embedding-3-large` if budget allows) and embed the user's query in whatever language they typed. The model maps "perdón" and "forgiveness" to nearby points in vector space, so an English-embedded scene can still match a Spanish query. This works _today_ with no schema change — the gap is mostly that we haven't measured it.
- **Use a model with stronger non-English performance** (Cohere `embed-multilingual-v3`, BGE-M3, or similar). These specifically train on parallel multilingual corpora and beat OpenAI's models on cross-lingual retrieval benchmarks. Switching means a full reindex and a `model` column update on `scene_embeddings`.

The embedding model is a single source-of-truth choice — mixing models in the same `embedding` column quietly degrades cosine distance comparisons. The `model` column on `scene_embeddings` exists; we just don't currently enforce single-model queries.

### 9.2 Per-locale scene descriptions

Even the best multilingual model loses information when the _source_ text is monolingual. The fix is to give each scene a description **in each supported locale** and embed each one separately:

- The `language` column on `scene_embeddings` already exists for exactly this — each (scene, locale) becomes its own row with its own embedding.
- Manager generates localized scene descriptions (likely via translation of the English description, or by re-running the scene-description prompt against a localized transcript).
- `searchBySemantic` adds a `WHERE language = ?` clause matching the request locale. Falls back to English rows when no localized row exists for that scene.

This is a multiplicative storage and embedding cost (`scenes × locales`), so it's the most expensive change in the whole report. Sequencing matters: do 9.1 first, measure how good single-model multilingual retrieval is, then only invest in 9.2 for locales where the gap is still material.

### 9.3 Multilingual keyword path

Trigram and FTS need per-language treatment:

- **FTS configurations.** `to_tsvector('english', ...)` is the default; we need `to_tsvector('spanish', ...)` etc. for stemming and stopword handling per language. Postgres ships dictionaries for major Romance/Germanic/Slavic languages; smaller languages need an `unaccent`-only fallback.
- **Per-locale tsvector columns** on `scene_embeddings` (or a single column whose `regconfig` is computed from `language`). The cleaner pattern is one `tsvector_<locale>` column per supported locale, indexed independently.
- **Trigram is language-agnostic** so `pg_trgm` (Section 6.1) Just Works for typo tolerance across locales — but only on the localized text columns, not the English ones.
- **Variant title/description columns** on `video_variants` already hold localized text. Keyword search should query these for the request locale before falling back to the English scene description.

### 9.4 Query-side handling

- **Detect or trust the request locale.** GraphQL already requires a `locale` arg. Use it as the embedding language, the FTS configuration, and the keyword path locale. Don't try to detect from the query string — too unreliable, and the variant filter already constrains us to the right pool.
- **Optional cross-locale fallback.** If a query in `es` returns < N results, optionally re-run against the `en` index and label the results as "from English content." Useful for languages with thin coverage; opt-in via a request flag so it doesn't dilute the primary experience.
- **Synonyms (Section 6.1) become per-locale.** The `Synonym` content type needs a `locale` field. Salvación/salvado is a different mapping than salvation/saved.

### 9.5 Personas + multilingual

Personas (Section 5) interact with multilingual in one important way: the persona descriptions used in the embedded text and the query-time blend (5.2) must exist **in each locale** for those locales to benefit. Otherwise a persona blend in Spanish is mixing an English-centric persona vector into a Spanish query vector, which dilutes both signals. Add `localizations` to the `Persona` content type from day one, even if only English is populated initially.

### 9.6 Sequencing recommendation

1. **Measure first.** Pick 50 representative non-English queries per priority locale, run them today, score the results manually. This is the baseline.
2. **Embed query in user's language with the existing model.** Free win if it works — no schema change. Re-score the 50.
3. **Add per-locale FTS configuration + query localized variant text.** Closes most of the keyword gap. Re-score.
4. **Decide on per-locale scene descriptions** based on remaining gap. Don't pay for this if 1–3 already close it.
5. **Consider switching to a multilingual-first embedding model** (Cohere, BGE) if even per-locale descriptions don't close it for priority locales.

### 9.7 Cost and operational notes

- **Embedding cost scales linearly with locales** if we go to per-locale descriptions. For N locales × M scenes, plan for N × current OpenRouter spend on reindex.
- **Storage scales similarly** — `scene_embeddings` becomes ~N times larger. Vector index (HNSW/IVFFlat) becomes important sooner.
- **Manager throughput** is the bottleneck for backfills. Per-locale reindexes should be staggered, not parallel.
- **Locale rollout is per-locale**, not all-at-once. Ship one priority locale end-to-end (descriptions + embeddings + FTS + synonyms) before starting the next.
- **Prompt caching considerations** — translated descriptions are deterministic given the source; cache them to avoid re-translation on every reindex.

---

## Appendix — File Reference

- `apps/cms/src/graphql/search.ts` — GraphQL resolver, rate limit, validation.
- `apps/cms/src/api/search/services/search.ts` — orchestrator (embed → fan-out → fuse → dedup → paginate).
- `apps/cms/src/api/search/services/semantic-search.ts` — pgvector cosine SQL for video scenes.
- `apps/cms/src/api/search/services/keyword-search.ts` — Postgres FTS for videos.
- `apps/cms/src/api/search/services/experience-semantic-search.ts` — pgvector for experiences.
- `apps/cms/src/api/search/services/experience-keyword-search.ts` — FTS for experiences.
- `apps/cms/src/api/search/services/fusion.ts` — RRF + dedup.
- `apps/cms/src/api/search/services/search-health.ts` — embedding-failure counters.
- `apps/cms/src/api/scene-embedding/services/indexer.ts` — scene_embeddings write path (Manager → CMS).
- `apps/cms/src/bootstrap/ensure-pgvector.ts` — extension bootstrap pattern (model for `pg_trgm` add).
- `apps/web/src/components/FloatingSearchBar.tsx` — primary web consumer.
- `docs/roadmap/topic-experiences/feat-106-tv-app-search-ui.md` — TV app consumer; this report's Section 6.2 additions are backwards-compatible with that ticket.
