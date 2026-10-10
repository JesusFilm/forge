# packages/video-player — @forge/video-player

## Purpose

This package wraps two video backends behind a single workspace dependency
so consumer apps don't have to install Mux / video.js dependencies directly:

- **`MuxPlayer`, `MuxVideo`** — thin React wrappers around
  `@mux/mux-player-react` and `@mux/mux-video-react`. `apps/web` uses
  `MuxVideo` for the watch page and inline / hero / carousel video surfaces;
  `MuxPlayer` remains exported for package-level compatibility.
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
  resolve under pnpm strict resolution. Consumer apps should depend on
  `@forge/video-player`, not direct Mux React packages, unless they truly need
  an upstream-only API.

### Subpath exports (`./mux-player` + `./mux-video`)

In addition to the barrel `import { MuxPlayer, MuxVideo } from "@forge/video-player"`,
the package exposes two subpath specifiers:

- `@forge/video-player/mux-player` → default export = `MuxPlayer`
- `@forge/video-player/mux-video` → default export = `MuxVideo`

The barrel is convenient but pulls both backends into the same Webpack
module group, so dynamic imports that need chunk separation should use the
subpaths. The watch-page hero now imports only `@forge/video-player/mux-video`;
do not reintroduce a MuxPlayer hero fallback in `apps/web`.

Prefer the barrel for static (non-dynamic) imports and the subpaths
only when chunk separation matters.

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
- Mux wrapper smoke tests live near their consumers, including the MuxVideo
  branch tests for `VideoHero` / `Video` / `CarouselVideo` and
  `HeroPlayer.test.tsx`.
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
