---
date: 2026-04-20
topic: tablet-experience-redesign
---

# Tablet (iPad + Android Tablet) Experience Redesign

## Problem Frame

The JesusFilm mobile app today ships a phone-only UI. When run on an iPad or a large Android tablet, the existing layout (single-column stacked VideoHero → NavigationCarousel → VideoCard feed → VideoCarousel rails → MediaCollection) scales up awkwardly: the bottom tab bar floats low across a wide canvas, full-width cards become oversized, horizontal rails show only 1.5 items, and the Video Detail screen wastes the right half of the screen on whitespace.

The Easter Mobile Redesign — iOS + Android Stitch project (projects/4168049777513341773) established the phone design language: curated, cinematic, dark-themed, one-card-per-section vertical journey. The tablet redesign must faithfully preserve that feeling while adopting the native tablet UX patterns that both Apple HIG (iPadOS) and Material 3 (large screens) expect: persistent vertical navigation, multi-column content rails, and media + metadata layouts that use the landscape canvas.

## Design Philosophy

- **Native tablet, not stretched phone** — Follow iPadOS (HIG) and Material 3 large-screen canonical layouts. No bottom tab bar on tablet. No full-width phone cards scaled to tablet width.
- **Curated, not algorithmic** — Preserved from the phone design. CMS order IS the navigation. No view counts, trending, or social proof.
- **Gallery + cinema** — Home is a magazine-layout gallery (wide hero, multi-column rails). Video Detail is a cinematic hero (player as the first-class citizen) with supporting content arranged in columns below.
- **Platform-appropriate, same app** — Identical React Native / Expo codebase. Cosmetic differences only: SF Pro + iOS glyphs on iPadOS, Roboto + Material 3 glyphs on Android tablets.

## Scope

This brainstorm covers **2 screens × 2 platforms = 4 mockups**, matching the original Easter Mobile Redesign Stitch project:

1. iPad — Curated Home (HIG)
2. Android Tablet — Curated Home (M3)
3. iPad — Video Detail (HIG)
4. Android Tablet — Video Detail (M3)

All mockups are **landscape-first**. Portrait behaviour is specified as a layout collapse, not a separately-designed mockup.

The other bottom tabs (Discover / Library / Profile) are out of scope for this brainstorm. They will scale up as-is for now; a follow-up brainstorm can redesign them (Library in particular has a strong list-detail opportunity).

## Navigation Model

- **Replace the bottom tab bar with a persistent vertical sidebar** on tablet widths (≥ 768pt iPadOS regular width class, ≥ 600dp Android).
  - iPadOS: native `NavigationSplitView`-style sidebar with JFP wordmark at top, 4 destinations (Home / Discover / Library / Profile), each with HIG glyph + label.
  - Android: Material 3 navigation rail (for tablet widths 600-840dp) or sidebar (for > 840dp), with the same 4 destinations and accent-on-active treatment.
- **Active destination indicator** uses the existing brand accent `#CB333B` (ACCENT) — filled pill behind the active item on Android; HIG-standard selected state on iPadOS.
- **Sidebar persists on every screen in this scope** including Video Detail. No immersive auto-hide. Users can scroll through the feed or scrub the player without the sidebar retreating.
- **Portrait collapse**: sidebar collapses to a compact rail (icons only, ~72pt wide on iPadOS, ~80dp on Android) OR to a modal drawer triggered by a top-left menu button. Portrait mockups are not required in this pass; the collapse pattern is captured as a note.

## Home Screen Layout

- **Full-bleed VideoHero** occupies the top of the content area (right of the sidebar) at approximately 45-55% of viewport height. Heading, subheading, and "Watch now" CTA overlay the bottom-left quadrant. Cinematic gradient from transparent top to dark bottom for text legibility. Mute toggle top-right. Faithful to phone VideoHero treatment, widened.
- **NavigationCarousel** renders directly below the hero as a horizontal rail showing **4-5 items visible at once** in landscape (vs. 1.5 on phone). Each item keeps the phone card composition (image + title + category label).
- **Section video cards** render as a **2-column grid** in landscape — each card retains the `mobileCinematicHigh` thumbnail + `sectionVideoTitle` + `subtitle` from the phone design, but two cards sit side-by-side per row instead of one full-width. Generous inter-card gutter preserves the gallery feel.
- **VideoCarousel rails** show **3-4 items visible at once** (vs. ~1.8 on phone). Rail title and subtitle float above the row in the same type treatment as phone.
- **MediaCollection rail** shows **2-3 tall collection cards visible at once**. Cards stay tall (poster aspect) to preserve the "Video Bible Collection" feel.
- **Scroll is vertical** through the whole feed. The sidebar is fixed; the content area scrolls.
- **Content max-width**: content area has a ~2400pt soft max on the very widest displays (iPad Pro 13" M-series, Galaxy Tab S10 Ultra) so line lengths and card sizes don't balloon. Below that, content fluidly fills.

## Video Detail Layout

- **Player as cinematic hero**: 16:9 player fills the full content-area width below the top safe area. No letterboxing added by the app; if the source video is wider, the existing player handles it.
- **Metadata section below the player**, not beside it — this is the chosen pattern (preview accepted):
  - Full-width row: title, subtitle.
  - Below that, a **2-column arrangement**:
    - **Left column (~60%)**: description (Text block `contentParagraphs`, expandable), Related Questions CTA, Quiz button.
    - **Right column (~40%)**: Bible Quotes carousel rendered as a vertical stack of 2-3 cards visible at once (vs. horizontal swipe on phone), keeping `reference` + `text` + `attribution` + `imageUrl`.
- **Sidebar remains visible** (persistent nav decision above). Content scrolls within the main pane; the sidebar does not.
- **Back affordance** (to return to Home or previous screen) lives inside the main pane — iPadOS back button in the top-left of the content area on iPad, M3 Up button on Android.

## Requirements

- R1. **Persistent vertical nav**: Tablet layouts replace the bottom tab bar with a sidebar (iPad) or navigation rail (Android). The 4 destinations (Home / Discover / Library / Profile) remain unchanged.
- R2. **Full-bleed tablet hero**: VideoHero stretches across the content pane (not the full viewport — the sidebar sits to its left). Text overlay position and gradient mimic the phone design.
- R3. **Multi-column rails and grids**:
  - NavigationCarousel: 4-5 items visible.
  - Section video cards: 2-column grid.
  - VideoCarousel: 3-4 items visible.
  - MediaCollection: 2-3 items visible.
- R4. **Video Detail columns**: Player hero on top; metadata split into left description column + right bible-quote column beneath the player.
- R5. **Platform styling**: iPad follows HIG (SF Pro, HIG glyphs, native sidebar chrome). Android tablet follows Material 3 (Roboto / platform default, M3 glyphs, navigation rail chrome). Shared colour + brand language (`#CB333B` accent, `#1c1917` background, `#f5f5f4` primary text).
- R6. **No bottom tab bar on tablet**: Width-gated. Phones continue to render the existing tab bar; tablet widths render the sidebar.
- R7. **All block types preserved**: Every Experience block that renders on phone must render on tablet. No block is dropped. Only the arrangement and density changes.
- R8. **No invented metrics or social features**: Carried over from the phone design. No view counts, "Trending", "Popular", "Continue Watching", or duration badges. Only what the CMS provides.
- R9. **Landscape-first design**: Mockups are produced in landscape. Portrait is handled by a sidebar collapse (rail or drawer) — no separate portrait mockup in this pass.
- R10. **Dark theme only**: Matches the existing mobile app theme. Light-theme tablet mockups are out of scope for this pass.

## Success Criteria

- On an iPad Pro 13" in landscape, the Home mockup shows the hero, NavigationCarousel, and at least one rail above the fold — no dead whitespace in the right half of the screen.
- Video Detail shows the player and the beginning of the description / first bible quote above the fold in landscape.
- An iPadOS designer, shown only the iPad mockup, can identify HIG-native affordances (sidebar, glyphs, typography). Same for a Material 3 designer shown the Android mockup.
- The tablet and phone apps are recognisably the same product — accent, wordmark, typography hierarchy, card composition, CMS-ordered journey all preserved.
- Every visual element in a mockup maps to a real field in the Experience JSON (same integrity bar as the phone redesign).

## Scope Boundaries

- **Not in this brainstorm**: Discover, Library, Profile, Collection, or any screen outside Home + Video Detail.
- **Not in this brainstorm**: Portrait-first mockups. Portrait is a collapse, not a redesign.
- **Not in this brainstorm**: Light-theme tablet design.
- **Not in this brainstorm**: Implementation — how to gate layouts by width in React Native / Expo, how `useWindowDimensions` / `Platform.isPad` / flash-list multi-column is wired, or any code-level design. That belongs in `/ce-plan`.
- **Not in this brainstorm**: New CMS content types or new block types. The data contract is unchanged.
- **Not in this brainstorm**: Watch history, progress tracking, duration display, social features.

## Key Decisions

- **Sidebar, not bottom tabs, on tablet**: Both Apple HIG and Material 3 explicitly recommend against bottom tabs on tablet widths. The sidebar also makes room for a deeper Library redesign later without rework.
- **Player hero + columns-below on Video Detail** (not a player-left / info-right split): Chosen via user preview selection. Feels closer to a cinematic "movie detail page" than a two-pane reading app, and keeps the player uncontested by side chrome.
- **Landscape-first**: JFP content is media-forward; users hold tablets in landscape to watch.
- **2 screens × 2 platforms**: Matches the original Stitch scope exactly. Other tabs are deferred, not cancelled.
- **Persistent sidebar (no auto-hide during playback)**: Explicit user-testable behaviour; discoverability beats immersion for a curated catalogue app.

## Dependencies / Assumptions

- The existing SDUI pipeline (gql.tada query → normalizer → SectionDispatcher → renderers) can host tablet-width branches without a parallel type hierarchy. Confirmed by existing renderer structure in `apps/mobile/src/components/sections/`.
- `mobileCinematicHigh` thumbnails render acceptably when shown two-up on a 13" iPad Pro (each card ~1100-1200pt wide). If thumbnails look soft at that size, a higher-res image field may be needed — to be verified during mockup review.
- The existing brand palette (`#CB333B` accent, `#1c1917` background, `#f5f5f4` text) scales to tablet without adjustment.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] What width threshold triggers the tablet layout? iPadOS `UserInterfaceSizeClass.regular` for width is the natural iOS break; Material 3's 600dp is the Android break. Confirm these align cleanly with React Native `useWindowDimensions`.
- [Affects R3][Design] Exact card counts per rail at each breakpoint (e.g. iPad 11" vs. iPad Pro 13" vs. Galaxy Tab S10 Ultra) — to finalise after mockup review.
- [Affects R4][Design] Should Bible Quotes on Video Detail stay a horizontal carousel (preserving the phone motion) or become a vertical list (using the right column's vertical space)? Current mockup plan is vertical stack; revisit if it feels static.

### Deferred to Follow-up Brainstorms

- Tablet designs for Discover, Library, Profile — especially Library as a two-pane list-detail.
- Portrait-first mockups, if usage data shows significant portrait-orientation use on tablets.
- Light-theme tablet mockups, if product prioritises theming.

## Mockups

Generated in Stitch, project `projects/17660151889101631070` ("Easter Tablet Redesign — iPad + Android Tablet"). Canonical set (one per screen × platform):

| Screen | Platform | Stitch screen ID | Local preview |
| --- | --- | --- | --- |
| Curated Home | iPad (HIG) | `projects/17660151889101631070/screens/af4495e8d2f24b60a10ac041f9abcc41` | `/tmp/stitch-tablet/ipad-home-v2.png` |
| Curated Home | Android Tablet (M3) | `projects/17660151889101631070/screens/22c32a33a3c7497ba5b96e75c833639c` | `/tmp/stitch-tablet/android-home-v2.png` |
| Video Detail | iPad (HIG) | `projects/17660151889101631070/screens/c00c5b88cd284eff89f8dd332b7570de` | `/tmp/stitch-tablet/ipad-detail-v2.png` |
| Video Detail | Android Tablet (M3) | `projects/17660151889101631070/screens/7b0ff80fa36d4cb180ac33c838c959da` | `/tmp/stitch-tablet/android-detail-v2.png` |

Alternate (not canonical but kept in the project for reference):

- iPad Home with literal dawn-landscape hero + Featured grid visible above the fold: `projects/17660151889101631070/screens/898cad9bf8f746fca840f984f36196c0`

### Known minor deviations (to address during planning / iteration)

- **iPad Home (canonical)**: rail shows only 3 cards above the fold; spec (R3) calls for 4-5. The 2-column "Featured" grid sits below the fold in this mockup; at implementation time it should be pulled up or the hero shortened.
- **iPad Video Detail (canonical)**: only 1 of 2 Bible Quote cards visible above the fold; the "Ask your question" / "Take the next-step quiz" pill buttons and the "Expand" affordance for the description are also below the fold in this mockup. Layout is correct — just render-position.
- **Android Video Detail (canonical)**: player poster frames three silhouetted crosses at sunset. The FORBIDDEN list banned literal cross illustrations; this is a mild miss. Implementation should source an abstract cinematic poster or use the first video frame instead.

## Next Steps

→ Mockups approved as the canonical tablet design direction. Any further creative refinement happens via Stitch variants or direct design edits in the above project.
→ Run `/ce-plan` to scope the engineering work for a width-gated tablet layout in `apps/mobile` — adaptive sidebar + nav rail, multi-column rails, 2-pane video detail. Plan should cover: breakpoint gating (`useWindowDimensions` + platform size-class), sidebar component for iPad / nav rail for Android, extending the SDUI dispatcher to render tablet variants without a parallel type hierarchy, and how `@shopify/flash-list` multi-column + FlashList's `numColumns` breakpoints interact with the existing `CuratedHomeLayout` feed.
