---
date: 2026-06-08
topic: mobile-series-detail-page
---

# Mobile Series Detail Page — Requirements

## Summary

Add a dedicated series detail page to the mobile app, matching the web app's
series experience. Reached from search, it shows the series trailer up top
(reusing the existing video-detail player) or a plain poster image when there
is no trailer, then the series title, a "Read more" description, a Language +
Share action row, and a scrollable grid of the series' videos that each open in
the normal video detail page.

---

## Problem Frame

A series is a `Video` with `label: SERIES`/`COLLECTION` (or any record with
children). The web app renders these on a purpose-built series page. Mobile has
no such page, so tapping a series in search routes it through the single-video
detail screen (`apps/mobile/app/watch/[slug].tsx`). The result is the broken
state in the reference screenshot: a series shown with a single-video layout —
a chrome-heavy player, an "Up Next" sibling carousel, Bible Quotes, and a
Download/Subtitles action row — none of which fit a collection. When a series
has no trailer at all, the same screen has no image-only fallback to show.

---

## Key Decisions

- **Series discriminator stays label-based.** A record is series-shaped when
  its `label` is `SERIES` or `COLLECTION`, or it has children. No new type,
  no schema change — this mirrors web's `isSeriesRecord`.

- **Trailer reuses the existing player; image-only when absent.** When the
  series has a playable trailer (its own dub with a non-null `hls`), the hero
  reuses the video-detail `VideoPlayer` as-is, chrome and all. The "no player
  chrome / just an image" rule applies only to the trailer-absent case, where
  no player is mounted at all.

- **One series page for every entry point.** Rather than branching only in
  search, `apps/mobile/app/watch/[slug].tsx` redirects to the series page when
  the resolved record is series-shaped. Deep links, recommendations, and search
  all land on the same page.

- **Language sets the carry-through audio language.** Selecting a language on
  the series page swaps the trailer dub and becomes the language an episode
  opens in when tapped. Re-translating the grid's episode titles on language
  change is deferred.

- **Language + Share only.** A series has no single downloadable or captionable
  asset, so the video page's Download and Subtitles actions do not carry over.

- **Mobile-side query change only.** Admin's `HybridSearchResult` already
  exposes `label` and `childCount`, and `Video` already exposes the series'
  own dubs, `children`, `childDubLanguages`, and images. The work is additive
  field selection in mobile's own operations — zero `apps/admin` edits.

---

## Requirements

**Entry and routing**

- R1. A series-shaped record (label `SERIES`/`COLLECTION`, or any record with
  children) renders the series detail page, not the single-video detail page.
- R2. Mobile search routes a series-shaped result to the series page. Mobile's
  search query selects `label` and `childCount`; no `apps/admin` change.
- R3. Any navigation that resolves to a series slug lands on the series page:
  `watch/[slug]` redirects to the series page when the resolved record is
  series-shaped, so deep links and non-search entry points behave identically.

**Hero**

- R4. When the series has a playable trailer (its own dub with a non-null
  `hls`), the hero reuses the existing video-detail `VideoPlayer`, with the
  same chrome and controls as the video page.
- R5. When the series has no playable trailer, the hero shows the series poster
  as a plain image — no player is mounted and no player chrome appears.
- R6. The poster falls back through the series images in the app's existing
  precedence (`mobileCinematicHigh` → … → `url`).

**Title, description, actions**

- R7. The page shows a "SERIES" label and the series title.
- R8. The page shows the series description with a collapsed "Read more"
  expansion, matching the video page's description behavior.
- R9. The action row has exactly two actions: Language and Share.
- R10. Share invokes the native share sheet with the series' shareable link and
  title.

**Language**

- R11. Language opens the existing language selection sheet.
- R12. Selecting a language swaps the trailer dub when a matching dub exists.
- R13. The selected language is carried into an episode when it is tapped — the
  episode opens in that language.

**Video grid**

- R14. The page shows a scrollable grid of the series' videos (its children, in
  their defined order). There is no in-grid search or filter input.
- R15. Each grid card shows the video thumbnail and title.
- R16. Tapping a grid card pushes to that video's existing detail page,
  carrying the selected language and a seed for instant paint.

---

## Key Flows

- F1. Open a series from search
  - **Trigger:** User taps a series-shaped result in mobile search.
  - **Steps:** Search detects the series via `label`/`childCount` and pushes the
    series page → page resolves the series, its trailer, children, and dub
    languages → hero paints from the seed image, then the trailer (if any).
  - **Outcome:** The series detail page, not the single-video page.
  - **Covered by:** R1, R2.

- F2. Series with a trailer
  - **Trigger:** Resolved series has a dub with a non-null `hls`.
  - **Steps:** Hero mounts the existing `VideoPlayer` with the trailer stream
    and series poster.
  - **Outcome:** A normal, chrome-bearing player at the top of the page.
  - **Covered by:** R4.

- F3. Series without a trailer
  - **Trigger:** Resolved series has no playable dub.
  - **Steps:** Hero renders the series poster image only.
  - **Outcome:** A static image — no player, no chrome.
  - **Covered by:** R5, R6.

- F4. Change language
  - **Trigger:** User taps Language and selects a language.
  - **Steps:** Sheet sets the selected language → trailer dub swaps if available
    → the selection persists for episode taps.
  - **Outcome:** Trailer plays in the chosen language; episodes will open in it.
  - **Covered by:** R11, R12, R13.

- F5. Open an episode from the grid
  - **Trigger:** User taps a card in the video grid.
  - **Steps:** Push the video detail page with the tapped slug, the selected
    language, and a seed.
  - **Outcome:** The standard single-video detail page for that episode.
  - **Covered by:** R14, R15, R16.

---

## Acceptance Examples

- AE1. **Covers R4.** Given a series with a playable trailer, when the page
  opens, then the hero is the existing `VideoPlayer` showing the trailer.
- AE2. **Covers R5, R6.** Given a series with no playable trailer, when the page
  opens, then the hero is a plain poster image and no player is mounted.
- AE3. **Covers R1, R2.** Given a search result whose `label` is `SERIES`, when
  tapped, then the series page opens; given a result that is a single video,
  when tapped, then the single-video page opens.
- AE4. **Covers R3.** Given a deep link to a series slug routed through
  `watch/[slug]`, when it resolves to a series-shaped record, then it redirects
  to the series page.
- AE5. **Covers R13.** Given a language selected on the series page, when an
  episode is tapped, then the episode detail page opens in that language.

---

## Scope Boundaries

**Deferred for later**

- Re-translating grid episode titles when the language changes (the trailer dub
  and episode carry-through still swap; only the grid labels stay in their
  fetched locale).
- An in-grid search/filter input over the series' videos.
- Series-level Download and Subtitles actions.

**Outside this page's identity**

- The single-video page's "Up Next" sibling carousel, Bible Quotes, and
  related-questions blocks. The series page is trailer/image + title +
  description + grid.
- Any `apps/admin` or schema change. The required `label`, `childCount`,
  `children`, series dubs, `childDubLanguages`, and images already exist on the
  admin surface.

---

## Dependencies / Assumptions

- The language sheet is a cross-route `formSheet` (separate Expo Router route,
  no props). The series page therefore needs shared cross-route state so the
  sheet's selection reaches the page — either reusing `WatchSessionProvider`
  configured for a series, or a lightweight series-scoped equivalent.
- Mobile's video-by-slug query already fetches the series' own variants (the
  trailer) and `children`. `childDubLanguages` must be added to the series
  query selection to populate the language sheet.
- The series page reads the trailer from the series' own playable dub, the grid
  from `children`, the language list from the dub-language union, and the poster
  from the series images.

---

## Outstanding Questions

**Deferred to Planning**

- Language list source for the sheet: `childDubLanguages` (union across
  episodes, matching web) vs. the trailer's own dub languages. Lean
  `childDubLanguages`.
- Whether to reuse `WatchSessionProvider` in a series mode or introduce a
  smaller series-scoped session context for the hero + language sheet.
- Grid card content beyond thumbnail + title (episode index, duration pill).
- The exact shareable URL shape for a series (web uses
  `/{slug}.html/{language}.html`).

---

## Sources / Research

- `apps/web/src/components/watch/SeriesPageClient.tsx`,
  `SeriesHero.tsx`, `SeriesEpisodesGrid.tsx`, `SeriesEpisodeCard.tsx`,
  `LanguagePickerModal.tsx` — the web series page being ported.
- `apps/web/src/lib/content.ts` (`resolveSeriesBySlug`, `isSeriesRecord`),
  `apps/web/src/lib/fragments/watch-video.ts` — series resolution and the
  `childDubLanguages` fetch.
- `apps/mobile/app/watch/[slug].tsx`, `apps/mobile/app/watch/_layout.tsx`,
  `apps/mobile/app/watch/language.tsx` — the single-video page and the
  `formSheet` sheet routes to mirror.
- `apps/mobile/src/components/watch/VideoPlayer.tsx`,
  `VideoDescription.tsx`, `LanguageSheet.tsx`,
  `apps/mobile/src/contexts/WatchSessionProvider.tsx` — components and
  cross-route state to reuse.
- `apps/mobile/app/(tabs)/watch.tsx`,
  `apps/mobile/src/components/search/SearchResultCard.tsx`,
  `apps/mobile/src/lib/queries.ts` (`SEARCH`) — search screen, result card, and
  the query that needs `label`/`childCount` added.
- `apps/admin/schema.graphql` — `HybridSearchResult.label` + `.childCount`
  (lines ~329–345) and `Video` `children` / dubs / `childDubLanguages` / images
  already exposed; no admin change needed.
