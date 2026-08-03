---
title: "TV VideoView steals D-pad focus from interactive elements"
date: "2026-04-13"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Explore button on homepage hero receives initial focus but cannot be re-focused after navigating away"
  - "D-pad up navigation from Experiences rail does not reach the Explore button"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
last_updated: "2026-07-29"
tags:
  - tvos
  - dpad-focus
  - videoview
  - tvfocusguideview
  - expo-video
  - react-native-tvos
---

# TV VideoView steals D-pad focus from interactive elements

## Problem

After adding inline video autoplay to the TV homepage hero (`HomeHero`), the Explore button received initial focus via `hasTVPreferredFocus` but could not be re-focused after navigating to another element (e.g., the Experiences rail). D-pad up navigation was absorbed by the `VideoView` native component.

## Symptoms

- Explore button is focused on initial mount (crimson glow visible)
- Pressing D-pad down to Experiences rail works
- Pressing D-pad up to return to Explore button fails — focus stays on the rail
- Same issue on both tvOS simulator and Android TV emulator

## What Didn't Work

- **`focusable={false}` on VideoView alone**: Prevents the `VideoView` itself from receiving focus, but the native view still blocks the tvOS focus engine from traversing through it to reach elements behind/above it in the view hierarchy.

## Solution

Two changes required:

1. **Wrap VideoView and gradient in `pointerEvents="none"` container** — makes the entire background layer invisible to the focus engine:

```tsx
<View style={StyleSheet.absoluteFill} pointerEvents="none">
  <VideoView
    player={player}
    style={StyleSheet.absoluteFill}
    nativeControls={false}
    contentFit="cover"
    focusable={false}
  />
  <LinearGradient ... />
</View>
```

2. **Replace text overlay `View` with `TVFocusGuideView`** — explicitly guides focus to the Explore button:

```tsx
const exploreRef = useRef<View>(null)

<TVFocusGuideView
  style={styles.textContainer}
  destinations={
    exploreRef.current
      ? [findNodeHandle(exploreRef.current)!].filter(Boolean)
      : undefined
  }
>
  <Text ...>{title}</Text>
  <Pressable ref={exploreRef} hasTVPreferredFocus ...>
    <Text>Explore</Text>
  </Pressable>
</TVFocusGuideView>
```

## Why This Works

The tvOS focus engine uses the view hierarchy and spatial layout to determine focus traversal. A native `VideoView` — even with `focusable={false}` — is an opaque native UIView that blocks focus traversal through it. Wrapping it in `pointerEvents="none"` tells React Native to exclude the entire subtree from the responder system. `TVFocusGuideView` with explicit `destinations` then provides a declarative focus target that the tvOS focus engine uses when navigating into that region.

## 2026-07-29 instance: watch-details action row (up-press steals into a PLAYING backdrop)

On `/watch/[slug]`, pressing D-pad UP from the hero action row (Play pill, topmost
focusable) visually unhighlighted everything; the next DOWN landed on an Up Next card
instead of Play. `UIFocusDebugger status` (lldb attached to the simulator process)
showed the focused item was `_AVPlayerViewControllerContainerView` — the
`VideoBackdrop`'s AVKit container captured the up-move **even though the backdrop
already has BOTH `pointerEvents="none"` on its container AND `focusable={false}` on
the `VideoView`**. This confirms the while-playing hijack: the RN-level guards below
hold for a paused/idle player but not for an actively playing one. Android TV was
unaffected (no AVKit; the up-press simply had no candidate and focus stayed put).

Containment (third pattern, for interactive elements that must sit ON the playing
surface): `trapFocusUp` on the action row's existing `TVFocusGuideView`
(`DetailsActionRow.tsx`). Down/left/right stay geometry-driven (verified in-sim:
down → Up Next, up → back to Play, edges hold, Select on Play opens the player).
The Experience hero (`VideoHeroRenderer`) covers the same hazard differently — its
full-bleed silent-focus `Pressable` catches UP as the topmost focusable.

**What `trapFocusUp` actually does** (read from the pinned source, because the
intuitive reading is wrong and leads to a broken layout): it is NOT a spatial
guide that "wins" the up-search. `app.json` sets `newArchEnabled: false`, so the
live path is Paper's `RCTTVView`, where the whole implementation is one method —
`shouldUpdateFocusInContext:` (`React/Views/RCTTVView.m:274-289`). When
`focusHeading == UIFocusHeadingUp` it returns
`[UIFocusSystem environment:self containsEnvironment:context.nextFocusedItem]`.
The AVKit container is not inside the guide, so that is NO and **UIKit cancels the
entire focus update**. Three consequences that matter:

1. Focus does not move and does not "bounce" — it simply never leaves. No
   `onFocus` and no `onBlur` fire for a trapped press. Anything keyed on the
   trapped press itself will never run; the scroll-restore below is therefore
   keyed on focus ENTERING the row from the content underneath.
2. The guide must CONTAIN the focusables it protects. A `TVFocusGuideView` placed
   as a 1px SIBLING above the row would contain nothing, so the check returns NO
   for every up-move including legitimate ones — the sibling-not-descendant trap
   that `tv-focus-driven-hero-patterns-20260420.md` warns about.
3. It is heading-scoped, not target-scoped: it vetoes every up-move out of the
   guide, not merely the ones the AVKit container would have won.

**The trap alone strands the scroll position.** Native focus-scroll only reveals
the re-focused row's own edge — returning from below-fold content leaves the page
half-scrolled with the hero title cut off, and the trapped UP press can never
scroll further ("stuck on Play, can't see the top of the page"). Pair the trap
with a scroll-to-top companion: the row surfaces `onRowFocus`/`onRowBlur` (fired
from every pill), and the screen answers with a JS-driven eased glide to `y: 0`
(650ms `Easing.out(cubic)` timing whose listener issues per-frame
`scrollTo(animated: false)` writes — `scrollTo(animated: true)`'s fixed ~300ms
native curve is too abrupt for a full-viewport return). The glide needs
`onScroll` + `scrollEventThrottle` wired to track the start offset (forgetting
`onScroll` makes the glide silently no-op from offset 0), and `onRowBlur` stops
it so a down-press mid-glide can't fight native focus-scroll. Two ordering rules
the decision layer (`actionRowScrollGlide.ts`, where the tests live) exists to
hold:

- The blur MUST be identity-checked against the last-focused pill. tvOS fires the
  NEW pill's focus BEFORE the old pill's blur on a within-row hop (verified
  in-sim — a bare blur-stop let Play's late blur kill the glide Language had just
  restarted, stranding the page mid-scroll).
- A restart mid-glide MUST seed from the animation's own current value
  (`stopAnimation`'s callback), never from the `onScroll` mirror. The mirror lags
  by a throttle window plus a bridge hop and, since the glide runs toward 0,
  always lags HIGH — seeding from it writes the page back down before resuming,
  a visible backward hitch on every mid-glide hop.

At `y: 0` the row is
fully visible, so the native scroll-into-view has nothing left to override
(contrast Home, which needed `scrollEnabled={false}` because its row-0 labels sit
at the viewport bottom). Verified in-sim: About → two UPs → Play focused with the
full hero restored; a further UP holds both focus and position; RIGHT mid-glide
lands on Language with the glide completing; DOWN mid-glide cancels cleanly onto
the below-fold content.

Diagnosis technique worth keeping: attach lldb to the simulator app process and run
`expr -l objc -O -- [UIFocusDebugger status]` — it names the actually-focused
native item, turning "focus disappeared" from guesswork into a one-line answer.

## Prevention

- Any **inline** `VideoView` used as a background (non-interactive) layer on TV must be wrapped in `pointerEvents="none"` — `focusable={false}` alone is insufficient. **While the video is actively PLAYING even that pair is insufficient on tvOS** (see the 2026-07-29 instance above): interactive elements sitting on the playing surface additionally need a directional `trapFocus*` on their focus guide (or the silent-focus-Pressable pattern) so the AVKit container can't win a directional search.
- **On tvOS only**, a `trapFocus*` inside a SCROLLABLE screen must pair with a scroll-restore on re-focus (see the 2026-07-29 instance) — the veto in `RCTTVView.shouldUpdateFocusInContext:` swallows the press with no event and no focus-reveal scroll, so the trapped direction is the one the user would otherwise have scrolled with. **This does not transfer to Android TV**: `ReactScrollView` extends `android.widget.ScrollView`, whose `dispatchKeyEvent` runs `executeKeyEvent` → `arrowScroll(FOCUS_UP)` and page-scrolls while `mScrollEnabled` is true (the default) — consuming DPAD_UP before `ReactViewGroup.focusSearch`, where the trap lives, is ever consulted. Don't build the restore machinery for an Android-only surface.
- **Exception: overlay VideoViews** (e.g., fullscreen player) where `TVFocusGuideView` with `trapFocusUp/Down/Left/Right` already contains D-pad navigation must NOT use the `pointerEvents="none"` wrapper. It blocks AVPlayerLayer rendering on tvOS, producing a black screen with functional controls. Use `focusable={false}` directly on the `VideoView` instead. See `docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md` for the full investigation.
- **Hero-above-rail layouts** (background video hero that reacts to rail focus): **prefer removing interactivity from the hero entirely** rather than wrapping it in `TVFocusGuideView` with `destinations`. The guide-with-destinations pattern is fragile once the video is actively playing — `VideoView` continues to intercept focus despite every RN-level guard. Make the hero non-interactive and let the adjacent rail own focus. See `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md`.
- For layouts where an interactive element _must_ sit above a `VideoView` and the hero pattern above doesn't apply, wrap with `TVFocusGuideView` + explicit `destinations` as a fallback and verify behavior with the video actively playing, not just paused.
- Test D-pad focus traversal after adding any native video view to a TV screen — focus away from the initial element, then verify you can navigate back.

## Related Issues

- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` — supersedes this doc's "wrap the hero in TVFocusGuideView" prevention for hero-above-rail layouts; documents the non-interactive-hero + rail-owns-focus pattern and the VideoView focus-hijacking-while-playing behavior that the `TVFocusGuideView` approach could not fully contain
- `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md` — the inline autoplay work that introduced this focus issue
- `docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md` — the wrapper pattern breaks overlay VideoViews; documents when NOT to use it
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` — TV platform setup, documents `TVFocusGuideView` pattern
- react-native-tvos issue #852 — focus lost on back-navigation (related but distinct). Restoring the exact last-focused element across a multi-focusable screen: `docs/solutions/design-patterns/tv-back-nav-focus-restoration-screen-focus-memory.md`
