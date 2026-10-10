---
title: Watch-route LCP + JS chunk + font perf campaign (mobile-sim 56 → 72)
date: 2026-05-27
category: docs/solutions/performance-issues
module: apps/web
problem_type: performance
component: tooling
severity: high
related_components:
  - apps/web
  - packages/video-player
tags:
  - lcp
  - lighthouse
  - mux-player
  - mux-video
  - hls-buffer-cap
  - next-dynamic
  - preconnect
  - link-preload
  - optimize-package-imports
  - woff2-subset
  - dead-code-elimination
  - subpath-export
applies_when:
  - Mobile-sim Lighthouse performance score on a Mux-backed watch route is below ~70
  - LCP element is a Mux poster image rendered above a hero video player
  - Initial JS payload includes Mux Player chrome + video.js + cast plugin for a route that never uses them
  - next/image `priority` or `loading="eager"` on sibling thumbnails is competing with the hero LCP preload
  - Variable-axis TTF fonts are being shipped uncompressed (>500KB) when woff2 subsetting is available
---

# Watch-route LCP + JS chunk + font perf campaign

## Problem

The `/watch/[slug]/[locale]` route — the highest-traffic surface in `apps/web` — landed at a Lighthouse mobile-sim score of **56**. The dominant bottleneck was a 12.2 s simulated LCP on a slow-4G / 4× CPU profile, gating every other metric. Bundle inventory at baseline:

- **~1010 KB JS** transferred to the watch route on first visit, of which ~503 KB gzipped was a single `media-chrome + cast + hls.js` bundle from `<MuxPlayer>`.
- **~580 KB of fonts** in the critical path: Montserrat upright as a 688 KB raw / 280 KB gz `.ttf` plus a second Montserrat-Italic variable face, both blocking text paint.
- **~46 HLS segments (~54 MB)** preloaded eagerly by hls.js before `canplay` fired, saturating the simulated-mobile bandwidth window and pushing the LCP poster fetch behind the segment queue.
- **3 sibling-carousel thumbnails** issuing `<link rel="preload" as="image">` entries at high priority, competing with the hero poster on the critical path.
- The actual LCP element — the `<img id="image">` inside `<mux-player>`'s shadow DOM — was **invisible to the preload scanner**: it only entered the network waterfall after mux-player JS parsed, instantiated the custom element, and ran its template.
- **16 admin block renderers** (`apps/web/src/components/sections/index.tsx`) were static-imported into every watch-route chunk despite none of them rendering on a typical video-template watch page.
- **video.js** (the legacy player runtime) was dragged in transitively via `@forge/video-player`'s barrel `index.ts` re-exporting `useVideoPlayerCore`, even though `apps/web`'s surface only consumed the Mux wrapper components.

Mobile users on flaky networks saw a black hero frame for 10+ seconds with chrome shifting in after JS hydrated. Score after the campaign: **72**, with the LCP element now discoverable in the initial HTML scan.

Final 5-run mobile-sim median deltas on `/watch/[slug]/[locale]/hindi`:

| Metric                     | Baseline              | Final                   | Δ      |
| -------------------------- | --------------------- | ----------------------- | ------ |
| Performance score          | 56                    | **72**                  | +16    |
| LCP (simulated)            | 12.2 s                | **7.2 s**               | −5.0 s |
| LCP (observed)             | ~460 ms               | **460 ms**              | flat   |
| TBT                        | 440 ms                | **170 ms**              | −61 %  |
| Speed Index                | 8.0 s                 | **4.1 s**               | −49 %  |
| JS transfer                | 1010 KB               | **633 KB**              | −37 %  |
| Font transfer              | 580 KB                | **201 KB**              | −65 %  |
| HLS segments preloaded     | 46 (54 MB)            | 4 (~5 MB)               | −91 %  |
| `www.gstatic.com` requests | 1 (47 KB cast_sender) | **0**                   | gone   |
| Image preloads in `<head>` | 4                     | **1** (LCP poster only) | −75 %  |
| Desktop perf score         | 86                    | **93**                  | +7     |
| Desktop LCP                | 2.4 s                 | **1.63 s**              | −32 %  |
| Desktop TBT                | 30 ms                 | **0 ms**                | zero   |
| CLS                        | 0                     | 0                       | —      |

## Root cause

Seven independent-but-interlocking contributors, each of which had to be addressed separately to recover the score:

1. **`<MuxPlayer>` shipped dead chrome.** The `@mux/mux-player` package bundles `media-chrome` (its built-in UI layer), cast-sender support, and `hls.js` together as a ~1.8 MB raw / ~503 KB gzipped chunk. The watch route overlays a custom `HeroPlayerControls` React layer on top and hides the entire native chrome with CSS — so the media-chrome layer was pure dead weight on every watch page load, indistinguishable in cost from the parts we actually used.

2. **hls.js's default buffer was tuned for desktop fiber.** Out of the box hls.js front-loads `maxBufferLength: 30` seconds and `maxBufferSize: 60_000_000` bytes, which translated to roughly **46 segments / ~54 MB** queued before the `canplay` event. On a simulated mobile-4G connection this saturated the bandwidth window for the first 8–10 seconds — the LCP poster request, even when discovered, sat behind the segment queue.

3. **The LCP element was non-discoverable.** Chrome's preload scanner walks the initial HTML and queues priority fetches for `<img>` / `<link rel="preload" as="image">` it finds there. The actual LCP — the `<img id="image">` inside `<mux-player>`'s shadow DOM — only appeared _after_ the custom element JS parsed and stamped its template. The poster URL was knowable at SSR time but never surfaced to the scanner.

4. **Sections barrel pulled 16 unused block renderers into the route chunk.** `apps/web/src/components/sections/index.tsx` static-imported every admin block renderer (countdown, gallery, carousel, etc.) so the renderer registry could be a synchronous lookup. On a typical video-template watch page, **zero** of those blocks render — but all 16 were in the initial chunk.

5. **`@forge/video-player`'s barrel re-exported video.js.** The package's root `index.ts` re-exported `useVideoPlayerCore` (the video.js wrapper for the legacy player surface) alongside `MuxPlayer`/`MuxVideo`. `apps/web` consumed only the Mux components, but the barrel made tree-shaking unreliable across the package boundary and the entire video.js runtime followed `MuxPlayer` into the watch chunk.

6. **Two Montserrat font faces where one would do.** Montserrat upright was served as a `.ttf` (688 KB raw / 280 KB gz) and Montserrat Italic shipped as a _separate_ variable font face — used by exactly one Tailwind `italic` class on `AdventCountdown`. Synthetic italic skew on the upright face is visually acceptable for that single surface, and `.ttf` carries ~30 % of overhead that `.woff2` does not.

7. **SiblingCarousel competed with LCP for high-priority fetches.** The carousel's `next/image` thumbnails inherited `priority` + `loading="eager"` from a copy-paste of the hero pattern, causing the browser to emit three `<link rel="preload" as="image">` entries at high fetch-priority — all competing with the actual LCP poster on the critical path.

## Solution

Seven targeted changes, each tied to one root cause. The campaign treated the score as a sum of independent contributions and shipped each fix as a discrete, individually-revertable PR.

### 1. Make the LCP poster discoverable in the initial HTML

Emit an explicit preload link from the server component before the player mounts, and match its query string to the `poster=` prop the player passes down. This puts the LCP image in the preload scanner's first pass — the browser fetches it before mux-player JS even parses.

In [apps/web/src/app/[slug]/[locale]/page.tsx](../../../apps/web/src/app/[slug]/[locale]/page.tsx):

```tsx
<link
  rel="preload"
  as="image"
  href={`https://image.mux.com/${playbackId}/thumbnail.webp?width=1280`}
  fetchPriority="high"
/>
```

The matching `poster={`https://image.mux.com/${playbackId}/thumbnail.webp?width=1280`}` on `<MuxPlayer>` / `<MuxVideo>` ensures the player's later fetch hits the same cache entry rather than issuing a second request. Shipped in **#1029**.

A `react-dom` `preload()` attempt was tried first and rejected — it does NOT reliably emit in Next.js 16 + Turbopack production builds in this codebase. The raw `<link>` JSX form (React 19 hoists it into `<head>` via Float) is the working pattern.

### 2. Cap hls.js buffer so segments don't starve the poster

Pass a constrained `_hlsConfig` to the Mux player so hls.js doesn't front-load 30 s of segments on initial canplay. This frees the bandwidth window for the LCP poster and downstream resources:

```tsx
<MuxPlayer
  // ...
  _hlsConfig={{
    maxBufferLength: 10,
    maxBufferSize: 5_000_000,
    backBufferLength: 5,
  }}
/>
```

10 s forward buffer is enough to absorb network jitter without monopolizing bandwidth during the first paint window. Shipped in **#1029**.

### 3. Dual-mount with a runtime flag to drop media-chrome's 503 KB gz

Add a `<MuxVideo>` component (thin wrapper over the bare `<mux-video>` custom element — no media-chrome, no cast UI, just the video + HLS) alongside the existing `<MuxPlayer>` and gate the choice behind an env flag so the swap could canary safely.

In [apps/web/src/components/watch/HeroPlayer.tsx](../../../apps/web/src/components/watch/HeroPlayer.tsx):

```tsx
const MuxPlayer = dynamic(() => import("@forge/video-player/mux-player"), {
  ssr: false,
})
const MuxVideo = dynamic(() => import("@forge/video-player/mux-video"), {
  ssr: false,
})

// runtime selection
{
  env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO ? (
    <MuxVideo {...sharedProps} />
  ) : (
    <MuxPlayer {...sharedProps} />
  )
}
```

The two components diverge on autoplay-error shape: `<MuxPlayer>` emits a CustomEvent with `detail.code === "autoplay-blocked"`, while `<MuxVideo>` rejects the `play()` Promise with `DOMException("NotAllowedError")`. The handler bridges both via a shared helper:

```ts
function isAutoplayBlockedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  return (err as { name?: unknown }).name === "NotAllowedError"
}
```

Subtitle injection also has to handle the shadow-DOM layout difference (bare `<video>` direct vs nested under `<mux-video>` under `<mux-player>`):

```ts
return (
  muxVideo?.shadowRoot?.querySelector("video") ??
  (el as unknown as HTMLElement).shadowRoot?.querySelector("video") ??
  (el instanceof HTMLVideoElement ? el : null)
)
```

Shipped in **#1032** behind `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` (default `false`).

### 4. Subpath exports on `@forge/video-player` to fence off video.js

Replace the package's root barrel with explicit subpath exports so `apps/web` can import `mux-player` and `mux-video` without dragging `useVideoPlayerCore` (and the video.js runtime) along the import graph.

In [packages/video-player/package.json](../../../packages/video-player/package.json):

```jsonc
"exports": {
  ".":              "./src/index.ts",
  "./mux-player":   "./src/MuxPlayer.tsx",
  "./mux-video":    "./src/MuxVideo.tsx",
  "./video-js-core":"./src/useVideoPlayerCore.ts"
}
```

Consumers of the legacy video.js player (e.g. `apps/manager`'s review-player-card) keep working via `@forge/video-player/video-js-core`; `apps/web`'s imports point at `/mux-player` and `/mux-video` directly. Tree-shaking now operates on a single-file entry, not a barrel, so video.js stays out of the watch chunk. Shipped in **#1032** (subpaths added) + **#1034** (apps/web migrated to subpaths + video.js direct dep dropped).

Critically: `next/dynamic(() => import("@forge/video-player").then(m => m.MuxPlayer))` still ships both backends in the resulting chunk because Turbopack groups them through the barrel. The subpath specifiers are the load-bearing piece — they resolve to distinct module entries.

### 5. Drop the Montserrat-Italic face, swap upright to WOFF2

Remove the second `@font-face` block for Montserrat Italic in [apps/web/src/app/layout.tsx](../../../apps/web/src/app/layout.tsx) and let the browser synthetically skew the upright face for the single `italic` usage on `AdventCountdown`. Re-encode the upright face from `.ttf` to `.woff2` via `woff2_compress` — verified that the variable-font axis tables (`fvar`, `gvar`, `HVAR`, `MVAR`, `avar`) survive the encode so the `wght 100-900` axis still works.

Net: ~580 KB of font bytes drops to ~201 KB, and the second face's separate critical-path fetch disappears entirely. Italic-face removal shipped in **#1034**; WOFF2 swap shipped in **#1036**.

### 6. Lazy-load SiblingCarousel thumbnails

In [apps/web/src/components/watch/SiblingCarousel.tsx](../../../apps/web/src/components/watch/SiblingCarousel.tsx), remove `priority` and `loading="eager"` from the `<Image>` props. Native `loading="lazy"` on next/image still fetches above-the-fold cards immediately (the browser's intersection observer fires synchronously for in-viewport images) — but those fetches no longer emit `<link rel="preload" as="image">` entries competing with the LCP poster for high fetch-priority.

Critical finding: next/image emits a head-preload for **either** `priority={true}` OR `loading="eager"`. Plain `loading="lazy"` is the only way to avoid the contention while keeping above-fold cards visible on first paint.

Shipped in **#1036**.

### 7. Dynamic-import the sections barrel

Convert `apps/web/src/components/sections/index.tsx` from a static-import registry to a dynamic-import map. The renderer registry stays a synchronous lookup of _components_, but each component is now a `next/dynamic()` boundary — so the 16 admin block renderers split into per-block chunks loaded only when a watch page actually contains that block type. Typical video-template pages: zero of the 16 chunks fetched.

Shipped in **#1029**, alongside dynamic-imported modals (`DownloadModal`, `LanguagePickerModal`, `ShareModal`) and `experimental.optimizePackageImports` for `lucide-react` + the Mux packages.

## Prevention

Read these rules before touching watch-route render paths, the workspace player package, the admin block renderers, or any font / image preload wiring.

**Chunk-splitting & workspace packages**

- If you wrap a workspace component in `next/dynamic` for chunk separation, verify the package exposes the relevant **subpath exports** in its `package.json` `exports` map. A barrel re-export collapses both branches into the same chunk despite the dynamic boundary — `next/dynamic` only splits what the bundler can prove is independently reachable.
- Don't ship two video backends (`@mux/mux-player-react` and `@mux/mux-video-react`) in the same chunk. Import each via its own subpath (`@forge/video-player/mux-player`, `@forge/video-player/mux-video`) so the inactive backend is statically unreachable.
- The combo that actually dead-code-eliminates the inactive backend at build time is: **subpath export + `next/dynamic` + a `process.env.NEXT_PUBLIC_*`-folded conditional**. All three are required. Drop any one and the loser backend still ships.
- After any new dynamic-import boundary on the watch route, grep the post-build `.next/static/chunks/` for the loser-branch symbol (`mux-player`, `media-chrome`, `cast_sender`, `video.js`, etc.). If it's present on flag-on builds, the split didn't work — fix the import topology before merging.
- Static imports of N components in a barrel ship all N into every consumer's chunk, even when only 0–2 ever render. Any barrel file in `apps/web` that exports render-time-conditional components (admin block renderers, modal variants, hero variants) must convert each export to `next/dynamic` per-renderer — not a single dynamic on the barrel itself.

**Player / Mux backend rules**

- Before swapping a Mux backend, audit whether the heavy backend's UI surface is actually rendered. If `media-chrome` slots are overridden by a custom React controls layer, the entire `<MuxPlayer>` UI tree is dead weight — `<MuxVideo>` (no media-chrome) is the correct backend. Keep the swap behind a feature flag for one release cycle so Mux Data beacon volume can be compared.
- ALWAYS migrate autoplay-blocked detection to `play()` Promise rejection with `DOMException("NotAllowedError")` when moving from `<MuxPlayer>` to `<MuxVideo>` (or bare `<video>`). `CustomEvent.detail.code === "autoplay-blocked"` is a MuxPlayer-specific surface — the Promise rejection is the cross-vendor truth source and works on bare `<video>`, MuxVideo, hls.js attach paths, and Safari native HLS alike.
- Configure HLS.js via `_hlsConfig` to cap buffer-ahead (`maxBufferLength`, `maxBufferSize`, `backBufferLength`). Default HLS.js eagerly preloads ~46 segments — death on mobile cellular. Cap to a conservative window (10–15 s) for hero / autoplay use cases.
- Keep `player_name` stable across backend swaps (`"forge-web-watch"`). It's the join key for the Mux Data dashboard — changing it during a backend migration silently zeroes historical comparisons.
- Override `disableTracking={false}` explicitly when migrating to `<MuxVideo>` for the hero. The `@forge/video-player` wrapper defaults `disableTracking={true}` for the section players (Mux Data cost control); the hero needs attribution.

**LCP image preload rules**

- Before adding `priority={true}` to a `next/image`, ask: is this image the LCP element on this route? If not, use native `loading="lazy"`. `priority` emits a `<link rel="preload" as="image">` head entry that competes with the real LCP element's preload for critical-path bandwidth.
- `priority={true}` + `loading="eager"` on the same `next/image` emits competing head preload entries. Pick one, and only on the actual LCP element.
- Above-fold images that aren't the LCP belong on native `loading="lazy"` — not `priority`, not `loading="eager"`. The browser's lazy heuristic still fires synchronously for images already in the viewport.
- For the LCP image preload itself, use a raw `<link rel="preload" as="image" fetchPriority="high" />` JSX element rendered in the page Server Component. React 19 hoists it to `<head>` during SSR.
- **Do NOT use `react-dom`'s `preload()` API on the watch route** — it does not reliably emit in Next.js 16 + Turbopack production builds in this codebase. The raw `<link>` JSX form is the working pattern.
- Document-head image preloads on the watch route should number exactly **1** (the Mux LCP poster). Any additional `<link rel="preload" as="image">` entry is a regression — find the offending `priority` prop or stray `preload()` call.

**Font rules**

- Variable fonts ship as WOFF2, never TTF. WOFF2 preserves variable-font tables (`fvar`, `gvar`, `HVAR`, `MVAR`, `avar`) — verify post-conversion with `woff2_info`.
- Before shipping a synthetic-italic variable face, audit whether any consumer uses an actual italic axis position. If the only consumer is a Tailwind `italic` class (`font-style: italic`), the browser synthesizes the slant from the upright face — drop the dedicated italic face entirely.
- Variable-font axes that no live class targets are payload, not capability. Audit `@font-face` declarations against actual Tailwind usage before adding new faces.

**React 19 / Next.js 16 head-emission gotchas**

- `react-dom`'s `preload()` / `preinit()` APIs are unreliable in Next.js 16 + Turbopack production builds in this codebase. Default to raw `<link>` JSX in Server Components for any new resource hint until this is upstream-fixed.
- Resource hints belong in the Server Component render tree, not in a `useEffect` — by the time client JS runs, the preload window is gone.

## Verification

Run these checks before merging any PR that touches the watch route's render path, the player package, the barrel renderer file, or font / image preload wiring.

**Build-output inspection**

- `pnpm --filter @forge/web build` succeeds with no Turbopack chunk-size warnings on the watch route.
- Inspect `.next/static/chunks/` for loser-backend symbols on flag-on builds:
  - `rg -l 'mux-player|media-chrome' apps/web/.next/static/chunks/` → should be empty when the MuxVideo flag is on.
  - `rg -l 'cast_sender|video\.js' apps/web/.next/static/chunks/` → should be empty on all watch-route chunks.
- Confirm per-renderer chunk split for the admin block renderers: each renderer should appear in its own chunk file under `.next/static/chunks/`, not collapsed into the page chunk.

**Lighthouse (mobile-sim)**

- `lighthouse 'http://localhost:<PORT>/watch/<slug>/<locale>' --form-factor=mobile --throttling-method=simulate --only-categories=performance --output=json --output-path=./lh.json --chrome-flags="--headless"` — median performance score across 5 runs should be **≥ 70** (campaign baseline 56 → 72).
- Audit `lcp-discovery-insight` — `priorityHinted: true`, `requestDiscoverable: true`, `eagerlyLoaded: true`. Any `false` indicates the LCP preload isn't emitting or isn't matching the LCP element.
- Audit `prioritize-lcp-image` — score should be 1.
- Audit `unused-javascript` — flag-on watch route should not list the inactive Mux backend's chunk.
- Audit `font-display` — no flagged faces; all faces should resolve `swap` or `optional`.

**Head-emission spot checks**

- View source of the production watch route and count `<link rel="preload" as="image">` entries — should be exactly **1** (the Mux LCP poster). Any additional entry is a regression.
- Confirm the LCP poster `<link>` carries `fetchpriority="high"`.
- Confirm `<link rel="preload" as="font" type="font/woff2" crossorigin>` entries are limited to faces actually used above the fold.

**Player backend & Mux Data**

- Network panel on a cold watch-page load: verify only one of `mux-player` / `mux-video` script bundles fetches (whichever matches `NEXT_PUBLIC_*` flag state).
- HLS request waterfall: initial segment burst should be capped (≤ ~10 s of buffer / ≤ 5 segments), not 46. Inspect `.ts` segment count on the first second of playback.
- Mux Data dashboard, filter `player_name = "forge-web-watch"` — beacon volume must not drop after a backend swap deploys. A drop indicates the new backend isn't reporting; check `metadata` + `disableTracking={false}` wiring on `<MuxVideo>`.
- Force autoplay-blocked state (Chrome flag `--autoplay-policy=document-user-activation-required`) and verify the unmute / tap-to-play UI appears. Confirms the `DOMException("NotAllowedError")` Promise-rejection path is wired.

**Font integrity**

- `woff2_info apps/web/public/fonts/<face>.woff2` should list `fvar`, `gvar`, `HVAR`, `MVAR`, `avar` tables for any variable face. Missing tables = static font masquerading as variable.
- `ls -lh apps/web/public/fonts/` — no `.ttf` files for faces that have a `.woff2` equivalent. TTF in `public/fonts/` for a face that also ships as WOFF2 is dead payload.

**Bundle-size regression gate**

- Compare `.next/analyze/` (or equivalent bundle-analyzer output) for the watch route's first-load JS between the PR branch and `main`. Any single-chunk growth > 10 KB gzipped on the watch route requires explicit justification in the PR description.
- The watch-route page chunk should not import any admin block renderer statically — the entire renderer set must arrive via `next/dynamic`. Grep the analyze output for renderer names in the page chunk; presence = regression.

## Related solution docs

- [docs/solutions/performance-issues/watch-hero-muxplayer-to-muxvideo-swap-20260526.md](watch-hero-muxplayer-to-muxvideo-swap-20260526.md) — direct precursor doc capturing the MuxPlayer → MuxVideo swap, subpath-export rationale, `_hlsConfig` budget preservation, autoplay-blocked detection via `play()` Promise, Mux Data attribution override, and the simulated-mobile Lighthouse delta table. The current campaign doc compounds the rest of the work that landed after this swap.
- [docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md](../design-patterns/mux-player-custom-react-chrome-pattern-20260430.md) — documents the always-hidden-Mux-chrome + parallel React `HeroPlayerControls` pattern that the hero swap inherits; explains why the chrome layer was already redundant, which is the load-bearing premise that lets MuxVideo replace MuxPlayer at all. Now stale for the default-on path; see refresh candidates below.
- [docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md](../design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md) — React 19 compiler ref / setState patterns. Relevant because the HeroPlayer + subtitle-injection + autoplay-blocked flag changes all touch ref / state plumbing under the new flag-on path and need to keep the ruleset green.
- [docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md](../developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md) — Chrome MCP / Lighthouse measurement loop pattern; this campaign is the textbook reapplication (5-run median mobile-sim Lighthouse, network waterfall inspection, before / after deltas).
- [docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md](../architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md) — the canonical subpath-export-in-workspace-package precedent (gql-tada client subpaths); same Turbopack barrel-vs-subpath chunking insight reused by the video-player package here.

## Related PRs / plans

- [#1029 — perf(web): cut watch-page mux chunk + LCP poster waste](https://github.com/JesusFilm/forge/pull/1029) — merged. HLS buffer cap, LCP poster preload via React 19 raw `<link rel="preload">` hoisting, dynamic-imported sections + modals, preconnect to mux.
- [#1032 — refactor(web): swap watch-hero MuxPlayer for MuxVideo behind a flag](https://github.com/JesusFilm/forge/pull/1032) — merged. Dual-mount HeroPlayer behind `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO`; subpath exports on `@forge/video-player`. Originating plan: [docs/plans/2026-05-26-005-refactor-watch-hero-muxplayer-to-muxvideo-beta-plan.md](../../plans/2026-05-26-005-refactor-watch-hero-muxplayer-to-muxvideo-beta-plan.md).
- [#1034 — perf(web): drop video.js + Montserrat-Italic from watch route](https://github.com/JesusFilm/forge/pull/1034) — merged. Drops video.js from `apps/web` bundle; removes Montserrat-Italic webfont; strips flag-off branches from section players.
- [#1036 — perf(web): drop sibling-carousel preloads + ship Montserrat as woff2](https://github.com/JesusFilm/forge/pull/1036) — open. Removes SiblingCarousel image preloads; converts Montserrat to WOFF2.

## Refresh candidates

- [docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md](../design-patterns/mux-player-custom-react-chrome-pattern-20260430.md) — the watch HERO no longer uses MuxPlayer in default operation (MuxVideo is the flag-on path after #1032; section players had flag-off branches stripped in #1034). The "custom React chrome over MuxPlayer" framing is accurate only for legacy / fallback contexts, not the current hero. Confidence: HIGH. Suggested follow-up: `/ce:compound-refresh mux-player-custom-react-chrome-pattern-20260430`.
- [docs/solutions/performance-issues/watch-hero-muxplayer-to-muxvideo-swap-20260526.md](watch-hero-muxplayer-to-muxvideo-swap-20260526.md) — the "bigger wins remain locked behind a follow-up" paragraph (section players still importing via barrel) is now stale; #1034 stripped flag-off branches + switched sections to subpaths. Confidence: HIGH.
