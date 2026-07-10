---
title: "fix: Watch Hero Poster-First Idle Autoplay"
type: "fix"
status: "completed"
date: "2026-06-10"
roadmap: "docs/roadmap/platform/feat-176-watch-hero-poster-idle-autoplay.md"
origin: "docs/roadmap/platform/feat-175-watch-cold-path-performance-follow-up.md"
---

# fix: Watch Hero Poster-First Idle Autoplay

## Summary

Change the watch hero from immediate muted Mux playback to a poster-first
initial render. The server-preloaded Mux poster should be the first visual
hero surface. Normal page loads activate the muted looping preview only after
the browser load event and an idle window; explicit user intent and
`?autoplay=1` still activate playback immediately.

## Problem Frame

The live post-merge audit confirmed that SSR and ISR are working: the page
returns server HTML with readable metadata, one H1, JSON-LD, and warmed
`x-nextjs-cache: HIT` responses. Performance remains weak because the hero
creates the Mux player immediately and starts muted autoplay during the
critical page-load window. Lighthouse saw several multi-megabyte Mux video
chunks during initial load. Blocking only Mux segment traffic cut mobile
payload and Total Blocking Time sharply, so this slice should move media
startup after initial page load while preserving the product's muted preview.

## Requirements

- R1. Normal page loads render the hero poster immediately without mounting
  `MuxPlayer` or `MuxVideo` on the first client render.
- R2. The poster image uses the same `thumbnail.webp?width=1280` URL as the
  route-level preload, so the browser can reuse the preloaded resource.
- R3. Muted preview activation is scheduled after `window.load` and an idle
  callback; browsers without `requestIdleCallback` use a bounded timeout
  fallback.
- R4. Idle muted activation is skipped while the document is hidden or the hero
  is no longer in or near the viewport.
- R5. Clicking the pre-reveal "Play with Sound" surface activates the selected
  Mux backend immediately and preserves the existing unmuted play flow.
- R6. `?autoplay=1` activates the player immediately and preserves the existing
  one-shot autoplay handling and URL cleanup behavior.
- R7. Both Mux backend branches keep the existing poster, HLS config, Mux Data,
  subtitles, error handling, and chrome reveal behavior after activation.

## Acceptance Examples

- AE1. Given a normal watch page load, when `HeroPlayer` first renders, then a
  poster image is visible and neither Mux backend component has mounted.
- AE2. Given the browser fires `load` and the idle callback runs while the hero
  is visible, when the scheduled activation fires, then the current Mux backend
  mounts muted, looping, and with the existing poster and HLS config.
- AE3. Given the user clicks "Play with Sound" before idle activation, when the
  click handler runs, then the player mounts immediately and unmuted playback
  starts through the existing gesture-safe path.
- AE4. Given `?autoplay=1` is present, when `HeroPlayer` mounts, then player
  activation is immediate and the existing autoplay attempt strips the query
  parameter after it runs.
- AE5. Given the document is hidden or the hero is scrolled away before idle,
  when the idle callback fires, then muted preview activation is deferred and
  no video segment requests start from that callback.

## Key Technical Decisions

- KTD1. Keep idle muted autoplay, not tap-to-play only. The user selected this
  middle-ground behavior because it preserves the product's animated preview
  while moving video traffic out of the critical load window.
- KTD2. Keep the Mux backend selection unchanged. The build-time
  `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` flag still chooses MuxVideo versus
  MuxPlayer after activation.
- KTD3. Use a plain poster image outside the Mux element for the first render.
  A normal image is discoverable and visible before the client-only Mux dynamic
  import, unlike the Mux shadow-DOM poster.
- KTD4. Treat explicit user intent as higher priority than idle scheduling.
  A user click or `?autoplay=1` should not wait for `load`, idle, or viewport
  checks.

## Implementation Units

### U1. Roadmap and Plan

- **Goal:** Track this follow-up separately from the completed cold-path
  metadata/social-image PR.
- **Requirements:** R1-R7.
- **Files:** `docs/roadmap/platform/feat-176-watch-hero-poster-idle-autoplay.md`,
  `docs/plans/2026-06-10-004-fix-watch-hero-poster-idle-autoplay-plan.md`,
  `docs/roadmap/README.md`.

### U2. Poster-First Hero Activation

- **Goal:** Introduce an activation state so the poster renders first and the
  selected Mux backend mounts only after idle, click, or `?autoplay=1`.
- **Requirements:** R1, R2, R3, R4, R5, R6, R7, AE1-AE5.
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.

### U3. Evidence and Completion

- **Goal:** Validate behavior locally, collect browser/network proof, and mark
  the roadmap item complete.
- **Requirements:** R1-R7.
- **Files:** `docs/solutions/performance-issues/`,
  `docs/roadmap/platform/feat-176-watch-hero-poster-idle-autoplay.md`,
  `docs/plans/2026-06-10-004-fix-watch-hero-poster-idle-autoplay-plan.md`.

## Validation Plan

- Unit tests cover initial poster-only render, idle activation, click-before
  idle activation, immediate `?autoplay=1` activation, hidden/offscreen
  deferral, and MuxVideo branch parity.
- Existing HeroPlayer tests continue to cover language switching, subtitle
  injection, autoplay-blocked handling, chrome reveal, scroll pause, and player
  prop wiring after activation.
- Typecheck and lint cover React 19 compiler and prop contract safety.
- Helium browser smoke verifies the live interaction surface: poster appears
  immediately, muted preview starts after idle, and "Play with Sound" still
  starts playback.
- Lighthouse or network evidence verifies that normal initial load no longer
  requests Mux video segments before delayed activation.

## Completion Evidence

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
  passed: 68 passed, 2 todo.
- `pnpm --filter @forge/web typecheck` passed.
- `pnpm --filter @forge/web lint` passed.
- `ADMIN_GRAPHQL_URL=http://127.0.0.1:3003/api/graphql NEXT_PUBLIC_CANONICAL_ORIGIN=http://127.0.0.1:4913 pnpm --filter @forge/web build`
  passed after rerunning outside the sandbox; the sandboxed attempt hit a
  Turbopack helper-port permission panic.
- Local SSR route probe returned `200` for
  `http://127.0.0.1:4913/watch/life-of-jesus-gospel-of-john.html/english.html`.
- Initial server HTML contains one `hero-player-poster`, one `h1`, and zero
  rendered `mux-player` / `mux-video` backend elements.
- Helium smoke against the same local URL opened
  `Life of Jesus (Gospel of John) | Jesus Film Project`, captured a desktop
  screenshot, and reported no page errors. Immediate browser state had the
  poster src, one `h1`, zero Mux backend elements, zero `video` elements, and
  no Mux stream requests. After `1800ms`, one Mux backend mounted and the Mux
  stream manifest request started.

## Open Questions

- OQ1. Deployment can still separately flip
  `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO=true`; this PR should not require
  that environment operation.
- OQ2. If product later chooses stronger performance over animated preview,
  the next simplification is tap-to-play only: never schedule idle muted
  autoplay on first visit.
