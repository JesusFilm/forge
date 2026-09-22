---
id: "feat-533"
title: "Watch sitemap covers every playable language, not just ISO-639-1 ones"
owner: "vlad"
priority: "P0"
status: "in-progress"
start_date: "2026-09-22"
duration: 1
depends_on:
  - "feat-184"
blocks:
  - "feat-538"
tags:
  - "platform"
  - "web"
  - "watch"
  - "seo"
  - "sitemap"
  - "i18n"
---

## Problem

FGE-183 / W-065. The Watch sitemap derived every `<loc>` from the hreflang
alternate list, and that list only accepts BCP-47 tags that normalize to a
Google-valid hreflang (`/^[a-z]{2}$/` language subtag, optional `[A-Z]{2}`
region). Any language without an ISO-639-1 code was dropped from the manifest,
and dropping the alternate deleted the URL.

Production evidence from the 2026-09-13 listing audit: `/watch/jesus.html/cebuano.html`,
`.../ilocano.html` and `.../hiligaynon.html` all return 200, yet `cebuano` and
`ilocano` appear 0 times across sitemap chunks 0/1/5/9 while `kinyarwanda`
(which has `rw`) appears 6,426 times. Watch advertises 2,000+ languages and the
sitemap exposed roughly 140. The whole long tail — Cebuano (~20M speakers),
Ilocano, Hiligaynon and thousands more — had no discovery path but crawl luck.

A content group whose languages _all_ failed the hreflang test was deleted
outright by `.filter((group) => group.alternates.length > 0)`.

## Entry Points - Read These First

1. `apps/admin/src/services/watch-seo-manifest.service.ts` — `toAlternates`,
   `toVideoRouteGroups`, `VideoRouteGroupSchema`, `normalizeGoogleHreflang`.
2. `apps/web/src/lib/watch-seo-manifest.ts` — `isVideoRouteGroup`, the wire
   contract web accepts.
3. `apps/web/src/lib/watch-sitemap.ts` — `groupEntries`, `groupForEntries`,
   `groupLocEntries`, `getWatchSitemapChunks`.
4. `apps/web/src/lib/watch-sitemap-audit.ts` — `missing_self_alternate`.
5. `docs/solutions/performance-issues/watch-hreflang-sitemap-manifest-20260612.md`

## Grep These

- `languageSlugs`
- `normalizeGoogleHreflang`
- `annotatedLocs`
- `unannotatedLocs`
- `canonicalVideoUrls`
- `missing_self_alternate`

## What To Build

Decouple sitemap inclusion from hreflang eligibility by **adding** a list beside
the existing one rather than changing the existing one's type:

```ts
// apps/admin/src/services/watch-seo-manifest.service.ts
const VideoRouteGroupSchema = z.object({
  contentSlug: z.string().min(1),
  alternates: z.array(LanguageAlternateSchema), // unchanged hreflang cluster
  languageSlugs: z.array(z.string().min(1)).optional(), // every playable language
})
```

`languageSlugs` is `.optional()` at the schema boundary because
`WatchSeoManifestStore.getLatest()` parses the persisted snapshot on every read:
a required field would make admin 500 on the snapshot written by the previous
build, and web would then serve a 503 sitemap until the next Core sync. The
generator always emits it.

Web mirrors the same optionality (`languageSlugs?: string[]`) and falls back to
the alternate list when it is absent, so either side can deploy first.

Sitemap rendering emits one `<loc>` per playable language and attaches the
`<xhtml:link>` cluster **only to the URLs that are members of it**. A long-tail
URL ships as a bare `<url><loc>…</loc></url>`. Attaching the cluster's set to a
non-member breaks Google's reciprocity requirement (the URL is not in the set it
publishes), which makes Google discard the whole cluster's annotations — a
regression for the ~140 languages that work today. The offline auditor's
`missing_self_alternate` rule is therefore conditional on the entry annotating
at all.

## Constraints

- Do not change `alternates`, `normalizeGoogleHreflang`, or the
  `skippedHreflangValues` counts. They stay the hreflang contract and the
  operator signal.
- Do not attach an alternate set to a URL that is not in it.
- Do not widen `hreflang` to `string | null` on the wire: web's
  `parseWatchSeoManifest` rejects the whole manifest on a non-string `hreflang`,
  so an older web build would serve a 503 sitemap for the whole deploy window.
- `episodeRouteGroups` stays untouched — the sitemap does not consume it
  (FGE-192 / W-067 owns that).
- No Pothos/GraphQL surface changes, so no schema or codegen regeneration.

## Verification

```bash
pnpm --filter @forge/admin test -- src/services/watch-seo-manifest.service.test.ts src/services/watch-seo-manifest-store.test.ts src/app/api/watch-seo-manifest/route.test.ts src/services/watch-seo-manifest-refresh.service.test.ts src/scripts/generate-watch-seo-manifest.test.ts
pnpm --filter @forge/web test -- src/lib/watch-sitemap.test.ts src/lib/watch-sitemap-audit.test.ts src/lib/watch-seo-manifest.test.ts src/app/sitemap.test.ts src/lib/watch-cache-tags.test.ts src/app/api/revalidate/route.test.ts
pnpm --filter @forge/web audit:watch-sitemap -- --origin https://www.jesusfilm.org/watch
```

Post-deploy, read `canonicalVideoUrls` from the `watch_seo_manifest.generated`
log line on the first Core sync. That is the real production URL count this
change unlocks, and the number the scaling residual below is measured against.

## Measured scaling (2026-09-22, synthetic manifests)

`getWatchSitemapChunks`, 35 MB / 49,999 shard limits:

| shape                                | locs      | chunks | web heap | manifest JSON | build |
| ------------------------------------ | --------- | ------ | -------- | ------------- | ----- |
| 3,000 content x 140 hreflang (today) | 420,002   | 228    | 160 MB   | 30.2 MB       | 0.7 s |
| 3,000 content x 500 playable         | 1,500,002 | 232    | 245 MB   | 51.8 MB       | 1.8 s |
| 1,000 content x 2,000 playable       | 2,000,002 | 82     | 50 MB    | 48.3 MB       | 2.2 s |

Marginal cost of a long-tail URL: **~80 bytes of web heap** (the materialized
chunk index) and **~20 bytes of manifest JSON**. Chunk count barely moves
(228 -> 232) because shards are byte-bound by the alternate blocks and the extra
URLs carry none, so the sitemap index shape is stable.

Residual (tracked as `feat-538`): `getWatchSitemapChunks` materializes every entry and
`getWatchSeoManifest` buffers the whole manifest with `response.json()` and no
byte cap. Both were already unbounded before this change; this change raises the
multiplier. If the post-deploy `canonicalVideoUrls` lands above ~5M, bound them
(lazy per-chunk materialization; a byte cap on the manifest read per
`docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`)
before the corpus grows further.
