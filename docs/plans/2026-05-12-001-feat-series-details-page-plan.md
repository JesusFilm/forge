---
title: "feat(web): Series Details Page"
type: feat
status: active
date: 2026-05-12
origin: docs/brainstorms/2026-05-12-series-details-page-requirements.md
---

# feat(web): Series Details Page

## Summary

Add a new render branch inside the existing `/[slug]/[locale]` route in `apps/web` so a slug pointing at a `COLLECTION`-labeled video record (a series with episodes) lands on a dedicated series page rather than the video-details layout. The HOW: detect series upstream in `page.tsx` immediately after `resolveWatchVideoBySlug`, add a sibling resolver that doesn't filter out series-without-trailer, write three small components (`SeriesHero`, `SeriesEpisodesGrid`, `SeriesPageClient`) that compose existing primitives, and add a parallel `generateSeriesMetadata` helper. No admin-schema changes, no env-var additions, no new icons, no new modal types.

---

## Problem Frame

`apps/web/src/app/[slug]/[locale]/page.tsx` resolves any 2-segment slug through `resolveWatchVideoBySlug` first; when that returns a record, the page renders `WatchPageClient` regardless of whether the record is a single video or a `COLLECTION`-labeled parent with episodes. Series-typed slugs (e.g., StoryClubs) currently render against a layout sized for a single video — the episode list, series-level share affordance, and series description have nowhere to display.

Full background, requirements, and acceptance criteria live in the [origin requirements doc](../brainstorms/2026-05-12-series-details-page-requirements.md).

---

## Requirements

- R1. Series page lives at the existing `/[slug]/[locale]` route via a branch inside `page.tsx`, not a new URL path.
- R2. Series detection uses `video.label === "COLLECTION"`. The admin `VideoLabel` enum (`apps/admin/schema.graphql:1082-1091`) contains BOTH `COLLECTION` and `SERIES`; U1 includes a pre-implementation admin-data smoke check that locks the discriminator before any code is written. See origin: brainstorm.
- R3. Empty/error states reuse the existing `ExperienceEmpty` / `ExperienceError` components.
- R4. Page inherits the same floating search bar and JFP logo as the video details page (layout-level inheritance — no per-page work).
- R5. If the series record has at least one variant with an `hls` source (published and playable), the hero plays it muted-on-loop via the existing `HeroPlayer` primitive — same `Play with Sound` pill, same scroll-pause/resume behavior, same portaled chrome backdrop. (`hls` is the canonical playability discriminator — see Key Technical Decisions and the existing `resolveWatchVideoBySlug` guard at content.ts:983.)
- R6. If no playable variant exists, the hero renders a static `<Image>` of `series.images[0]` via the existing `resolvePosterUrl` chain. No `<MuxPlayer>` is mounted.
- R7. The series title overlay sits at the bottom of the hero in both modes — same `hero-player-overlay-anchor` pattern as the video page, so it rides the body section on scroll.
- R8. Page displays a label of the form `SERIES · {N} EPISODE(S)` where N = `series.children.length`. Pluralization rule: `N === 1 → "SERIES · 1 EPISODE"`; `N !== 1 → "SERIES · {N} EPISODES"` (covers N = 0 and N ≥ 2).
- R9. Page displays the series title with the same H1 styling as the video page.
- R10. Page displays the Share pill triggering the existing `ShareModal` scoped to the series (title, description, poster, slug). `ShareModal` requires no API changes — its `playbackId` prop is already optional.
- R11. Page displays the series description with the same paragraph styling as the video page's `WatchBody`.
- R12. Below the metadata, the page renders a grid of every child of the series (every episode).
- R13. Grid uses the exact column template from the search-results grid: `grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
- R14. Episode cards reuse the existing `VideoCard` component as-is. No duration overlay; no new card variant.
- R15. Episode card clicks navigate to `/{episode.slug}/{locale}` via a custom `hrefBuilder` passed into `VideoCard`. Locale is the same locale the user is viewing the series in.
- R16. No new UI primitives, no new icons, no new gradients, no new modal types are introduced. Every visible element composes from existing `apps/web` components.
- R17. Page metadata (`generateMetadata` → OG tags + `<title>`) populates from the series record directly via a new `generateSeriesMetadata` helper that mirrors `getWatchPageMetadata`.

**Origin actors:** none specified — single-actor (anonymous web visitor) page.
**Origin flows:** F1 (Visit a series and pick an episode).
**Origin acceptance examples:** AE1 (R5), AE2 (R6, R7), AE3 (R5 + hero scroll behavior), AE4 (R8), AE5 (R15).

---

## Scope Boundaries

- No Bible Quotes carousel on the series page.
- No Related Questions accordion.
- No language picker / language-switching UI.
- No sibling carousel (the episode grid IS the discovery surface).
- No download modal — series-level downloads are not a concept.
- No "Ask Yours" CTA.
- No changes to the admin schema, the `VideoLabel` enum, or the `WatchVideo` GraphQL fragment.
- No widening of `ShareModal`'s props (the existing `playbackId?: string | null` accepts the no-trailer series case unchanged).
- No new env vars.
- No duration overlay on episode cards — the existing `VideoCard` ships unchanged.
- No editorial featured episode for the hero — trailer is whatever the series record's variants carry; absent, static thumbnail.
- No carousel for the episode grid (no Embla, no horizontal scroll) — plain CSS grid.
- No analytics events specific to series-page interactions in v1.
- No Playwright e2e coverage in this plan — unit + jsdom tests match the watch-page test pattern.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/app/[slug]/[locale]/page.tsx` (lines 21-32 for `generateMetadata`; lines 40-55 for the routing branch insertion point)
- `apps/web/src/lib/content.ts` (lines 137-143 for `ResolvedWatchPage` discriminated union; line 983 for the `playableVariants.length` guard that `resolveSeriesBySlug` must bypass; line 965 for `tryResolveWatchVideoBySlug` — the inner uncached helper — and line 1025 for the cached public `resolveWatchVideoBySlug` shape to mirror)
- `apps/web/src/lib/fragments/watch-video.ts` (lines 50-61 for the `children` projection — slug/title/label/images all present; comment at line 6 confirming editor-curated relation order)
- `apps/web/src/components/watch/HeroPlayer.tsx` (lines 288-289 — `playbackId`/`hlsSrc` defaults to undefined when null; component spins on a black box rather than degrading to static)
- `apps/web/src/components/watch/HeroPlayerControls.tsx` (canonical chrome + backdrop portal pattern; reused untouched)
- `apps/web/src/components/watch/ShareModal.tsx` (lines 45-55 — `playbackId?: string | null` already optional; line 75 — URL builder uses `${origin}/watch/${slug}/${locale}` which is correct under Next's `basePath: "/watch"`)
- `apps/web/src/components/watch/WatchPageClient.tsx` (lines 17-24 for the `WatchModalState` to narrow; lines 116-157 for the `<main>` shape to mirror)
- `apps/web/src/components/search/VideoCard.tsx` (lines 6-13 — `hrefBuilder` prop is fully customizable; line 12 — `defaultHrefBuilder` returns `/${slug}/en` which we override per call site)
- `apps/web/src/components/SearchOverlay.tsx` (line 263 — exact grid className `grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`; line 311 is a duplicate at the exit-animation branch)
- `apps/web/src/lib/search.ts` (lines 37-39 — `SearchResult` type the `VideoCard` adapter must produce)
- `apps/web/src/lib/url.ts` (`resolvePosterUrl` for the static-hero thumbnail fallback)
- `apps/web/src/lib/experience-metadata.ts` (`getWatchPageMetadata` — pattern to mirror for `generateSeriesMetadata`)
- `apps/admin/schema.graphql` (lines 682-691 — `VideoLabel` enum confirms `COLLECTION` value)

### Institutional Learnings

- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md` — Lift player to React state (not just `useRef`) for subscription rebinding on remount. Render-phase spinner reset on playback-ID change (not in `useEffect`). Sticky `aspect-video` + `useLayoutEffect` for the ResizeObserver. `SeriesHero` reuses `HeroPlayer` untouched, so these contracts ride along for free.
- `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md` — `ShareModal` builds canonical URLs from props. Verified the existing `${origin}/watch/${slug}/${locale}` form is correct for both video and series pages under `basePath: "/watch"`; no `pathPrefix` widening required. Locale must drive variant selection, not just appear in the cache key — applies if/when the series page ever fetches variant-specific data (not in v1).
- `docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md` — Before authoring any new admin operation, sweep both `rg "adminGraphql\("` AND `rg "= gql\`"` against `apps/web/src` to inventory existing fields. This plan does NOT add a new fragment (reuses `WatchVideo`), so the sweep is a verification-only step in U1.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` — Verified: this plan introduces no new env vars; `ADMIN_GRAPHQL_URL` is already provisioned per the Unit-5 PR. Carry the discipline forward only if future iterations add a feature flag.
- `docs/solutions/logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md` — Strapi-side 10-row cap on list relations does not apply here (admin GraphQL via Pothos). The existing `WatchVideo` fragment already uses `children(pagination: { limit: -1 })` defensively against Strapi reads, so admin-Pothos behavior is also covered against future re-routing.

### External References

- None — every primitive needed is already in `apps/web`.

---

## Key Technical Decisions

- **Branch routing in `page.tsx`, not in `resolveWatchPage`**: The existing resolver only handles experience/template slugs and never receives a `WatchVideoRecord`. Adding a `kind: "series"` would conflate two unrelated resolver shapes. Cleaner to detect after `resolveWatchVideoBySlug` returns.
- **Add `resolveSeriesBySlug` instead of relaxing `resolveWatchVideoBySlug`**: The existing resolver's `!playableVariants.length` guard is correct for the video page (a video with no playable variant is genuinely broken). A series with no trailer is fine — it just renders a static thumbnail. Splitting the resolver keeps the video-page contract intact.
- **`SeriesHero` as a wrapper, not a HeroPlayer modification**: `HeroPlayer` is shared across the watch page and works correctly with current assumptions (a playable variant is always present). Adding a "no-variant" branch inside it would couple two distinct UI states into one component. The series page composes `HeroPlayer` (when trailer exists) or a static `<Image>` (when not) at the call-site level.
- **`SeriesPageClient` narrows the modal state machine**: `WatchModalState` includes `"download" | "language" | "share"` — the series page only uses `"share"`. Narrowing to `"none" | "share"` keeps the type and the component's surface honest about what it actually does.
- **Episode → SearchResult adapter is inline, not a new module**: The mapping is six lines of pure data shaping. Extracting it to its own file would create premature abstraction; co-locating it inside `SeriesEpisodesGrid.tsx` (as an unexported `toSearchResult` function) keeps the adapter's blast radius scoped.
- **`generateSeriesMetadata` lives in `experience-metadata.ts`**: Adjacent to the existing `getWatchPageMetadata` so the patterns evolve together. Doesn't justify a new module yet.
- **`hls` is the canonical playability discriminator, not `muxVideo.playbackId`**: The existing `resolveWatchVideoBySlug` guards on `Boolean(variant.hls)` (content.ts:983). R5 and U2's branch follow the same contract so the video page and series page share a single playability rule. If a future variant carries a `muxVideo.playbackId` without an `hls` URL, both pages will treat the variant as unplayable — intentional, because `<MuxPlayer>` consumes `hls` for streaming.
- **Shared cached inner fetch for both resolvers**: `resolveWatchVideoBySlug` and `resolveSeriesBySlug` both consume a single `cache()`-wrapped inner fetch (e.g., `getWatchVideoBySlugCached`) so the COLLECTION-without-trailer path makes one admin GraphQL round-trip, not two. `resolveSeriesBySlug` filters its return to `label === "COLLECTION"` so it never hijacks broken-video slugs that should fall through to `resolveWatchPage`.
- **`generateMetadata` reuses the request-scoped resolver**: `generateMetadata` calls `resolveWatchVideoBySlug(slug, locale)` directly and relies on React's `cache()` dedupe (already wrapping the resolver at content.ts:1025) so the same call from `SlugLocalePage` returns the same value without a second admin round-trip.

---

## Open Questions

### Resolved During Planning

- **How to detect "this slug is a series"**: `video.label === "COLLECTION"` against the admin `VideoLabel` enum (verified in `apps/admin/schema.graphql:682-691`). The brainstorm flagged this as deferred-to-planning.
- **Should `resolveWatchPage` grow a `kind: "series"` branch?**: No — `resolveWatchPage` handles experience/template slugs only and never receives a `WatchVideoRecord`. Branch in `page.tsx` directly.
- **Does `HeroPlayer` degrade cleanly to a static image when no variant?**: No — it spins on a black box until Mux's error UI eventually surfaces. Solved by writing a `SeriesHero` adapter that branches at the call site.
- **How are episodes ordered?**: Editor-curated relation order, returned by admin GraphQL as-is. No client-side sort needed. Confirmed by the `WatchVideo` fragment's documentation comment (line 6).
- **Does `ShareModal` need adjustment for the series case?**: No — `playbackId` is already optional (`string | null | undefined`), and the URL builder's `${origin}/watch/${slug}/${locale}` form is correct under the `/watch` basePath. The Embed tab automatically suppresses when no playback ID is present.
- **How do we get episode count and the children projection?**: Both come from the existing `WatchVideo` fragment's `children(pagination: { limit: -1 })` block — no fragment widening needed.

### Deferred to Implementation

- **Exact prop signature for `SeriesHero`**: Likely `{ series: WatchVideoRecord, locale: string }` mirroring `HeroPlayer`'s `block` prop shape, but the exact type lives next to the component once we touch the file.
- **Whether `resolveSeriesBySlug` should also short-circuit when `series.children.length === 0`**: A `COLLECTION` with no children is editorially broken. Either render the page anyway (R3-style empty state) or 404 it. Pick during U1 based on what `ExperienceEmpty` looks like for series.
- **Where the floating search bar + JFP logo are rendered today** (layout vs. WatchPageClient): If layout-level (likely per the prompt's framing), `SeriesPageClient` inherits them for free. If component-level, U4 must include them explicitly. One `grep` at the start of U4 resolves this.
- *(Resolved during planning — pluralization rule now lives in R8: `N === 1 → "SERIES · 1 EPISODE"`, otherwise `"SERIES · {N} EPISODES"`.)*

### Deferred from Document Review (2026-05-12)

- **Static-hero overlay legibility on arbitrary posters** *(design-lens, U2)*: R7 specifies the title overlay rides the body-section scroll in both modes via the overlay anchor, but does not specify a gradient scrim, drop shadow, or contrast treatment for the static-image branch. The video-page overlay assumes a dark video frame; a light or saturated poster could make white title text unreadable. Decide before U2 lands: keep the overlay-anchor pattern as-is and accept the poster-contrast risk, or add a scrim layer behind the title in static mode (mirrors `VideoCard`'s `bg-gradient-to-t from-black via-black/25 to-transparent`).
- **Series with zero children — visual fallback** *(design-lens, U1/Risks)*: A `COLLECTION` with `children.length === 0` is editorially valid (mid-population) but produces an empty grid that may look broken. Decide before U4 lands: render `ExperienceEmpty`, render the hero + metadata with an empty grid (low-content acceptable), or 404. Tie the decision to what admin data actually looks like for series records mid-population — check during U1's pre-implementation gate.
- **Episode card hover state in a persistent series grid** *(design-lens, U3)*: `VideoCard`'s existing hover style (`hover:scale-[1.02] hover:shadow-2xl`) was designed for a transient search-results list, not a persistent episode grid. Decide before U3 lands: inherit unchanged, suppress via a prop on `VideoCard` (would widen its API), or accept a small custom variant for the series page (would violate R16). Defer until the implementer can see both contexts side-by-side.

---

## Implementation Units

### U1. Add `resolveSeriesBySlug` resolver

**Goal:** Add a new resolver in `apps/web/src/lib/content.ts` that returns a series-shaped record (`WatchVideoRecord` with `label === "COLLECTION"` and `children`) without the `playableVariants.length` guard that `resolveWatchVideoBySlug` enforces.

**Requirements:** R2, R5, R6 (foundation for the trailer-or-thumbnail branch; AE2 fails today because the series-without-trailer case is filtered out upstream).

**Dependencies:** None.

**Files:**
- Modify: `apps/web/src/lib/content.ts`
- Test: `apps/web/src/lib/__tests__/content-series.test.ts` (new) — or extend `content-watch-merge.test.ts` if the existing test file owns content.ts coverage.

**Approach:**
- **Pre-implementation gate (hard prerequisite — runs before any code is written):** query the admin GraphQL endpoint for a known series slug (the StoryClubs equivalent in admin) and record the actual `label` value in this section of the plan body. The plan currently assumes `COLLECTION`; if admin data returns `SERIES` (or `null`, with `children.length > 0` as the actual discriminator), update R2, R5, and the U5 branch condition to match before writing the resolver. Discriminator must be locked in writing before U1 implementation begins.
- Extract a shared `cache()`-wrapped inner fetch (e.g., `getWatchVideoBySlugCached`) consumed by BOTH `resolveWatchVideoBySlug` and `resolveSeriesBySlug` so the COLLECTION-without-trailer path makes one admin round-trip, not two. The existing inner `tryResolveWatchVideoBySlug` (content.ts:965) becomes a thin wrapper that adds the `playableVariants.length` guard on top of the shared cache; `resolveSeriesBySlug` is the parallel wrapper that skips that guard and filters on `video.label === "COLLECTION"`.
- Mirror `tryResolveWatchVideoBySlug` (line 965 — the inner uncached helper wrapped by the public `resolveWatchVideoBySlug` at line 1025) but skip the `!playableVariants.length` rejection at line 983.
- Reuse the existing `getWatchVideoBySlugOperation` (or `getWatchVideoOperation`) — no new GraphQL operation, no fragment widening.
- Return shape: `{ video: WatchVideoRecord, canonicalParent: WatchVideoRecord | null, selectedVariant: WatchVariant | null }`. `selectedVariant` is the chosen trailer when one exists (a variant whose `hls` is set, per the Key Technical Decisions discriminator), `null` otherwise.
- Filter out non-`COLLECTION` records before returning — records with any other `label` value short-circuit to `null` so the U5 branch falls through to `resolveWatchPage` in one round-trip rather than getting hijacked by the series resolver.
- Inline `toSearchResult` adapter is NOT in scope here — it lives in U3.
- Before writing the resolver, run the dual-pattern sweep from `docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md`: `rg "adminGraphql\(" apps/web/src` AND `rg "= gql\\\`" apps/web/src` to verify no fragment widening is needed. The plan asserts none is — the sweep is a safety check, not exploratory.

**Patterns to follow:**
- `resolveWatchVideoBySlug` for the resolver shape, locale handling, error envelope (`isWatchVideoBySlugMissingError`), and Apollo client construction.

**Test scenarios:**
- Happy path: given a slug for a `COLLECTION` record with `children.length > 0` and at least one variant with `muxVideo.playbackId`, the resolver returns the record with `selectedVariant` populated to that variant.
- Happy path: given a slug for a `COLLECTION` record with `children.length > 0` and NO variants with `muxVideo.playbackId`, the resolver returns the record with `selectedVariant === null` (this is the case `resolveWatchVideoBySlug` currently filters out — proves AE2's data path).
- Edge case: given a slug for a `COLLECTION` record with `children.length === 0`, the resolver returns a structurally valid record so the page layer can decide whether to render an empty grid or 404 (resolution deferred to U4/U5).
- Edge case: given a slug that resolves to a non-`COLLECTION` record, the resolver returns `null` (or the existing missing-error envelope) — does not falsely accept a video.
- Error path: given an Apollo network error, the resolver propagates the error in the same shape `resolveWatchVideoBySlug` produces, so the page-level error UI matches.

**Verification:**
- New resolver exports cleanly from `content.ts` and is callable from `page.tsx`.
- `pnpm typecheck` clean.
- New unit tests pass and cover all five scenarios above.

---

### U2. Add `SeriesHero` component

**Goal:** New component at `apps/web/src/components/watch/SeriesHero.tsx` that branches between `<HeroPlayer block={…} />` (when the series has a trailer variant) and a static `<Image>` of `series.images[0]` (when not). Static-mode includes a zero-height `hero-player-overlay-anchor` so the title overlay rides the body section on scroll exactly as the video page does.

**Requirements:** R5, R6, R7. Origin AE: AE1, AE2, AE3.

**Dependencies:** None.

**Files:**
- Create: `apps/web/src/components/watch/SeriesHero.tsx`
- Create: `apps/web/src/components/watch/__tests__/SeriesHero.test.tsx`

**Approach:**
- Props: `{ series: WatchVideoRecord, selectedVariant: WatchVariant | null, locale: string, onPlayerReady?: (player) => void }`.
- Branch: `if (selectedVariant && (selectedVariant.muxVideo?.playbackId || selectedVariant.hls))` → mount `<HeroPlayer block={{ kind: "HeroPlayer", video: series, variant: selectedVariant }} onPlayerReady={…} />` with the existing `WatchHeroPlayerBlock` shape.
- Otherwise → render a `sticky aspect-video w-full overflow-hidden bg-black` wrapper containing `<Image fill src={resolvePosterUrl(series.images?.[0], null)} alt="" priority className="object-cover" />` plus the same zero-height `<div ref={setOverlayAnchor} data-testid="hero-player-overlay-anchor" className="relative z-10 h-0 w-full" />` div the video page uses.
- The static-mode wrapper uses the same sticky-top computation (`min(0px, calc(100svh - heroHeight))`) so the title overlay's overlay-anchor sits at the same scroll-aware position.
- **Alt text rationale (accessibility):** `alt=""` on the static-hero Image is intentional — the series title is rendered in the overlay immediately following the image in DOM order (per R7), making the image decorative for screen readers. Add an inline code comment near the `<Image>` capturing this reasoning so any future refactor that relocates the title overlay is forced to reconsider the alt value.

**Patterns to follow:**
- `apps/web/src/components/watch/HeroPlayer.tsx` lines 200-330 for the sticky wrapper + overlayAnchor pattern.
- `apps/web/src/lib/url.ts` `resolvePosterUrl` for the thumbnail URL chain.

**Test scenarios:**
- **Covers AE1.** Happy path (trailer mode): given a `selectedVariant` with `muxVideo.playbackId`, the component renders `<HeroPlayer />` and a `data-testid="hero-player-wrapper"` is present.
- **Covers AE2.** Happy path (static mode): given `selectedVariant === null` (or a variant with neither `muxVideo.playbackId` nor `hls`), the component renders `<img>` from `series.images[0]` and does NOT mount any `<mux-player>` element. The `data-testid="hero-player-overlay-anchor"` zero-height div is still present.
- Edge case: given a series with no `images` array, the component renders a black background placeholder (no broken `<img>` src).
- Edge case: given `selectedVariant` with `hls` but no `muxVideo.playbackId`, the component falls through to HeroPlayer (which handles the `hls` src fallback path).

**Verification:**
- `pnpm typecheck` clean.
- Unit tests pass for both trailer-mode and static-mode branches.

---

### U3. Add `SeriesEpisodesGrid` component + inline child-to-SearchResult adapter

**Goal:** New component at `apps/web/src/components/watch/SeriesEpisodesGrid.tsx` that renders every child of the series using the existing `VideoCard` component, in the same grid template the search overlay uses for results. Episode clicks route to `/{episode.slug}/{locale}`.

**Requirements:** R12, R13, R14, R15. Origin AE: AE5.

**Dependencies:** None (parallel with U2).

**Files:**
- Create: `apps/web/src/components/watch/SeriesEpisodesGrid.tsx`
- Create: `apps/web/src/components/watch/__tests__/SeriesEpisodesGrid.test.tsx`

**Approach:**
- Props: `{ episodes: NonNullable<WatchVideoRecord["children"]>, locale: string }`.
- Inline (unexported) `toSearchResult(child)` mapper: `id = child.documentId`, `slug = child.slug`, `title = child.title`, `imageUrl = child.images?.[0]?.mobileCinematicHigh ?? child.images?.[0]?.thumbnail ?? null`, `type = "video"`, `snippet = null`, `startSeconds = null`, `playbackId = null`, `score = 0`.
- Wrapper className: `grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` (verbatim from `SearchOverlay.tsx:329`).
- Custom `hrefBuilder={(result) => \`/${result.slug}/${locale}\` as Route}` passed to each `<VideoCard>`.
- No animations (drop the `animate-card-enter`/`animate-card-exit` modifiers — those are search-result-specific).

**Patterns to follow:**
- `apps/web/src/components/SearchOverlay.tsx` line 329 for the grid wrapper className.
- `apps/web/src/components/search/VideoCard.tsx` for the `hrefBuilder` signature.
- `apps/web/src/lib/search.ts` lines 37-39 for the `SearchResult` shape the adapter must produce.

**Test scenarios:**
- Happy path: given a series with 3 episode children, the component renders 3 `<a>` elements with `data-testid` patterns matching `VideoCard`'s anchor.
- **Covers AE5.** Happy path: given a child with `slug === "storyclubs-birth-of-jesus"` and the page locale is `en`, the rendered anchor's `href` attribute is `/storyclubs-birth-of-jesus/en`.
- Edge case: given an empty children array, the component renders the grid wrapper but no cards. No layout shift, no error.
- Edge case: given a child whose `images[0]` is missing both `mobileCinematicHigh` and `thumbnail`, the card's `imageUrl` is null and `VideoCard` falls through to its placeholder gradient — verifies the adapter doesn't throw.
- Integration: given a child whose `documentId` is the same as another child's `slug` (collision), each `VideoCard` still uses `documentId` as React key (no duplicate-key warnings).

**Verification:**
- `pnpm typecheck` clean.
- Unit tests pass for all five scenarios.
- Wrapper className matches the search-results grid byte-for-byte (regression guard against future divergence).

---

### U4. Add `SeriesPageClient` orchestrator

**Goal:** New client component at `apps/web/src/components/watch/SeriesPageClient.tsx` that composes `SeriesHero` (U2) + the metadata block (label + title + share + description) + `SeriesEpisodesGrid` (U3) + the existing `ShareModal`. Mirrors `WatchPageClient`'s `<main>` shape but narrows the modal state machine to `"none" | "share"`.

**Requirements:** R3, R4, R8, R9, R10, R11, R16, R17 (header inheritance verified here).

**Dependencies:** U2 (`SeriesHero`), U3 (`SeriesEpisodesGrid`).

**Files:**
- Create: `apps/web/src/components/watch/SeriesPageClient.tsx`
- Create: `apps/web/src/components/watch/__tests__/SeriesPageClient.test.tsx`

**Approach:**
- Before writing: grep `apps/web/src/app/` for where `FloatingSearchProvider` / `SearchOverlay` / JFP logo are mounted. If they live in the root layout, `SeriesPageClient` inherits them automatically — no work. If they live inside `WatchPageClient`, `SeriesPageClient` must render the same wrappers. Resolution at the top of this unit (10-minute discovery, not a rewrite).
- Props: `{ series: WatchVideoRecord, selectedVariant: WatchVariant | null, locale: string }`.
- State: `[modalState, setModalState] = useState<"none" | "share">("none")`. Drop `WatchModalState`'s `"download"` and `"language"` arms.
- JSX skeleton:
  - `<main data-testid="series-page-client" data-modal-state={modalState} className="min-h-screen bg-stone-900 text-stone-100">`
  - `<SeriesHero series={series} selectedVariant={selectedVariant} locale={locale} onPlayerReady={…} />`
  - Title block: a section with the `SERIES · {N} EPISODES` label, the H1 title, the Share pill (reusing the same `Button` variant + `ExternalLink` icon as `BibleQuotesSection.tsx:170-178`), and the description paragraph.
  - `<SeriesEpisodesGrid episodes={series.children ?? []} locale={locale} />`
  - `<ShareModal open={modalState === "share"} videoSlug={series.slug ?? ""} currentLanguageSlug={locale} videoTitle={series.title ?? null} videoDescription={series.snippet ?? series.description ?? null} posterUrl={resolvePosterUrl(series.images?.[0], null)} playbackId={null} onClose={() => setModalState("none")} />`.
- Reuse existing styling: title uses the same H1 className from `WatchBody.tsx`; description uses the same paragraph className from `WatchBody.tsx`; label uses the same uppercase-tracked-amber pattern from `HeroPlayer.tsx:289-294`.
- **Focus management (accessibility):** confirm the existing `ShareModal` implements a focus trap (Radix Dialog or manual). If yes, note it in the U4 test scenarios and rely on existing behavior. If no, add focus-on-open (first focusable element inside the modal) and focus-return-on-close (back to the Share pill on `setModalState("none")`) as explicit implementation steps inside `SeriesPageClient`.

**Patterns to follow:**
- `apps/web/src/components/watch/WatchPageClient.tsx` for the `<main>` shape, the modal-state-machine pattern, and the `ShareModal` integration.
- `apps/web/src/components/watch/WatchBody.tsx` for the title H1 + description paragraph styling.
- `apps/web/src/components/watch/HeroPlayer.tsx` lines 289-294 for the label styling (`text-sm font-semibold tracking-wider text-amber-400 uppercase`).
- `apps/web/src/components/watch/BibleQuotesSection.tsx` lines 170-178 for the Share pill (`Button variant="pill"` + `ExternalLink` icon).

**Test scenarios:**
- **Covers AE4.** Happy path: given a series with 13 children, the rendered `data-testid="series-page-client"` element contains text matching `SERIES · 13 EPISODES`.
- Pluralization (R8 singular): given a series with exactly 1 child, the rendered label reads `SERIES · 1 EPISODE`.
- Happy path: given the user clicks the `data-testid="series-page-share"` (or equivalent) pill, the modal opens (`ShareModal` becomes visible with `data-testid="watch-share-modal"` or its existing testid).
- Happy path: given the modal is open, clicking its close button sets `data-modal-state` back to `"none"`.
- Accessibility: opening the modal moves focus into it (verifies the focus trap from the existing `ShareModal`); closing the modal returns focus to the Share pill.
- Edge case: given `series.title` is null, the H1 renders empty rather than throwing.
- Edge case: given `series.description` and `series.snippet` are both null, the description paragraph is omitted (mirrors `WatchBody`'s behavior).
- Integration: given a series WITH a trailer, `SeriesHero` mounts `HeroPlayer`; given a series without, `SeriesHero` mounts the static `<img>`. (One representative test per branch is enough — full hero coverage lives in U2.)

**Verification:**
- `pnpm typecheck` clean.
- All test scenarios pass.
- A manual visual check at a known series slug (whatever slug ends up being the StoryClubs equivalent in admin) shows the page rendering with the correct hero, label, title, share pill, description, and episode grid.

---

### U5. Wire route branching in `page.tsx` and add `generateSeriesMetadata`

**Goal:** Modify `apps/web/src/app/[slug]/[locale]/page.tsx` to detect series-shaped records and render `SeriesPageClient` instead of `WatchPageClient`. Add a parallel `generateSeriesMetadata` helper in `apps/web/src/lib/experience-metadata.ts` so OG title/description/image populate from the series record directly.

**Requirements:** R1, R2, R17.

**Dependencies:** U1 (`resolveSeriesBySlug`), U4 (`SeriesPageClient`).

**Files:**
- Modify: `apps/web/src/app/[slug]/[locale]/page.tsx`
- Modify: `apps/web/src/lib/experience-metadata.ts`
- Test: `apps/web/src/app/[slug]/[locale]/__tests__/page-routing.test.tsx` (new, OR extend any existing page-level test if present) — verifies the routing branch picks `SeriesPageClient` for `label === "COLLECTION"` and `WatchPageClient` otherwise.
- Test: `apps/web/src/lib/__tests__/experience-metadata.test.ts` (extend if present, new otherwise) — verifies `generateSeriesMetadata` populates from the series record.

**Approach:**
- In `page.tsx` after the existing `resolveWatchVideoBySlug` call (lines 40-55):
  - If `watchVideo != null` AND `watchVideo.video.label === "COLLECTION"`: render `<SeriesPageClient series={watchVideo.video} selectedVariant={watchVideo.selectedVariant} locale={locale} />`. Return.
  - Else if `watchVideo != null`: continue with the existing `WatchPageClient` rendering. (Unchanged.)
  - Else: try `resolveSeriesBySlug(slug, locale)`. If it returns a record (a series without a playable variant), render `SeriesPageClient` with `selectedVariant={null}`. Return.
  - Else: fall through to `resolveWatchPage` for experience/template slugs. (Unchanged.)
- In `generateMetadata` (lines 21-32): call `resolveWatchVideoBySlug(slug, locale)` from inside the metadata function. Because the resolver wraps `cache()` (content.ts:1025), the same call from `SlugLocalePage` reuses the result — no second admin round-trip. Then branch: if the resolved record's `label === "COLLECTION"`, call `generateSeriesMetadata(locale, { series: watchVideo.video, pathLocale: rawLocale })`; otherwise call the existing `getWatchPageMetadata(locale, { slug, pathLocale: rawLocale, pathPrefix: "watch" })`.
- `generateSeriesMetadata` mirrors `getWatchPageMetadata` but reads title/description/poster directly from the series `WatchVideoRecord`. No Strapi experience lookup. The OG image uses `resolvePosterUrl(series.images?.[0], null)`.

**Patterns to follow:**
- The existing branch order in `page.tsx` lines 40-65 (video-by-slug → experience/template fallback).
- `apps/web/src/lib/experience-metadata.ts` `getWatchPageMetadata` for the metadata helper shape (title, description, openGraph.images, openGraph.type, canonical URL construction).

**Test scenarios:**
- **Covers AE5 (route correctness).** Happy path: given a slug for a `COLLECTION` record, the page renders the `data-testid="series-page-client"` element and NOT `data-testid="watch-page-client"`.
- Happy path: given a slug for a non-`COLLECTION` video, the page renders `data-testid="watch-page-client"` (regression guard — verifies the branch doesn't break the existing video page).
- Happy path (series-without-trailer): given a slug that `resolveWatchVideoBySlug` rejects (no playable variant) but `resolveSeriesBySlug` accepts as a `COLLECTION`, the page falls through and renders `SeriesPageClient` with `selectedVariant={null}`.
- Edge case: given a slug that resolves to neither a video nor a series, the page falls through to `resolveWatchPage` (and ultimately `ExperienceEmpty`). The series branch does not swallow non-series resolution paths.
- Metadata happy path: given a series record with title "StoryClubs" and a description, `generateSeriesMetadata` returns `{ title: "StoryClubs", description: …, openGraph: { images: […], … } }`.
- Metadata edge case: given a series record with null description, `generateSeriesMetadata` returns metadata with a sensible fallback (empty string or omitted description, matching how `getWatchPageMetadata` handles missing fields).

**Verification:**
- `pnpm typecheck` clean.
- `pnpm test` passes for the route-branching test + the metadata test.
- Manual browser smoke: visiting a known `COLLECTION` slug renders the series page; visiting a known video slug renders the video page (unchanged); visiting an experience slug renders the experience page (unchanged).

---

## System-Wide Impact

- **Interaction graph:** Series detection lives in `page.tsx` and short-circuits before reaching `WatchPageClient`. The existing video and experience render paths are NOT modified — only a new branch is added.
- **Error propagation:** `resolveSeriesBySlug` uses the same error envelope shape as `resolveWatchVideoBySlug` so `ExperienceError` / `ExperienceEmpty` continue to work without changes.
- **State lifecycle risks:** None new. The series page's `SeriesPageClient` has its own modal state machine narrowed to `"none" | "share"`, so it cannot accidentally collide with the video page's `"download" | "language"` arms.
- **API surface parity:** `ShareModal` is reused unchanged. Both the video page and the series page now invoke it with the same prop signature; the series case passes `playbackId={null}` and `posterUrl` from the series thumbnail.
- **Integration coverage:** The route-level test in U5 is the integration seam — it verifies that the existing video page continues to render correctly when a non-`COLLECTION` slug is resolved. Without that test, a refactor of the branch order in `page.tsx` could silently regress the video page.
- **Unchanged invariants:** `resolveWatchVideoBySlug` keeps its `playableVariants.length > 0` guard — the video page contract is unchanged. The `WatchVideo` GraphQL fragment is unchanged. The admin schema is unchanged. `HeroPlayer`, `HeroPlayerControls`, `ShareModal`, `VideoCard`, and the search overlay's grid template are all consumed without modification.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| *(Resolved during planning — hoisted into U1 as a pre-implementation gate that locks the discriminator before code is written.)* | |
| Floating search + JFP logo are inside `WatchPageClient` rather than the root layout, requiring `SeriesPageClient` to compose them too. | U4 starts with a grep step to confirm placement. If layout-level → free reuse. If component-level → add the same wrappers to `SeriesPageClient`. Either way contained to U4. |
| `HeroPlayer`'s sticky-top math relies on the wrapper's measured `heroHeight`, and the static-mode branch in `SeriesHero` would need the same measurement for parity. | U2 mirrors the sticky-top pattern from `HeroPlayer.tsx` (the `useLayoutEffect` + `ResizeObserver` + `min(0px, calc(100svh - heroHeight))` style). Static mode uses the same measurement so the title overlay's scroll behavior matches the video page exactly. |
| Episode-card adapter loses fields that `VideoCard` quietly depends on (e.g., a future addition to `SearchResult` becomes required), regressing the grid. | TypeScript catches drift at compile time: the unexported, co-located adapter fails typecheck if its return value no longer satisfies `SearchResult`. No runtime "renders-without-warnings" assertion is needed — typecheck is the cheaper, sharper signal. |
| `generateSeriesMetadata` drifts from `getWatchPageMetadata` over time (e.g., the OG image format diverges, breaking series share previews). | Both helpers live in the same file (`experience-metadata.ts`). U5 leaves a code comment cross-referencing the two so future edits naturally consider both. |
| Series records with no children render an empty grid that looks broken. | Deferred to U4 implementation — picks between rendering the page with an empty grid (acceptable, low-content) or rendering `ExperienceEmpty` instead. Pick based on what admin data actually looks like for series records mid-population. |

---

## Documentation / Operational Notes

- No new docs needed. The brainstorm doc captures the product framing; this plan captures the technical approach; both live in `docs/`.
- No new env vars, no migration, no monitoring change.
- Rollout is the standard `apps/web` PR → Railway deploy → Cloudflare cache invalidation flow. No flag-gating in v1 — series records that already exist in admin will start resolving to the new page as soon as the PR ships.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-12-series-details-page-requirements.md](../brainstorms/2026-05-12-series-details-page-requirements.md)
- Related code: `apps/web/src/app/[slug]/[locale]/page.tsx`, `apps/web/src/lib/content.ts`, `apps/web/src/components/watch/{HeroPlayer,ShareModal,WatchPageClient,WatchBody}.tsx`, `apps/web/src/components/search/VideoCard.tsx`, `apps/web/src/components/SearchOverlay.tsx`
- Related PR: #923 (merged) — established the watch page primitives this plan composes
- Institutional learnings: `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`, `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`, `docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md`, `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`
