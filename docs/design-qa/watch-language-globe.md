# Language Globe Design QA

## 2026-08-24 LFG browser verification

- Server: `http://localhost:3001`
- `/watch/language-globe` - **Skip:** the integrated browser controller was
  locked to its connection-error page by the host security policy and explicitly
  prohibited further navigation or an alternate browser workaround.
- `/watch/language-globe/not-found` - **Skip:** same controller-policy blocker.
- `/watch` and a missing localized Watch route - **Skip:** same
  controller-policy blocker.
- Static fallback: 20 focused globe, shared-section, homepage, and 404 tests
  pass. The suite now mounts the real canvas component and verifies viewport,
  reduced-motion, document-visibility, and unmount cleanup paths. A timestamp
  cadence test confirms 24 rendered frames over one second of 60 Hz display
  ticks.
- Existing responsive and performance captures below remain the visual
  baseline. The renderer and one-surface composition are unchanged by the final
  heading-line-height correction; review follow-ups add only accessible
  description wiring, cadence precision, lifecycle coverage, and safe-area
  padding.

Result: **PARTIAL** because the host browser policy prevented a fresh rendered
route pass. No route was silently dropped from the QA scope.

The prior Watch search-language takeover report is preserved at
`docs/design-qa/watch-search-language-takeover.md`.

- Source visual truth: `/tmp/codex-clipboard-3481551a-70bb-4204-9f0e-e526feb9ae20.png`
- Implementation screenshot: `/tmp/language-globe-verse-1128x724.png`
- Latest adaptive desktop screenshot:
  `/tmp/language-globe-adaptive-desktop-1128x724.png`
- Second-language cycle evidence:
  `/tmp/language-globe-second-language-1128x724.png`
- Mobile implementation screenshot:
  `/tmp/language-globe-adaptive-mobile-390x844.png`
- Reusable Experience section:
  `/tmp/language-globe-section-desktop.png`
- Reusable Experience section, mobile:
  `/tmp/language-globe-section-mobile.png`
- Not-found composition:
  `/tmp/language-globe-404-desktop.png`
- Not-found composition, mobile:
  `/tmp/language-globe-404-mobile.png`
- Integrated Experience composition:
  `/tmp/language-globe-integrated-experience-desktop.png`
- Integrated Experience composition, mobile:
  `/tmp/language-globe-integrated-experience-mobile.png`
- Integrated not-found composition:
  `/tmp/language-globe-integrated-404-desktop.png`
- Integrated not-found composition, mobile:
  `/tmp/language-globe-integrated-404-mobile.png`
- Full-view comparison:
  `/tmp/language-globe-adaptive-comparison.png`
- Pre/post performance visual comparison:
  `/tmp/language-globe-performance-visual-comparison.png`
- Route: `http://localhost:3000/watch/language-globe`
- State: initial globe rotation with `prefers-reduced-motion: reduce`
- CSS viewport: `1128 x 724`
- Source pixels: `1128 x 724` at 1x
- Implementation pixels: `1128 x 724` at 1x; the canvas render density is
  internally capped at 1.5x

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation uses a compact system monospace at
  10–12 CSS px for the globe and 11–14 px for the full caption. Complete verse
  lines are drawn once in screen space and clipped through the projected land
  mask, eliminating perspective-compressed overlapping glyphs. The result keeps
  normal word shaping, spacing, and antialiasing at every globe depth.
- Spacing and layout rhythm: the inset frame and rounded corners align with the
  reference. The newest user-directed composition intentionally departs from
  the reference's smaller globe: the radius is now responsive up to 720 CSS px
  and its center sits below the viewport, revealing only a zoomed upper
  hemisphere.
- Colors and visual tokens: the near-black `#09090b` stage, quiet translucent
  border, and white-to-gray depth fade match the reference's restrained palette.
- Image quality and asset fidelity: no raster or vector is rendered at runtime.
  The compact mask contains 6,825 sampled land cells generated from Natural
  Earth's public-domain 1:50m land polygons. Coastlines now follow the real map
  geometry while canvas text stays sharp at a device-pixel ratio capped at 1.5.
  A sparse boundary pass adds punctuation to coastline breaks, and 39
  real-coordinate markers restore small islands and archipelagos lost at the
  compact mask's 1.5-degree sampling resolution.
- Copy and content: the texture uses the public-domain 1904 Patriarchal Greek
  New Testament source text and 38 public-domain translations distributed by
  eBible.org. The full caption starts with the World English Bible and advances
  through all 39 editions every five seconds, displaying the language name and
  sequence position. The canvas exposes the English wording and edition count
  as its accessible fallback.

The equal-size side-by-side comparison in
`/tmp/language-globe-atmosphere-comparison.png` confirms the inset frame,
zoomed upper-hemisphere crop, tonal depth, and compact type treatment. The
implementation intentionally exceeds the reference density to preserve the
user-requested real coastline detail. The complete caption is a deliberate
content addition requested after the reference was selected.

No focused crop was required: the complete caption is clearly readable in the
full-size desktop and mobile captures, and the remaining detail is the globe's
deliberately dense texture rather than small interface chrome.

## Comparison History

1. Initial browser pass — P2: the globe was visibly too sparse and narrow
   compared with the reference. Fixed by adding deterministic geographic label
   offsets, reducing type size, widening the projection, and shifting the globe
   slightly lower.
2. Post-fix pass — the normalized side-by-side comparison shows matching frame
   proportions, vertical placement, visual density, and tonal hierarchy. No
   further P0/P1/P2 fixes were identified.
3. User-review iteration — P1: sparse geographic labels did not form readable
   continents, and the globe did not extend high enough in the frame. Replaced
   repeated point offsets with a deterministic geographic land mask, increased
   the globe radius, and moved its center upward.
4. Dense-grid pass — P2: the first land-mask capture still left too much space
   between character pairs. Tightened the sampling grid from three degrees to
   two degrees. The final comparison shows continuous continent silhouettes at
   the target viewport with no remaining P0/P1/P2 findings.
5. Performance review — P1: the dense version consumed 2.977 seconds of main
   thread task time and 1.130 seconds of script time during a three-second
   visible-animation sample. Cached all geographic projections, removed
   per-frame allocations and sorting, bucketed depth/state changes, capped
   canvas density at 1.5, and moved to an optimized animation cadence. The pre/post
   visual comparison shows equivalent land density and composition.
6. Zoom/crop iteration — the user requested a closer composition with only the
   globe's top visible. Increased the responsive radius, enlarged the language
   type, and placed the globe center below the viewport. The desktop and mobile
   captures show an intentional upper-hemisphere crop with no overflow.
7. Smoothness iteration — increased the optimized canvas cadence to 30 fps.
   The active three-second sample stayed within the established main-thread
   budget and motion was confirmed with changing canvas hashes.
8. Scripture and cartography iteration — replaced language names with 39
   public-domain editions of Matthew 24:14 and replaced the approximate polygon
   mask with Natural Earth 1:50m land geometry sampled at 1.5-degree intervals.
   Off-canvas culling and a stable 24 fps cadence retain the reference animation
   character while accommodating the denser real-world coastlines.
9. Scripture legibility iteration — P1: two-character land fragments and
   overlapping excerpts did not let viewers identify the Bible text. Added a
   fixed, complete verse caption, lengthened geographic excerpts, and reduced
   simultaneous phrase density. Follow-up direction required equal treatment
   across languages, so the complete caption now cycles through all 39 editions
   every five seconds. Desktop evidence shows English at `01 / 39` and Breton at
   `04 / 39`; the mobile capture preserves full wrapping without overflow.
10. Continuous-verse iteration — P1: despite the full caption, the globe itself
    still appeared to contain arbitrary two-character groups. Replaced the
    per-cell translation scrambling with one translation per latitude row,
    preserved spaces, and assigned consecutive three-character chunks by
    longitude. Removed the overlapping phrase-anchor layer. The revised desktop
    and mobile captures visibly contain continuous multilingual verse sentences
    across the continents while retaining the real land silhouette.
11. Sharpness iteration — P1: projecting separate three-character canvas draws
    compressed neighboring chunks together near the poles and globe edges,
    making the Scripture appear blurred. Replaced per-cell text draws with one
    geographic clip path and crisp, complete verse lines rendered in screen
    space. The desktop and mobile captures show separated baselines, normal word
    spacing, and readable phrases throughout the central land regions without
    weakening the continent outline.
12. Island-detail iteration — P2: the compact land mask omitted small islands
    and simplified some coastlines. Added a deterministic punctuation pass on a
    sparse subset of real land-boundary cells plus 39 curated geographic markers
    for small islands and archipelagos. Desktop and mobile captures show clearer
    coastline texture and visible island chains without reintroducing text blur.
13. Hot-loop optimization — cached translation strings and glyph counts,
    caption wrapping, and latitude geometry; removed per-frame arrays, Unicode
    scans, translation-list searches, and square roots; and avoided redundant
    island font assignments. Visual output and the 24 fps cadence are unchanged.
14. Star-field iteration — added 42 static, opacity-batched subpixel points and
    six faint typographic `·`, `+`, and `✦` accents behind the globe. Desktop and
    mobile captures show added sky depth without reducing Scripture contrast or
    introducing twinkle motion.
15. Star-halo iteration — moved all background stars into a narrow elliptical
    band `1.035–1.225×` outside the globe rim. Added three slow opacity phases and
    independent accent phases using the existing animation clock. Captures 1.8
    seconds apart confirm shimmer while the mobile crop retains the halo near the
    globe rather than scattering it across the page.
16. Atmosphere and rotation iteration — slowed the default rotation from 72 to
    120 seconds. Added a faint dotted/dashed ellipse at `1.012×` the globe radius
    plus 44 sparse `·`, `:`, `'`, `°`, and `~` marks along its upper rim. Desktop
    and mobile captures show a readable round silhouette without a hard border;
    the star halo remains just outside the atmosphere.
17. Adaptive mobile-performance iteration — replaced one universal render cost
    with three deterministic profiles. Desktop retains the full 1.5-degree land
    mask, 1.5× density, and 24 fps. Regular phones use a connected 3-degree mask,
    1.25× density, and 20 fps. Narrow, two-core, or low-memory phones use 1×
    density, 16 fps, and sparser coastline/atmosphere decoration. The mobile and
    desktop captures confirm that Scripture, continent silhouettes, stars, and
    the atmospheric rim survive the quality scaling.
18. Reusable-section iteration — separated the canvas from its page composition
    and added one server-rendered section contract for eyebrow, heading level,
    supporting content, actions, and visual variant. The localized Watch home
    instance renders as an `h2` immediately before the footer; the localized
    not-found instance renders the page's only `h1`, recovery actions, and a
    faint 404 watermark. Both reuse one adaptive canvas renderer. The isolated
    Experience and 404 preview routes provide desktop and phone debugging
    surfaces without weakening the real fixed-sentinel 404 route.
19. Unified-surface iteration — moved the eyebrow, headline, promo copy, and
    actions inside the same rounded frame as the canvas. Embedded globes no
    longer render their own padding or border, leaving exactly one outer visual
    boundary. Widened the Experience heading so “Choose a language” stays on one
    desktop line and brought the Scripture/globe texture into the first viewport.
    Desktop and phone captures confirm both Experience and 404 variants read as
    one continuous composition rather than typography followed by a separate
    animation rectangle.

## Browser and Performance Evidence

- Normal motion produced different canvas hashes 0.8 seconds apart; reduced
  motion produced identical hashes 0.8 seconds apart.
- Two consecutive visible 24 fps samples recorded `TaskDuration: 0.242s` and
  `0.205s`, with `ScriptDuration: 0.094s` and `0.082s`. Both recorded zero
  layout or style recalculation and stayed within the 0.25-second task budget
  despite the higher-detail land mask.
- After adding the complete multilingual caption, a steady-state three-second
  sample recorded `TaskDuration: 0.1998s` and `ScriptDuration: 0.0847s`, with
  zero layout or style recalculation. The first post-reload warm-up sample was
  `0.3109s` and was not used as the steady animation figure.
- The continuous-verse renderer's steady-state sample recorded
  `TaskDuration: 0.2009s` and `ScriptDuration: 0.0869s`, with zero layout or
  style recalculation. Removing the separate phrase-anchor pass offsets the
  slightly longer per-cell chunks.
- The clipped-line renderer reduced the steady-state three-second sample to
  `TaskDuration: 0.1124s` and `ScriptDuration: 0.0457s`, with zero layout or
  style recalculation. It draws dozens of complete text lines instead of
  thousands of separate text fragments.
- With coastline punctuation and small-island markers enabled, the same sample
  recorded `TaskDuration: 0.1250s` and `ScriptDuration: 0.0530s`, with zero
  layout or style recalculation. This remains comfortably below the `0.25s`
  task-time budget.
- Two consecutive post-optimization samples recorded `TaskDuration: 0.1130s`
  and `0.1229s` and `ScriptDuration: 0.0463s` and `0.0488s`. Average task time
  is `0.1180s` and average script time is `0.0476s`, with zero layout or style
  recalculation. This improves the detailed renderer without lowering its 24 fps
  cadence, canvas density, island count, or coastline punctuation density.
- With the static star field enabled, a three-second sample recorded
  `TaskDuration: 0.1224s` and `ScriptDuration: 0.0501s`, with zero layout or
  style recalculation and no additional animation loop.
- With halo positioning and shimmer enabled, a three-second sample recorded
  `TaskDuration: 0.1058s` and `ScriptDuration: 0.0429s`, with zero layout or
  style recalculation. Shimmer reuses the existing 24 fps canvas loop.
- With the atmospheric punctuation rim enabled, a three-second sample recorded
  `TaskDuration: 0.1295s` and `ScriptDuration: 0.0561s`, with zero layout or
  style recalculation and no additional animation loop.
- The adaptive regular-phone profile at `390 x 844` recorded `TaskDuration:
0.0667s` and `ScriptDuration: 0.0259s` over three seconds, with zero layout or
  style recalculation. Its backing canvas was `445 x 1045`, confirming the
  intended 1.25× density cap. The final desktop full-detail profile recorded
  `TaskDuration: 0.1185s` and `ScriptDuration: 0.0524s` over the same interval,
  also with zero layout or style recalculation.
- The constrained-phone 404 composition at `390 x 844` recorded
  `TaskDuration: 0.0903s` and `ScriptDuration: 0.0293s` over three seconds, with
  zero layout or style recalculation. Reduced-motion hashes were identical 0.8
  seconds apart. The mobile Experience and 404 compositions each had one canvas,
  one heading, no horizontal overflow, and no browser-console errors.
- After merging content and canvas into one surface, the constrained-phone 404
  sample recorded `TaskDuration: 0.0437s` and `ScriptDuration: 0.0146s` over
  three seconds, with zero layout or style recalculation. The merged layout has
  one surface, one canvas, and one outer frame border at both breakpoints.
- The supplied ASCII Gen reference was measured separately. It uses no canvas
  or WebGL: it swaps pre-generated text frames inside one contained `<pre>` at
  approximately 24 fps. Its normalized task-time cost is comparable to the
  optimized dynamic canvas, but it trades runtime computation for lazy frame
  downloads and in-memory frame strings.
- The animation gate blocks frames before page load, outside the viewport, and
  while the document is hidden. Distributed homepage instances also defer their
  first canvas draw until they enter the observer margin, avoiding below-fold
  canvas work during initial page load.
- Browser load completed in 233.7 ms in the local development run
  (`DOMContentLoaded` 197.6 ms).
- The page created one canvas and zero images or videos. Resource timing showed
  only the existing Watch font, CSS, and development JavaScript; the component
  added no image, media, or data requests.
- Mobile QA at `390 x 844` reported `scrollWidth: 390`, a `356 x 836` visible
  canvas, the same upper-hemisphere crop, and no horizontal overflow. The compact
  mask remains connected and retains the small-island punctuation treatment.
- Browser console was checked. No application-origin runtime errors were
  present. In-app-browser extension frame-manager errors and development-only
  Fast Refresh warnings from live source edits were ignored.

## Follow-up Polish

- P3: final Experience integration may tune the default rotation or speed once
  neighboring section content is known.

final result: passed
