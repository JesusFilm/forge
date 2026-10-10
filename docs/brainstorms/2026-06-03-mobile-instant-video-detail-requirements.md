---
date: "2026-06-03"
topic: "mobile-instant-video-detail"
---

# Mobile — Instant Video Detail

## Summary

Make the mobile video detail screen feel instant on tap. The screen paints
immediately from data the caller already holds (poster, title, `playbackId`),
starts playback optimistically, loads only a lean data set before first paint,
defers the heavy payload, and hydrates from a persisted on-device cache on
repeat visits. A full-screen spinner stops being a state the screen can show.

---

## Problem Frame

Tapping a search result takes up to ~5 seconds before the video appears, and
for that whole window the screen is a blank spinner — it reads as broken.

The reported intuition was "content is local, so it should be instant." That
premise is false. Mobile fetches every video over the network from the
production admin GraphQL API (`apps/mobile/src/lib/config.ts` →
`apps/mobile/src/env.ts`, default `https://admin.jesusfilm.org/api/graphql`).
There is no local CMS, no bundled content, and the Apollo cache is in-memory
only (`apps/mobile/src/lib/apolloClient.ts`) — empty on every cold start.

The delay has two stacked causes:

1. **A blocking, oversized fetch.** `GET_VIDEO_BY_SLUG` pulls the entire
   `WatchVideo` fragment (`apps/mobile/src/lib/queries.ts:95-212`): all image
   variants, every locale, the parent and _all_ sibling children, every
   dubbed-language variant with every download file and every subtitle track,
   study questions, and Bible citations with book joins. First paint uses a
   small fraction of it, yet the screen blocks behind one spinner until the
   whole payload returns (`apps/mobile/app/watch/[slug].tsx:154`).

2. **Discarded seed data.** The search result already carries `slug`, `title`,
   `imageUrl`, and `playbackId` (`apps/mobile/src/lib/queries.ts:58-67`), but
   navigation passes only the slug — so nothing the user already saw is reused,
   and every tap is a cold fetch.

The cost is felt on the single most common action in the app: opening a video.

---

## Key Decisions

- **"Never blocks" is the screen's contract, not a search-only fix.** The
  detail screen is modeled as `seed → enriching → complete`, where a blank
  full-screen spinner is not a representable state. This applies to every entry
  point — search, Up Next, home/experience cards, and cold deep links.

- **Seed-and-enrich via navigation handoff.** Callers that already have a
  video's title/image/`playbackId` pass them into the detail route so it paints
  instantly; the network fetch becomes pure enrichment, not a gate.

- **Optimistic playback, accept the rare swap.** Playback starts immediately
  from the `playbackId` already in hand (HLS URL derived as
  `https://stream.mux.com/{playbackId}.m3u8`). In the common English/primary
  case the optimistic source equals the resolved one, so the later query is a
  silent no-op. When the resolved default variant differs, the player swaps
  source — accepted, because a brief reload still beats a blank screen.

- **Split into lean core + deferred detail.** First paint depends only on a
  lean data set (title, poster, description, active playable stream). The heavy
  data loads after first paint or lazily when the surface that needs it opens —
  a natural fit because the download, language, and subtitle surfaces are
  _already_ separate routes (`apps/mobile/app/watch/[slug].tsx:220-222`).

- **Persist the cache and prefetch.** The GraphQL cache persists to device
  storage so previously-opened videos hydrate with no network on a later visit,
  and detail data is prefetched from list surfaces so a tap reads from cache.

- **Admin stays out of this work.** If the lean fetch needs a server-side
  schema change, it is surfaced as a handoff to the admin owners, not made here.

---

## Requirements

### Instant first paint

- R1. When a caller has seed data (title, image, `playbackId`, slug), tapping a
  video navigates to the detail screen with that seed, and the screen renders it
  immediately without a full-screen spinner.
- R2. The detail screen never shows a blank/full-screen spinner as a loading
  state. Before data arrives it shows seed content and/or a structured skeleton
  (player area, title, section placeholders).
- R3. Sections fill in progressively as their data becomes available, rather
  than the screen blocking until the complete payload arrives.

### Optimistic playback

- R4. When a usable `playbackId` is present (from seed or lean fetch), the
  player begins loading the HLS stream immediately, derived as
  `https://stream.mux.com/{playbackId}.m3u8`.
- R5. When the resolved active/default variant differs from the optimistic
  source, the player swaps to the correct source as one continuous playback (no
  crash, no double-play). When they match, no swap or reload occurs.
- R6. When no `playbackId` is available (e.g. a cold deep link with slug only),
  the screen shows poster/skeleton and begins playback once the lean fetch
  resolves a playable variant.

### Lean core, deferred detail

- R7. First paint depends only on a lean data set: title, poster, description,
  and the active variant's playable stream. Heavy data is not required for it.
- R8. Heavy data — all dubbed-language variants, all download files, all
  subtitle tracks, Up Next siblings, Bible citations, study questions — loads
  after first paint or lazily when its surface is opened.
- R9. The download, language, and subtitle sheets read from cache or fetch the
  slice they need when opened, rather than depending on it being pre-loaded by
  the detail screen. A brief per-sheet load on first open is acceptable.

### Persistence & prefetch

- R10. The GraphQL cache persists to device storage so a previously-opened
  video hydrates instantly (poster, title, metadata) on a later visit or after
  app restart, with a background refresh updating it.
- R11. Detail data for a video is prefetched when its card is shown or pressed
  in the search list (and other lists where the cost is low), so tapping it
  reads from cache.

### Cross-cutting

- R12. Every entry point into the detail screen — search, Up Next, home cards,
  cold deep links — gets the instant-paint behavior. The search→tap path is not
  privileged over the others.

---

## Key Flows

- F1. Search → tap (seed available)
  - **Trigger:** User taps a video search result.
  - **Steps:** Navigate with seed (title/image/`playbackId`); screen paints
    poster + title instantly; player starts from the derived HLS URL; lean fetch
    enriches description/metadata; heavy data loads in the background; resolved
    variant either matches (no-op) or swaps once (R5).
  - **Outcome:** Video visible and playing without a blank spinner.
  - **Covers:** R1, R2, R4, R5, R7, R8.

- F2. Cold deep link (no seed)
  - **Trigger:** A shared URL opens the detail screen fresh with only a slug.
  - **Steps:** Screen shows skeleton + poster placeholder; lean fetch resolves
    the playable core; player starts; heavy data loads after.
  - **Outcome:** No blank spinner even with zero handoff data.
  - **Covers:** R2, R6, R7, R12.

- F3. Repeat visit
  - **Trigger:** User re-opens a video viewed earlier this session or before
    restart.
  - **Steps:** Persisted cache hydrates the screen instantly; a background
    revalidate refreshes it.
  - **Outcome:** Instant paint with no blocking network.
  - **Covers:** R10, R12.

---

## Acceptance Examples

- AE1. **Covers R4, R5.** Seed `playbackId` equals the resolved active variant
  (English/primary case). **Given** a tapped result with a `playbackId`,
  **when** the lean/heavy data resolves the same variant, **then** playback runs
  continuously with no source swap or reload.
- AE2. **Covers R5.** Seed `playbackId` differs from the resolved default
  variant. **Given** optimistic playback started from the seed, **when** the
  resolved default variant is different, **then** the player swaps to the
  correct source as a single continuous session without crashing or double-play.
- AE3. **Covers R2, R6.** Cold deep link, slug only. **Given** no seed data,
  **when** the screen mounts, **then** it shows a skeleton and poster (never a
  blank full-screen spinner) and begins playback once the lean fetch resolves.
- AE4. **Covers R10.** Previously-opened video re-opened after app restart.
  **Given** a persisted cache entry, **when** the screen mounts, **then** poster,
  title, and metadata appear instantly from cache while a background refresh
  runs.
- AE5. **Covers R9.** Download sheet opened for a freshly-opened video. **Given**
  heavy data was deferred, **when** the user opens Download, **then** the sheet
  fetches or reads its own slice (a brief load is acceptable) rather than
  assuming it was pre-loaded.

---

## Success Criteria

- No full-screen spinner is observable on any entry path into the detail screen.
- With seed data, poster + title are on screen within ~150 ms of tap, before any
  network completes.
- Time-to-first-video-frame is no longer gated on the heavy payload; playback
  starts as soon as the HLS manifest and decode allow — a large reduction from
  the current ~5 s.
- Re-opening a previously-viewed video paints from the persisted cache with zero
  blocking network.
- Verified in the iOS simulator on the `ourlovingpursuer` and `birth-of-jesus`
  paths: reload, search, tap, observe instant paint and playback start.

---

## Scope Boundaries

### Deferred for later

- Full offline content sync or pre-warming popular videos on device. Persisting
  videos the user actually opens is in scope (R10); bulk background pre-sync is
  not.
- Hiding the optimistic→resolved source swap behind a crossfade/poster cover —
  the swap is accepted as-is for v1; smoothing it is a later polish.

### Outside this work's identity

- Admin / server-side query or schema changes. If the lean fetch needs server
  support, surface it as a handoff to the admin owners rather than editing
  `apps/admin` here.
- Changes to the search query, ranking, or results UI.
- Locale / i18n expansion. The detail screen's hardcoded `locale: "en"`
  (`apps/mobile/app/watch/[slug].tsx:65`) is unchanged by this work.

---

## Dependencies / Assumptions

- Search results carry `playbackId` for playable video results (verified,
  `apps/mobile/src/lib/queries.ts:66`). Non-video results (e.g. collections) may
  lack it — those fall back to R6's skeleton-then-play path.
- The Mux HLS URL pattern is `https://stream.mux.com/{playbackId}.m3u8`
  (verified, `apps/mobile/src/lib/muxThumbnail.ts:1`), and `stream.mux.com` is an
  allowed streaming host (`apps/mobile/src/lib/validateUrl.ts:1`).
- The search `playbackId` is assumed to be the primary/English asset. When it
  diverges from the detail screen's resolved default variant, that is the R5
  swap case — assumed rare.
- A lean field selection on `videoBySlug` is efficiently supported by the
  existing admin GraphQL surface. If a dedicated lighter resolver/field proves
  necessary, that is an admin handoff (see Scope Boundaries).
- An Apollo cache-persistence approach for React Native is available; the
  specific backend (AsyncStorage / MMKV) is a planning decision.
- Mobile has no ISR/revalidation webhook (unlike web). Staleness is handled by
  revalidate-on-view (the existing `cache-and-network` policy), so persisted
  content paints instantly then refreshes.

---

## Outstanding Questions

### Deferred to planning

- Persistence backend (AsyncStorage vs MMKV), cache size, and eviction policy.
- Whether the lean/heavy split is two queries or one query with `@defer`, and
  the exact lean field set.
- Prefetch trigger (on-viewable vs press-in) and concurrency limits to avoid
  hammering the API from a scrolling list.
- Skeleton visual design.
- Whether per-sheet fetches (R9) should themselves read the persisted cache
  first.

---

## Sources / Research

- `apps/mobile/src/lib/queries.ts:43-71` — `SEARCH` result fields, including
  `playbackId`; `:95-223` — `WatchVideo` fragment and `GET_VIDEO_BY_SLUG`.
- `apps/mobile/app/(tabs)/watch.tsx` — search screen; navigation currently
  passes only the slug.
- `apps/mobile/app/watch/[slug].tsx:64-68` — `cache-and-network` query;
  `:154-160` — full-screen spinner block; `:220-222` — download/language/
  subtitle as separate routes.
- `apps/mobile/src/lib/apolloClient.ts` — `InMemoryCache`, no persistence;
  endpoint via `getGraphQLUrl()`.
- `apps/mobile/src/lib/config.ts` + `apps/mobile/src/env.ts` — endpoint defaults
  to `https://admin.jesusfilm.org/api/graphql`.
- `apps/mobile/src/lib/muxThumbnail.ts:1` — Mux URL pattern;
  `apps/mobile/src/lib/validateUrl.ts:1` — allowed streaming host.
- `apps/mobile/src/components/watch/VideoPlayer.tsx:31-42` — `player.replace`
  swaps source only when the URL changes (the no-op-on-match behavior R5 relies
  on).
- `apps/mobile/src/lib/normalizeVideo.ts:273-274` — `streamingUrl` /
  `muxPlaybackId` derivation from the first playable variant.
