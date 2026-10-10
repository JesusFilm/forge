---
title: TV/mobile series-detail 10s render — shared-fragment over-fetch + an un-indexed childDubLanguages aggregation (local timing hides prod cost)
date: 2026-06-19
last_updated: 2026-09-08
category: performance-issues
module: apps/tv, apps/mobile, apps/admin
problem_type: performance_issue
component: graphql_query
root_cause: over_fetch_plus_missing_db_index
resolution_type: code_fix_plus_open_handoff
severity: high
symptoms:
  - The series detail page (/series/[slug], e.g. the "jesus" film) takes up to ~10s to render on real TV / mobile devices.
  - Local dev feels fine; the slowness only shows against the deployed admin.
applies_when:
  - A consumer screen reuses a shared GraphQL fragment that fetches more of an entity than the screen renders.
  - A GraphQL field aggregates across a deep relation (children → dubs) without a supporting composite index.
  - You benchmark a resolver against a small local DB and conclude it is fast.
tags:
  - graphql-overfetch
  - shared-fragment
  - postgres-index
  - childDubLanguages
  - admin-handoff
  - local-vs-prod-latency
  - query-split-bytes-vs-latency
---

> **2026-09-08 update — read this before the hand-off section. The index it asks for has shipped, and `jesus` no longer reaches `/series` on EITHER client.**
>
> - **The admin hand-off is answered.** A partial index covering this exact access path
>   shipped on 2026-06-26 — one week after this doc was written — in
>   `apps/admin/prisma/migrations/0035_watch_video_query_indexes/migration.sql:12`. It was
>   written for the Watch route, not in response to this hand-off, and nobody re-benchmarked
>   `childDubLanguages` against prod afterwards. See "Remaining root cause" below, which is
>   now annotated rather than live.
> - **`jesus` is historical on BOTH clients.** TV PR #1767 made its classification label-only
>   (2026-07-28). Mobile PR #1980 then made its own predicates label-first, so mobile's home
>   shelf and search results no longer send `jesus` to `/series` either. The earlier version of
>   this banner said mobile routing was unchanged; that stopped being true with #1980. See
>   [a record's own children are not a container signal](../logic-errors/tv-childcount-not-a-series-container-signal.md).
> - **Still live on mobile:** mobile's `GET_SERIES_BY_SLUG` continues to fetch
>   `childDubLanguages` on the blocking query (`apps/mobile/src/lib/queries.ts:416`) — it never
>   received TV's Phase 2 lazy split. So the measured shape below is still mobile's behaviour
>   for any genuine high-fan-out SERIES/COLLECTION; only the `jesus` example moved.

## Problem

The TV (and mobile) **series detail** screen — `apps/tv/app/series/[slug].tsx` and
`apps/mobile/app/series/[slug].tsx`, e.g. the
`jesus` film with 61 chapters — took **up to ~10s** to render its content on real
devices. The question was: is the query fetching too much, or is the admin CMS
slow to respond?

**Answer: both, and they are the same cause.** The query asks the admin resolver
to do far too much work at once. The dominant term is a server-side aggregation
with no supporting index.

## Diagnosis (measured)

The TV/mobile clients get their endpoint from **EAS server-side env**
(`EXPO_PUBLIC_GRAPHQL_URL=https://admin.jesusfilm.org/api/graphql`) — _not_ from
`.env.local` (local `127.0.0.1:3003`) or `eas.json`. So any real-device build
talks to **prod admin**. That is why local dev never reproduced it.

Write that local value as `localhost:3003`, not `127.0.0.1:3003`. TV's
`getGraphQLUrl()` rewrites the host for the Android emulator by matching the
literal substring `localhost` (`apps/tv/src/lib/config.ts:7`), so `127.0.0.1`
silently skips the `10.0.2.2` swap and the emulator cannot reach the host.

`GET_SERIES_BY_SLUG` (slug `jesus`), same 1.25 MB payload both times:

|                           | Local admin | Prod admin                 |
| ------------------------- | ----------- | -------------------------- |
| `{ __typename }` baseline | 0.047s      | 0.26–0.45s                 |
| Full `GET_SERIES_BY_SLUG` | **0.45s**   | **7.5s warm / 11.4s cold** |

Per-field prod attribution (≈, warm):

| Field group           | Prod time    | Count | Notes                                                                                         |
| --------------------- | ------------ | ----- | --------------------------------------------------------------------------------------------- |
| `childDubLanguages`   | **2.5–4.9s** | 2,251 | DISTINCT-ON-language over ~137k dub rows (61 children × ~2,250 dubs). **No composite index.** |
| `variants: dubs`      | ~2.4s        | 2,270 | Fetched only to pick **one** trailer dub; `muxVideo` relation resolved per dub.               |
| `parents → siblings`  | ~1.6s        | 208   | **Never rendered on the series screen** — dead weight from the shared watch fragment.         |
| `children` (episodes) | ~1.1s        | 61    | Legitimately needed (episode rail).                                                           |

Only ~90 KB of the 1.25 MB is needed for first paint. The local 0.45s is
unrepresentative: a tiny DB + OS page cache + loopback hid the real cost.

## What was fixed (apps/tv + apps/mobile)

A series-specific lean fragment `SeriesWatchVideo` (parallel to the watch
screen's `WatchVideo`, which is unchanged), applied to both apps:

- **Drops the `parents → parent → children` sibling chain** — the series screen
  renders its `EpisodeRail`/grid from its OWN `children` and never shows siblings
  (that's the watch screen's Up Next).
- **Drops each dub's `duration` + `muxVideo.playbackId`** — player-only fields;
  the series screen needs only a playable `hls` + `language` for the trailer.
- Keeps `variants: dubs` (lean), `children`, and `childDubLanguages`.

The normalizer's `buildWatchVideoRecord` input type was widened
(`NormalizableVideo` / `NormalizableVariant`: `parents` + per-variant player
fields optional) so the one shared builder accepts both the full watch shape and
the lean series shape, with no loss of type safety. Over-fetch guard tests added:
`apps/tv/src/lib/videoQueries.test.ts`, `apps/mobile/src/lib/__tests__/queries.test.ts`.

**Measured impact (prod, slug `jesus`):**

|                | Before    | After trim        |
| -------------- | --------- | ----------------- |
| Payload        | 1.25 MB   | **854 KB** (−32%) |
| Latency (warm) | 7.5–11.4s | **5.3–5.7s**      |

## Remaining root cause — HAND-OFF to admin owner (do NOT fix in the consumer apps)

> **Answered 2026-06-26; verification still open.** An equivalent partial index
> shipped in `apps/admin/prisma/migrations/0035_watch_video_query_indexes/migration.sql:12`:
>
> ```sql
> CREATE INDEX IF NOT EXISTS "video_dub_watch_playable_language_idx"
>   ON "video_dub"("video_id", "language_id", "duration" DESC, "id" ASC)
>   WHERE "deleted_at" IS NULL AND "published" = true
>     AND "hls" IS NOT NULL AND "language_id" IS NOT NULL;
> ```
>
> It is stronger than the recommendation below on two counts: `language_id` is the
> second key column rather than the fourth, which is what a `DISTINCT ON (language_id)`
> wants, and `deleted_at`/`published` moved into a partial `WHERE`, so the index is
> physically smaller instead of merely sorted. Its predicate matches the resolver's four
> scalar filters field for field (`video.service.ts:3446-3452`), including the
> `hls IS NOT NULL` and `language_id IS NOT NULL` the recommendation below omitted.
>
> **Three things this does NOT establish.** The migration header says it covers "the
> production query shapes observed in Datadog APM for videoBySlug/watch route snapshots" —
> it was not written for this hand-off. Nothing in the repo shows anyone re-benchmarked
> `childDubLanguages` against prod afterwards, so the 2.5–4.9s figure below is unretired,
> not disproven. And two resolver predicates remain uncovered by any index: the
> `language: { slug: { not: null }, deletedAt: null }` join, and the
> `video: { …childVisibility, parents: { some: { parentId } } }` subquery, which since
> PR #1830 also carries `notRestrictedFromWatchWhere()`.
>
> The analysis below is kept because it is what makes that index legible. Treat it as the
> diagnosis, not as open work.

The residual ~5.3s is dominated by **`childDubLanguages`** (2.5–4.9s). The
consumer apps cannot fix this; it is an admin DB/resolver issue.

- Resolver: `apps/admin/src/services/video.service.ts` (`getChildDubLanguages`,
  L3411–3475; the method opens at `:3431`) exposed at
  `apps/admin/src/graphql/types/video.ts:668-678`. (Both citations were re-checked
  2026-09-08; the earlier ~L1575 / ~L476 line numbers had drifted badly.)
- It runs a `VideoDub` `findMany` filtered by `video.parents { some { parentId } }`
  with `DISTINCT ON (languageId)` — scanning ~137k candidate rows then sorting.
- Existing indexes **as of 2026-06-19** (`VideoDub(videoId)`, `VideoDub(languageId)`,
  `VideoRelation(childId)`, `VideoRelation(parentId, childId)`) did **not** support
  this access path; on a large prod table the planner does a big scan + sort.
  That inventory is now out of date — `VideoDub` carries seven `@@index` entries in
  `apps/admin/prisma/schema.prisma` plus four raw-SQL partial indexes from migrations
  0035 and 0041, including the covering one quoted above. Re-read the schema before
  citing this list.

**Recommended fix (admin migration):** add a composite index, e.g.

```sql
CREATE INDEX CONCURRENTLY video_dub_video_lang_idx
  ON video_dub (video_id, deleted_at, published, language_id);
```

to enable an index-only path and drop the sort. This benefits **both** mobile and
TV (first paint and the language panel). Optional follow-ups: a server-side
`published` filter / pagination on `dubs`, and a cheap `childDubLanguagesCount`
field so the hero "N languages" count doesn't require the full list.

## Phase 2 — lazy-load `childDubLanguages`, and benchmark which list dominates (2026-06-30, PR #1424)

After the phase-1 trim, `GET_SERIES_BY_SLUG` (slug `jesus`) measured **835.6 KB / 884 ms
warm** (prod, warm median of 10). Two heavy per-language lists remained:
`childDubLanguages` (the language union) and `variants: dubs`. The open question —
_which one dominates the 835 KB?_ — cannot be read off the query; it was settled only
by benchmarking each list separately.

U1 (apps/tv) lazy-loaded `childDubLanguages` off the initial fetch into a secondary
`GetSeriesLanguages` query (`apps/tv/src/lib/videoQueries.ts`), sourcing the hero count +
language panel from that query's own state so the lean record stays referentially stable
(the WeakMap-memoized `normalizeSeries` never re-walks the dub list on cache-first
re-entry).

**Measured (prod, slug `jesus`, warm median of 10):**

| Operation                               | resp KB | warm median | warm TTFB | cold   | p95    |
| --------------------------------------- | ------- | ----------- | --------- | ------ | ------ |
| `GetSeriesBySlug` — before (both lists) | 835.6   | 884 ms      | 741 ms    | 842 ms | 943 ms |
| `GetSeriesBySlug` — after, lean (U1)    | 693     | **630 ms**  | 489 ms    | 588 ms | 711 ms |
| `GetSeriesLanguages` — after, lazy (U1) | 142.6   | 674 ms      | 641 ms    | 680 ms | 913 ms |

**The split resolved the open question — and bytes vs latency live in _different_ lists:**

- `childDubLanguages` is only **~142.6 KB**, but it carried the **latency** (its unindexed
  `DISTINCT-ON` aggregation). Moving it off the blocking fetch cut warm latency
  **−254 ms / −29%** (884 → 630 ms) — the hero + episode rail paint without waiting on it.
- `variants: dubs` (~**693 KB**, still on the lean query) is the **byte** hog — but cheap to
  serve now that phase-1 dropped its per-dub `muxVideo` resolution. So the payload fell only
  **−17%** (835.6 → 693 KB).

The intuitively-guilty field — named "languages," with the visible aggregation cost — was the
**latency** driver but the **byte** minor. The next, higher-value payload follow-up (trim
`variants: dubs`) was identifiable **only** from this per-field split.

## New TV fan-out surface from the reclassification (2026-07-28, PR #1767)

`GET_VIDEO_BY_SLUG` (`apps/tv/src/lib/videoQueries.ts`) now selects the video's own
`children` — card fields only, no `dubs` and no `childDubLanguages` — to power the Chapters
rail on `/watch` for the ten reclassified films (up to ~61-73 children each). This is a
different fan-out from the `childDubLanguages` aggregation measured above and has **not** been
benchmarked against prod. Apply the same per-field `size_download` / `time_total` split from
Phase 2 before assuming it is negligible; do not carry the numbers above over to it.

## The META lesson

1. **A shared GraphQL fragment is over-fetch the moment a second screen reuses it
   for less.** The series screen inherited the watch screen's sibling chain +
   player-only dub fields. Split a lean fragment per consumer; guard it with a
   `print()`-based jest test so it can't silently re-fatten.
2. **Local resolver timing proves nothing about prod.** A small DB + page cache +
   loopback hid a 12× aggregation cost. Benchmark suspect resolvers against a
   prod-sized dataset, or read the query plan — don't trust the local stopwatch.
3. **Know where the deployed app's endpoint actually comes from.** In 2026-06 it was
   EAS server-side env for both clients, not any file in the repo — so the only
   locally-configured endpoint (`127.0.0.1:3003`) was never the one users hit.
   **The two clients have since diverged, which is the sharper version of the lesson:**
   `apps/tv` still reads a required `EXPO_PUBLIC_GRAPHQL_URL` with no in-code default
   (`apps/tv/src/env.ts:8`), while feat-339 moved `apps/mobile` to
   `EXPO_PUBLIC_ADMIN_GRAPHQL_URL` resolved by `apps/mobile/src/lib/adminEndpoint.ts` —
   which holds the production default IN the repo, deliberately leaves the variable
   unset in EAS, and makes a development bundle default to local admin and refuse
   production outright. So re-derive the endpoint per app at the time you need it; the
   answer moved once already, and it moved in the direction this lesson said to expect.
4. **Bytes and latency can live in different sub-lists — benchmark each, don't guess
   which to defer.** After the phase-1 trim, `childDubLanguages` (~142 KB) carried the
   latency while `variants: dubs` (~693 KB) carried the bytes; lazy-loading the
   latency-dominant list won −29% latency but only −17% payload. Before splitting a query
   that has 2+ heavy lists, measure `size_download` **and** `time_total` per field (warm
   median vs prod, e.g. `curl -w '%{size_download} %{time_total}'`) — an aggregation field
   (`DISTINCT-ON`/`GROUP BY`/union) is the latency suspect, a flat per-row list is the byte
   suspect, and they are usually not the same field.
