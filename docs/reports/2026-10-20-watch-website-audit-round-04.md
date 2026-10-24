# Watch website audit — round 04: design consistency and the mobile website

Date: 2026-10-20 (UTC 03:36–04:20). This was a read-only audit of production
`https://www.jesusfilm.org/watch`. Earlier rounds:
round 01 (#2821), round 02 (#2825), round 03 (#2827).

This is not a WCAG conformance claim and not user research. Every finding
cites a measured value or a capture.

## Method

- **Responsive sweep.** Headless Chromium with viewport emulation (touch +
  mobile at widths under 900). It checked 13 templates at 320x640 and
  390x844, and 7 templates at 768x1024, 1024x768 and 844x390 (46 page loads,
  all 200). Per page it recorded:
  - horizontal overflow, and elements past the viewport outside a scroller
  - text clipped inside an `overflow: hidden` box
  - targets under 24 px
  - fixed overlays
  - hero media state
- **Motion.** The same sweep ran with `reducedMotion: reduce` at 390x844 on
  home, film, episode and What's new.
- **Text size.** Root `font-size: 200%` at 390x844 on five templates (text-only
  resize). Page zoom to 400% is covered by the 320 px sweep.
- **Dialogs.** The search overlay was opened and a query typed at 320x640,
  and again at 320x360. The short viewport stands in for an open on-screen
  keyboard; it is not a real one.
- **Manual.** The native T3 browser checked fixed-element geometry and focus
  at 320x640.
- **Local fixtures.** Temporary, uncommitted `(demo)` pages rendered the real
  `WatchHomeTvCarousel`, `SiblingCarousel`, footer, header, feedback launcher
  and `SeriesPageClient`, so each repair could be measured before and after
  in a real browser.
- **Limits.**
  - Chromium emulation only: no real phone and no Safari.
  - Signed-in history/account, the player controls (#2740), and the
    loading/error boundaries were not tested.
  - The search overlay's keyboard-open state is approximated.

## Coverage and health

| Template                         | URL                                           | Viewports                                       | Health                                                                            |
| -------------------------------- | --------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Home en                          | /watch                                        | 320, 390, 768, 1024, 844x390, 200% text, reduce | Poor → fixed in part: CTA truncated at 320; no pause control; motion under reduce |
| Home es-419                      | /watch/spanish-latin-american.html            | 320, 390                                        | Same as en ("Ver a…")                                                             |
| Film                             | /watch/jesus.html                             | all                                             | Good; preview autoplays under reduce (fixed)                                      |
| Film ar (RTL)                    | /watch/jesus.html/arabic-modern-standard.html | 320, 390, 768, 1024, 844x390                    | Good: `dir=rtl`, no overflow                                                      |
| Series                           | /watch/lumo-the-gospel-of-john.html           | all                                             | Poor at 768 and 844x390 → fixed                                                   |
| Collection                       | /watch/new-believer-course.html               | 320, 390                                        | Good                                                                              |
| Episode                          | /watch/lumo-john-6-1-60.html                  | all                                             | Fair: footer focus under the launcher (fixed)                                     |
| Topic                            | /watch/family.html                            | 320, 390                                        | Good                                                                              |
| Language inventory               | /watch/english.html/videos                    | 320, 390, 768, 1024, 844x390 + 12 curl          | Good; WordPress 404 not reproduced                                                |
| Language directory               | /watch/languages                              | 320, 390, 200% text                             | Good (long names end with an ellipsis)                                            |
| What's new                       | /watch/whats-new                              | all + reduce                                    | Fair (small targets, feat-763/#2669)                                              |
| History signed-out               | /watch/history                                | 320, 390                                        | 404 on prod (#2822 not deployed)                                                  |
| 404                              | /watch/no-such-page-r04.html                  | 320, 390                                        | Soft 404 (feat-757)                                                               |
| Search overlay                   | from film                                     | 320x640, 320x360                                | Fair: clipped labels (feat-766)                                                   |
| Header (all pages)               | —                                             | 320, 390, 200% text                             | Search label clipped (fixed); crowded at 200% text (feat-767)                     |
| Signed-in, player, loading/error | —                                             | —                                               | Not tested                                                                        |

No template had horizontal page overflow at any viewport.

## Findings and what happened

| #   | Sev | Finding (evidence)                                                                                                                                                                                                                                      | Owner / path                                                  | Outcome                                                                                                                                                               |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1  | Home hero preview has no pause and keeps playing and auto-advancing under `reduce`. Film/episode previews also autoplay under `reduce` (all `paused: false` after 7 s).                                                                                 | `WatchHomeTvCarousel`, `useWatchHomeTvCarousel`, `HeroPlayer` | **Fixed, PR #2829 (feat-762).** The current-slide circle is now Pause/Play, using existing `HeroPlayerControls` keys. Reduced motion starts on the poster.            |
| 2   | P1  | At 320 the hero primary action reads "Watc…" / "Ver a…" (62 of 95 px).                                                                                                                                                                                  | `WatchHomeTvCarousel` action row                              | **Fixed, PR #2829.** The row wraps.                                                                                                                                   |
| 3   | P2  | At 768 the series title is squeezed to 4 lines (266 px) and the Languages picker shows "E" (130 px). At 844x390 the title sits under the fixed header (top 11 < 60).                                                                                    | `SeriesPageClient`                                            | **Fixed, PR #2831 (feat-765).**                                                                                                                                       |
| 4   | P2  | Header search label reads "Search vi…" at 320 on every page, and "Sear…" beside the home wordmark.                                                                                                                                                      | `FloatingSearchField`, `FloatingSearchBar`                    | **Fixed, PR #2830 (feat-764).** A container query falls back to the existing short "Search" label.                                                                    |
| 5   | P2  | When Tab scrolls a footer link to the bottom edge, the fixed feedback launcher covers 12–28% of it at 320. This is the round-03 "Share covered" lead; it is the footer Share link, not the episode Share button.                                        | `globals.css` `html`                                          | **Fixed, PR #2830.** `scroll-padding-bottom`.                                                                                                                         |
| 6   | P2  | The "← JESUS" collection link shows focus only as its hover underline.                                                                                                                                                                                  | `SiblingCarousel`                                             | **Fixed, PR #2830.** Inset ring.                                                                                                                                      |
| 7   | P2  | Search overlay at 320:<br>• placeholder hard-cut ("Search or browse topi"; input 180 px beside the language control)<br>• "Search in …" label truncated<br>• "All videos on single pa…"<br>• at 320x360 the "English" pill runs into the ↵ submit glyph | `SearchOverlay.tsx` (also edited by conflicting #2663)        | **Ticketed feat-766.** Update 2026-10-20: fixed in #2663, which carries the ticket (complete); the 320x360 results height remains open there.                         |
| 8   | P2  | At 200% text the home header search icon overlaps the language globe, and the hero title breaks mid-word ("Samarita/n") and climbs under the header.                                                                                                    | `FloatingSearchProvider` header grid; hero title classes      | **Ticketed feat-767.** Update 2026-10-20: header in #2835 (carries the ticket, in progress until #2829 also merges), hero title in #2829. Mid-word breaks remain.     |
| 9   | P3  | The feedback launcher's intro pill ("FEEDBACK") covers body text and card titles while it is expanded (seen at 390 home and over "LUMO - John 4" at 768). The collapsed 34 px button sits over the 20 px content gutter on every phone page.            | `FeedbackLauncher`, `useFeedbackLauncherIntro`                | **Recommendation (design decision).** Options: shorten or skip the intro on narrow viewports, or reserve bottom space under the last block. Do not hide the launcher. |
| 10  | P3  | Raw URLs and social handles in series descriptions (LUMO).                                                                                                                                                                                              | Admin content                                                 | **Report to content owners**, no content write.                                                                                                                       |
| 11  | P3  | Home `h1` is visually hidden. The first visible context is a "SEGMENT" eyebrow and a clip title. Seeker sections sit 5–6 screens down on phones.                                                                                                        | Editorial ordering in Admin                                   | **Editorial/product decision**, same as round 02.                                                                                                                     |
| 12  | P3  | At 200% text, card titles end in an ellipsis (the accessible names stay full). Inventory meta "Episode / 59:33" is clipped by 3 px at 320.                                                                                                              | Card components                                               | Low; watch for it in a future card pass.                                                                                                                              |
| 13  | —   | Inventory WordPress 404 (round 03, 1 of 6).                                                                                                                                                                                                             | Cloudflare/origin                                             | **Not reproduced:** 0/12 curl plus about 45 browser loads, no `wp-content`. `English.html` (capital E) gives a 200 soft 404, already covered by feat-757.             |

Open PRs that already own related scope (not duplicated): #2637 header
order/skip link, #2663 search focus, #2669 contrast/targets (the 20 px
footer links and What's new targets), #2740 player controls, #2383 hero
`?t=` prefetch.

## Page-load evidence for the fixes

These are matched `next build` runs in one tree, same env, against
origin/main `ec092baf6`:

- **Main:** 124 JS chunks, 4,932,797 B. This matches round 03's baseline
  exactly.
- **#2829:** 4,934,371 B (+1,574 B raw).
- **#2830:** JS 4,930,753 B (chunk re-split, no new chunks); CSS
  +406 B raw.
- **#2831:** class-only change, no build repeated.

None of the three adds a request, preload, dynamic import or load-time
effect. The reduced-motion paths only remove media work.

## Next round

1. feat-766 search overlay at 320 / keyboard-open. Coordinate with #2663.
2. feat-767 header and hero at 200% text; re-check #2829's wrapped row at
   200%.
3. A feedback launcher intro design decision (finding 9).
4. Real-device pass (iOS Safari, Android Chrome) for the hero pause and the
   reduced-motion paths, safe areas, and the on-screen keyboard over search.

Update 2026-10-20 (round 07 reconciliation): items 1 and 2 were done in
rounds 06-07. The feat-766 and feat-767 ticket files are no longer in this
report's PR; they ship with their implementations (#2663 for feat-766,
#2835 for feat-767, whose hero part is in #2829), so the PRs do not add the
same files. Still open from both: the 320x360 search results height, a
real on-screen keyboard check, hero title mid-word breaks at 200%, and real
Android/iOS large-text settings.
