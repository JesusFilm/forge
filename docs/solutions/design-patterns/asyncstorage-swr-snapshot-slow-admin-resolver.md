---
title: "AsyncStorage stale-while-revalidate snapshot for slow admin resolver screens"
date: 2026-06-11
category: design-patterns
module: apps/mobile
problem_type: design_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "A mobile screen's dominant launch cost is an uncached server resolver (no unstable_cache / ISR in front of it)"
  - "Measured TTFB dominates latency — the payload downloads in under 0.3s but server compute adds 2-6s before the first byte"
  - "The data is safe to serve days-old for the first paint because a live refetch always replaces it"
  - "The content is config-keyed, not user- or session-specific"
related_components:
  - "apps/mobile/src/lib/watchHomePersistence.ts"
  - "apps/mobile/src/hooks/useWatchHome.ts"
  - "apps/mobile/src/hooks/useWatchHomeCarouselMemory.ts"
  - "apps/admin/src/graphql/types/video.ts"
tags:
  - mobile
  - async-storage
  - stale-while-revalidate
  - performance
  - caching
  - graphql
  - expo
  - cold-launch
---

# AsyncStorage stale-while-revalidate snapshot for slow admin resolver screens

## Context

The mobile Home tab took 5-10 seconds to show content on cold launch. The natural
hypothesis was payload size: the `watchHomeVideos` query fetches 26 collection
core ids and returns 249 video records at ~460KB.

Measurement ruled that out before any code was written. Three `curl` runs of the
app's exact query against production admin:

| Run  | Total | TTFB  | Download |
| ---- | ----- | ----- | -------- |
| Cold | 6.1s  | 5.8s  | ~0.3s    |
| Warm | 2.8s  | 2.75s | ~0.1s    |
| Warm | 2.7s  | 2.6s  | ~0.1s    |

The download was ~3% of the total. The cost is server compute: admin's
`watchHomeVideos` resolver is an uncached Prisma fetch that runs fresh on every
request. Web is fast on the same data only because Next.js wraps it in
`unstable_cache` (60s TTL) + ISR; mobile hits the raw resolver every cold launch.
Trimming query fields would have changed almost nothing.

No prior session had attempted a cold-start cache for this hook; the applicable
in-repo prior art was the AsyncStorage provider pattern from
`watchPreferences.ts` / `WatchPreferencesProvider` — pure parse/serialize in
`src/lib`, storage I/O at the consumer, hydration gate before trusting state
(session history).

## Guidance

Persist the last successful response to AsyncStorage and paint it immediately on
the next launch while the live fetch revalidates in the background. The pattern
has two halves.

### Pure storage schema (`src/lib/watchHomePersistence.ts`)

Parse/serialize is pure (no AsyncStorage import), unit-testable, and guarded by
three gates that all degrade to `null` — meaning "no snapshot, fall back to the
network-blocked spinner":

- **Version gate** — `WATCH_HOME_SNAPSHOT_VERSION`, bumped whenever the
  fragment/input shape changes. The version constant is the only defense against
  deep shape drift; the comment ties it to the fragment explicitly.
- **TTL** — 7 days, deliberately longer than the sibling carousel session's 24h.
  Safe because the snapshot is only ever the _first paint_ (the live fetch always
  replaces it) and the carousel's daily rotation is date-seeded on-device at
  queue-build time, so a days-old snapshot still renders today's correct lineup.
- **Size cap** — 1.5MB, clear of Android AsyncStorage's ~2MB per-item limit.

```ts
// An empty snapshot must not paint the full-empty "No content available"
// state over the loading spinner.
if (videos.length === 0) return null
```

The serializer has a second entry point that builds the envelope around an
_already-stringified_ videos array, so the hot path stringifies the ~460KB
payload exactly once and reuses the string for both the equality compare and the
persisted blob. `persistedAt` lives in the envelope, not the videos JSON — which
is what keeps the videos string usable as an equality comparator:

```ts
export function serializeHomeSnapshotFromVideosJson(
  videosJson: string,
  now: Date,
): string {
  return `{"version":${WATCH_HOME_SNAPSHOT_VERSION},"persistedAt":${now.getTime()},"videos":${videosJson}}`
}
```

### Hook orchestration (`src/hooks/useWatchHome.ts`)

Two effects fire concurrently on mount: the network fetch and the snapshot
paint. The disk read wins by seconds on a cold launch. Two refs and a closure
boolean coordinate ordering:

- `networkLandedRef` — set when live data arrives; the snapshot effect checks it
  before and after each await and bails if it flipped, so a late disk read never
  paints over live data.
- `snapshotVideosJsonRef` — the painted snapshot's videos JSON; the live fetch
  string-compares against it to decide **keep vs swap**:
- `cancelled` — a closure boolean set in the snapshot effect's cleanup, also
  checked before and after each await, so an unmounted or remounted effect
  invocation never paints late.

```ts
const videosJson = JSON.stringify(videos)
const snapshotStillCurrent =
  mode === "initial" && videosJson === snapshotVideosJsonRef.current
if (!snapshotStillCurrent) {
  setModel(
    buildWatchHomeModelFromVideos({
      videos,
      languageSlug: ENGLISH_LANGUAGE_SLUG,
    }),
  )
}
```

Identical data keeps the snapshot-built model because a model identity swap
rebuilds the hero queue and resets the pager mid-viewing — the swap is reserved
for actually-changed content. Pull-to-refresh always swaps (a rebuilt queue is
the point of the gesture).

The empty-response guard mirrors the storage-layer rule at the screen layer — an
empty-but-200 response over a painted snapshot degrades like a failed fetch:

```ts
if (
  mode === "initial" &&
  videos.length === 0 &&
  snapshotVideosJsonRef.current != null
) {
  setError(RETRYABLE_ERROR_MESSAGE)
  return
}
```

Persist is fire-and-forget after every non-empty success; write failures lose
the fast next launch, nothing else.

### Companion: pre-hydration write buffering (`useWatchHomeCarouselMemory.ts`)

Any sibling state that hydrates from AsyncStorage on the same mount must buffer
writes that fire before hydration resolves. A pre-hydration write clobbers the
stored blob with a subset of itself, and hydration would then regress a fresher
in-session value. Both write paths buffer (`pendingPlayedFlushRef`,
`pendingSessionRef`) and the hydration effect flushes them — and skips restoring
any value a pre-hydration write already superseded.

## Why This Matters

The 5.8s cold TTFB is not a transient bug — it is the steady-state cost of an
uncached resolver doing relational Prisma work per request. The client cannot
make the server faster, but it can make every launch after the first free by
reusing the previous result. The snapshot turned a 5-10s spinner into content at
~1s after JS boot, with the live fetch silently confirming or replacing it.

The scoped snapshot also beats the tempting alternative — flipping on the
existing app-wide Apollo cache persistence — because it has its own storage key,
TTL, version gate, and size budget, and revalidates in the background, none of
which the global mechanism provides (see What Didn't Work).

## When to Apply

- The screen's dominant launch cost is server compute (measure TTFB vs download
  before deciding — if download dominates, trim the payload instead).
- The data is safe to show stale for seconds because a background revalidation
  always replaces it.
- The content is keyed on a stable config (same query for everyone), not
  user-specific — a stale user-scoped snapshot could show another account's data.
- The payload is bounded and fits the platform storage limit (cap it anyway).

Do **not** reach for this when:

- The _first-ever_ launch is the experience to fix — only server-side caching at
  the resolver/CDN layer fixes that (handed off to admin's owner in this case).
- You are tempted to enable global Apollo cache persistence instead — a scoped
  snapshot is easier to reason about, invalidate, and budget.

## Examples

Measured relaunch timeline after the fix (simulator + Expo Go profile —
production EAS builds boot faster, but the impossible-window proof holds
regardless of boot time because warm TTFB at 2.7s minimum exceeds the disk
read + model build by orders of magnitude):

- ~3s: white (Expo Go boot)
- ~4s: splash (JS not yet mounted)
- ~6s: **full Home painted from snapshot**

Network content was physically impossible before ~7.7s on this setup (JS mounts
~5s; warm TTFB is 2.7s minimum) — proving the snapshot, not a lucky fast fetch,
painted the screen. Before the fix the spinner ran until the network landed,
typically 5-10s.

## What Didn't Work

- **Trimming the query payload** — measured at ~0.2s of a 6s total; the
  hypothesis "too much data" was wrong in a useful way. Always measure TTFB vs
  download before optimizing payload shape.
- **Enabling the global Apollo cache persistence**
  (`src/lib/cachePersistence.ts`, `EXPO_PUBLIC_FORGE_CACHE_PERSIST`, shipped
  dark) — rejected: 1MB cap shared with all cached data, `cache-first` without
  background revalidation, and deliberately gated pending real-device
  verification. It exists because `apollo3-cache-persist` crashes under Apollo
  v4; this scoped snapshot is the per-query "revisit" that scaffold doc
  anticipated.
- **Admin-side resolver caching** — the biggest lever (fixes first-ever launch
  for every client, the way web's `unstable_cache` already does) but admin is
  owned by another team; handed off rather than blocked on.

## Prevention

- **Version-gate test**: a snapshot written at version N must parse to `null` at
  version N+1. Bump the constant whenever the persisted shape changes.
- **TTL test**: `now` beyond the max age parses to `null`.
- **Never-paint-empty contract at both layers**: the parse gate rejects empty
  videos AND the fetch handler's empty-response guard sets an error instead of
  swapping the model — same contract, two layers, test both.
- **Race tests**: network-lands-first must suppress the snapshot paint
  (`networkLandedRef`); pre-hydration writes must buffer, not write subsets.
- **Verify persistence against raw storage, not UI state** — read the stored key
  back (e.g., via the app container's AsyncStorage file) after the operation;
  UI can reflect stale React state (session history).

## Related

- `docs/solutions/design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md`
  — the lean `watchHomeVideos` payload (9.5MB -> 0.62MB) is what makes this
  snapshot small enough to persist; two phases of the same optimization arc.
- `docs/solutions/mobile/experience-selection-provider-library-tab-pattern-2026-04-08.md`
  — the repo's AsyncStorage read-gate (`isReady`/`hydrated`) precedent this
  pattern follows.
- `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md`
  — records why `apollo3-cache-persist` was removed (Apollo v4 crash); this doc
  is the follow-through on its "revisit cache persistence" note.
- `docs/solutions/performance-issues/swr-cache-failure-backoff-manager-20260331.md`
  — the same stale-while-revalidate contract applied server-side in manager;
  the pattern is a recurring repo theme.
