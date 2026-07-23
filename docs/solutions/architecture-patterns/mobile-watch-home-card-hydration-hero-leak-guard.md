---
title: "Mobile Home adapter: additive coreId hydration for under-curated Experience MediaCollection cards, with a structural hero-leak guard"
date: 2026-07-22
category: docs/solutions/architecture-patterns/
module: apps/mobile (src/lib/watchHome, src/hooks/useWatchHome.ts, src/lib/watchHomePersistence.ts)
problem_type: architecture_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "An admin-authored Experience MediaCollectionBlock item has null titleOverride/labelOverride/imageUrl/imageOverrideUrl (under-curated) but carries a resolvable coreId"
  - "A client-owned carousel/hero greedily scans ALL of its input video pool for eligible slides (e.g. by label), so feeding it merged config+hydration videos would let curated hydration content leak into a surface it must never drive"
  - "A hook needs a transient-fetch failure to reuse last-known-good state instead of downgrading already-hydrated UI, resetting a stateful pager, or poisoning a persisted snapshot"
  - "A persisted cold-launch snapshot mixes two video sets with different downstream fates (config-model input vs. hydration-only) and must not let one leak into the other on rehydrate"
  - "Repo idiom forbids renderHook-style hook tests, so async hook logic (dedupe, chunking, fallback, staleness guards) needs a pure, hook-free seam to stay unit-testable"
tags:
  - "mobile"
  - "sdui"
  - "coreid-hydration"
  - "experience-adapter"
  - "watch-home"
  - "feat-172"
  - "hero-leak-guard"
  - "react-native"
---

# Mobile Home adapter: additive coreId hydration for under-curated Experience MediaCollection cards, with a structural hero-leak guard

## Context

The apps/mobile Home tab renders its body from the prod `watch-home` admin
Experience via a block-to-model adapter
(`apps/mobile/src/lib/watchHome/experienceAdapter.ts`), documented as shipped
under feat-235 (`apps/mobile/CLAUDE.md` "Home tab" section). That adapter reads
each `MediaCollectionBlock` item's own fields — `titleOverride`,
`labelOverride`, `imageUrl`, `imageOverrideUrl` — and had no path to the linked
video's data at all. Prod's "Acts of the Apostles" shelf exposed the gap: those
items are under-curated in admin (every override field null), so cards fell all
the way through to the item's raw `videoSlug` for a title (e.g.
`"lumo-acts-1-1-8-3"` instead of `"LUMO - Acts 1:1-8:3"`) and rendered a blank
poster. This is not an auth or token problem — the linked video's real title
(`video.locales[0].title`) and Cloudflare poster (`video.images`) are reachable
by the `coreId` every item already carries; the adapter simply never looked
there.

apps/tv had already solved the equivalent problem for its own SDUI
`/experience/[slug]` MediaCollection renderer (see
`docs/solutions/architecture-patterns/tv-sdui-mediacollection-card-image-title-resolution.md`)
by hydrating cards from a coreId-keyed video index. That fix lives on a
_different_ surface than this one — TV's own SDUI experience renderer, not
TV's Home body — and TV's hydration strategy **drops** items it can't hydrate.
Mobile's Home adapter needed the same coreId-hydration idea ported to _its_
surface (the Home-body adapter, not the SDUI `/experience/[slug]` renderers,
which remain flat and untouched), but the port could not be a straight copy:
mobile's Home adapter feeds a client-owned hero carousel that must never be
Experience-driven (feat-172), and mobile's working (well-curated) shelves rely
on inline overrides with no linked-video record in any local index — dropping
those items on missing hydration would have broken shelves that already
worked. This work shipped in PR #1676 (branch
`feat/mobile-home-experience-card-hydration`, CI green, unmerged as of
2026-07-22).

## Guidance

### 1. Additive hydration in `itemToCard`, never a drop

`itemToCard` (`apps/mobile/src/lib/watchHome/experienceAdapter.ts:78-136`)
takes a `videoByCoreId` index as a fourth argument and, when the item carries a
`coreId`, looks up the linked video to fill in title and image gaps —
authored overrides always win:

```ts
// apps/mobile/src/lib/watchHome/experienceAdapter.ts:99-117
const hydrated = item.coreId ? videoByCoreId.get(item.coreId) : undefined
const hydratedTitle = hydrated?.locales?.[0]?.title ?? null
const hydratedImage = hydrated ? pickAdminImage(hydrated.images ?? []) : null
const title =
  item.titleOverride || item.labelOverride || hydratedTitle || slug
...
const imageUrl =
  rewriteSeedPosterUrl(item.imageOverrideUrl) ??
  item.imageUrl ??
  hydratedImage ??
  muxThumbnailFromPlaybackId(item.muxPlaybackId) ??
  null
```

This is deliberately additive, not TV's drop-on-miss behavior: mobile's
working shelves carry inline overrides but no entry in any local video index
(nothing fetched them), so dropping every item without a hydration hit would
have silently emptied shelves that were already rendering correctly. The
function's default parameter (`videoByCoreId: Map<... > = new Map()` at
`experienceAdapter.ts:177`) also means a caller with no video data at all — the
adapter's own existing unit tests among them — renders exactly as it did
before hydration existed (verified by the test `"renders inline-only (no map
arg) exactly as before — backward compatible"`,
`apps/mobile/src/lib/watchHome/__tests__/experienceAdapter.test.ts:407-411`).

### 2. Top-up fetch of the coreIds the config pool doesn't already cover

The Home hook already fetches a fixed pool of config-curated videos in
parallel with the Experience
(`GET_WATCH_HOME_VIDEOS` against `getWatchHomeCoreIds()`,
`apps/mobile/src/hooks/useWatchHome.ts:136-144`). Rather than re-fetch every
Experience item's video unconditionally, the hook computes the _divergence_
— coreIds the Experience references that the config pool didn't already
return — and only top-up-fetches those:

```ts
// apps/mobile/src/hooks/useWatchHome.ts:214-218
const configIndex = buildVideoByCoreIdIndex(videos)
const divergent = experienceItemCoreIds(experienceBlocks).filter(
  (coreId) => !configIndex.has(coreId),
)
```

`experienceItemCoreIds` (`experienceAdapter.ts:199-212`) walks every
`MediaCollectionBlock`, validates each item's `coreId` against
`CORE_ID_PATTERN` (`experienceAdapter.ts:39-42`, so an unsafe value can't ride
the `$coreIds` GraphQL variable), and dedupes via `[...new Set(ids)]`. The
actual fetch is `fetchTopUpVideos`
(`apps/mobile/src/lib/watchHome/topUpFetch.ts:59-78`), extracted to a
React-free module specifically so its chunking and merge logic are
unit-testable without pulling React into the test (module header comment,
`topUpFetch.ts:1-2`). It chunks the coreId list under admin's 100-id cap
(`VIDEOS_BY_CORE_IDS_MAX = 100`, `topUpFetch.ts:17`), fires the chunks via
`Promise.all`, and flattens the results — any rejected chunk rejects the whole
top-up, so the caller degrades uniformly rather than partially
(`topUpFetch.test.ts:47-59` — `"rejects fail-fast when any chunk rejects"`).
The hook wraps this in its own timeout
(`TOPUP_FETCH_DEADLINE_MS = 3000`, `useWatchHome.ts:52`), deliberately far
below the Experience's own 8-second deadline
(`EXPERIENCE_FETCH_DEADLINE_MS = 8000`, `useWatchHome.ts:46`) — the rationale
for that specific number is in point 6.

### 3. `assembleWatchHomeModel` — the pure seam that keeps config and hydration video sets structurally separate

The load-bearing new function is `assembleWatchHomeModel`
(`experienceAdapter.ts:241-259`). It takes two _distinct_ video arrays and
builds two different outputs from them:

```ts
// apps/mobile/src/lib/watchHome/experienceAdapter.ts:241-259
export function assembleWatchHomeModel(args: {
  configVideos: readonly WatchHomeVideoInput[]
  hydrationVideos: readonly WatchHomeVideoInput[]
  blocks: readonly ExperienceBlock[] | null
  languageSlug?: string
}): { model: WatchHomeModel; usedExperience: boolean } {
  const configModel = buildWatchHomeModelFromVideos({
    videos: args.configVideos,
    languageSlug: args.languageSlug,
  })
  const videoByCoreId = buildVideoByCoreIdIndex([
    ...args.configVideos,
    ...args.hydrationVideos,
  ])
  const experienceSections = args.blocks
    ? buildWatchHomeSectionsFromExperience(args.blocks, videoByCoreId)
    : []
  return resolveWatchHomeModel({ configModel, experienceSections })
}
```

`configModel` — which owns the client-owned hero via
`buildWatchHomeModelFromVideos` — is built from `configVideos` **only**. The
coreId index used to hydrate Experience cards, by contrast, is built from the
**merged** set (`[...configVideos, ...hydrationVideos]`). The function's own
doc comment states the invariant it exists to enforce
(`experienceAdapter.ts:232-239`): feeding merged videos into the config model
would leak a curated top-up video into the hero. This function is the single
place that decision gets made, and it is a pure function with no React or
network dependency — every call site (the hook's live-fetch path
`useWatchHome.ts:248-253`, and its snapshot-rehydrate path
`useWatchHome.ts:332-339`) goes through it, so there is exactly one place a
future change could get the separation wrong, and it is covered directly by
unit tests (point 4 below).

### 4. `buildVideoByCoreIdIndex` — parent AND child, top-level wins

The hydration index itself is built by `buildVideoByCoreIdIndex`
(`apps/mobile/src/lib/watchHome/model.ts:504-518`), which indexes not just
top-level config-pool videos but also every `children[].child` record, so an
Experience item that lives only as a child of another collection already in
the config pool (e.g. an episode of a series the config pool pulled as a
parent) hydrates without needing a top-up fetch at all:

```ts
// apps/mobile/src/lib/watchHome/model.ts:504-518
export function buildVideoByCoreIdIndex(
  videos: readonly WatchHomeVideoInput[],
): Map<string, WatchHomeVideoInput> {
  const index = new Map<string, WatchHomeVideoInput>()
  for (const video of videos) {
    for (const rel of video.children ?? []) {
      const child = rel.child
      if (child?.coreId) index.set(child.coreId, child)
    }
  }
  for (const video of videos) {
    if (hasCoreId(video)) index.set(video.coreId, video)
  }
  return index
}
```

Children are inserted first, top-level records second — on a coreId present
both ways, the top-level record wins (its `Map.set` runs last), which matters
because the top-level record carries the real `children` array and
`childCount`. This is asserted directly by
`"on a coreId present both as a child and a top-level record, the top-level
record wins"` (`apps/mobile/src/lib/watchHome/__tests__/model.test.ts:36-49`),
alongside sibling tests for the child-only case
(`model.test.ts:14-34`) and the no-coreId skip
(`model.test.ts:51-57`).

### 5. Snapshot v3 — hydration videos persisted separately, never merged before persist

The cold-launch snapshot (`apps/mobile/src/lib/watchHomePersistence.ts`) was
bumped from v2 to v3 to add a `hydrationVideos` field kept alongside, not
merged into, the existing `videos` field:

```ts
// apps/mobile/src/lib/watchHomePersistence.ts:127-142
export type WatchHomeSnapshot = {
  /** Always present — feeds the hero carousel and the config fallback body. */
  videos: readonly WatchHomeVideoInput[]
  blocks: readonly WatchHomeSnapshotBlock[] | null
  /**
   * Top-up records for editor-curated coreIds the config pool doesn't cover, kept
   * SEPARATE from `videos` so they hydrate the Experience cards but never feed the
   * config hero (which greedily scans videos for short films). [] when none.
   */
  hydrationVideos: readonly WatchHomeVideoInput[]
  persistedAt: number
}
```

The version bump comment (`watchHomePersistence.ts:105-111`) is explicit about
why: an old (v2) snapshot fails the version gate and the launch cleanly
re-fetches, rather than a v3 reader silently treating a missing field as
merged-in. On rehydrate, `useWatchHome.ts:332-339` calls
`assembleWatchHomeModel` with `snapshot.videos` as `configVideos` and
`snapshot.hydrationVideos` as `hydrationVideos` — the same separated shape the
live fetch produces — so the cold-launch repaint goes through the identical
hero-leak guard as the network path, not a parallel implementation that could
drift out of sync.

### 6. Last-good hydration reuse — mirrors the existing Experience-blocks pattern, pure and tested

A transient top-up failure (timeout or rejected chunk) must not downgrade
cards that were already hydrated on a prior fetch, reset the hero pager (via
the keep-model compare below), or write a degraded snapshot. This mirrors an
already-existing sibling pattern in the hook —
`lastGoodExperienceBlocksRef` reusing the last Experience blocks that yielded
a real body on a transient Experience-fetch error
(`useWatchHome.ts:108-110`) — extended to hydration via a parallel ref
(`lastGoodHydrationVideosRef`, `useWatchHome.ts:114-116`) and a pure decision
function so the branch logic is unit-tested without driving the async hook:

```ts
// apps/mobile/src/lib/watchHome/topUpFetch.ts:40-54
export function resolveHydrationVideos(
  outcome: TopUpOutcome,
  lastGood: readonly WatchHomeVideoInput[] | null,
): {
  hydrationVideos: readonly WatchHomeVideoInput[]
  nextLastGood: readonly WatchHomeVideoInput[] | null
} {
  if (outcome.ok) {
    return {
      hydrationVideos: outcome.videos,
      nextLastGood: outcome.videos.length > 0 ? outcome.videos : lastGood,
    }
  }
  return { hydrationVideos: lastGood ?? [], nextLastGood: lastGood }
}
```

Four branches, four tests, each a distinct discriminator so deleting a branch
would fail a specific test (`apps/mobile/src/lib/watchHome/__tests__/topUpFetch.test.ts:61-86`):
a successful fetch with results is used and remembered
(`"on success uses the fresh records..."`); an _empty_ success is used for the
current paint but must not clobber a good `lastGood`
(`"on an EMPTY success uses empty but keeps the prior last-good"`); a failure
reuses `lastGood` unchanged (`"on failure reuses the last-good..."`); and a
failure with no `lastGood` yet (first launch) degrades to empty rather than
throwing (`"on failure with NO last-good yields empty"`). The hook wires this
in at `useWatchHome.ts:240-245` and separately logs the failure via
`logWatchHomeFallback({ reason: "topup-error" })`
(`useWatchHome.ts:299`, reason defined at
`apps/mobile/src/lib/watchHome/logWatchHomeFallback.ts:18`) so a dropped
top-up is never silent even when the rest of Home renders fine.

## Why This Matters

**The hero-leak guard is what makes feat-172 (client-owned hero, never
Experience-driven) survive this change structurally, not by convention.**
`buildCarouselPools` — which builds the client-owned hero's carousel pools —
does not consume an explicit, curated list of hero-eligible ids the way TV's
hero does (TV's hero uses an explicit-id `heroQueue`, per
`apps/mobile/CLAUDE.md`'s cross-reference and the tracked TV solution doc).
Mobile's hero instead _greedily scans every video in its input map_ for
records whose resolved label is `"Short film"`:

```ts
// apps/mobile/src/lib/watchHome/model.ts:454-465
const shortFilmById = new Map<string, WatchHomeVideoSlide>()
for (const video of args.videoByCoreId.values()) {
  const parentCard = normalizeCard({
    sectionId: "home-carousel-short-films",
    sourceId: video.coreId ?? video.documentId ?? "unknown",
    video,
    languageSlug: args.languageSlug,
  })
  if (!parentCard || parentCard.label !== "Short film") continue
  const slide = cardToCarouselSlide(parentCard)
  if (slide) shortFilmById.set(slide.id, slide)
}
```

Because this scan iterates _every_ video the caller hands it
(`args.videoByCoreId`, built inside `buildWatchHomeModelFromVideos` from
whatever `videos` array is passed at `model.ts:520-524, 547-549`), it is
mobile's specific leak vector — TV's explicit-id hero has no equivalent scan
and so never had this risk. If `assembleWatchHomeModel` fed the _merged_
config+hydration set into `buildWatchHomeModelFromVideos`, a short film that
an editor curated only into an Experience shelf (arriving solely via the
top-up fetch) would silently start appearing in the client-owned hero
carousel — a direct feat-172 violation, and one that would only show up in a
sim/prod render, not in a type check. Keeping `configVideos` and
`hydrationVideos` as two separate function parameters to
`assembleWatchHomeModel`, rather than one pre-merged array, makes the
violation _unrepresentable_ by any caller that respects the type signature —
this is the "mocked-shape-vs-real-contract discipline" principle in
practice: the guard needed a test where _only_ the leak path could pass, which
is exactly what
`"GUARD: a short film that arrives ONLY as top-up hydration renders in the
Experience body but NEVER the client-owned hero"`
(`apps/mobile/src/lib/watchHome/__tests__/experienceAdapter.test.ts:442-453`)
asserts — paired with a `BASELINE` test in the same `describe` block
(`experienceAdapter.test.ts:433-440`) proving the same short film _does_ reach
the carousel when fed as `configVideos`, so the guard test is non-vacuous (a
short film in `hydrationVideos` alone really is a different code path, not an
accident of the fixture).

**Additive-not-drop preserves every shelf that already worked.** TV's sibling
hydration pattern drops items it can't resolve; mobile's `itemToCard` keeps
every item regardless of hydration outcome and only fills gaps. This
asymmetry is intentional, not an oversight: mobile's already-curated shelves
supply title/image via item-level overrides with no linked video in any local
index (nothing fetches those videos), so a drop-on-miss policy identical to
TV's would have silently emptied working shelves the moment this feature
shipped. The `"renders inline-only (no map arg) exactly as before — backward
compatible"` test
(`experienceAdapter.test.ts:407-411`) is the regression guard for that
asymmetry.

**The accepted perf tradeoff is bounded and backed by measurement, not
assumed.** The top-up fetch runs as one _sequential_ round-trip after the
parallel videos+Experience fetch and before the single paint — on a
snapshot-less first launch, the client-owned hero (which needs nothing from
top-up) still waits on it, capped at `TOPUP_FETCH_DEADLINE_MS = 3000`
(`useWatchHome.ts:48-52`, comment explaining the number is intentionally
"WELL below the Experience deadline"). The alternative — paint first, then
patch in hydrated cards on a second `setModel` once top-up resolves — was
rejected because of a structural constraint in `HomeScreen.tsx`: `heroSlides`
is memoized on the _entire_ `model` object reference
(`apps/mobile/src/components/home/HomeScreen.tsx:116-134`, dependency array
`[model, memoryHydrated, resetPlayedIds]` at line 134), and a
`useEffect` keyed on `heroSlides` resets `activeHero` to `null` on every
`heroSlides` identity change (`HomeScreen.tsx:150-155`, comment: "A rebuild
resets the pager to slide 0 without re-firing onSlideChange... Drop it so the
chrome renders from heroSlides[0] instead of an evicted slide"). A second
`setModel` call after paint would therefore recompute the hero queue and
visibly flicker/reset the client-owned hero pager — worse UX than a single
bounded wait. Returning users are unaffected in practice: they paint from the
v3 snapshot (including its own `hydrationVideos`) instantly, with the live
top-up running as a background revalidation behind that already-hydrated
paint.

## When to Apply

- Any admin-authored Experience surface reachable by a stable `coreId` where
  authored per-item overrides can be null/under-curated, but the linked
  record (video, or any similarly-shaped entity) carries the real display
  data — hydrate additively by coreId rather than accepting the raw fallback
  chain bottoming out at a slug or id.
- Any client-owned surface (hero, carousel, "for you" rail — anything NOT
  meant to be Experience/CMS-driven) that is built by a function which
  _scans its entire input pool_ for eligibility (by label, by flag, by any
  predicate) rather than consuming an explicit curated id list. That scan
  shape is the leak vector: any caller that ever merges "editor-curated
  hydration/enrichment data" into that function's input has created a leak
  path, whether or not today's data happens to trigger it. Keep the two
  video sets as separate function parameters through to the point they
  diverge (config-model build vs. hydration-index build), never pre-merged.
- Any hook whose failure-path must not regress already-good UI state:
  extract the reuse-last-good decision into a pure function taking
  `(outcome, lastGood)` and returning `(usedValue, nextLastGood)`, so all
  four success/empty-success/failure/failure-with-no-history branches get a
  discriminating unit test — this repo's idiom explicitly does not
  `renderHook`-test hooks (see `useHeroStream.test.ts`'s stated rationale,
  referenced in the task context), so this is the only way that branch logic
  gets tested at all.
- Any persisted cold-launch snapshot that mixes two video/data sets destined
  for different downstream consumers: bump the schema version and add the
  new set as a _separate_ field, never merge it into the existing array —
  a version bump makes an old snapshot fail the parse gate cleanly instead of
  silently misinterpreting a missing field as "already merged."
- Any top-up/enrichment fetch layered on top of an existing required fetch:
  give it its own timeout strictly shorter than the required fetch's
  deadline, and make it degrade (never throw) to a documented, logged
  fallback — see this repo's general outbound-timeout-shorter-than-caller-
  budget law in the root `CLAUDE.md` "Known Patterns" list, which this
  pattern instantiates for a client-side hook rather than a server route.

## Examples

**Acts of the Apostles shelf, before this change.** The `mediaCollection`
Experience item for the episode carried `coreId: "6_Acts0401"`,
`videoSlug: "lumo-acts-1-1-8-3"`, and every override field null. `itemToCard`
had no `videoByCoreId` argument at all, so `title` fell through
`item.titleOverride || item.labelOverride || slug` straight to the raw slug
string `"lumo-acts-1-1-8-3"`, and `imageUrl` fell through to
`rewriteSeedPosterUrl(item.imageOverrideUrl) ?? item.imageUrl ??
muxThumbnailFromPlaybackId(item.muxPlaybackId) ?? null` — with no
`muxPlaybackId` on the item either, this resolved to `null` and the card
rendered blank.

**After.** The same item, once its `coreId` resolves in the merged
`videoByCoreId` index (built from either the config pool or, more likely
here since Acts isn't in the config-curated pool, the top-up fetch), hydrates
to the real values. This is exactly the fixture in
`"hydrates an under-curated block item's title + image from the merged
index"` (`experienceAdapter.test.ts:455-480`): given a hydration video with
`coreId: "6_Acts0401"`, `locales: [{ title: "LUMO - Acts 1:1-8:3" }]`, and
`images: [{ mobileCinematicHigh: "https://cdn/acts-1.jpg" }]`, the assembled
model's card renders `title === "LUMO - Acts 1:1-8:3"` and
`imageUrl === "https://cdn/acts-1.jpg"` — matching what was sim-confirmed on
an iPhone 17 Pro Max device build against the live prod Experience.

**The SHORT_FILM guard, concretely.** Take a video shaped like a real
hero-eligible short film — `label: "SHORT_FILM"`, a slug, and a poster
(`experienceAdapter.test.ts:417-424`). Fed as `configVideos` (i.e. it came
back from the config-pool `GET_WATCH_HOME_VIDEOS` fetch), it reaches
`model.carousel.pools` and is therefore hero-eligible — the `BASELINE` test
proves this branch is real, not vacuously always-false
(`experienceAdapter.test.ts:433-440`). Fed instead as `hydrationVideos` (i.e.
an editor referenced it only from an Experience `MediaCollectionBlock`, and it
arrived solely via the top-up fetch), the exact same video renders as a
titled, imaged Experience card (`model.sections[0].cards[0].title === "Test
Short Film"`) while `inCarouselPools(model, "TESTSHORT1")` is `false` — the
same underlying video record produces different eligibility depending
entirely on which of the two `assembleWatchHomeModel` parameters carried it in
(`experienceAdapter.test.ts:442-453`). That parameter, not any property of the
video itself, is the enforcement point.

## Related

- `docs/solutions/architecture-patterns/tv-home-single-admin-experience-migration-20260712.md`
  — the direct architectural **parent**: `buildVideoByCoreIdIndex`
  (top-level-wins, children-first insertion), the chunked
  degrade-never-blank `topUpFetch`, and the versioned Home snapshot were all
  established there for TV's Home rails and ported here. Note the
  **additive-not-drop divergence**: that doc frames TV's adapter as a
  deliberate divergence from mobile's original render-flat posture; this work
  makes mobile _also_ hydrate by coreId but **keep** non-hydrated items — a
  third posture that doc does not cover.
- `docs/solutions/architecture-patterns/tv-sdui-mediacollection-card-image-title-resolution.md`
  — the sibling TV pattern for a _different_ surface (TV's own SDUI
  `/experience/[slug]` renderer, not TV's Home body) with drop-on-miss (not
  additive) hydration and an explicit-id (not greedy-scan) hero — the two
  differences that made a straight copy the wrong move here. This work does
  NOT touch the mobile SDUI `/experience/[slug]` pipeline, which stays flat.
- `docs/solutions/design-patterns/asyncstorage-swr-snapshot-slow-admin-resolver.md`
  — the snapshot envelope + keep-vs-swap model-identity gate this v2→v3
  `hydrationVideos` bump extends; the paint-then-hydrate rejection (point 6 in
  Why This Matters) is a concrete instance of that doc's "reserve the model
  swap for actually-changed content, or the hero pager resets mid-view" rule.
- `docs/solutions/architecture-patterns/cross-client-hero-parity-eligibility-gate.md`
  — guards the same feat-172 client-owned-hero invariant from a different
  threat (cross-client content drift vs. this work's same-app hydration leak),
  on the same `buildCarouselPools`/`model.ts` machinery.
- `apps/mobile/CLAUDE.md` "Home tab — Experience-driven body, client-owned
  hero" section, updated this session to describe the shipped
  `assembleWatchHomeModel` / top-up / v3-snapshot flow.
- feat-172 (hero client-owned, never Experience-driven) — the invariant this
  change's separation of `configVideos`/`hydrationVideos` structurally
  protects.
- feat-235 (mobile home experience parity) — the block-to-model adapter this
  work extends with hydration.
- PR #1676, branch `feat/mobile-home-experience-card-hydration` (CI green,
  unmerged as of 2026-07-22) — the change described in this document.
