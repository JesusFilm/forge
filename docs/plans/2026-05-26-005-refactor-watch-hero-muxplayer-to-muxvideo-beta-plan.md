---
title: Migrate watch-page hero from MuxPlayer to MuxVideo
type: refactor
status: active
date: 2026-05-26
origin: docs/brainstorms/2026-04-29-watch-page-mux-parity-requirements.md
---

# Migrate watch-page hero from MuxPlayer to MuxVideo

## Overview

Replace `<MuxPlayer>` (`@mux/mux-player-react`, ~1.8 MB raw / 503 KB gzipped) with `<MuxVideo>` (`@mux/mux-video-react`, ~250 KB raw / 80 KB gzipped) inside `apps/web/src/components/watch/HeroPlayer.tsx`. Cuts the watch-route initial JS by ~420 KB gzip, eliminates the external `cast_sender.js` / `cast_framework.js` fetches from `www.gstatic.com`, and makes the poster image discoverable in the document's initial HTML scan (light-DOM `<video poster>` instead of a shadow-DOM `<img>` created by media-chrome after JS executes).

All non-hero `<MuxVideo>` surfaces (`VideoHero`, `Video`, `CarouselVideo`) are unaffected — they already use `<MuxVideo>`. Hero chrome stays React-rendered via the existing `HeroPlayerControls` pattern (the four load-bearing pieces from [docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md](../solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md) remain in force; piece #1 — hiding Mux chrome — becomes a no-op because `<MuxVideo>` has no chrome to hide).

## Problem Frame

The watch-page hero is the single largest item on the `/watch/[slug]/[locale]` mobile-sim Lighthouse waterfall. After the perf pass landed in the prior conversation, the simulated-mobile LCP plateau (~11 s) is dominated by the time required to download + parse + execute the mux-player + hls.js + cast_sender chunk before the shadow-DOM poster `<img>` can be inserted. Lab observed LCP is 460 ms; the simulator projects 11 s because the LCP element is only discoverable after JS executes (`requestDiscoverable: false` initially, only `true` after our preload landed).

`<MuxVideo>` is a thin wrapper around `<video>` + HLS.js with the same `MuxMediaProps` surface (`_hlsConfig`, `envKey`, `metadata`, `disableCookies`, `disableTracking`, `preferPlayback`). It does not ship `media-chrome`, theme assets, the cast plugin, or chrome shadow DOM. Because the watch hero already hides all Mux chrome via CSS Custom Properties and renders its own React chrome (`HeroPlayerControls`), the chrome layer is dead weight today. Swapping the backend keeps the visible UI identical and frees both bytes and a chunk of main-thread parse cost.

The pre-existing watch-page-mux-parity decision (see origin) chose `<MuxPlayer>` for the watch surface with the explicit acceptance that "bespoke chrome would have to be built." That bespoke chrome shipped (`HeroPlayerControls`), so the predicate for keeping mux-player no longer holds for the hero. This plan partially reverses the origin's player decision for the hero only.

## Requirements Trace

- R1. Drop the watch-route initial JS payload by at least 350 KB gzip on the hero-bearing path. **Verifier:** `.next/static/chunks` size diff on the route's primary entry chunk; Lighthouse `network-requests` Script-resource sum.
- R2. Eliminate the external `cast_sender.js` and `cast_framework.js` fetches from `www.gstatic.com` on watch pages. **Verifier:** Lighthouse `network-requests` shows no `gstatic.com` entries.
- R3. Preserve every behavior covered by the existing watch `__tests__/HeroPlayer.test.tsx` + `__tests__/HeroPlayerControls.test.tsx` + `__tests__/LanguagePickerModal.test.tsx` suites: autoplay-muted on mount, loop, scroll-pause threshold, language-switch event handling, tap-to-unmute synchronous chain, autoplay-blocked recovery, spinner state machine, sticky-top behavior, fullscreen toggle, keyboard hotkeys (re-rendered via `HeroPlayerControls`).
- R4. Preserve Mux Data analytics attribution (`player_name`, `video_title`, `video_id`, `viewer_user_id` via `envKey` + `metadata`). **Verifier:** Network shows beacons to `mux.com/api/v1/...` with the same `viewer_user_id` query payload; manual smoke + a unit test that asserts `metadata` is forwarded.
- R5. Preserve HLS buffer tuning shipped in the prior conversation (`maxBufferLength: 10`, `maxBufferSize: 5_000_000`, `backBufferLength: 5`). **Verifier:** Lighthouse `network-requests` shows ≤ 10 video segments on initial load (current state, 5).
- R6. Preserve subtitle plumbing: `LanguagePickerModal` subtitle toggle + `SubtitleOverlay` cuechange listener continue to function via the standard `HTMLMediaElement.textTracks` API. **Verifier:** Existing subtitle tests pass; manual smoke renders a track and toggles it.
- R7. Cut over behind a feature flag (`NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO`) so both paths exist in `main` for one release before mux-player-react is removed. **Verifier:** Flag-off path renders `<MuxPlayer>`; flag-on path renders `<MuxVideo>`; both paths exercised in CI.
- R8. No visual design change. Loading state, autoplay-muted preview, tap-to-unmute reveal, chrome controls, fullscreen layout, sticky pinning, and overlay layers are pixel-identical on a same-frame side-by-side comparison. **Verifier:** Chrome DevTools MCP screenshot comparison on the test page (`/watch/11-has-the-universe-always-existed/hindi`) before vs after, both at 360×800 mobile and 1280×800 desktop.

## Scope Boundaries

- **Out of scope**: Removing `@mux/mux-player-react` from `packages/video-player/src/MuxPlayer.tsx`, `apps/web/package.json`, or `packages/video-player/package.json`. The wrapper stays. Sunset is gated on R7 stability and lives in a follow-up after one stable release.
- **Out of scope**: Migrating `apps/manager`'s `useVideoPlayerCore` (video.js) — that's `packages/video-player`'s separate sunset criterion.
- **Out of scope**: Changing the bg-black + spinner loading overlay in `HeroPlayer.tsx`. The overlay stays exactly as-is; the goal is byte-size + LCP discoverability, not visual loading UX.
- **Out of scope**: Switching `<MuxPlayer>` to `<MuxVideo>` inside `SeriesPageClient`'s trailer-loop hero. If that surface also uses `MuxPlayer`, it gets the same flag; verify in U1 inventory.
- **Out of scope**: AirPlay / cast UI. Already lost in the current chrome-hidden mode; this plan does not reintroduce them.
- **Out of scope**: Captions UI (built-in Mux Player CC menu was already hidden by `--controls: none`). Subtitles continue to render via `SubtitleOverlay`'s React layer.
- **Non-goal**: Improving the simulated-mobile LCP value below ~11 s. The chunk-size drop should help the simulator, but the LCP plateau is bandwidth- and CPU-bound on the simulated 1.6 Mbps + 4× CPU profile. Real-world LCP is already 460 ms.

## Context & Research

### Relevant Code and Patterns

- [apps/web/src/components/watch/HeroPlayer.tsx](../../apps/web/src/components/watch/HeroPlayer.tsx) — only runtime `<MuxPlayer>` caller in apps/web. Lines 582–630 hold every prop. Lines 316–325, 368–370, 417–463 hold every ref read/write. Lines 142–148 pierce the shadow DOM to read text tracks; line 114 has the secondary `el.textTracks` access.
- [apps/web/src/components/watch/HeroPlayerControls.tsx](../../apps/web/src/components/watch/HeroPlayerControls.tsx) — ref consumer; only uses standard `HTMLMediaElement` API (`addEventListener("timeupdate" / "durationchange" / "loadedmetadata" / "play" / "pause" / "volumechange" / "progress")`, `paused`, `muted`, `volume`, `currentTime`, `duration`, `buffered`, `play()`, `pause()`). All transfer 1:1 to `HTMLVideoElement`. Fullscreen lives on `wrapperRef`, not the player ref.
- [apps/web/src/components/watch/SubtitleOverlay.tsx:129](../../apps/web/src/components/watch/SubtitleOverlay.tsx) — casts `playerRef.current as HTMLMediaElement`, reads `el.textTracks`. Pure standard API; the cast becomes the actual type under MuxVideo.
- [apps/web/src/components/watch/LanguagePickerModal.tsx:224](../../apps/web/src/components/watch/LanguagePickerModal.tsx) — single field read `playerRef.current?.currentTime`. Native on both.
- [apps/web/src/components/watch/**tests**/MuxPlayerSpike.test.tsx](../../apps/web/src/components/watch/__tests__/MuxPlayerSpike.test.tsx) — U1 spike from the original parity work. Verifies `MuxPlayer` and `MuxVideo` coexist (no `define` collision), ref shapes (`MuxPlayerElement` vs `HTMLVideoElement`). Use as the existence proof that both backends register cleanly side-by-side.
- [apps/web/src/components/sections/VideoHero.tsx](../../apps/web/src/components/sections/VideoHero.tsx), [Video.tsx](../../apps/web/src/components/sections/Video.tsx), [CarouselVideo.tsx](../../apps/web/src/components/sections/CarouselVideo.tsx) — existing `<MuxVideo>` callsites; mirror their prop shape (`disableTracking={false}` override for Mux Data, native `autoPlay` + `muted` separate from `<MuxPlayer>`'s `autoPlay="muted"` string).
- [packages/video-player/src/MuxVideo.tsx](../../packages/video-player/src/MuxVideo.tsx) — wrapper to extend if needed. Defaults `disableTracking={true}` (Mux Data cost gate). The hero needs `disableTracking={false}` so Mux Data attribution per R4 keeps working — pass explicitly at the callsite rather than mutating the wrapper default.
- [apps/web/src/env.ts:110](../../apps/web/src/env.ts) — `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` declaration is the pattern. Add `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` alongside it with the same Zod shape and `runtimeEnv` mapping.
- [apps/web/src/components/sections/CarouselVideo.tsx:462](../../apps/web/src/components/sections/CarouselVideo.tsx) — flag-on/off branch pattern (`if (env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION) { /* MuxVideo */ } else { /* video.js */ }`) is the precedent for how to dual-mount inside HeroPlayer.

### Institutional Learnings

- [docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md](../solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md) — the regression checklist. Every numbered piece (1–4 + 5a–5f) must keep working post-swap. Piece #1 (hide chrome via `--controls: none`) becomes a no-op under MuxVideo; pieces #2–4 + 5a–5f are unchanged.
- [docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md](../solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md) — `videoReady` reset on variant change must remain render-phase, not `useEffect`, or the React Compiler ESLint rule fails CI.

### External References

- Mux Video React: `MuxMediaProps` exposes `_hlsConfig`, `envKey`, `metadata`, `disableCookies`, `disableTracking`, `preferPlayback` — confirmed via `node_modules/.pnpm/@mux+playback-core@*/dist/types/types.d.ts`. R4 + R5 are achievable without wrapper changes.
- HTML `<video>` autoplay-block detection: `play()` returns a `Promise` that rejects with `DOMException("NotAllowedError")` when the browser blocks autoplay. Replaces MuxPlayer's `event.detail.code === "autoplay-blocked"` path. HeroPlayer.tsx:417, 450, 463 already `.catch` the play promise — extend those handlers to set `autoplayBlocked = true` on `NotAllowedError`.

## Key Technical Decisions

- **Dual-mount behind `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO`**: introduce a parallel render path inside `HeroPlayer.tsx`. Flag-off keeps `<MuxPlayer>` (unchanged). Flag-on renders `<MuxVideo>`. Both paths exercised in CI via `__tests__/HeroPlayer.test.tsx` running each branch. Same pattern as the existing watch-player migration flag.
- **Ref type stays `MuxPlayerRef` at the public boundary**, but the underlying value satisfies the standard `HTMLMediaElement` surface either way. The seven type-only consumers (`HeroPlayerControls`, `SubtitleOverlay`, `LanguagePickerModal`, `WatchPageClient`, `SeriesPageClient`, `WatchSectionRenderer`, plus their tests) need no change because every method/property they touch is on `HTMLMediaElement`. Document this in `packages/video-player/src/index.ts` via a new exported type alias `type WatchPlayerRef = MuxPlayerRef | MuxVideoRef` (later swap consumers to the alias; not blocking).
- **Mux Data attribution preserved at the callsite**: pass `disableTracking={false}` explicitly when rendering `<MuxVideo>` from HeroPlayer; keep the existing `envKey` + `metadata` props. Do not flip the wrapper's default — other `<MuxVideo>` callsites (`VideoHero`, `Video`, `CarouselVideo`) intentionally have tracking disabled today.
- **Poster as native `<video poster>` attribute**: the existing `<link rel="preload">` in `page.tsx` already points at `https://image.mux.com/<id>/thumbnail.webp?width=1280`; passing the same URL to `poster=` makes the LCP element discoverable in the initial HTML scan. Underneath the bg-black overlay, so visually identical to today.
- **Autoplay-blocked detection switches to `play()` Promise rejection**: catch `NotAllowedError` in the existing `play()` `.catch` blocks at lines 417, 450, 463 and set `autoplayBlocked = true`. Remove the `event.detail.code === "autoplay-blocked"` MuxPlayer-specific branch from `handlePlayerError` — under MuxVideo the `onError` shape is plain `Event` with `currentTarget.error?.code` mapping to standard `MediaError.MEDIA_ERR_*`.
- **`autoPlay="muted"` literal becomes `autoPlay + muted` booleans**: native `<video autoPlay muted>` produces equivalent behavior. The existing `muted` state already handles unmute on tap.
- **Object-fit via inline `style`**: MuxPlayer's `--media-object-fit` CSS custom property is replaced by `style={{ objectFit: chromeRevealed ? "contain" : "cover" }}` on `<MuxVideo>`. PRE_REVEAL/REVEALED_OBJECT_FIT_STYLE constants flip from `MuxCSSProperties` to plain `CSSProperties`.
- **CHROME_HIDE_STYLE drops**: no `<MuxVideo>` chrome to hide. `MuxCSSProperties` direct import from `@mux/mux-player-react` removes from HeroPlayer.tsx line 15.

## Open Questions

### Resolved During Planning

- **Does `<MuxVideo>` support `_hlsConfig`, `envKey`, `metadata`?** Yes — confirmed via `MuxMediaProps` definition in `@mux/playback-core/dist/types/types.d.ts`. R4 + R5 transferable.
- **Does the standard `HTMLVideoElement` surface satisfy `HeroPlayerControls`'s ref calls?** Yes — repo-research-analyst inventoried every read/write; all are standard `HTMLMediaElement` (`addEventListener`, `paused`, `muted`, `volume`, `currentTime`, `duration`, `buffered`, `play()`, `pause()`).
- **Does fullscreen change?** No — `HeroPlayerControls` already targets `wrapperRef.requestFullscreen()`, not the player. iOS `webkitEnterFullscreen` is on `HTMLVideoElement` only and is not currently used; keep wrapper fullscreen as today.
- **Will captions render?** Captions are not rendered by Mux Player's chrome today (CC menu is hidden by `--controls: none`). `SubtitleOverlay` reads `textTracks` from the underlying media element directly — works identically on `<video>` since `<MuxVideo>` forwards the underlying element.
- **Where does the new flag live?** `apps/web/src/env.ts` — same Zod + `runtimeEnv` pattern as `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION`.

### Deferred to Implementation

- **Does `<MuxVideo>` shadow-DOM piercing still work?** ⚠️ Resolved in U1: `HeroPlayer.tsx:142–152` uses `el.shadowRoot?.querySelector("mux-video")` then `.shadowRoot?.querySelector("video")` to **inject a custom `<track>` element** for the subtitle override. Under `<MuxVideo>`, `el` IS the underlying `HTMLVideoElement` directly (no shadow root), so the existing fallback chain returns `null` and subtitle injection **silently fails**. Fix in U3: append a final fallback `(el instanceof HTMLVideoElement ? el : null)` to the `video` resolution chain so the track is appended directly to `el`. Add a regression test in U4 that asserts the `<track>` lands when `subtitleVttSrc` is set under flag-on.
- **Does `SeriesPageClient`'s trailer hero use `<MuxPlayer>` too?** ✅ Resolved in U1: SeriesPageClient is type-only — it owns a `playerRef` to thread to `LanguagePickerModal` but does NOT render a player. Migration scope stays at HeroPlayer alone. `LanguagePickerModal`'s `?.currentTime` read tolerates a null ref.
- **HLS.js `_hlsConfig` parity in MuxVideo at runtime**: the prop type accepts it; verify segments-per-load drops to ≤ 10 under flag-on, matching today's flag-off. Defer measurement to U5.
- **Mux Data beacon parity**: type accepts `envKey` + `metadata`; verify a real beacon fires with the same fields. Defer to U5 manual smoke.
- **Autoplay-blocked recovery on Mobile Safari**: confirm the play-promise rejection fires `NotAllowedError` on iOS Safari mute-required autoplay paths. Defer to U5 device check.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

Render-time branch inside `HeroPlayer.tsx`:

```
HeroPlayer
├── flag off (default)
│   └── <MuxPlayer
│         style={CHROME_HIDE_STYLE + object-fit CSS var}
│         poster, autoPlay="muted", muted, loop, preload="metadata"
│         _hlsConfig, envKey, metadata, disableCookies
│         onLoadedMetadata, onCanPlay, onError(detail.code)
│       />
│
└── flag on
    └── <MuxVideo
          style={{ objectFit }}                    // CSS var → inline
          poster
          autoPlay muted loop                       // boolean attrs
          preload="metadata"
          _hlsConfig, envKey, metadata, disableCookies
          disableTracking={false}                   // override wrapper default
          onLoadedMetadata, onCanPlay
          onError → standard Event; map err.code
        />

         play() .catch(NotAllowedError ⇒ autoplayBlocked = true)   // replaces detail.code path
```

Ref consumer chain is untouched: `setPlayerRef` accepts either, downstream code calls only `HTMLMediaElement` methods.

## Implementation Units

- [ ] **Unit 1: Inventory + parity verification**

**Goal:** Confirm the migration surface is exactly what the planning research described — no SeriesPageClient surprise, no extra MuxPlayer callsite, no shadow-DOM dependency that breaks under MuxVideo.

**Requirements:** R3, R6

**Dependencies:** None

**Files:**

- Read: `apps/web/src/components/watch/HeroPlayer.tsx`, `HeroPlayerControls.tsx`, `SubtitleOverlay.tsx`, `LanguagePickerModal.tsx`, `WatchPageClient.tsx`, `SeriesPageClient.tsx`, `WatchSectionRenderer.tsx`
- Read: `apps/web/src/components/watch/__tests__/MuxPlayerSpike.test.tsx`

**Approach:**

- Verify every prop in HeroPlayer.tsx:582-630 has a MuxVideo equivalent.
- Verify HeroPlayer.tsx:142-148 shadow-DOM piercing falls back to direct `el.textTracks` (it does; line 146 has `??`).
- Decide whether SeriesPageClient renders a MuxPlayer or only types-through. If it renders, include in U3 dual-mount.

**Patterns to follow:**

- Run `rg -n "MuxPlayer|@mux/mux-player" apps/web` for completeness; cross-reference with the research inventory.

**Test scenarios:** N/A — investigation only.

**Verification:**

- A short written confirmation appended to this plan's "Resolved During Planning" section noting any deviations from the research inventory.

- [ ] **Unit 2: Add `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` env flag**

**Goal:** Wire a new boolean flag with the same shape as `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION`. Flag-off is the existing behavior.

**Requirements:** R7

**Dependencies:** None

**Files:**

- Modify: `apps/web/src/env.ts` (add Zod schema entry + `runtimeEnv` mapping)
- Modify: `apps/web/.env.example` (document the flag)
- Test: `apps/web/src/env.test.ts` if one exists, otherwise no new test (env parsing has implicit coverage via `next build`)

**Approach:**

- Match the existing flag's exact shape: `z.coerce.boolean().default(false)`.
- The runtime check site (HeroPlayer.tsx) will read `env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` directly — no provider, no context.

**Patterns to follow:**

- `apps/web/src/env.ts:110` (existing flag declaration)
- `apps/web/src/components/sections/CarouselVideo.tsx:462` (consumer pattern: `if (env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION) { ... }`)

**Test scenarios:**

- Default (no env var set): flag is `false`, MuxPlayer path renders.
- `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO=true`: flag is `true`, MuxVideo path renders.

**Verification:**

- `pnpm --filter @forge/web exec next build` succeeds with and without the env var set.
- Existing env-related tests (if any) still pass.

- [ ] **Unit 3: Dual-mount HeroPlayer with flag-gated MuxVideo branch**

**Goal:** Inside `HeroPlayer.tsx`, branch on `env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO`. Flag-off renders the current `<MuxPlayer>`. Flag-on renders `<MuxVideo>` with parity props.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R8

**Dependencies:** Unit 2

**Files:**

- Modify: `apps/web/src/components/watch/HeroPlayer.tsx`
- Test: `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` (extend, see U4)

**Approach:**

- Add a new `MuxVideo` import alongside the existing `MuxPlayer` from `@forge/video-player`.
- Define a parallel `MUX_VIDEO_OBJECT_FIT_PRE_REVEAL` / `_REVEALED` pair using plain `CSSProperties` (`{ objectFit: "cover" }` / `{ objectFit: "contain" }`).
- Extract the shared event-handler set (`handleCanPlay`, `handleLoadedMetadata`, `handlePlayerError`, `setPlayerRef`, etc.) so both render paths reuse them.
- For `<MuxVideo>`:
  - `autoPlay`, `muted`, `loop`, `preload="metadata"` (boolean attrs).
  - `playbackId` + `src` (when no playbackId) identical to current.
  - `poster="${playbackId}/thumbnail.webp?width=1280"` so the preload URL matches and the LCP `<img>` is in light DOM.
  - `_hlsConfig`, `envKey`, `metadata`, `disableCookies` identical to current.
  - `disableTracking={false}` to override the wrapper default and preserve Mux Data attribution.
  - `style={{ ...(chromeRevealed ? REVEALED_VIDEO : PRE_REVEAL_VIDEO) }}` — no chrome-hide vars, no `MuxCSSProperties`.
  - `onError`: receives plain `Event`. Drop the `detail.code === "autoplay-blocked"` branch; only the generic error escape (set `videoReady=true`) remains.
- Adjust the existing `play().catch(...)` handlers at lines 417, 450, 463 to detect `err.name === "NotAllowedError"` and set `autoplayBlocked = true`. This unifies the autoplay-block path across both branches.
- Leave the shadow-DOM access at line 142-148 untouched — the `el.shadowRoot?.querySelector(...)` returns null for `<mux-video>` (no shadow root) and the existing `??` fallback to direct `el.textTracks` covers it.

**Execution note:** Test-first on the flag-on branch — add `__tests__/HeroPlayer.test.tsx` cases that mount with the flag flipped before changing the production code. The render-shape contract is well understood (props + ref surface from U1 inventory); a failing test for the MuxVideo path is the right anchor.

**Patterns to follow:**

- [apps/web/src/components/sections/CarouselVideo.tsx:462](../../apps/web/src/components/sections/CarouselVideo.tsx) (flag branch shape)
- [apps/web/src/components/sections/VideoHero.tsx:184](../../apps/web/src/components/sections/VideoHero.tsx) (`<MuxVideo>` prop usage with `envKey` + `metadata`)
- [docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md](../solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md) — every load-bearing piece for the surrounding chrome.

**Test scenarios:**

- Flag-off: existing tests pass unchanged.
- Flag-on, render: `<mux-video>` custom element mounts with `playbackId`, `poster`, `autoPlay`, `muted`, `loop`, `preload="metadata"`, `disableTracking={false}`.
- Flag-on, `onCanPlay`: `videoReady` flips to `true`, spinner overlay unmounts.
- Flag-on, `play()` rejects with `NotAllowedError`: `autoplayBlocked` flips to `true`, pill UI updates.
- Flag-on, variant change: `videoReady` resets to `false` in the render phase (React Compiler rule).
- Flag-on, language-switch event: same dispatch handler still mutes/seeks; smoke-test via the existing test helper.

**Verification:**

- Both branches in `HeroPlayer.test.tsx` are green.
- `pnpm --filter @forge/web exec tsc --noEmit` clean.
- `pnpm --filter @forge/web exec eslint .` clean (React Compiler rule especially).

- [ ] **Unit 4: Extend HeroPlayer / Controls / LanguagePicker test mocks for MuxVideo**

**Goal:** The existing `muxPlayerMock` in `HeroPlayer.test.tsx` captures props from `<MuxPlayer>` and exposes `fireCanPlay()` / `fireError({ code })`. Add a parallel `muxVideoMock` that captures `<MuxVideo>` props and exposes `fireCanPlay()` / `fireErrorEvent()` (plain `Event`, not `CustomEvent`). Run the existing behavior suite under both mocks via a `describe.each` or two parallel `describe` blocks.

**Requirements:** R3, R6, R7

**Dependencies:** Unit 3

**Files:**

- Modify: `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` (parallel MuxVideo coverage)
- Modify: `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx` (`makePlayer()` factory continues to return an `HTMLMediaElement`-shaped stub — no change needed; double-check `addEventListener` parity)
- Modify: `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` (current `{ currentTime }` stub already type-compatible — verify; no behavioral change expected)

**Approach:**

- Hoist the per-test environment toggle behind a helper that flips `env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` via the existing `MutableEnv` cast pattern (`VideoHero.test.tsx:40,48,52` is the precedent).
- The Mux Data attribution assertion: `expect(lastMuxVideoProps()).toMatchObject({ envKey: ..., metadata: { player_name: "forge-web-watch", video_title: ..., video_id: ..., viewer_user_id: ... }, disableTracking: false })`.
- Mock both `@forge/video-player`'s `MuxPlayer` AND `MuxVideo` exports.

**Patterns to follow:**

- [apps/web/src/components/sections/**tests**/VideoHero.test.tsx:40,48,52](../../apps/web/src/components/sections/__tests__/VideoHero.test.tsx) — `MutableEnv` cast for flag toggling.
- The existing `muxPlayerMock` factory in `HeroPlayer.test.tsx` — replicate its callback-capture shape for `MuxVideo`.

**Test scenarios:**

- Flag-on autoplay-muted on mount.
- Flag-on `onCanPlay` flips spinner state.
- Flag-on `onError` (plain Event, `target.error.code = MediaError.MEDIA_ERR_DECODE`) escapes the spinner without setting `autoplayBlocked`.
- Flag-on `play()` rejection with `NotAllowedError` sets `autoplayBlocked = true`.
- Flag-on `metadata` + `envKey` forwarded to `<MuxVideo>` for Mux Data attribution.
- Flag-on language-switch event continues to mute + seek.

**Verification:**

- `pnpm --filter @forge/web exec vitest run watch/HeroPlayer watch/HeroPlayerControls watch/LanguagePickerModal` green.
- Snapshot of captured `MuxVideo` props matches the documented prop inventory.

- [ ] **Unit 5: Real-stack smoke + Lighthouse re-baseline**

**Goal:** Verify R1, R2, R4, R5, R8 in a real production build with the flag on. Compare to a recorded flag-off baseline.

**Requirements:** R1, R2, R4, R5, R8

**Dependencies:** Unit 3, Unit 4

**Files:**

- No code changes. Generates a result document attached to the PR.

**Approach:**

- Build twice (flag-off and flag-on) against the same admin endpoint.
- For each: run Lighthouse mobile-sim 5× against `/watch/11-has-the-universe-always-existed/hindi`; capture median score, LCP, TBT, FCP, SI, total script transfer size, count of Mux video segments, presence/absence of `gstatic.com` requests.
- For each: run Lighthouse desktop unthrottled once; capture LCP, TBT.
- Capture a Chrome DevTools MCP screenshot at 360×800 and 1280×800 mid-loading and at videoReady. Compare visual.
- Verify a Mux Data beacon fires from the flag-on build — open DevTools Network, filter `mux.com`, confirm `viewer_user_id` + `video_id` payload matches the metadata prop.
- Verify ≤ 10 video segments fetched on initial load (R5).
- Verify zero `gstatic.com` requests on the flag-on build (R2).

**Patterns to follow:**

- The measurement methodology from the perf-iteration conversation that produced this plan: 5× simulated mobile + 1× desktop, segment count + transfer size pulled from `network-requests`.

**Test scenarios:** N/A — measurement.

**Verification:**

- Lighthouse mobile-sim median score is ≥ flag-off median (regression check). Realistic target: +5 to +10 points.
- Lighthouse mobile-sim Script transfer drops by ≥ 350 KB.
- Zero `gstatic.com` entries.
- Manual visual diff at the two viewports shows no perceptible difference outside the loading window.
- Mux Data beacon contains expected fields.

- [ ] **Unit 6: Documentation and rollout notes**

**Goal:** Update package guidance and add a one-page solution doc capturing the swap rationale + the autoplay-blocked path divergence.

**Requirements:** Operational

**Dependencies:** Unit 5

**Files:**

- Modify: [packages/video-player/CLAUDE.md](../../packages/video-player/CLAUDE.md) — update the dual-API rules + sunset criterion. The hero is now a MuxVideo consumer when the flag is on. The mux-player-react dep removal target shifts from "after `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION`" to "after `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` has been `true` in production for one stable release AND the existing player migration flag has graduated."
- Modify: [apps/web/CLAUDE.md](../../apps/web/CLAUDE.md) — note the new flag in the same section that documents `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION`.
- Modify: [docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md](../solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md) — append a section noting that on MuxVideo, piece #1 (chrome hiding) is a no-op and the autoplay-blocked detection moves to `play()` Promise rejection.
- Create: `docs/solutions/performance-issues/watch-hero-muxvideo-swap-YYYYMMDD.md` capturing the migration, the bundle-size delta, the autoplay-block detection rewire, and the feature-flag rollout shape.

**Approach:**

- Keep solution doc under 150 lines. Lead with the bundle-size diff and the "chrome was already React-rendered, so this was free" framing.

**Test scenarios:** N/A — docs only.

**Verification:**

- A new contributor reading `apps/web/CLAUDE.md` understands which player the hero is using under which flag state.
- The solution doc is searchable under the `mux-video` + `lcp` + `hls` tags.

- [ ] **Unit 7: Rollout + monitoring** _(optional follow-up, not blocking the PR)_

**Goal:** Enable the flag in staging, monitor for a release, then enable in prod.

**Requirements:** R7

**Dependencies:** Unit 5, Unit 6

**Files:**

- None in repo. Railway env-var changes only.

**Approach:**

- Set `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO=true` in staging. Observe Mux Data dashboard for any drop in beacon volume on the watch surface (vs. baseline week). Watch error rates in any frontend telemetry.
- After one stable release: set the flag to `true` in production.
- After one stable release in prod: open a follow-up PR removing the `<MuxPlayer>` branch from `HeroPlayer.tsx` and dropping `@mux/mux-player-react` from `apps/web/package.json` (keep in `packages/video-player/package.json` until the wrapper is sunset).

**Patterns to follow:**

- The existing `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` rollout cadence.

**Test scenarios:** N/A.

**Verification:**

- Staging Mux Data dashboard shows continuous beaconing for the watch surface.
- Frontend error rate on the watch route does not regress.

## System-Wide Impact

- **Interaction graph:** The `MuxPlayerRef` type flows through 7 files (HeroPlayer, HeroPlayerControls, SubtitleOverlay, LanguagePickerModal, WatchPageClient, SeriesPageClient, WatchSectionRenderer). All seven only touch standard `HTMLMediaElement` API surface, so a future ref-type unification (`type WatchPlayerRef = MuxPlayerRef | MuxVideoRef`) is safe but not required for this plan to land.
- **Error propagation:** `onError` shape diverges between the two players (CustomEvent vs Event). The shared `handlePlayerError` function must accept either; type narrows internally. The `play()` Promise `.catch` chain takes over autoplay-blocked detection — already a robust pattern, just wider applicability.
- **State lifecycle risks:** None new. `videoReady` reset on variant change stays render-phase (React Compiler rule). Spinner overlay stays in place. No remount triggered by the flag switch within a session — flag is build-time only.
- **API surface parity:** `MuxPlayerRef` and `MuxVideoRef` differ in their static type but their consumed surface (HTMLMediaElement methods + properties) is identical at runtime. Cast points in `SubtitleOverlay.tsx:129` become actual matches under MuxVideo.
- **Integration coverage:** Unit tests with vitest + jsdom verify branch-shape and prop-forwarding but cannot exercise real HLS playback or Mux Data beacons. U5 covers the real-stack gaps.

## Risks & Dependencies

- **Risk: Mux Data attribution drops or shape-shifts under MuxVideo.** _Mitigation:_ U4 assertion + U5 real-stack beacon check. The `metadata` prop is documented on MuxMediaProps; mux-video-react has shipped Mux Data for several versions.
- **Risk: iOS Safari autoplay-blocked classification differs.** _Mitigation:_ U5 device check. The `play()` rejection path is the W3C-standard signal and is what Mux Player's internal autoplay-blocked detection wraps anyway. Worst case: keep both detection paths.
- **Risk: Shadow-DOM piercing at HeroPlayer.tsx:142-148 silently fails.** _Mitigation:_ The `??` fallback at line 146 catches it; verify in U3 that the fallback is exercised under flag-on.
- **Risk: HLS buffer config `_hlsConfig` not honored by mux-video-react.** _Mitigation:_ U5 segment-count check (R5 verifier). Type accepts the prop; the playback-core implementation is shared between mux-player and mux-video.
- **Risk: Visual regression on first-frame paint when poster transitions to video.** _Mitigation:_ The bg-black overlay covers the transition until `canPlay`; the user never sees the moment of poster→video swap. Same as today. U5 visual diff.
- **Risk: `_hlsConfig` is a Mux-internal prefix (leading underscore implies private). The shape may change without semver guarantees.** _Mitigation:_ Pin the mux-video-react minor version; add a follow-up to revisit if Mux promotes a public HLS-config API.
- **Dependency:** No external dependencies. The flag, code, and tests all land in the same PR. Rollout is operator-driven via Railway env vars.

## Documentation / Operational Notes

- The new flag joins `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` as the second hero-player-related toggle. Watch-page CLAUDE.md should call out that the flags compose: `FORGE_WATCH_PLAYER_MIGRATION` controls section players (Video / VideoHero / CarouselVideo); the new flag controls the HeroPlayer surface.
- Mux Data dashboard is the production canary for R4. The first week post-rollout, watch `player_name = "forge-web-watch"` beacon volume.
- Railway env-var rollout: staging first, then prod, one stable release apart. Reverse via env-var flip if any regression — no deploy required.
- Follow-up after stable: a separate PR removes the flag-off branch + the `@mux/mux-player-react` direct dep from `apps/web/package.json`. Keep it in `packages/video-player` until the wrapper is sunset per its own criterion.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-29-watch-page-mux-parity-requirements.md](../brainstorms/2026-04-29-watch-page-mux-parity-requirements.md) (this plan partially reverses the origin's hero-player choice; non-hero `<MuxVideo>` surfaces are unchanged.)
- Related solution: [docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md](../solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md)
- Related solution: [docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md](../solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md)
- Existing flag pattern: [apps/web/src/env.ts:110](../../apps/web/src/env.ts) (`NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION`)
- Existing MuxVideo prop shape: [apps/web/src/components/sections/VideoHero.tsx:184](../../apps/web/src/components/sections/VideoHero.tsx)
- Existing MuxPlayer call: [apps/web/src/components/watch/HeroPlayer.tsx:582-630](../../apps/web/src/components/watch/HeroPlayer.tsx)
- MuxMediaProps surface: `node_modules/.pnpm/@mux+playback-core@*/dist/types/types.d.ts` (confirms `_hlsConfig`, `envKey`, `metadata`, `disableTracking`, `disableCookies`, `preferPlayback` on MuxVideo).
- Existing dual-flag consumer pattern: [apps/web/src/components/sections/CarouselVideo.tsx:462](../../apps/web/src/components/sections/CarouselVideo.tsx)
- Spike-test precedent for both backends coexisting: [apps/web/src/components/watch/**tests**/MuxPlayerSpike.test.tsx](../../apps/web/src/components/watch/__tests__/MuxPlayerSpike.test.tsx)
