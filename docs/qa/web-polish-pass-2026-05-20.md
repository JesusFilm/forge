---
title: Web Polish Pass — QA Report
captured_at: 2026-05-20
verified_at: 2026-05-20
branch: qa/web-polish-pass
base_commit: ba7b774f
source: Claude Web Extension QA pass
target_url: http://localhost:3000/watch/1-jesus-our-loving-pursuer/english
target_route: apps/web /watch/[slug]/[language]
runtime: Next.js App Router, dev mode
counts:
  total: 51
  verified_true: 34
  verified_false: 7
  deferred: 7
  needs_measurement: 3
  high: 12
  medium: 19
  low: 20
categories:
  CRIT: critical / functional
  A11Y: accessibility (WCAG)
  SEO: search engine optimization
  PERF: performance
  UX: usability / ux
  SEC: security / hygiene
verification_legend:
  true: confirmed by live DOM, console, network, or code grep
  false: refuted by live evidence — struck through, not actionable
  deferred: requires prod build, throttled network, or player-engaged session to verify
  needs-measurement: subjective / requires designer tool (contrast checker, performance budget)
  needs-manual: requires human inspection of specific surface (tool output redacted)
---

# Web Polish Pass — QA Report (2026-05-20)

## How to use this doc

- Each finding has a stable ID (`CRIT-01`, `A11Y-03`, …). Reference it in commits/PRs.
- Per-finding fields: `severity`, `category`, `originally`, `verified`, `verify_note`, `evidence`, `impact`, `fix`, `hints`, `status`.
- Findings with `verified: false` have their **heading struck through** — do not work on them.
- Update `status` to `in-progress` / `fixed` / `wontfix` as work proceeds.

## Verification pass (2026-05-20)

- Method: live DOM via `mcp__claude-in-chrome__javascript_tool`, console + network reads, source grep on `apps/web/src/`, single 1450×840 screenshot.
- Page state: target URL freshly loaded; **video player NOT engaged** (still on spinner when measured), so player-runtime findings (text tracks, subtitle overlap, slow chunks) marked `deferred`.
- Runtime: `next dev` — anything dev-only (script count, HMR overlay) noted as `deferred` for prod re-test.

### Refuted findings (do not work on)

- **SEO-04** — OG tags use `property=` correctly (11 `property`, 0 `name`).
- **SEO-05** — First `<meta>` is the charset `utf-8` meta, not an orphan.
- **PERF-06** — Dev-mode `<script>` count is a HMR artifact (55 here, 104 in source report); re-check in prod build.
- **PERF-08** — All 12 `<img>` already have `decoding="async"` (Next.js Image default).
- **PERF-09** — Only the H1 duplicates, not the chapter list. Heading sequence shows one H3×7 chapter run.
- **UX-07** — Clip label fully visible in current viewport.
- **UX-10** — All 3 external `target="_blank"` links already have `rel="noopener"`.

### Deferred (need a different test environment to confirm)

CRIT-03, CRIT-04, CRIT-06 (need player-engaged + throttled-network session) · A11Y-11, UX-01 (need video playing with subtitles) · PERF-04, PERF-05, UX-03, SEC-02 (need prod build) · A11Y-09 (needs contrast checker) · SEC-01 (needs server-side per-session token analysis) · UX-06 (needs manual link inspection).

## Resolution summary — fixes shipped this pass (branch `qa/web-polish-pass`)

All fixes were verified with: live DOM check (chrome MCP) + `pnpm --filter @forge/web typecheck` + `pnpm --filter @forge/web test`. All three green at every step.

### Fixed (14 findings)

- **CRIT-01** — `NavigationCarousel.tsx`: swapped `key={item.id}` → `key={item.contentId}`. The Strapi-fragment-derived type claims `id` exists, but admin's runtime shape doesn't expose it, so `key` was `undefined`. Verified clean on `/watch/easter` (the test slug doesn't render this section).
- **A11Y-01 / SEO-07** — Duplicate `<h1>` resolved: demoted `WatchBody.tsx`'s `<h1>` → `<h2>`. Duplicate `<main>` resolved: `ExperienceSkeleton.tsx` `<main>` → `<div role="status">` so the Suspense fallback no longer collides with `WatchPageClient`'s real `<main>`. DOM: `h1Count: 2 → 1`, `mainCount: 2 → 1`.
- **A11Y-02** — Heading hierarchy normalized: `SiblingCarousel` chapter card `<h3>` → `<span>` (cards are nav links, not section headers), `WatchStudyQuestions` `<h4>` → `<h2>`, `BibleQuotesSection` `<h3>` "Bible Quotes" → `<h2>`. Sequence is now `H1 → H2 → H2 → H2 → H3` with no skips.
- **A11Y-04** — `nativeButton={false}` added to `RelatedQuestions` and `BibleQuotesCarousel` Button usages that pass a `render` slot (the warning's root cause was rendering a non-`<button>` while the Base UI prop still declared a native button). No more nativeButton warnings in console.
- **A11Y-05** — Dynamic `aria-label` on the hero unmute pill: `"Play video with sound"` or `"Tap to unmute video"` depending on `pillState`.
- **A11Y-06 / UX-08** — `CarouselPrevious` / `CarouselNext` UI primitive now accepts an optional `label` prop that drives both `aria-label` and the sr-only span. Callsites updated: SiblingCarousel → `"Previous/Next chapter"`, BibleQuotesSection → `"Previous/Next Bible quote"`, CarouselVideo → `"Previous/Next video"`. Four distinct accessible names where there were previously two identical ones.
- **A11Y-10** — Added `dir="ltr"` to `<html>` in `app/layout.tsx`. Document direction is now declared; will be wired per-locale once Arabic/Hebrew are served.
- **PERF-01** — `BibleQuotesSection` `BibleCitationCard` now takes an `isLcpCandidate` prop; the first card receives `priority + loading="eager" + fetchPriority="high"`. Next 16's `priority` alone wasn't producing the right DOM attrs when paired with `fill + sizes`, so the trio is spelled out explicitly.
- **PERF-07** — `SiblingCarousel` chapter thumbnails now use explicit `loading={index < 5 ? "eager" : "lazy"}` + `fetchPriority`. The same Next 16 + `fill` + `sizes` quirk meant `priority={index < 5}` alone wasn't surfacing. DOM verification: 5 eager / 2 lazy chapter thumbs, zero `loading="auto"` images (down from 5).
- **SEO-01** — Title now always appends `| Jesus Film Project` on the video-template branch (previously only fired when `routeVideo.title` was empty). `<title>` is now `"1. Jesus, Our Loving Pursuer | Jesus Film Project"`.
- **SEO-02** — Description generator flipped: `routeVideo.description` (long body) is now preferred over `routeVideo.snippet` (short tagline). Meta description on the test page jumped 52 chars → 279 chars. Also lengthened the experience-branch fallback string.
- **SEO-09** — `robots: { index: true, follow: true }` now explicitly emitted on all three metadata branches (video-template, experience, series). `<meta name="robots" content="index, follow">` present.

### Wontfix (1 finding)

- **SEO-06** — Canonical pointing to `www.jesusfilm.org` while served from `localhost:3000` is **correct SEO behavior**. The canonical should always point to the production domain — `localhost` URLs would never be valid SEO targets, and there is no staging environment in forge (per `project_no_staging`). No code change needed. If a staging env is ever introduced, the canonical generator should grow env-aware host resolution at that point.

### Deferred follow-ups beyond this pass

- **SEO-08** (hreflang) — Requires threading per-slug language variant lists into `getWatchPageMetadata`. Bigger feature than a polish fix; track as a separate ticket.
- **SEO-03** (JSON-LD VideoObject) — Same: bigger feature.
- **CRIT-05** (no `<video>` at SSR), **CRIT-07** (Media Chrome shadow stylesheet), **A11Y-03 / UX-11** (nav + footer landmarks), **A11Y-07** (alt text audit), **A11Y-08 / UX-05** (real search input element), **PERF-02 / PERF-03** (move off Unsplash hot-link), **UX-02 / UX-04 / UX-09** (visual / UX polish), **SEC-03** (inline-style codemod), **SEC-04** (critical-CSS audit) — all confirmed-actionable but out of scope for this batch.

---

## CRIT — Critical / Functional

### CRIT-01 — Missing `key` prop in NavigationCarousel children

- severity: high
- category: CRIT
- originally: #1
- verified: true
- verify_note: Console error during render: "Each child in a list should have a unique `key` prop. … Check the render method of `div`. It was passed a child from NavigationCarousel." Source file confirmed at `apps/web/src/components/sections/NavigationCarousel.tsx`.
- evidence: React console warning during render of NavigationCarousel.
- impact: Reconciliation bugs, item shuffling on re-render, lost component state.
- fix: Add stable `key` prop to mapped children inside NavigationCarousel.
- hints: `apps/web/src/components/sections/NavigationCarousel.tsx`; check `.map(` sites.
- status: open

### CRIT-02 — Mux HLS playlists rebuffering early

- severity: high
- category: CRIT
- originally: #2
- verified: true
- verify_note: Console captured 2 `VIDEOJS WARN: Problem encountered with playlist … Aborted early because there isn't enough bandwidth to complete the request without rebuffering. Switching to playlist …` events during initial load.
- evidence: Multiple videojs WARN events switching renditions back and forth.
- impact: Playback quality oscillates; poor first-frame experience on average networks.
- fix: Tune ABR ladder / initial bitrate. Consider lower starting rendition + slower upshift.
- hints: video player config in `apps/web/src/components/video/` or `packages/video-player/`.
- status: open

### CRIT-03 — Failed/cancelled video manifest requests

- severity: medium
- category: CRIT
- originally: #3
- verified: deferred
- verify_note: Player wasn't engaged in this verification session; chrome MCP network log only captured 2 mux-related JS chunks. The report's claim of "≥10 m.m3u8 with transferSize 0" requires a player-engaged session to confirm.
- evidence (source): ≥10 `https://stream.mux.com/*.m3u8` resource entries with `transferSize: 0`.
- impact: Wasted bandwidth, contributes to playback instability.
- fix: Stop pre-fetching unused variants; investigate segment-abort root cause.
- hints: check Mux player initialization options; pair with CRIT-02 retune.
- status: deferred

### CRIT-04 — Extremely slow video chunks

- severity: medium
- category: CRIT
- originally: #4
- verified: deferred
- verify_note: Same as CRIT-03 — player not engaged in verification session.
- evidence (source): Several Mux chunks took 1.7s–6.1s to load (worst 6,104ms).
- impact: Hero/play experience stalls on slower networks.
- fix: Investigate CDN region, segment size, and concurrent prefetch budget.
- hints: capture HAR from a throttled-network repro; share with Mux if upstream.
- status: deferred

### CRIT-05 — No `<video>` element at initial render

- severity: medium
- category: CRIT
- originally: #5
- verified: true
- verify_note: Live DOM: `document.querySelectorAll('video').length === 0` even after 5s wait on freshly-loaded page (spinner state).
- evidence: `<video>` is created lazily after user interaction; no fallback markup.
- impact: SSR/no-JS users see no fallback; search engines see no video markup.
- fix: Ensure poster image is present at SSR; consider rendering an SSR `<video poster>` skeleton.
- hints: confirm whether player wrapper is `'use client'`-gated.
- status: open

### CRIT-06 — No caption/subtitle tracks

- severity: high
- category: CRIT
- originally: #6
- verified: deferred
- verify_note: Caption track inspection requires player-engaged session; cannot read `textTracks` from a not-yet-mounted `<video>`. Original report had it as `hasCaptions: false`.
- evidence (source): `hasCaptions: false` on the active player.
- impact: WCAG 1.2.2 violation + localization regression.
- fix: Wire Mux text tracks (VTT) into the player; verify per-language fallback chain.
- hints: cross-reference admin's caption fields; check `apps/web/src/components/video/`.
- status: deferred

### CRIT-07 — Media Chrome shadow-root stylesheet missing

- severity: medium
- category: CRIT
- originally: #7
- verified: true
- verify_note: Console warning: "Media Chrome: No style sheet found on style tag of #document-fragment".
- evidence: Custom-element media player isn't loading CSS into its shadow root → FOUC on unstyled controls in prod.
- impact: Flash of unstyled controls in production.
- fix: Verify Media Chrome stylesheet is bundled and injected into the player's shadow root.
- hints: search for `media-chrome` / `<media-controller>` usage.
- status: open

---

## A11Y — Accessibility (WCAG)

### A11Y-01 — Two `<h1>` on the page

- severity: high
- category: A11Y
- originally: #8
- verified: true
- verify_note: Live DOM: `h1Count: 2`, both reading "1. Jesus, Our Loving Pursuer".
- evidence: Two `<h1>` elements, both identical text.
- impact: WCAG 1.3.1; SEO crawlers confused about main topic (also see SEO-07).
- fix: Demote duplicate to `<h2>` or remove one render path.
- hints: Also: `mainCount: 2` — there are TWO `<main>` elements on the page, which is its own a11y bug worth fixing in the same pass.
- status: open

### A11Y-02 — Broken heading order

- severity: high
- category: A11Y
- originally: #9
- verified: true
- verify_note: Heading sequence captured live: `H1, H3×7 (chapter list), H1, H4 (Related Questions), H3, H3`. H1→H3 and H1→H4 skips confirmed.
- evidence: H1 → H3 (chapter list) and H1 → H4 ("RELATED QUESTIONS"). Skipped levels.
- impact: WCAG 1.3.1; screen-reader navigation broken.
- fix: Use H2 for top-level section headings; cascade downward.
- hints: section header components in `apps/web/src/components/sections/`.
- status: open

### A11Y-03 — No `<nav>` or `<footer>` landmarks

- severity: medium
- category: A11Y
- originally: #10
- verified: true
- verify_note: Live DOM: `navCount: 0, footerCount: 0`.
- evidence: No navigation or footer landmarks.
- impact: No skip-to-nav for assistive tech; missing semantic structure.
- fix: Wrap chapter list / language switcher in `<nav>`; add a `<footer>`.
- hints: layout-level fix; see also UX-11 (no footer).
- status: open

### A11Y-04 — Base UI `nativeButton` warnings

- severity: high
- category: A11Y
- originally: #11
- verified: true
- verify_note: Console errors captured twice during render — one with stack frame pointing to `RelatedQuestions`, one to `FreeResourceCard` inside `BibleQuotesCarousel`.
- evidence: Console: "Base UI: A component that acts as a button expected a native `<button>` because the `nativeButton` prop is true. Rendering a non-`<button>` removes native button semantics…"
- impact: Buttons not keyboard/screen-reader operable as expected.
- fix: Either use native `<button>` rendering, or set `nativeButton={false}` on these usages.
- hints: `RelatedQuestions`, `FreeResourceCard` components in `apps/web/src/components/`.
- status: open

### A11Y-05 — "Play with Sound" missing aria-label

- severity: medium
- category: A11Y
- originally: #12
- verified: true
- verify_note: Live DOM: Play with Sound button `aria-label` is null.
- evidence: Icon-bearing CTA has no programmatic name.
- impact: Screen readers announce only fallback text.
- fix: Add `aria-label="Play video with sound"` (or equivalent).
- hints: hero CTA in the watch hero section.
- status: open

### A11Y-06 — Carousel Prev/Next buttons missing aria-label

- severity: medium
- category: A11Y
- originally: #13
- verified: true
- verify_note: Live DOM: 2 "Previous slide" buttons, both with empty `aria-label`.
- evidence: Same label appears in chapter carousel + bible quotes carousel with no programmatic differentiation.
- impact: Screen-reader users can't tell which carousel they're operating.
- fix: Add unique `aria-label` per carousel ("Previous chapter", "Previous quote", etc.) and/or `aria-controls`.
- hints: shared carousel component using embla-carousel-react.
- status: open

### A11Y-07 — Decorative/content images with empty `alt=""`

- severity: medium
- category: A11Y
- originally: #14
- verified: true
- verify_note: Live DOM: 4 of 12 images have `alt=""`.
- evidence: 4/12 empty-alt images.
- impact: If decorative → OK; if content → fails WCAG 1.1.1.
- fix: Audit each. Hero LCP image needs descriptive `alt` or explicit decorative marker.
- hints: Bible Quotes background images likely OK as decorative; verify intent.
- status: open

### A11Y-08 — Search input has no accessible name (and isn't a real `<input>`)

- severity: high
- category: A11Y
- originally: #15
- verified: true
- verify_note: Live DOM: `inputCount: 0`.
- evidence: No real `<input>` for the visible search field.
- impact: Keyboard users can't operate it; screen readers find nothing.
- fix: Render a real `<input>` with `aria-label` (or `<label>`) and a submit form.
- hints: top-of-page search component; cross-check UX-05.
- status: open

### A11Y-09 — Color contrast risk on body text

- severity: low
- category: A11Y
- originally: #16
- verified: needs-measurement
- verify_note: Can't measure contrast ratios without a designer tool against the actual rendered backgrounds. Visual screenshot shows mustard "EPISODE" label and stone-400 grey on dark — needs ratio check.
- evidence (source): `text-stone-400` over dark/brown background; mustard EPISODE label on dark; near-black foreground on transparent in computed style sample.
- impact: Possible WCAG AA failure (4.5:1 for normal text).
- fix: Measure with a contrast checker; adjust tokens.
- hints: Tailwind color tokens in `apps/web/src/`.
- status: needs-measurement

### A11Y-10 — `<html dir>` attribute empty

- severity: low
- category: A11Y
- originally: #17
- verified: true
- verify_note: Live DOM: `document.documentElement.dir === ""`. Source confirmed: `apps/web/src/app/layout.tsx:29` renders `<html lang="en" className=...>` with no `dir`.
- evidence: `<html>` has no `dir` attribute.
- impact: Bidirectional layout will break once Arabic/Hebrew locales are served.
- fix: Set `dir="ltr"` (or per-locale `dir`) in `apps/web/src/app/layout.tsx`.
- hints: root layout; small fix.
- status: open

### A11Y-11 — Subtitle text overlaps H1 + Play button

- severity: high
- category: A11Y
- originally: #18
- verified: deferred
- verify_note: Player not engaged in verification session; current screenshot shows spinner with title + Play CTA clearly visible. Cannot confirm the burned-in caption collision without a playing video state.
- evidence (source): Caption ("How beautiful is the masterpiece...") sits behind H1 and Play CTA.
- impact: Major visual + usability bug if confirmed.
- fix: Either pause subtitle rendering until play, or move title/CTA out of caption region.
- hints: hero video overlay z-index / poster behavior; see also UX-01.
- status: deferred

---

## SEO — Search Engine Optimization

### SEO-01 — `<title>` too short, no brand suffix

- severity: medium
- category: SEO
- originally: #19
- verified: true
- verify_note: Live DOM: `document.title === "1. Jesus, Our Loving Pursuer"`.
- evidence: Title has no brand suffix.
- impact: Lower CTR, no brand reinforcement.
- fix: Append " | Reflections of Hope — Jesus Film Project" (or equivalent template).
- hints: `apps/web/src/lib/experience-metadata.ts` (per `apps/web/src/app/page.tsx`).
- status: open

### SEO-02 — Meta description too short

- severity: medium
- category: SEO
- originally: #20
- verified: true
- verify_note: Live DOM: meta description length is 52 chars.
- evidence: Below Google's 120–160 sweet spot.
- impact: Truncated CTAs in SERP.
- fix: Generate longer descriptions; verify template length budget.
- hints: same metadata generator as SEO-01.
- status: open

### SEO-03 — No JSON-LD structured data

- severity: high
- category: SEO
- originally: #21
- verified: true
- verify_note: Live DOM: `script[type="application/ld+json"]` count is 0.
- evidence: No structured data.
- impact: No video rich result eligibility.
- fix: Emit `VideoObject` JSON-LD (name, description, thumbnailUrl, uploadDate, duration, embedUrl, transcript).
- hints: add as a `<Script type="application/ld+json">` in the page or layout.
- status: open

### ~~SEO-04 — Open Graph tags using `name=` instead of `property=`~~

- severity: ~~medium~~
- category: SEO
- originally: #22
- verified: false
- verify_note: **Refuted.** Live DOM: `meta[property^="og:"]` count is 11; `meta[name^="og:"]` count is 0. OG tags are rendered correctly with `property=`. Likely Next.js's default emission, as suspected in the original report.
- status: refuted

### ~~SEO-05 — Orphan `<meta>` with empty content~~

- severity: ~~low~~
- category: SEO
- originally: #23
- verified: false
- verify_note: **Refuted.** Live DOM: the first `<meta>` is `<meta charset="utf-8">` with `name: null, content: ""`. That's the expected charset declaration, not an orphan tag. The original collector script misread it.
- status: refuted

### SEO-06 — Canonical URL points to production on localhost

- severity: low
- category: SEO
- originally: #24
- verified: true
- verify_note: Live DOM: canonical host is `www.jesusfilm.org` while served from `localhost:3000`.
- evidence: Canonical → `jesusfilm.org` in dev.
- impact: Acceptable in dev; verify staging/preview hosts don't leak prod canonicals.
- fix: Audit canonical generator's env-driven host.
- hints: `apps/web/src/lib/`.
- status: open

### SEO-07 — Duplicate H1 confuses crawlers

- severity: low
- category: SEO
- originally: #25
- verified: true
- verify_note: Derived from A11Y-01 (confirmed).
- evidence: Same H1 twice.
- impact: SEO topic ambiguity.
- fix: Resolved by A11Y-01.
- hints: cross-ref A11Y-01.
- status: open

### SEO-08 — No `hreflang` alternates

- severity: medium
- category: SEO
- originally: #26
- verified: true
- verify_note: Live DOM: `link[rel="alternate"][hreflang]` count is 0.
- evidence: No hreflang alternates.
- impact: International SEO doesn't know about language variants.
- fix: Emit one `<link>` per available language under the watch slug.
- hints: requires knowing which languages have published variants per Experience.
- status: open

### SEO-09 — No `<meta name="robots">`

- severity: low
- category: SEO
- originally: #27
- verified: true
- verify_note: Live DOM: no robots meta tag present.
- evidence: Missing.
- impact: Implicit `index,follow` works, but explicit is cleaner.
- fix: Set explicitly in metadata.
- hints: `apps/web/src/lib/experience-metadata.ts`.
- status: open

---

## PERF — Performance

### PERF-01 — LCP image not eager-loaded

- severity: high
- category: PERF
- originally: #28
- verified: true
- verify_note: Console warning observed: `Image with src "https://images.unsplash.com/photo-1480869799327-..." was detected as the Largest Contentful Paint (LCP). Please add the loading="eager" property…`. Live DOM: hero image `fetchPriority: auto`, `loading: lazy` — not eager.
- evidence: LCP warning + DOM attributes.
- impact: LCP regression.
- fix: Add `priority` (Next.js `<Image>`) on hero image; verify only ONE hero is marked priority.
- hints: hero section component.
- status: open

### PERF-02 — Hero image sourced from Unsplash

- severity: low
- category: PERF
- originally: #29
- verified: true
- verify_note: Console LCP warning explicitly named the unsplash URL; live DOM: 4 images with `unsplash` in `src`.
- evidence: `unsplash.com/photo-...` LCP image.
- impact: Third-party dependency, no SLA, rate-limit risk.
- fix: Move to self-hosted CDN.
- hints: relevant to product, not just polish — flag to content owner.
- status: open

### PERF-03 — Bible Quote card images all Unsplash

- severity: medium
- category: PERF
- originally: #30
- verified: true
- verify_note: 4 unsplash images present and the hero is one of them — remaining ≥3 are the quote cards.
- evidence: Decorative quote backgrounds from `unsplash.com`.
- impact: Same as PERF-02 + bandwidth.
- fix: Self-host or use platform CDN.
- hints: BibleQuotes section.
- status: open

### PERF-04 — 245 resources / ~2.75 MB total transfer

- severity: medium
- category: PERF
- originally: #31
- verified: deferred
- verify_note: Dev-mode resource counts include HMR and source-map chunks; only `next start` against a `next build` output is a fair measurement.
- evidence (source): Resource count + transfer total; chunks: video.js 453 KB, hls.js 314 KB, two node_modules chunks ~273–301 KB.
- impact: Heavy first load.
- fix: Lazy-load video player after Play click; chunk-split node_modules bundles.
- hints: cross-ref PERF-05.
- status: deferred

### PERF-05 — video.js + hls.js shipped together

- severity: medium
- category: PERF
- originally: #32
- verified: deferred
- verify_note: Needs bundle analysis on prod build.
- evidence (source): Both libraries always loaded; Safari can play HLS natively.
- impact: ~300 KB waste on Safari/iOS users.
- fix: Lazy-load hls.js behind MSE feature detection.
- hints: video player module entrypoint.
- status: deferred

### ~~PERF-06 — 104 `<script>` tags in DOM~~

- severity: ~~medium~~
- category: PERF
- originally: #33
- verified: false (dev-mode artifact)
- verify_note: **Refuted in dev.** Live DOM: `scriptCount: 55` (not 104) — the count differs between sessions and is inflated by Next.js dev HMR. Real measurement only meaningful against prod build. Folded into PERF-04 if a real concern surfaces post-build.
- status: refuted

### PERF-07 — Chapter thumbnails with `loading="auto"`

- severity: medium
- category: PERF
- originally: #34
- verified: true
- verify_note: Live DOM: 5 images with `loading="auto"` (and 7 with `loading="lazy"`, 0 eager).
- evidence: 5 images using browser-default loading hint.
- impact: Browser-dependent; inconsistent.
- fix: Explicit `loading="eager"` for above-the-fold (and `priority` for the LCP), `loading="lazy"` for below.
- hints: chapter list component; pair with PERF-01 fix.
- status: open

### ~~PERF-08 — Images missing `decoding="async"`~~

- severity: ~~low~~
- category: PERF
- originally: #35
- verified: false
- verify_note: **Refuted.** Live DOM: all 12 `<img>` already have `decoding="async"` (Next.js `<Image>` sets it by default).
- status: refuted

### ~~PERF-09 — Chapter list rendered twice~~

- severity: ~~low~~
- category: PERF
- originally: #36
- verified: false
- verify_note: **Refuted.** Live heading sequence shows the chapter H3 list appears exactly once (H1, then H3×7, then second H1, then H4 etc.). Only the H1 duplicates — that's already covered by A11Y-01. There is no duplicate chapter render.
- status: refuted

---

## UX — Usability / UX

### UX-01 — Subtitles burned into video poster

- severity: low
- category: UX
- originally: #37
- verified: deferred
- verify_note: Player not engaged this session — current screenshot shows spinner, no poster + caption state.
- evidence (source): Caption text appears on poster before user clicks Play.
- impact: Confusing first impression; collides with title (see A11Y-11).
- fix: Suppress subtitle layer until playback starts, OR use a clean poster image.
- hints: hero poster / video element layering.
- status: deferred

### UX-02 — "Play with Sound" CTA small / overlapped

- severity: high
- category: UX
- originally: #38
- verified: partial
- verify_note: In current screenshot (1450×840, spinner state), the CTA renders at clear size with `Play with Sound` text — NOT visually small or overlapped. The overlap claim depends on UX-01 (subtitle render) being confirmed. Treat as partially confirmed pending UX-01.
- evidence: Source flagged overlap with subtitle; current state shows clean CTA.
- impact: Reduced affordance for primary action.
- fix: Resolved partially by UX-01 + A11Y-11; consider larger tap target on mobile.
- hints: hero CTA.
- status: partial

### UX-03 — NextJS "3 Issues" dev overlay visible

- severity: high
- category: UX
- originally: #39
- verified: deferred (dev-only)
- verify_note: Not visible in current screenshot. The overlay is `next dev`-only and will not ship in `next start`. Re-confirm absence on prod build.
- evidence (source): Overlay visible in source screenshots.
- impact: Dev tool only.
- fix: Verify production build doesn't include the overlay.
- hints: this is expected in `next dev`; re-verify with `next start`.
- status: deferred

### UX-04 — Globe / language button has no visible label

- severity: low
- category: UX
- originally: #40
- verified: true
- verify_note: Screenshot confirms top-right globe icon is small with no visible text label.
- evidence: Icon-only globe button.
- impact: Easy to miss; users won't discover language switching.
- fix: Add visible language code (e.g. "EN") or text label.
- hints: language switcher in header.
- status: open

### UX-05 — Search "bible stories" looks like a value

- severity: low
- category: UX
- originally: #41
- verified: true
- verify_note: Confirmed via A11Y-08 — no real `<input>` element. Current screenshot shows "Search or browse topics…" — placeholder appears correctly here but the underlying not-an-input issue remains.
- evidence: No real input + confusing prefill in some states.
- impact: Users may not realize the field is empty.
- fix: Use a real `<input>` with proper `placeholder=` styling.
- hints: cross-ref A11Y-08.
- status: open

### UX-06 — "Read more..." link with query params (blocked by tool)

- severity: low
- category: UX
- originally: #42
- verified: needs-manual
- verify_note: Original tool output was redacted; needs human inspection of the link target under Psalms 139:13-18.
- evidence (source): `[BLOCKED: Cookie/query string data]` in original tool output.
- impact: Query params may leak data or be hard to share.
- fix: Audit query-string content; consider canonical/clean URLs.
- hints: requires manual inspection of the link target.
- status: needs-manual

### ~~UX-07 — "Reflections of Hope · Clip 1 of 7" label cut off~~

- severity: ~~low~~
- category: UX
- originally: #43
- verified: false
- verify_note: **Refuted at 1450×840.** Current screenshot shows the label fully visible at the bottom-left of the hero. May have been a viewport-specific issue in the source screenshot. Re-flag if it reproduces on mobile.
- status: refuted

### UX-08 — Two carousels with identical aria labels

- severity: medium
- category: UX
- originally: #44
- verified: true
- verify_note: Derived from A11Y-06 (both Prev buttons have empty `aria-label`).
- evidence: Same as A11Y-06.
- impact: See A11Y-06.
- fix: See A11Y-06.
- hints: cross-ref A11Y-06.
- status: open

### UX-09 — No visible breadcrumbs

- severity: low
- category: UX
- originally: #45
- verified: true
- verify_note: Live DOM: no breadcrumb landmark (`[aria-label*="breadcrumb"]` count is 0).
- evidence: Deep URL with no breadcrumb trail.
- impact: Navigation + SEO loss.
- fix: Add breadcrumbs (also emit BreadcrumbList JSON-LD — pair with SEO-03).
- hints: layout-level addition.
- status: open

### ~~UX-10 — External CTAs need `target/rel` audit~~

- severity: ~~low~~
- category: UX
- originally: #46
- verified: false
- verify_note: **Refuted.** Live DOM: 3 external links present, all with `target="_blank"`, all with `rel` containing `noopener` (0 missing-noopener external links found).
- status: refuted

### UX-11 — No footer

- severity: medium
- category: UX
- originally: #47
- verified: true
- verify_note: Live DOM: `footerCount: 0`.
- evidence: No footer on the page.
- impact: Missing copyright, privacy, terms, contact, socials.
- fix: Add a global footer.
- hints: layout-level; coordinates with A11Y-03.
- status: open

---

## SEC — Security / Hygiene

### SEC-01 — Mux signed URLs token caching

- severity: low
- category: SEC
- originally: #48
- verified: deferred (server-side)
- verify_note: Token shape and `expires=` parameter confirmed in console-logged playlist URLs (CRIT-02 evidence). "Per-session vs cached across users" is a server-side concern that can only be answered by inspecting admin's URL signer.
- evidence: `expires=1779836400` (Sep 2026) and `signature=...` on every Mux URL.
- impact: Possible token leakage via browser history / referer.
- fix: Verify token issuance is per-session.
- hints: admin's video URL signing layer.
- status: deferred

### SEC-02 — Dev-mode artifacts in production?

- severity: low
- category: SEC
- originally: #49
- verified: deferred (dev-only)
- verify_note: HMR / Fast Refresh expected in dev; needs `next start` against a prod build to confirm absence.
- evidence (source): HMR, React DevTools hint, Fast Refresh messages observed in dev.
- impact: Expected in dev; verify they don't appear in prod build.
- fix: Re-test against `pnpm --filter @forge/web start`.
- hints: dev-only artifact verification.
- status: deferred

### SEC-03 — 31 inline `style` attributes

- severity: low
- category: SEC
- originally: #50
- verified: true (count differs)
- verify_note: Live DOM: `[style]` count is 23 (not 31). Still a meaningful number for CSP planning, just smaller than originally measured.
- evidence: 23 inline style attributes.
- impact: CSP complexity — would require `'unsafe-inline'` or per-style hashes.
- fix: Move to classes where feasible; track remaining via codemod.
- hints: audit components for `style={...}`.
- status: open

### SEC-04 — Stylesheet `<link>` render-blocking check

- severity: low
- category: SEC
- originally: #51
- verified: true
- verify_note: Live DOM: 2 stylesheet links.
- evidence: 2 `<link rel="stylesheet">` tags.
- impact: Minimal; verify not render-blocking unnecessarily.
- fix: Audit critical-CSS strategy.
- hints: Next.js handles this; likely fine.
- status: open
