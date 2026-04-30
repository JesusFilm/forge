# packages/video-player — @forge/video-player

## Purpose

This package wraps two video backends behind a single workspace dependency
so consumer apps don't have to install Mux / video.js dependencies directly:

- **`MuxPlayer`, `MuxVideo`** — thin React wrappers around
  `@mux/mux-player-react` and `@mux/mux-video-react`. Used by `apps/web`
  for the watch page and inline / hero / carousel video surfaces.
- **`useVideoPlayerCore`** — a video.js-based React hook that handles
  Strict-Mode-safe player init, source swaps, text-track management,
  viewport autoplay, and standard playback controls. Used by
  `apps/manager`'s job review surface.

## Dual API rules

- **Do NOT mix import paths.** `apps/web` consumers import `MuxPlayer` /
  `MuxVideo` only; `apps/manager` consumers import `useVideoPlayerCore` only.
  Crossing the line is a smell — open a ticket instead.
- **Do NOT add a third backend** (HLS.js raw, Shaka, etc.) without an
  architecture review. The dual API exists transitionally; widening the
  surface defeats the point.
- **Mux deps are declared in this package's `package.json`** so the wrappers
  resolve under pnpm strict resolution. Consumer apps may also list the same
  Mux packages directly if they need to use additional Mux exports (e.g. spike
  tests in `apps/web`); pnpm hoists single versions, no duplicate
  custom-element `define` collision (verified in U1 spike).

## Sunset criterion

When `apps/manager`'s `review-player-card.tsx` migrates off
`useVideoPlayerCore` (tracked as a follow-up to the apps/admin migration in
feat-104), drop:

1. `useVideoPlayerCore`, `formatTime`, `VIDEO_JS_OPTIONS` exports from
   `src/index.ts`
2. `src/useVideoPlayerCore.ts` and its test
3. `video.js`, `@types/video.js` from this package's `package.json`
4. `apps/web/package.json`'s direct `video.js` dependency (R19 — separate
   gate: only after `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` has been
   `true` in production for one stable release)

The wrappers (`MuxPlayer`, `MuxVideo`) remain.

## Testing

- `pnpm --filter @forge/video-player test` — vitest, jsdom environment.
- `useVideoPlayerCore.test.tsx` covers the hook's public contract. Mock
  `video.js` at the module level.
- Mux wrapper smoke tests live in `apps/web` (`MuxPlayerSpike.test.tsx`,
  flag-on branch tests for `VideoHero` / `Video` / `CarouselVideo`).
  Real-playback assertions require Playwright (jsdom does not implement
  HTMLMediaElement playback); see plan U1 for the production-stack smoke.

## Conventions

- All exported components use `"use client"` — they touch the DOM and
  custom-element registration.
- Brand defaults applied in the wrappers: `disableCookies`,
  `playsInline`, plus `disableTracking` on `MuxVideo` (hero/inline excluded
  from Mux Data v1). All overrideable via props.
- Theming for `<MuxPlayer>` is forwarded via CSS Custom Properties on the
  underlying `<mux-player>` custom element — see
  https://github.com/muxinc/elements/blob/main/packages/mux-player/REFERENCE.md
  for the full list (`--controls`, `--media-accent-color`, …). The wrapper
  does NOT inject default classes / styles that would compete.
