---
id: "feat-733"
title: "Watch sitemap covers every playable language, not just ISO-639-1 ones"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-09-22"
completed_date: "2026-10-16"
duration: 1
depends_on:
  - "feat-184"
blocks:
  - "feat-734"
tags:
  - "platform"
  - "web"
  - "watch"
  - "seo"
  - "sitemap"
  - "i18n"
---

> **ID history.** This ticket was opened as `feat-533` and renumbered to
> `feat-716` on 2026-10-16: `main` had meanwhile allocated a different
> `feat-533` (`content-discovery/feat-533-consistent-short-watch-recommendation-feedback.md`),
> and the roadmap ID check on PR #2385 failed on the combined tree. Older text,
> including the source comment in
> `apps/admin/src/services/watch-seo-manifest.service.ts`, that says
> `feat-533` and mentions `languageSlugs`, Cebuano or the sitemap means this
> ticket. Its follow-up `feat-538` is now `feat-717`.
>
> Renumbered again to `feat-733` on 2026-10-17: `main` had meanwhile allocated
> `feat-716` (`media-generation/feat-716-studio-full-render-profile.md`) and
> `feat-717` (`content-discovery/feat-717-recommendation-reconciliation-shared-memory.md`).
> Text that says `feat-716` and mentions `languageSlugs`, Cebuano or the
> sitemap means this ticket; the follow-up is now `feat-734`.

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

Residual (tracked as `feat-734`, formerly `feat-717` and `feat-538`): `getWatchSitemapChunks` materializes every entry and
`getWatchSeoManifest` buffers the whole manifest with `response.json()` and no
byte cap. Both were already unbounded before this change; this change raises the
multiplier. If the post-deploy `canonicalVideoUrls` lands above ~5M, bound them
(lazy per-chunk materialization; a byte cap on the manifest read per
`docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`)
before the corpus grows further.

## Repair 2026-10-16: rolling-deploy validator (PR #2385 review R1)

Independent review of the PR found that the Admin route's `ETag` was the
snapshot `version` alone. An older Admin build re-parses a newer persisted
snapshot with its own schema and strips `languageSlugs`, so old and new Admin
served different bodies under one validator. New web that cached the old body
was then answered 304 by the upgraded Admin on every expired 60 s TTL and kept
the alternates-only sitemap, missing every newly covered long-tail URL, until
the process restarted or a webhook cleared that one process.

Fix: `watchSeoManifestEtag()` returns `"<version>.<representation>"` with
`WATCH_SEO_MANIFEST_REPRESENTATION = "r2"` in
`apps/admin/src/services/watch-seo-manifest.service.ts`. A web process holding
the bare-version validator no longer matches, gets one full 200, and then
revalidates with 304 against the new validator. The suffix is a constant: no
request hashes or re-serializes the manifest. Optional `languageSlugs`, the
absent-field fallback, and both static compatibility directions are unchanged.
No web code changed.

Evidence (local, 2026-10-16): the Admin route test pins that a legacy bare
validator gets a 200 with the widened body (it returned 304 before); a guard
test fails when the wire schema's field set changes without a representation
bump; a web client test pins that a changed validator replaces both manifest
and validator over several TTLs without `clearWatchSeoManifestCache`. An
outside-repo harness over the exact base/head source (mocked DB rows, real
`Request`/`Response`, fake clock) failed before the fix (old Admin 200, new
Admin 304 x3, no `languageSlugs`, no Cebuano loc) and passes after (200 then
304, `languageSlugs` retained, canonical bare Cebuano loc exactly once). Its
four-way old/new Admin x old/new Web matrix passes over both a widened and a
legacy snapshot, and only new Admin + new Web over a widened snapshot emits the
Cebuano loc.

Limits: no deployed multi-replica run and no production corpus. During a mixed
Admin fleet a web process can flip between the two bodies, one full 200 per
flip, until the older replicas retire. A later schema change that forgets the
representation bump reintroduces the stall; the guard test is the only
mechanical defense. FGE-183 stays In Progress (earlier wording here said In
Review; that was stale); `complete` here means the local implementation only.

## Repair 2026-10-16: roadmap ID renumber (PR #2385 CI)

The `roadmap-id-collisions-advisory` job failed on head `44152a6` (merge
projection `ade8190`, `ROADMAP_ID_BASE` = main `fc9f4af`): this ticket and its
follow-up shared `feat-533` and `feat-538` with tickets `main` had since
allocated in other lanes. Inherited IDs are not exempt from collisions between
the offered PR and current `main`. Fix: this ticket `feat-533` -> `feat-716`, the
follow-up `feat-538` -> `feat-717` (allocated above `main`'s highest `feat-712`
and the pending `feat-713`..`feat-715`; no concurrent allocation of `716` or
`717` found), with the `feat-184` `blocks`, `feat-716` `blocks`/`feat-717`
`depends_on`, and every doc reference moved to the new IDs. `main`'s own
`feat-533`/`feat-538` tickets are untouched. The source comment in
`apps/admin/src/services/watch-seo-manifest.service.ts` still says `feat-533`;
source is deliberately unchanged, and the ID history note above is its alias.

Validation (2026-10-16, outside the repo): `main`'s own unchanged
`check-new-roadmap-ids.mjs` and `resolve-pr-baseline.mjs`, run on a synthetic
two-parent merge (first parent `main`) of the offered head. Before, it emits
exactly the two CI errors (`feat-533`, `feat-538`); after, "No new roadmap ticket
ID collisions", and the 192 inherited duplicate-ID groups on `main` are unchanged.
The generated `docs/roadmap/README.md` is not regenerated: it is dated
2026-09-21 and never listed these tickets, so a refresh would churn unrelated
counts. Limit: local projection only; the real CI run on the published head is
the final check, and FGE-183 acceptance is unchanged.

## Repair 2026-10-17: second ID renumber and main integration (PR #2385)

PR #2385 went `DIRTY` against `main` `90908a4`, which had meanwhile allocated
`feat-716` (`media-generation/feat-716-studio-full-render-profile.md`) and
`feat-717` (`content-discovery/feat-717-recommendation-reconciliation-shared-memory.md`).
Fix: this ticket `feat-716` -> `feat-733` and the follow-up `feat-717` ->
`feat-734`, allocated above `main`'s highest `feat-727` and the highest pending
open-PR ID `feat-732` (all 131 open PRs, every author, rechecked before the
merge). The `feat-184` `blocks`, `feat-733` `blocks` / `feat-734`
`depends_on`, the owned doc references and the two generated README rows moved
with them. `main`'s own `feat-716`/`feat-717` tickets are untouched.

The one Git conflict, `apps/admin/src/services/watch-seo-manifest.service.test.ts`,
keeps both sides whole: this ticket's three long-tail `languageSlugs` tests and
`main`'s Watch-restriction and series-parent inheritance tests. The service
itself merged without a conflict.

Validation (2026-10-17, local): Admin manifest service, store, refresh and
route suites 56 passed (1 real-database suite skipped); Web sitemap, manifest,
audit and sitemap-route suites 53 passed; `main`'s roadmap ID checker reports no
new collision against `90908a4`. Limit: local only, run on dependencies
installed for an older base; CI on the published head is the final check, and
FGE-183 acceptance is unchanged.
