---
title: "TV SDUI MediaCollection cards: resolve title by coreId hydration, image by rewriting the poster seed to the watch origin"
date: 2026-07-14
category: docs/solutions/architecture-patterns/
module: apps/tv (SDUI experience-detail renderers)
problem_type: architecture_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Rendering admin SDUI MediaCollection cards in a React Native / TV client"
  - "MediaCollectionItem is flat: titleOverride/imageUrl are null and the real title lives only on the linked Video"
  - "imageOverrideUrl is a curated vertical-poster seed pointing at a host that 404s (www.jesusfilm.org/images)"
  - "Cards must be hydrated per coreId, mirroring the Home rail's GET_WATCH_HOME_VIDEOS pattern"
  - "Poster seed URLs need rewriting to the watch web origin with an ABSOLUTE base so they load in dev builds too"
tags:
  - "tv"
  - "sdui"
  - "media-collection"
  - "gql-tada"
  - "image-url-resolution"
  - "coreid-hydration"
  - "experience-detail"
  - "react-native"
---

# TV SDUI MediaCollection cards: resolve title by coreId hydration, image by rewriting the poster seed to the watch origin

## Context

The apps/tv SDUI experience screen (`/experience/[slug]`, rendered by
`ExperienceRenderer`) drew every MediaCollection card as **"Untitled" with a
blank thumbnail**. The cause is the shape of admin's `MediaCollectionItem`: it is
a _flat_ row with no linked video attached. The fragment TV fetches
(`MediaCollectionFields` in `apps/tv/src/lib/queries.ts`) pulls only
`titleOverride`, `subtitleOverride`, `labelOverride`, `collectionSize`,
`imageUrl`, `imageOverrideUrl`, `linkToSectionKey`, `videoId`, and `coreId` — no
nested `Video` record. In practice:

- `titleOverride` is **null** on these items — there is no plain `title` field on
  the item; the real title lives on the linked `Video`.
- `imageUrl` is **null**.
- `imageOverrideUrl` is a _seed_ of the form
  `https://www.jesusfilm.org/images/thumbnails/{coreId}-vertical.png`. That host
  **404s** for these assets — the poster files actually live in the watch web
  app's `apps/web/public/` dir and are served under the `/watch` basePath (see
  `apps/web/src/lib/media-image-url.ts`).

So a naive renderer that reads `item.title` / `item.imageUrl` gets nothing for
title and a dead URL for the image. `MediaCollectionRenderer.tsx` even documents
that the item "carries overrides + videoId only (no nested video record is
fetched on TV)." The card had no material to render — hence blank + Untitled.

TV **diverges from mobile** here on purpose: mobile's experience page still
renders these items flat and unhydrated. Porting this fix to mobile is a
documented follow-up (`apps/tv/src/lib/experienceHydration.ts` header).

Fixed in PR **#1551** (`fix(tv,mobile): correct card/preview imagery and hydrate
SDUI experience cards`) — open with CI green as of this writing.

## Guidance

The fix has two independent halves — **title** and **image** — plus two
image-resolution gotchas that bit the same surface.

### 1. Hydrate the title (and fallback image) by `coreId`, reusing the Home rail's query

The item can't carry its own title, but it carries a `coreId`. The Home rail
already fetches card-lean video records by coreId via `GET_WATCH_HOME_VIDEOS`
(`apps/tv/src/lib/watchHome/homeQueries.ts`, `watchHomeVideos(coreIds:)`). The
fix reuses that exact query: collect every MediaCollection item's coreId, fire the
same bulk query, and index the result by coreId.

`ExperienceRenderer.tsx` runs a **second** `useQuery` after the experience
resolves:

```tsx
const coreIds = useMemo(
  () => collectMediaCollectionCoreIds(experience?.sections),
  [experience],
)
const { data: hydrationData, error: hydrationError } = useQuery(
  GET_WATCH_HOME_VIDEOS,
  {
    variables: { coreIds, locale: "en", languageSlug: null },
    skip: coreIds.length === 0,
  },
)
const videoByCoreId = useMemo(
  () => buildVideoByCoreId(hydrationData?.watchHomeVideos),
  [hydrationData],
)
```

`collectMediaCollectionCoreIds` (`experienceHydration.ts`) walks the normalized
tree (`sections → sectionWrapper.sectionContent → container.slots.slotContent`),
gathers each item's coreId, validates it against `/^[a-zA-Z0-9_-]+$/`, and dedupes
via a `Set`. `buildVideoByCoreId` turns the result into a
`Map<coreId, HydratedVideo>`. The map is passed down through `ExperienceProvider`
as a new `videoByCoreId` context field, defaulted to a stable `EMPTY_VIDEO_MAP` so
cards never block on it.

`MediaCollectionRenderer` then resolves per card:

```tsx
const video = item.coreId ? videoByCoreId.get(item.coreId) : undefined
const thumbnailUrl = resolveMediaItemImageUrl(item, video)
const title = resolveMediaItemTitle(item, video)
```

`resolveMediaItemTitle` prefers the authored `titleOverride`, then the hydrated
`video.locales[0].title`, then `video.slug`, then `"Untitled"` — with an
empty-string override falling through (admin clears to `""`).

A hydration failure is **never silent**: `ExperienceRenderer` reports it to
Datadog (`event: "experience_hydration_failed"`) and warns in dev, while the cards
degrade to their authored fallback rather than crashing.

### 2. Rewrite the poster seed to an ABSOLUTE watch origin

`resolveMediaItemImageUrl` precedence is **override → imageUrl → video art**:

```tsx
resolveImageUrl(rewriteSeedPosterUrl(firstNonEmpty(item.imageOverrideUrl))) ??
  resolveImageUrl(firstNonEmpty(item.imageUrl)) ??
  resolveImageUrl(pickCardImage(video?.images ?? null, "card"))
```

The video's own art is the _last_ fallback, deliberately — the video's
`mobileCinematicHigh` is landscape and looks wrong cropped into a portrait card,
so the curated override poster (the same portrait poster web renders) wins.

The rewrite maps the dead `jesusfilm.org/images/…` seed to the watch app origin:

```tsx
const WATCH_ASSET_BASE = "https://watch.jesusfilm.org/watch" // ABSOLUTE, prod-pinned

function rewriteSeedPosterUrl(url: string | null): string | null {
  if (!url) return null
  const match = url.match(
    /^https?:\/\/(?:www\.)?jesusfilm\.org(\/images\/.*)$/i,
  )
  return match?.[1] ? `${WATCH_ASSET_BASE}${match[1]}` : url
}
```

This mirrors web's `resolveMediaImageUrl` (`apps/web/src/lib/media-image-url.ts`),
which uses the **same regex** — but with a critical difference. Web rewrites to a
_relative_ `BASE_PATH = "/watch"` because web is itself the server that hosts those
assets. **TV must use an absolute origin.** TV's own relative static base
(`resolveImageUrl.ts`, `STATIC_BASE_URL`) resolves relative paths to
`http://localhost:3000/watch` (or `10.0.2.2:3000` on Android) in dev — a Next.js
web server that is **not running** during a normal TV dev session — so a relative
rewrite yields posters that never load in dev builds. The absolute
`watch.jesusfilm.org` origin loads in both dev and prod. (Its prod fallback
`raw.githubusercontent.com/.../apps/web/public` is fine for the app's own bundled
relative assets, but not the curated seed.)

### 3. cardImage: field-major scan, because the bare Cloudflare `url` 400s

The video-art fallback goes through `pickCardImage` (`apps/tv/src/lib/cardImage.ts`),
the single owner of image-field precedence. Two non-obvious rules:

- The bare `url` field is a **variant-less Cloudflare Images delivery base** — it
  carries no `/f=…` transform and returns **HTTP 400**. So `url` ranks _last_ in
  `FIELD_ORDER`, never above a real variant-bearing field (`mobileCinematicHigh` /
  `mobileCinematicLow` / `videoStill` / `thumbnail`).
- The scan is **field-major, image-minor**: for each field in priority order, scan
  _all_ images and take the first hit. This matters because **admin's image
  ordering is not guaranteed** — a `videoStill` entry can sort first with its
  cinematic fields null. If you scanned image-major (first image's best field),
  you'd return `images[0].url` (the 400ing base). Field-major falls through to a
  sibling image's cinematic art instead.

### 4. Mux animated preview caps at width 640

The large experience-details card uses a max-quality Mux animated preview via
`EXPERIENCE_CARD_PREVIEW_OPTS` (`apps/tv/src/lib/muxUrl.ts`):

```tsx
export const EXPERIENCE_CARD_PREVIEW_OPTS: MuxAnimatedPreviewOpts = {
  width: 640,
  fps: 30,
}
```

**640 is Mux's ceiling for `animated.webp`** — asking for `1280` returns
`Invalid width`. A novel `(id, params)` combo costs a ~5s cold transcode on first
hover, then CDN-caches; rail thumbs keep the warm `448/8` defaults that ride web's
existing cache.

## Why This Matters

Any SDUI card surface built on flat items — MediaCollection today, any future
flat-item card block — hits this same wall on **both TV and mobile**: the item
gives you overrides + a coreId + a seed poster, and nothing else. You cannot
render a usable card from the item alone. Resolution has to come from either (a)
the linked video, hydrated by coreId, or (b) the curated override asset. Bake that
assumption in from the start when you build a new card renderer.

Three traps generalize beyond this one screen:

- **The dev-vs-prod static-base trap.** TV's `resolveImageUrl` resolves _relative_
  paths against a static base that is a local web server in dev
  (`localhost:3000` / `10.0.2.2:3000`) and GitHub raw in prod. Any curated asset
  that must load in a normal TV dev session (no web server running) needs an
  **absolute** origin, not a relative path. Copying web's relative-rewrite verbatim
  silently breaks dev image loading — the regex ports cleanly, the base path does
  not.
- **The Cloudflare variant trap.** The bare `url` on an admin image is a
  variant-less delivery base that 400s. Never treat it as a first-class image; it
  is a last-resort. And because admin image ordering isn't guaranteed, a
  field-major scan is mandatory — an image-major scan returns the 400ing base
  whenever a `videoStill`-first entry sorts ahead of the cinematic one (the exact
  "JESUS → The Beginning" regression, `cardImage.test.ts`).
- **The Mux ceiling.** `animated.webp` width maxes at 640; 1280 is rejected as
  `Invalid width`. Size the big-card preview at the ceiling, not beyond it.

## When to Apply

- Building or debugging any SDUI **experience card renderer** on apps/tv
  (MediaCollection or a new flat-item block). If cards show "Untitled"/blank,
  suspect flat items first — check whether the fragment even fetches a title/image
  and whether a coreId hydration pass is wired.
- Adding a **new flat-item card type**: add `coreId` to the fragment, extend
  `collectMediaCollectionCoreIds`'s walk to reach the new block, and resolve
  title/image via the `resolveMediaItem*` helpers rather than reading item fields
  directly.
- **Porting to mobile.** Mobile's experience page still renders these items flat.
  The hydration logic in `experienceHydration.ts` is the reference; note the
  absolute-vs-relative base distinction when adapting `resolveImageUrl`.
- Any time you copy an image-URL rewrite from apps/web into a native app — verify
  the base resolves to a reachable host in a dev build, not a local Next.js server.

## Examples

**JESUS → "The Beginning" (poster rewrite + variant-less-url regression).**
The MediaCollection item for the JESUS collection carries coreId `1_jf-0-0` and an
`imageOverrideUrl` seed
`https://www.jesusfilm.org/images/thumbnails/1_jf-0-0-vertical.png`. Before the
fix that URL 404s and the card is blank. `rewriteSeedPosterUrl` maps it to
`https://watch.jesusfilm.org/watch/images/thumbnails/1_jf-0-0-vertical.png` — the
same portrait poster web renders (`experienceHydration.test.ts`). Separately, when
a card falls back to the video's own `images`, JESUS's episode "The Beginning"
(`1_jf6101-0-0`) returns a `videoStill` entry sorted _first_ with
`mobileCinematicHigh: null`, and the cinematic art in the _second_ entry. The old
image-major picker returned `images[0].url` — the variant-less
`imagedelivery.net/.../1_jf6101-0-0.videoStill.jpg` base that 400s, leaving the
card blank. Field-major `pickCardImage` returns the loadable `mobileCinematicHigh`
from the sibling entry instead (`cardImage.test.ts`).

**Rewrite boundaries.** A non-jesusfilm override (`https://cdn.example/poster.jpg`)
passes through unchanged. A no-www seed
(`https://jesusfilm.org/images/thumbnails/x.png`) is rewritten to
`https://watch.jesusfilm.org/watch/images/thumbnails/x.png`. A jesusfilm.org URL
_not_ under `/images` (`https://www.jesusfilm.org/videos/x.png`) is the rewrite
boundary and passes through untouched (`experienceHydration.test.ts`).

**Title hydration.** An item with null `titleOverride` and coreId `1_jf-0-0`
resolves its title from the hydrated video's `locales[0].title`; if hydration
hasn't landed (empty map), the card shows the video slug or finally `"Untitled"`
rather than crashing.

## Related

- `docs/solutions/architecture-patterns/tv-home-single-admin-experience-migration-20260712.md`
  — predecessor / same-pattern parent. It established coreId hydration
  (`watchHomeVideos(coreIds:)`) for the TV **Home** Experience. This learning
  extends that exact mechanism to the general SDUI Experience-Details
  MediaCollection renderer and adds the image-resolution layer the home doc does
  not cover.
- `docs/solutions/integration-issues/mobile-relative-image-url-no-base-origin-20260408.md`
  — sibling mechanism for the image half: a native (expo-image) client must
  rewrite origin-relative CMS image paths to a web origin, and Cloudflare
  intercepts `/watch/images/*` static requests. The poster-seed rewrite here is
  the TV instance of that class.
- `docs/solutions/best-practices/admin-asset-backed-experience-media-picker-pattern-20260707.md`
  — upstream contract: admin resolves `imageOverrideUrl` at the GraphQL read
  boundary from MediaAsset IDs; the client then rewrites that URL's origin (same
  field, adjacent layer).
- `docs/solutions/conventions/verify-animated-media-motion-rich-probe-window.md` —
  how to verify a Mux `animated.webp` actually animates on-device; the
  verification companion to the 640-width-ceiling rule.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — prevention tie: the Cloudflare variant-less `url` 400 and the
  `videoId != coreId` gap only surface against the real CDN/prod contract, not
  mocked fixtures.
