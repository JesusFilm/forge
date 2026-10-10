# TV Mux animated hover-previews for video thumbnails — design

- **Date:** 2026-07-13
- **Owner:** urim
- **Status:** approved design → ready for implementation plan
- **Scope:** `apps/tv` only. No `apps/admin` changes. No `packages/*` changes.

## Problem

On the TV app, a focused video thumbnail is static. We want a YouTube-hover-style
short preview: when a **video** (not series) thumbnail holds D-pad focus and rests
briefly, it plays a short, silent Mux animated clip in place — across home rails,
the Up Next carousel, series episode cards, the SDUI Experience cards, and search
results. Mux exposes an animated image endpoint
(`image.mux.com/{playbackId}/animated.webp`) that makes this a small, decoder-safe
image swap rather than a second video player.

## Goal

A focused, dwelled video card crossfades a looping Mux `animated.webp` over its
static poster; on blur the preview tears down and the poster shows instantly.
Series/collection cards and cards with no playback id never preview.

## Decision: reuse web's content layer, build a TV-native trigger/lifecycle

`apps/web` already ships this feature (shared `MuxHoverPreview` +
`resolveMuxAnimatedPreviewUrl` in `apps/web/src/lib/url.ts`). We split along a
clean line: **what to fetch and how to crossfade it** is platform-identical and is
copied verbatim (kept in sync); **how activation is triggered and torn down** is
platform-specific and web's model is wrong for TV.

| Concern          | Web (`apps/web`)                                                                                                                | TV decision                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| URL builder      | `image.mux.com/{id}/animated.webp?start=2&end=6&width=448&fps=8`, unsigned/public, `encodeURIComponent`+`.trim()`+null-on-empty | **Mirror the builder shape** in `apps/tv/src/lib/muxUrl.ts`; **TV-tune the params** (diverge from web), dialed in on the spike |
| Signing          | None (public URL)                                                                                                               | **None** — same public URL, zero token plumbing                                                                                |
| Medium           | `animated.webp` via `next/image unoptimized`                                                                                    | `animated.webp` via **`expo-image`** (feasibility spike first)                                                                 |
| Crossfade        | poster persists; preview opacity 0→1 on its own `onLoad`                                                                        | **Same idea**, rebuilt with RN `Animated` (no CSS)                                                                             |
| Composition      | absolute overlay above poster                                                                                                   | **Same** — absolute-fill `<Image>` over poster                                                                                 |
| Trigger          | `pointerenter` + `focus`, CSS `group-hover`                                                                                     | **D-pad `onFocus`** only (no pointer/CSS on tvOS)                                                                              |
| Dwell            | none (immediate)                                                                                                                | **~400ms dwell** (D-pad sweeps rails; immediate would thrash)                                                                  |
| Teardown         | **latches** — every visited card keeps decoding forever                                                                         | **Deactivate on blur/unmount** (inverted) → one preview at a time by construction                                              |
| Reduced motion   | none (a gap)                                                                                                                    | **Respect** `AccessibilityInfo.isReduceMotionEnabled()`                                                                        |
| Series exclusion | previews everything                                                                                                             | **Skip series/collection** (and null-id) cards                                                                                 |

## Architecture

Three units, each independently testable:

### 1. URL builder — `getMuxAnimatedPreviewUrl(playbackId, opts?): string | null`

- New export in `apps/tv/src/lib/muxUrl.ts`, beside `muxHlsUrlFromPlaybackId`.
- Builder _shape_ mirrors web's `resolveMuxAnimatedPreviewUrl`: `.trim()` the id,
  return `null` on empty, else
  `https://image.mux.com/${encodeURIComponent(id)}/animated.webp?start=…&end=…&width=…&fps=…`.
- **Params are TV-tuned, not web's** — the values (`width`/`fps`/clip window) are
  intentionally larger/smoother for a 10-foot, big-card surface and are exposed as
  an `opts` object so the spike can sweep them without code churn.
- **TV-tuned starting defaults (validated & finalized on the spike):**
  `width=640` (up from web's 448 — sharper on a 32:15 card), `fps=12` (up from 8 —
  smoother lean-back motion, still bounded for Android TV), `start=2&end=6` (4s
  loop, skip the title card). These are a starting point, not final.
- Header comment notes the deliberate divergence from web
  (`resolveMuxAnimatedPreviewUrl`) and _why_ — so a future reader doesn't "resync"
  it back to web's numbers.

### 2. Timing/gating hook — `useHoverPreview({ focused, playbackId, enabled }) → previewUrl | null`

- Encapsulates the **dwell + activation + deactivation** state machine.
- On `focused` becoming true and `enabled`: start a trailing ~400ms timer (reuse
  the `createShowcaseFocusDebouncer` shape already in `home/showcaseState.ts`).
- On timer fire: return `getMuxAnimatedPreviewUrl(playbackId)`.
- On `focused` false, `enabled` false, unmount, **or screen blur**: clear the
  timer and return `null` (mirrors the showcase's cancel-on-unmount-and-blur
  discipline in `app/index.tsx` so a pending timer never fires into a backgrounded
  screen).
- `enabled = !isSeriesShaped && !!playbackId && !reduceMotion`.
- Does **not** latch: leaving a card returns `null`, so the preview `<Image>`
  unmounts and frees its decode/memory. Only the single focused card ever decodes.

### 3. Presentational overlay — `<HoverPreviewImage previewUrl posterStyle contentFit />`

- Renders nothing when `previewUrl` is null.
- When present: an absolute-fill `expo-image` `<Image source={previewUrl}>` above
  the poster, starting at opacity 0, animated to 1 (RN `Animated`, native driver)
  **only on `onLoad`** — so the poster shows through until the webp decodes.
- Uses the **same `contentFit` and frame** as the card's poster so the crossfade
  doesn't jump (TV posters are `32:15` `cover`; the animated asset is native ~16:9,
  so both must `cover`-crop identically).

## Data flow (Option A — thread the playback id, no per-focus fetch)

| Surface         | Card                                                            | playbackId source                                                                                               | Change                                                           |
| --------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Home rails      | `HomeCard` (`WatchHomeCard`)                                    | `MediaCollectionItem.muxPlaybackId` — **already fetched** in the Experience payload; the TV adapter discards it | Read it in `experienceAdapter.ts` → add to `WatchHomeCard` model |
| Up Next         | `ThumbCard` via `UpNextRail` (`WatchSibling`)                   | Add `muxPlaybackId` to `parents.children` in `videoQueries.ts`                                                  | Query + `WatchSibling` type + `ThumbCard` prop                   |
| Series episodes | `ThumbCard` via `EpisodeRail` (`WatchEpisode`)                  | Add `muxPlaybackId` to `GET_SERIES_BY_SLUG` children                                                            | Query + `WatchEpisode` type + `ThumbCard` prop                   |
| Search          | `ResultCard` (`SearchResult`)                                   | `SearchResult.playbackId` — **already present**                                                                 | Wire hook only                                                   |
| SDUI Experience | `VideoCardRenderer` / `VideoCarouselRenderer` (`FocusableCard`) | `section/item.streamingUrl` → `extractMuxPlaybackId`                                                            | Wire hook only                                                   |

`Video.muxPlaybackId(languageSlug)` / `MediaCollectionItem.muxPlaybackId` /
`HybridSearchResult.playbackId` **already exist** in admin's public schema (built
for the static Mux thumbnails). Selecting `muxPlaybackId` on child `Video` nodes
uses that purpose-built resolver field — one nullable string per child, **not** a
dubs projection — so no admin change, no `schema:print`, no admin-graphql drift.
The guarded 9.5MB bulk-home query is untouched (these are the `/watch` + `/series`
detail queries).

`ThumbCard` (primitives-only) gains one optional prop `previewPlaybackId?: string
| null`. Each rail reuses its **existing** video/series decision to populate it:
`EpisodeRail` passes `isNestedSeries ? null : episode.muxPlaybackId`; `UpNextRail`
passes `sibling.muxPlaybackId` (series-shaped siblings carry null id anyway).
`HomeCard`/`ResultCard` run the hook internally against their model + existing
`isSeriesSearchResult` check.

## Decoder safety (the reason this is an image, not a video)

A Mux `animated.webp` is an image texture, not an `AVPlayer` — it consumes **no
tvOS hardware decode slot**, so it never contends with the hero `VideoBackdrop` or
the fullscreen `VideoPlayer` (KTD4). Because the hook deactivates on blur, at most
one preview (the focused card's) is ever mounted. This is the decisive advantage
over a per-card muted `expo-video`, which would multiply decode slots or churn
release/recreate black-frames on source swap.

## Performance & cost

- **Dwell gating** means a Mux animated image is fetched only after focus _rests_
  ~400ms — not for every card the D-pad passes. Bounds Mux request volume (billed
  per image).
- Small capped asset (web's `width=448`, `fps=8`, 4s) keeps bytes and decode low.
- `expo-image` caches by URL → re-focusing a recent card is instant.
- Android TV weak SoC: off-focus previews unmount; keep an Android disable path
  ready if on-device measurement shows jank.
- Mirror web's `image.mux.com` connection warm as an early `expo-image` prefetch.

## Series exclusion

`enabled = !isSeriesShaped && ...`. Series/COLLECTION parents return a null
`muxPlaybackId` from admin anyway, so exclusion is double-safe and enforces the
"video thumbnails, not series thumbnails" rule structurally.

## Feasibility spike (FIRST implementation step)

Before any data threading, the spike does two things and gates the rest of the plan:

1. **Validate the medium.** Verify `expo-image` actually **animates** a Mux
   `animated.webp` on a tvOS simulator **and** an Android TV emulator (SDWebImage /
   Glide should, but a stuck first-frame is a plausible failure). Fallbacks, in
   order: (a) switch the medium to `animated.gif` (broader coder support); (b) as a
   last resort, a single mount-gated muted `expo-video` reusing `VideoBackdrop`
   discipline (heavier, decoder budget). If (a)/(b) both fail, the feature is
   descoped, not forced.
2. **Dial in the TV-tuned params.** On real tvOS + Android TV hardware, sweep
   `width` / `fps` / clip window from the starting defaults (`640` / `12` /
   `start=2&end=6`) and pick the largest values that stay smooth and within a
   sane byte/decode budget on the weakest target (Android TV). **Record the chosen
   values** as the builder's defaults.

## Testing

- **URL builder** (unit): valid id → exact web-matched URL; empty/whitespace →
  null; id is `encodeURIComponent`-escaped.
- **`useHoverPreview`** (unit): activates only after the dwell delay; returns null
  when `enabled` false, `playbackId` null, or reduce-motion on; clears on blur,
  unmount, and screen blur; rapid focus/blur within the dwell never activates.
- **Adapter/normalizer** (unit): `muxPlaybackId` threaded onto `WatchHomeCard`,
  `WatchSibling`, `WatchEpisode`; null-safe.
- **On-device** (per the TV sim-verify rule + the frontend page-load-perf rule):
  TV Metro on 8082, deep-link `/watch/the-birth-of-jesus`, rest on an Up Next card,
  confirm the preview animates and crossfades; **cold-relaunch** to avoid
  Fast-Refresh zombie-player false signals; capture a GIF; confirm the hero
  `VideoBackdrop` playback did not regress; include timing evidence since this
  touches rendering.

## Out of scope

- No audio (Mux animated is silent — matches the YouTube-hover convention).
- No per-card video players (decoder budget).
- No `apps/admin` changes; no new GraphQL fields.
- No previews on series/collection cards, nor on config-fallback home cards that
  lack a playback id (graceful skip).
- The `/watch` **hero** already has its own higher-fidelity muted `VideoBackdrop`
  preview; "video details page" is covered by its Up Next rail. The hero is not
  touched.

## Open risks

- **expo-image animated-webp on tvOS/Android TV** — gated by the spike above.
- **Poster/preview crop parity** — the animated overlay must share the poster's
  `contentFit`/frame or the crossfade jumps.
- **Android TV focus delivery** rides `patches/react-native-tvos@0.81.5-2.patch`;
  a future RN-tvos bump that regenerates the patch would break the focus trigger
  (same dependency as all existing TV focus visuals).
