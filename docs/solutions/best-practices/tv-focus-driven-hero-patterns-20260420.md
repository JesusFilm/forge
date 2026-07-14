---
title: TV focus-driven hero patterns — non-interactive hero, rail owns focus, poster-hold during HLS swap
date: 2026-04-20
last_refreshed: 2026-06-19
category: docs/solutions/best-practices
module: apps/tv
problem_type: best_practice
component: frontend_stimulus
severity: high
applies_when:
  - Building a TV surface (tvOS + Android TV) with a background video/image hero that reacts to focus state elsewhere on screen
  - Using expo-video VideoView alongside focusable React Native views on Android TV or tvOS
  - Routing D-pad focus between a header, hero, and horizontal rail with TVFocusGuideView
  - Consuming gql.tada dynamic-zone discriminated unions via Extract<Union, { __typename: "X" }>
  - Swapping an HLS source at runtime in response to focus or selection changes
tags:
  - tv
  - android-tv
  - tvos
  - expo-video
  - focus
  - tvfocusguideview
  - gql-tada
  - sdui
related_components:
  - apps/tv/src/components/ContentRail.tsx
  - apps/tv/src/components/sections/VideoHeroRenderer.tsx
  - apps/tv/app/index.tsx
  - apps/tv/src/lib/queries.ts
---

# TV focus-driven hero patterns — non-interactive hero, rail owns focus, poster-hold during HLS swap

## Context

> **Update (2026-06-15):** the TV home was later redesigned — the video-preview hero in `HomeHero.tsx` (now removed) became an **image-only** billboard + ambient backdrop (`HomeBillboard.tsx` + `HomeBackdrop.tsx`), so the home no longer exercises Section 2's `expo-video` poster-hold / HLS-swap patterns. Those video patterns now apply to the surviving video surfaces — the watch screen's `VideoBackdrop` and the `/experience` `VideoHeroRenderer`. The focus patterns below (non-interactive media layer, rail-owns-focus, debounce, `TVFocusGuideView` destinations, close-over-item, `collapsable={false}`) remain valid and are embodied in the redesigned home. For the image backdrop's own crossfade gotcha and the home's scroll model, see `docs/solutions/ui-bugs/tv-home-backdrop-crossfade-aba-stall-20260615.md` and `docs/solutions/design-patterns/tv-home-row-anchored-scroll-native-focus-scroll-disabled-20260615.md`.

> **Update (2026-06-19):** the home hero was later **re-interactivated**. `HomeBillboard` is now driven by `HomeHeroCarousel.tsx` — a paged carousel with a focusable **See more** CTA + next-slide chevron — so the rail no longer owns 100% of home focus. Section 1's "background media-driven heroes must be fully non-interactive / rail owns 100% focus" rule now scopes to surfaces with a background `expo-video` `VideoView` (the thing that hijacks focus); the **image-only** home hero has no video to hijack, so an interactive CTA is safe. The §1 `HomeHero.tsx` snippet below is historical (that file is removed). For how the re-interactivated hero bridges D-pad Up/Down to the sticky top bar — `nextFocusUp` on the hero buttons (Up) + a `TVFocusGuideView destinations` (Down) — see `docs/solutions/design-patterns/tv-sticky-header-nextfocus-asymmetry-bridge-20260619.md`. That doc also shows Section 3's "destinations must be siblings, not descendants" is a **per-instance check, not a blanket prohibition**: the re-interactivated hero's guide uses a _descendant_ `ctaNode` destination and works single-press (matching `MissionSection`).

The TV home hero (top ~55% of the screen on Apple TV + Android TV) was hardcoded to a single Experience. We reworked it so the hero tracks whichever Experience card is focused in the rail below, swapping the hero's poster, title, subtitle, and HLS video to match the focused card — a standard 10-foot "browse with a background preview" pattern.

The first implementation kept the hero's **Explore** CTA as an interactive element that had to coexist with a focusable horizontal rail below and a native `expo-video` `VideoView` painting HLS in the background. That combination is a minefield on both platforms:

- **Android TV**: `VideoView` is a `SurfaceView` that punches through the RN view hierarchy via the native compositor. Focusable siblings above it can be hidden, and the surface itself captures D-pad events the focus engine would otherwise route elsewhere.
- **tvOS**: the focus engine treats any view currently painting significant pixel activity (like an `AVPlayerLayer`) as a focus candidate, regardless of `focusable={false}`, `pointerEvents="none"`, or `isTVSelectable={false}`.

After ~7 iterations of focus-routing fixes (see "What we tried before it worked"), we pivoted: **remove the interactive Explore CTA from the hero entirely, make the hero purely presentational, and let the rail own 100% of focus on the home screen.** Users D-pad the rail and press Select to open the focused experience. Shipped in [PR #803](https://github.com/JesusFilm/forge/pull/803) on `feat/tv-focus-driven-hero`.

This doc captures seven patterns that came out of that work. Several supersede prior guidance in adjacent solution docs — see **Related** at the bottom.

## Guidance

### 1. Background media-driven heroes on TV must be fully non-interactive

If a background hero on a TV surface reacts to focus state elsewhere (a rail, a filter bar, etc.), make the hero subtree **entirely non-focusable**:

- No `Pressable`, no `focusable`, no `hasTVPreferredFocus` anywhere in the hero subtree.
- Mark media wrappers `pointerEvents="none"`. Focus events don't apply on TV, but this documents intent and plays nicely with Reanimated.
- The adjacent region that owns selection (the rail) owns 100% of focus. Its `TVFocusGuideView` uses `autoFocus` to claim initial focus on first render.
- Users navigate via the rail; pressing Select on a card either opens the experience or triggers whatever action the hero CTA used to perform.

From `apps/tv/src/components/HomeHero.tsx`:

```tsx
/**
 * TV home hero with stacked-layer crossfade.
 *
 * Purely presentational — the hero displays the currently focused
 * experience's video/image/title/subtitle but is NOT interactive.
 * Focus on the home screen lives entirely on the rail below; the
 * user navigates experiences by D-padding through cards and pressing
 * Select to open the focused experience.
 */
type HomeHeroProps = { hero: HomeHeroData | null }

export function HomeHero({ hero }: HomeHeroProps) {
  // ...crossfade bookkeeping, no focus concerns...
  return (
    <View style={styles.container} accessibilityRole="header">
      {entries.map(entry => (
        <Animated.View key={entry.hero.id} pointerEvents="none" ...>
          <MediaLayer hero={entry.hero} isActive={...} reduceMotion={...} />
        </Animated.View>
      ))}
      <LinearGradient ... pointerEvents="none" collapsable={false} />
      <View style={styles.textContainer} pointerEvents="none" collapsable={false}>
        {/* Title + subtitle */}
      </View>
    </View>
  )
}
```

### 2. Poster-hold during HLS source swaps

Swapping a `VideoView`'s `streamingUrl` produces a **black flash** for 200–800ms while HLS loads the manifest and decodes the first frame. On Android TV this cannot be covered by an overlay because of `SurfaceView` z-order.

Pattern:

1. Always paint a base `<Image>` poster layer first, below the video.
2. Only mount `<VideoView>` once the player reports `readyToPlay` via `addListener('statusChange', ...)`.
3. Once ready, hold the poster visible for `POSTER_HOLD_MS` (500ms worked for us, started at 1000ms) then crossfade the video in over `POSTER_FADE_MS`.
4. Honor `AccessibilityInfo.isReduceMotionEnabled()` — snap instead of animating when motion is reduced.
5. For **crossfades between heroes**: key the layer stack by `hero.id` so React preserves the outgoing `MediaLayer` subtree across commits, and `player.pause()` (not stop/unmount) the outgoing player so its last frame freezes rather than reverting to its own poster.
6. Bound the entries array to `<= 2`. tvOS caps concurrent `AVPlayer` instances at ~3; rapid D-padding otherwise starves the new decoder and renders black.

See `apps/tv/src/components/HomeHero.tsx` for the stacked-layer crossfade and the poster-hold `Animated.sequence`.

The **image-only** two-slot variant (an `expo-image` backdrop crossfade, no video) has its own trap: keying each slot's `<Image>` by URL means returning to an already-loaded slot never re-fires `onLoad`, so a fade gated on `onLoad` stalls. See `docs/solutions/ui-bugs/tv-home-backdrop-crossfade-aba-stall-20260615.md`.

### 3. `TVFocusGuideView` destinations must be siblings of the guide, not descendants

`TVFocusGuideView` redirects focus attempts **into** its frame toward its configured destinations. If the destination `Pressable` is rendered **inside** the guide, the guide's own bounds also absorb the destination's **outbound** focus events — typically manifesting as "one D-pad press gets absorbed, second press works."

Rule: the guide wraps the **non-focusable region you want to redirect away from**. The destination lives outside, as a sibling. We tried the opposite arrangement repeatedly and it never stabilized.

### 4. Debounce focus-driven state commits

Committing hero state on every micro-focus event thrashes during fast D-pad traversal (and blows past `AVPlayer` instance caps on tvOS). Use a **trailing-only** debounce:

```tsx
const FOCUS_DEBOUNCE_MS = 300

const handleItemFocus = useCallback((_index: number, item: Experience) => {
  if (debounceTimer.current) clearTimeout(debounceTimer.current)
  debounceTimer.current = setTimeout(() => {
    setCommittedId(item.documentId)
    debounceTimer.current = null
  }, FOCUS_DEBOUNCE_MS)
}, [])
```

### 5. Seed committed state with a derived fallback, not a `useEffect`

Using a `useEffect` to seed initial committed state flashes a blank hero for 50–100ms while the effect fires. Derive the fallback inline:

```tsx
const effectiveCommittedId =
  committedId ?? homepageExperience?.documentId ?? null
```

### 6. Wire focus callbacks directly into the interactive leaf, not its wrapper

On `react-native-tvos`, a wrapper `<View onFocus>` does **not** reliably fire when a nested `Pressable` gains focus. Focus events only fire on the leaf that actually holds focus. Pass `onFocus` through `renderItem` straight into the inner `Pressable`:

```tsx
// Keep the extra parameter minimal — an `onFocus` callback is enough today.
// If the rail ever grows onBlur/onSelect/etc., evolve to a typed hooks object.
renderItem: (item: T, index: number, onFocus: () => void) => ReactNode
```

### 7. In focus callbacks, close over `item`, never re-index `data[index]`

`FlatList` fires focus callbacks asynchronously. If the Apollo cache delivers a shorter `data` array between render and the callback fire, `data[index]` is `undefined` and downstream reads throw. Close over the `item` captured in `renderItem`'s scope instead.

### 8. Compile-time assert against `never` collapse for gql.tada dynamic-zone unions

When you use `Extract<Union, { __typename: "SomeType" }>` on a gql.tada dynamic-zone result, a regression in the generated types can silently collapse the extracted type to `never` **with no `tsc` error** — every property access on `never` is also `never`, so downstream view-model builders type as `never` without complaint and compile fine.

Defend with a single conditional-type assertion immediately after the `Extract`:

```tsx
type VideoHeroBlock = Extract<
  ExperienceBlock,
  { __typename: "ComponentSectionsVideoHero" }
>

// Guard: fails tsc if VideoHeroBlock collapses to `never`.
type _AssertVideoHeroBlockIsNotNever = VideoHeroBlock extends never
  ? "ERROR: VideoHeroBlock resolved to never — Extract against __typename failed"
  : true
const _videoHeroTypeCheck: _AssertVideoHeroBlockIsNotNever = true
void _videoHeroTypeCheck
```

If the union collapses, `_videoHeroTypeCheck = true` fails to assign to the string-literal error type and `tsc` prints the message.

**Pitfall worth knowing**: `never extends X` is vacuously `true` for almost any `X`. Asserts that check `VideoHeroBlock["field"] extends string | null | undefined` don't detect a `never` collapse — they're only sensitive to narrower field-level drift. If you want to guard both `never` collapse **and** specific field shapes, wrap in a tuple to block distribution:

```tsx
type _AssertShape = [VideoHeroBlock] extends [never]
  ? "ERROR: collapsed to never"
  : VideoHeroBlock["streamingUrl"] extends string | null | undefined
    ? true
    : "ERROR: streamingUrl typing drifted"
```

For most view-model consumers, the single `never` check is enough — downstream call sites will give better-localized errors if a specific field's type drifts.

### 9. Force discrete native views above `VideoView` with `collapsable={false}` (Android TV)

Already documented in [`apps/tv/CLAUDE.md`](../../../apps/tv/CLAUDE.md) Common Pitfalls: `VideoView` is a `SurfaceView` and punches through the RN hierarchy; wrap any overlaid `View`/`LinearGradient` with `collapsable={false}` to keep them as discrete native views. Mentioned here because every hero/video-card pattern in this doc relies on it.

## Why This Matters

- **Without the non-interactive refactor**, you maintain a tree of `isTVSelectable={false}` guards, `nextFocusUp`/`nextFocusDown` self-references, `trapFocusUp`/`trapFocusDown` guide walls, and state-backed node handles that must be kept in sync — each of which works for some subset of interaction paths and breaks under others. The `VideoView` hijacking behavior is native; no amount of RN-level guarding is robust.
- **Without poster-hold**, users see a black flash on every focus-driven hero swap. On Android TV this cannot be overlayed away.
- **Without debounce**, fast D-pad traversal thrashes `useVideoPlayer` and exceeds tvOS's concurrent `AVPlayer` cap (~3), silently rendering black video surfaces even when the poster is correct.
- **Without the `Extract` compile-time assert**, a gql.tada regression or a schema rename can collapse the type to `never` and ship a hero that displays nothing, with a completely clean build.
- **Without `collapsable={false}`**, titles and gradients disappear under the video on Android TV.

## When to Apply

- Any TV surface (tvOS + Android TV) that combines a focusable region with a background `expo-video` `VideoView`.
- Any TV surface where a background media element reacts to focus state from an adjacent focusable region.
- Any gql.tada consumer using `Extract<Union, { __typename: "X" }>` where the result is load-bearing for view construction.
- Any TV hero/carousel/media swap that changes `streamingUrl` at runtime.

## What we tried before it worked

Preserved so future readers don't re-walk the path. The commit trail on `feat/tv-focus-driven-hero` reads as a record of trying to fight the native focus engine instead of stepping around it.

1. **Wrap the entire hero in `TVFocusGuideView`** to redirect UP-from-rail to Explore. Making the guide hero-wide caught UP — but trapped DOWN, because Explore was now a descendant of the guide.
2. **Add `trapFocusDown={false}`** on the hero guide so DOWN from Explore could exit. Did not help — the guide's bounds still absorbed the first DOWN press.
3. **Make Explore a sibling of the hero focus guide, not a descendant.** Fixed two-press DOWN in isolation but broke UP.
4. **Layer on every RN-level guard available.** Subsequent attempts piled on `nextFocusUp`/`nextFocusDown` self-references, callback-ref node handles, extra text-container `TVFocusGuideView`s with `trapFocusUp + autoFocus`, and `isTVSelectable={false}` on every media wrapper — each fixed one interaction path and broke another. With the video playing, the `VideoView` still intercepted focus; the guard tree never reached a stable equilibrium.
5. **Stop fighting. Delete Explore entirely.** Remove the CTA and all the focus plumbing. Make the hero purely presentational. Let the rail's `TVFocusGuideView autoFocus` claim initial focus. `HomeHero.tsx` went from 329 → 166 lines; `ContentRail.tsx` lost 34 lines of focus-routing props.

The guards that did **not** prevent `VideoView` from hijacking focus while playing on tvOS: `focusable={false}`, `pointerEvents="none"`, `isTVSelectable={false}` on every wrapper, self-referencing `nextFocusUp` via `findNodeHandle`, `TVFocusGuideView trapFocusUp`. A complete fix via guards would mean replacing `expo-video`'s `VideoView` with a custom native module. Non-interactivity is the pragmatic alternative.

## Related

- [`docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md`](../design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md) — companion doc for the overlay-video-player case (custom chrome, auto-hide, in-trap focus). Same "TV focus engine is its own system" mindset; complements Section 6's onFocus-on-leaf rule with Pattern 5's `useTVEventHandler` denylist — synthetic `focus`/`blur`/`pan` events must be explicitly ignored to avoid reveal-loops when the engine reassigns focus to a newly-mounted Pressable with `hasTVPreferredFocus`.
- [`docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md`](../ui-bugs/tv-videoview-steals-dpad-focus-20260413.md) — earlier fix that wrapped the hero in `TVFocusGuideView` with destinations. **Superseded for the hero-above-rail layout** — the new pattern is to remove the `TVFocusGuideView` from the hero entirely and make the subtree non-interactive.
- [`docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md`](../ui-bugs/tv-video-hero-blank-autoplay-20260413.md) — baseline inline-autoplay patterns (useEffect for play, pickThumbnailUrl, gradient stops). Still correct for initial autoplay; extended here with source-swap + poster-hold.
- [`docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md`](../ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md) — context-dependent `pointerEvents="none"` rule (inline OK, overlay/fullscreen blocks `AVPlayerLayer`). The rail-owns-focus rule here is a natural complement.
- [`docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`](./react-native-tvos-porting-pitfalls-20260414.md) — central tvOS pitfalls catalog. The "non-interactive hero / rail owns focus" rule belongs alongside as an extension to the VideoView pitfall.
- [`docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`](./expo-tv-platform-setup-sdui-monorepo-20260410.md) — Section 3 (home data model) and Section 6 (focus management) both now need updating: `LIST_EXPERIENCES` intentionally diverges from mobile by carrying per-experience `VideoHero` blocks, and the focus model is rail-owns-focus rather than guide-wrapped-hero.
- [`docs/solutions/best-practices/playlist-video-player-sdui-mobile-20260409.md`](./playlist-video-player-sdui-mobile-20260409.md) — mobile predecessor of runtime HLS source swap (`useVideoPlayer` + `replaceAsync`); TV adds the poster-hold + focus concerns.
- [`docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md`](../integration-issues/expo-graphql-schema-drift-and-fragment-validation.md) — prior-art on gql.tada fragment drift detection; the compile-time union-assert here is a defensive complement.
- PR [#803](https://github.com/JesusFilm/forge/pull/803) — this branch.
- [`docs/brainstorms/2026-04-17-tv-focus-driven-hero-requirements.md`](../../brainstorms/2026-04-17-tv-focus-driven-hero-requirements.md) — requirements.
- [`docs/plans/2026-04-17-001-feat-tv-focus-driven-hero-plan.md`](../../plans/2026-04-17-001-feat-tv-focus-driven-hero-plan.md) — implementation plan.
