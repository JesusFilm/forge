---
id: "feat-538"
title: "Bound Watch sitemap materialization and the SEO manifest read"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-09-29"
duration: 3
depends_on:
  - "feat-533"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "seo"
  - "sitemap"
  - "infrastructure"
---

## Problem

Two unbounded reads sit on the Watch sitemap path. Both predate feat-533; that
change raises their multiplier by decoupling sitemap inclusion from hreflang
eligibility, so the URL corpus grows from the ~140 ISO-639-1 languages to every
playable language.

1. `getWatchSitemapChunks` (`apps/web/src/lib/watch-sitemap.ts`) materializes a
   `WatchSitemapChunkEntry` for **every** canonical URL and retains the whole
   array in a `WeakMap` keyed by manifest. `renderWatchSitemapIndex` only needs
   the chunk count and `renderWatchSitemapChunk` only needs one chunk, so the
   rest is retained for nothing.
2. `getWatchSeoManifest` (`apps/web/src/lib/watch-seo-manifest.ts`) reads the
   admin snapshot with `await response.json()` — the whole body buffers into the
   heap before any validation, with no byte cap and no streaming counter. This
   violates the repo's own buffered-read law.

Neither has a global guard. The existing `WatchSitemapGenerationError` codes
bound a **shard**, not the corpus.

There is a third axis the heap numbers do not capture: `getWatchSitemapChunks`
is fully synchronous with no yield point, so a cache-cold request blocks the
Node event loop for the whole walk (measured 0.7 s at 420k URLs, 2.4 s at 2M),
stalling every other request on that replica. Lazy per-shard materialization
reduces retained heap but **does not** close this: finding a shard's start still
replays the walk, and the index route needs the full chunk count. Treat
compute-time as its own requirement, not a side effect of the memory fix —
options are memoizing shard boundaries separately from entries, yielding between
groups, or moving generation off the request path entirely.

## Measured scaling (2026-09-22, synthetic manifests, 35 MB / 49,999 shard limits)

| shape                                       | locs      | chunks | web heap | manifest JSON | build |
| ------------------------------------------- | --------- | ------ | -------- | ------------- | ----- |
| 3,000 content x 140 hreflang (pre-feat-533) | 420,002   | 228    | 160 MB   | 30.2 MB       | 0.7 s |
| 3,000 content x 500 playable                | 1,500,002 | 232    | 245 MB   | 51.8 MB       | 1.8 s |
| 1,000 content x 2,000 playable              | 2,000,002 | 82     | 50 MB    | 48.3 MB       | 2.2 s |

Marginal cost of one additional canonical URL: **~80 bytes of web heap** and
**~20 bytes of manifest JSON** (synthetic slugs are 17 chars; real Watch slugs
such as `spanish-latin-american` run longer, so budget ~25 B). Chunk count
barely moves (228 -> 232) because shards are byte-bound by the alternate blocks
and long-tail URLs carry none — the sitemap index shape is stable, the heap is
not.

These are measured on a serialized synthetic manifest, not computed from the
constants that define the shape, per
`docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`.

## Gate — do not start before reading this number

feat-533 added `canonicalVideoUrls` to the `watch_seo_manifest.generated` log
line that admin emits on every snapshot generation. Read it from the first
post-deploy Core sync:

```
event=watch_seo_manifest.generated ... canonicalVideoUrls=<N>
```

- `N` below ~2M: no action. Heap stays inside today's envelope.
- `N` ~2M-5M: schedule this ticket.
- `N` above ~5M: treat as urgent — at ~80 B/URL the retained chunk index alone
  passes 400 MB on a replica that also serves page traffic, and the buffered
  manifest read passes 125 MB.

Record the observed `N` in this ticket before implementing, so the work is sized
against production rather than against the synthetic table above.

## Entry Points - Read These First

1. `apps/web/src/lib/watch-sitemap.ts` — `getWatchSitemapChunks`, `chunkCache`,
   `groupLocEntries`, `renderWatchSitemapChunk`, `renderWatchSitemapIndex`.
2. `apps/web/src/lib/watch-seo-manifest.ts` — `fetchWatchSeoManifest`.
3. `apps/web/src/lib/watch-sitemap-limits.ts` — the per-shard ceilings.
4. `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`
5. `docs/roadmap/platform/feat-533-watch-sitemap-full-language-coverage.md`

## Grep These

- `getWatchSitemapChunks`
- `chunkCache`
- `canonicalVideoUrls`
- `response.json()`
- `WATCH_SEO_MANIFEST_TIMEOUT_MS`

## What To Build

1. **Lazy per-shard materialization.** Keep the chunking walk, but retain only
   shard boundaries and totals, then materialize entries for the single
   requested shard:

```ts
type WatchSitemapChunkIndex = {
  bytes: number
  entryCount: number
  /** Where this shard starts in the group/loc walk. */
  start: { groupIndex: number; locIndex: number }
}
```

`renderWatchSitemapIndex` then needs only `chunks.length`, and
`renderWatchSitemapChunk(id)` replays the walk from `start`. Keep every existing
`WatchSitemapGenerationError` code and its threshold — this is a memory change,
not a limits change. `getWatchSitemapChunks` is exported and its full-entry
shape is asserted by `apps/web/src/lib/watch-sitemap.test.ts`; either keep it as
a thin materializing wrapper or migrate those assertions deliberately.

2. **Byte-cap the manifest read.** Stream `response.body` with a byte counter
   and `await reader.cancel()` the instant it crosses the ceiling — do not trust
   `Content-Length`. Map over-cap to the client's existing graceful-failure path
   (`null` -> cached manifest -> controlled 503), never a throw and never a new
   branch. Acquire the reader inside `try` and guard `releaseLock()` in
   `finally`. Never log the caught error: a `JSON.parse` `SyntaxError` can embed
   raw body fragments. Size the default from the observed `N` times ~25 B plus
   envelope, and keep the env knob `.optional()`.

3. Bound the event-loop block as its own acceptance criterion, measured at the
   production `N`, not inferred from the heap result.

4. Test the abort **mechanism** (a real `ReadableStream` whose `cancel()` sets a
   flag), not just the return value. Measure the cap against a serialized
   maximal payload rather than asserting a computation over the same constants.

## Constraints

- Do not narrow sitemap coverage to reclaim memory. feat-533 / FGE-183 exists
  because the long tail had no discovery path; reintroducing a language cap
  reopens that bug.
- Do not change the per-shard ceilings (`DEFAULT_MAX_SITEMAP_BYTES`,
  `DEFAULT_MAX_SITEMAP_URLS`) as part of this work.
- Do not change the hreflang cluster, its reciprocity, or
  `skippedHreflangValues`.
- An over-cap manifest must degrade, not fail loudly: the sitemap's existing
  fail-closed 503 is the floor, and a throw into a route with no `error.tsx` is
  worse than a stale snapshot.

## Verification

```bash
pnpm --filter @forge/web test -- src/lib/watch-sitemap.test.ts src/lib/watch-seo-manifest.test.ts src/lib/watch-sitemap-audit.test.ts src/app/sitemap.test.ts
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web audit:watch-sitemap -- --origin https://www.jesusfilm.org/watch
```

Plus a re-run of the synthetic scaling probe at the production `N`, showing
retained heap flat in shard count rather than linear in URL count, the
longest single synchronous block measured and bounded, and the rendered XML for
a sampled shard byte-identical to the pre-change output.
