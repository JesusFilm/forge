---
date: 2026-05-12
topic: series-details-page
---

# Series Details Page (apps/web)

## Summary

A new web page that renders a series — a parent record (a `COLLECTION`-labeled video, or equivalent) with multiple episodes — with the same chrome, share affordance, hero pattern, and grid styling already in use on the video details page and the search overlay. Reuses existing primitives end-to-end; introduces no new visual language.

---

## Problem Frame

The watch page in `apps/web` resolves `/[slug]/[locale]` against `resolveWatchPage`, which returns a discriminated union (`experience` / `video-template` / `video`). When a slug actually points at a series — a parent record with episodes attached, the kind of record a user might find via the floating-search results — the page currently has no dedicated layout. The user lands on a page sized for a single video; the episode list, series title, and series-level share affordance have nowhere to render.

The core/apps/watch reference app has a series page for exactly this case (`StoryClubs` in the screenshots shared with the brainstorm), and the parity gap is a real navigation dead-end whenever a search result or external link points at a series-typed slug.

---

## Key Flows

- F1. **Visit a series and pick an episode**
  - **Trigger:** user navigates to `/{series-slug}/{locale}` (via floating-search result, deep link, or share URL)
  - **Steps:**
    1. Page resolves the slug to a series record (a `COLLECTION`-labeled parent video, per planning verification).
    2. Hero renders: trailer plays muted-on-loop if the series record has a trailer video on its variants; otherwise the static series thumbnail fills the hero with the title overlay anchored to the bottom edge.
    3. Below the hero, the user sees the series label ("SERIES · N EPISODES"), title, share button, and description.
    4. Further below, the grid of episodes renders using the search-results card style.
    5. User clicks an episode card → routes to `/{episode-slug}/{locale}` (the existing video details page).
  - **Outcome:** user lands on the standard video details page for the chosen episode, with the existing watch-page chrome, hero player, and download/share affordances.
  - **Covered by:** R1, R3, R4, R5, R12, R14

---

## Requirements

**Page structure & routing**

- R1. The page lives at the existing `/[slug]/[locale]` route and is selected by branching inside `resolveWatchPage` (or the page handler) when the resolved record is a series. No new URL path is introduced.
- R2. Series detection should be derived from existing admin data — verified during planning (likely the `COLLECTION` value of the admin `VideoLabel` enum, or an equivalent signal exposed by the WatchVideo fragment). No new content type or schema field is required by this brainstorm.
- R3. When the slug does not resolve to any record, the page falls back to the same empty / error states the video page already uses (`ExperienceEmpty` / `ExperienceError`).

**Header (above the hero)**

- R4. The header includes the same floating search bar and the JFP logo that appear on the video details page. The search overlay (including the six category rectangles with icons) is inherited unchanged.

**Hero**

- R5. If the series record has at least one variant whose `muxVideo.playbackId` is populated, the hero plays that variant as a muted-loop preview using the existing `HeroPlayer` primitive — same `Play with Sound` pill, same scroll-pause/resume behavior, same portaled chrome bar with backdrop gradient.
- R6. If no trailer video is available on the series record, the hero renders a static `<Image>` of the series thumbnail (`series.images[0]` via the existing `resolvePosterUrl` chain). No video element is mounted in this mode.
- R7. The series title overlay sits at the bottom of the hero in both modes — anchored to the same overlay anchor used by the video page (`hero-player-overlay-anchor`), so the title rides with the body section on scroll exactly as the video-page title does today.

**Above-the-fold metadata (below hero)**

- R8. The page displays the series label in the form `SERIES · N EPISODES` (uppercase, same styling as the existing video-page label) where N is the count of episodes attached to the series.
- R9. The page displays the series title (same H1 styling as the video page).
- R10. The page displays a Share button using the same pill component and same `ShareModal` already used by the video page. Clicking opens the share modal scoped to the series (title, description, poster, URL).
- R11. The page displays the series description text using the same paragraph styling as the video page's `WatchBody` description.

**Episodes grid**

- R12. Below the metadata, the page renders a grid of every episode attached to the series (every child record of the series).
- R13. The grid uses the same column template as the search results grid in `SearchOverlay`: `grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
- R14. Each episode card is the existing forge `VideoCard` component, used as-is. No new card component, no duration overlay, no extra metadata layered onto the card by this brainstorm.
- R15. Each episode card links to `/{episode-slug}/{locale}` — the existing video details page for that episode. The locale is the same locale the user is viewing the series in.

**Reuse contract**

- R16. The page introduces no new visual primitives, no new icons, no new gradient definitions, no new modal types. Every visible element is composed from components already shipping in `apps/web`.
- R17. The page reuses the same `generateMetadata` pattern as the video page so OG title / description / image populate from the series record.

---

## Acceptance Examples

- AE1. **Covers R5.** Given a series record with at least one variant carrying a `muxVideo.playbackId`, when the page mounts, the hero plays that variant muted-on-loop and shows the `Play with Sound` pill.
- AE2. **Covers R6, R7.** Given a series record whose variants array is empty (or whose variants all lack `muxVideo.playbackId`), when the page mounts, the hero renders only `series.images[0]` as a static `<Image>` with the series title overlay anchored at the bottom — no `<MuxPlayer>` is mounted.
- AE3. **Covers R5, hero scroll behavior.** Given a trailer is playing on the hero, when the user scrolls so the body section covers ≥60% of the visible video, the trailer pauses. When the user scrolls back, the trailer resumes — same `pausedByScrollRef` semantics as the video page.
- AE4. **Covers R8.** Given a series with 13 episodes, the label reads `SERIES · 13 EPISODES`.
- AE5. **Covers R15.** Given a user is viewing the series at `/storyclubs/en`, when they click an episode card whose slug is `storyclubs-birth-of-jesus`, the browser navigates to `/storyclubs-birth-of-jesus/en`.

---

## Success Criteria

- A search result that previously pointed at a series-typed slug now lands on a coherent series page instead of a misshapen video page — no UI regression visible to users browsing the existing video pages.
- An engineer looking at the diff sees no new UI components added under `apps/web/src/components/` (and no new icon files, no new gradient definitions, no new modal types) beyond the new `SeriesPageClient` and whatever small adapters it composes from existing primitives.
- The new page renders correctly for a series WITH a trailer AND a series WITHOUT a trailer — both code paths verified against real data.
- Clicking through from the series page to an episode lands on the existing video details page with no breakage of that page's chrome, share, or scroll-pause behavior.

---

## Scope Boundaries

- No Bible Quotes carousel on the series page.
- No Related Questions accordion on the series page.
- No language picker / language switching UI on the series page (the locale is whatever the URL says).
- No sibling carousel on the series page — the episode grid IS the sibling discovery surface.
- No download modal on the hero — series-level downloads aren't a concept here.
- No "Ask Yours" CTA on the series page.
- No new content type or schema field. Series identification rides on existing admin data (planning verifies the exact signal).
- No duration overlay on episode cards. The existing `VideoCard` is used as-is.
- No editorial pick / featured episode for the hero. The trailer is whatever the series record's variants supply; if none, static thumbnail.
- No analytics events specific to series-page interactions in v1 — page-view tracking continues to flow through whatever the video page already does at the route level.

---

## Key Decisions

- **Same route, branch inside**: the series page lives at `/[slug]/[locale]` rather than `/series/...`. Reason: search result links to a series slug continue to work without route awareness; `resolveWatchPage` already returns a discriminated union, and adding a fourth `kind` is the natural extension.
- **Hero source = series record's own variants**: a series's "trailer" is just a variant of the series's own video record. Reason: no new schema field is required, and the existing WatchVideo fragment already projects variants on every video. Editors who want a trailer attach it to the series record exactly the way they attach a video to any other record.
- **Episode card = forge's `VideoCard` as-is**: includes no duration overlay even though core/apps/watch shows one. Reason: the user explicitly forbade new styling; matching core's overlay would add visual scope this brainstorm rejects.
- **Out of scope: language picker**: the core screenshot has one inline with the description. We're skipping it because it wasn't named in the prompt and adding it would re-open variant-selection plumbing that the video page already owns separately.

---

## Dependencies / Assumptions

- The admin GraphQL schema can identify a series via existing fields. Likely the `VideoLabel` enum's `COLLECTION` value plus the presence of `children`, but the exact rule is verified during planning (see Outstanding Questions). If verification reveals no usable signal, the brainstorm needs to be reopened to add a content-type change.
- A series record's `variants` field carries the trailer when one exists. This is the same shape the WatchVideo fragment already fetches for episodes; no schema change is expected.
- The existing `resolvePosterUrl` chain handles the series thumbnail correctly (`series.images[0]` → mobileCinematicHigh → Mux fallback).
- The existing `HeroPlayer` + `HeroPlayerControls` primitives can mount with a "no playable variant" state where they degrade to a thumbnail-only rendering — or, if that's not currently supported, the series page renders a separate static-image layout for that branch (small adapter, no new primitive).
- The existing `ShareModal` accepts series-level inputs (title, description, poster URL, playback ID = null when no trailer) without code changes.

---

## Outstanding Questions

### Resolve Before Planning

- _(none — the open implementation questions below are all answerable during planning by reading the admin schema and the existing content.ts resolver)_

### Deferred to Planning

- [Affects R2][Technical] What is the canonical signal that a slug points at a series in admin GraphQL? Candidates: `video.label === "COLLECTION"`; presence of `children`; a new resolver helper. Verify by inspecting `apps/admin/src/graphql/types/` and the existing watch-video fragment, plus a sample query against a known series record.
- [Affects R1][Technical] Should `resolveWatchPage` grow a `kind: "series"` branch in its discriminated union, or should `[slug]/[locale]/page.tsx` short-circuit before calling `resolveWatchPage` when it detects a series? Both work; the former is cleaner if the cache layer benefits.
- [Affects R5, R6][Technical] Does the existing `HeroPlayer` gracefully handle the "no variants" case (no `muxVideo.playbackId`, no `hls`), or does the series page need a separate static-image hero adapter? Inspect `HeroPlayer.tsx` for guards.
- [Affects R12][Technical] How are episodes ordered? In the screenshot they appear roughly in narrative order. Verify whether `series.children` already comes back sorted, or whether an `order` field needs to be projected and sorted client-side.
- [Affects R10][Technical] Does the existing `ShareModal` need any adjustment for the series case (e.g., no playback ID, different share text), or does it accept the series shape with no changes?
- [Affects R8, R12][Needs research] Episode count and the children projection: confirm the existing fragment already returns `children` in a form usable for both the label count AND the grid render, or whether a new fragment is needed for the series page specifically.
