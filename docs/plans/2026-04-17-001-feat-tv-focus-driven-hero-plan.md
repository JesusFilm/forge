---
title: "feat(tv): Focus-Driven Hero on Home Screen"
type: feat
status: active
date: 2026-04-17
origin: docs/brainstorms/2026-04-17-tv-focus-driven-hero-requirements.md
---

# feat(tv): Focus-Driven Hero on Home Screen

## Overview

On the TV app home screen, make the hero (video + title + subtitle +
Explore CTA) swap to reflect whichever card is focused in the
Experiences rail. Initial state remains the `isHomepage` experience;
the hero sticks to the last-focused card until the user leaves the home
screen. Swaps are debounced (~300ms) and crossfaded using stacked
video/image layers to sidestep Android TV `VideoView` z-order
limitations. Respects tvOS Reduce Motion and announces new hero state
via VoiceOver/TalkBack.

## Problem Frame

Today's home hero always reflects one "homepage-featured" experience.
Rail cards are essentially thumbnails with no preview affordance — the
user can't tell what an experience will feel like until they open it.
This plan implements the focus-driven hero pattern defined in the
origin requirements document (see origin: `docs/brainstorms/2026-04-17-tv-focus-driven-hero-requirements.md`).

## Requirements Trace

Every implementation unit maps back to requirements in the origin doc:

- R1. Focus-driven full-hero swap (video + title + subtitle + CTA target)
- R2. Explore CTA opens the currently-focused experience
- R3. Debounced crossfade (~300ms) — no swap during fast D-pad scrubbing
- R4. Initial render shows `isHomepage` experience
- R5. Hero sticks to last-focused within the home-screen session; resets
  on leaving home (detail nav, background, remount)
- R6. Valid video plays muted + looped (matches today)
- R7. Image fallback when no video
- R8. Solid Crimson Gallery surface when neither video nor image; hero
  never shows a black/empty state during source swap
- R9. Accessibility: respect Reduce Motion; announce new hero to
  screen readers
- R10. Never regress visually: graceful handling of validation
  failures, no blank hero during source swap, and a defined behavior
  for the initial `LIST_EXPERIENCES` loading and hard-error states.
  (R10's optimistic-ogImage-upgrade-to-video clause is rendered
  vacuous by Unit 1's eager fetch — see Unit 6 for why and the
  conditions under which it would need to be re-introduced.)

## Scope Boundaries

- No changes to `FocusableCard` visual design or focus-ring styling.
- No change to the navigation stack (Home → Experience Detail → Playback).
- No audio autoplay / no unmute-on-focus.
- No new CMS editorial flag; continue using `isHomepage` for R4 only.
- TV-only: no mobile/web changes in this pass.
- No eager preload of every experience's hero **video media**. Query
  metadata + streaming URLs for every rail experience is in scope
  (small count); media loads only for the currently-displayed hero.

### Deferred to Separate Tasks

- Port the same pattern to `apps/mobile` and `apps/web`: future iteration,
  separate plan.
- Editorial controls for which rail experiences expose a hero preview:
  future iteration if needed.

## Context & Research

### Relevant Code and Patterns

- `apps/tv/app/index.tsx` — the home screen. Runs `LIST_EXPERIENCES` +
  a second `GET_WATCH_EXPERIENCE` keyed to the `isHomepage` experience.
  Renders `<HomeHero>` + `<ContentRail>` of `<FocusableCard>`s.
- `apps/tv/src/components/HomeHero.tsx` — current hero; uses `expo-video`
  `useVideoPlayer` with `player.muted = true; p.loop = true`, defers
  `player.play()` to an effect. Gradient via `hexToRgba(COLORS.surface, 0)`.
  Explore `Pressable` has unconditional `hasTVPreferredFocus`.
- `apps/tv/src/components/ContentRail.tsx` — wraps `FlatList` in
  `TVFocusGuideView`; wraps each item in a `View` with `onFocus` that
  writes to module-level `focusMemory: Map<railId, index>`. Today this
  Map is write-only — nothing reads it. This is the upward-notification
  seam R1 needs.
- `apps/tv/src/components/FocusableCard.tsx` — `Pressable` +
  `Animated.View` with spring-scale 1.05 on focus. Already accepts
  `onFocus` / `onBlur` / `hasTVPreferredFocus`.
- `apps/tv/src/components/sections/VideoHeroRenderer.tsx` — canonical
  `VideoHero` block renderer used inside experience detail. Reuse for
  field-mapping parity (`heading`/`subheading` vs experience fields).
- `apps/tv/src/components/VideoPlayer.tsx` — canonical
  `one-shot hasTVPreferredFocus` pattern
  (`useState(true)` + `useEffect(() => setShould(false), [])`).
- `apps/tv/src/components/sections/VideoCardRenderer.tsx` — canonical
  `setTimeout` + `clearTimeout` in `useEffect` pattern for
  focus-settle delays.
- `apps/tv/src/lib/queries.ts` — gql.tada queries + fragments.
  `VideoHeroFragment` already exists. `LIST_EXPERIENCES` currently
  selects only `documentId`, `slug`, `title`, `metaDescription`,
  `isHomepage`, `ogImage` — does not include blocks.
- `apps/tv/src/lib/validateUrl.ts` — all CMS URLs must round-trip
  through `validateStreamingUrl()` / `resolveImageUrl()`.

### Institutional Learnings

- `docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md` —
  wrap inline `VideoView` + gradient in `<View pointerEvents="none">`
  so focus traverses past it. Use `TVFocusGuideView destinations`.
- `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md` —
  `player.play()` inside `useVideoPlayer` setup callback is silently
  ignored on tvOS; trigger `play()` in an effect with a short delay.
  Use `pickThumbnailUrl()` helper (gql.tada types `video.images` as
  object, not array).
- `docs/solutions/ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md`
  — Android TV density ~960x540dp. `expo-image` and `LinearGradient`
  can become invisible inside nested views on Android TV; required
  mitigations include `collapsable={false}`, removing inner
  `backgroundColor`, and keeping `overflow: "hidden"` on the outer
  `Animated.View`. The stacked two-layer crossfade must be validated
  against these constraints early.
- `docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md`
  — `pointerEvents="none"` wrapper pattern is correct for inline
  hero; two stacked inline heroes follow the same rule.
- `docs/solutions/best-practices/tv-carousel-card-conformance-pattern-20260416.md`
  — validate URLs once in the parent, pass validated values downward.
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`
  — `EXPO_TV=1 npx expo prebuild --clean` required when switching
  between TV and phone targets; lazy Apollo client.

### External References

None — local patterns + solutions are sufficient; no external
research warranted.

## Key Technical Decisions

- **Extend `LIST_EXPERIENCES` to include the first `VideoHero` block
  per experience.** With an expected experience count in the single
  digits / low double digits, the payload cost is negligible and it
  avoids cascading on-focus round-trips, the associated in-flight
  loading state, and Mux signed-URL expiry races. One query means one
  cache; Apollo already handles it. Lazy fetch was rejected because
  the resulting in-flight state would require R10 to do more work for
  no real benefit at this scale.
- **Crossfade design — default to stacked video layers, fall back to
  poster-cover + single-player swap.** The target design is two
  stacked `View`s each containing a `VideoView` (or `expo-image`),
  `pointerEvents="none"` so focus passes through, opacity-animated
  to cross-dissolve. However, Android TV's documented `VideoView`
  z-order pitfall (renders above RN hierarchy) may prevent the
  outgoing layer's opacity from actually fading the native video
  surface. **Unit 4 must spike this on Android TV emulator before
  the full implementation.** If the stacked approach fails:
  - Fall back to a single `VideoView` whose source swaps on commit,
    covered for the duration of HLS init by an `expo-image` poster
    layer that crossfades between the two experiences' thumbnails.
    This still satisfies R8 (no blank hero) and R3 (visible
    transition) while sidestepping the z-order issue.
  - Update Key Decisions in-place to reflect what actually ships.
    The design paragraph and the fallback branch must describe the
    same shipped behavior by end of Unit 4.
- **Debounce with trailing-only commit, 300ms.** Reset timer on every
  `onItemFocus`; commit on timeout. Chosen to match the existing
  400ms `scroll-then-focus` pattern neighborhood while biasing
  toward snappier feel. Named and tunable via a constant.
- **Keep the previous video playing during the debounce window.**
  Pausing during debounce would make the hero feel broken if the
  user briefly hovers a card they don't commit to. Crossfade only on
  commit; old video keeps playing until after its layer has faded
  out, then pauses to free decoder resources.
- **First-mount-only `hasTVPreferredFocus` on Explore.** Use the
  `VideoPlayer.tsx` pattern (`useState(true) + useEffect(() =>
setShould(false), [])`) so re-renders triggered by hero swap do
  not yank focus from the rail back to Explore.
- **Canonical hero text source = `VideoHero.heading/subheading`**, fall
  back to `Experience.title / Experience.metaDescription`. Mirrors
  `VideoHeroRenderer`.
- **Inline the focused-hero state in `app/index.tsx`, extract only if
  a second consumer emerges.** The state machine is ~25–35 lines
  (one `useState` + one `useRef` timer). Given there is only one
  consumer today, prefer inline. The "useFocusedHero hook" referenced
  in later units is a convenience label for this logic block — not
  a mandated separate file. Extract into
  `apps/tv/src/hooks/useFocusedHero.ts` only if the logic proves
  unwieldy inline or a second rail needs the same pattern.

## Open Questions

### Resolved During Planning

- Data-fetching shape: **Extend `LIST_EXPERIENCES`** (see Key Decisions).
- Crossfade technique: **Two stacked layers, opacity animation**
  (see Key Decisions).
- Debounce duration: **300ms, trailing only** (see Key Decisions).
- Previous video during debounce: **keep playing** (see Key Decisions).
- Canonical hero text source: **block `heading/subheading` → Experience
  fallback** (see Key Decisions).

### Deferred to Implementation

- Exact shape of `useFocusedHero`'s return value (object vs. tuple vs.
  discriminated union). Will be driven by how cleanly it reads in
  `app/index.tsx` once wired.
- Whether to introduce a shared `useDebouncedValue` / `useDebouncedCallback`
  utility in `apps/tv/src/lib/` or inline the `setTimeout` ref pattern
  in `useFocusedHero`. Decide during Unit 3 based on whether other
  consumers are likely (low signal today — prefer inline first, extract
  if a second consumer appears).
- VoiceOver announcement timing — `AccessibilityInfo.announceForAccessibility`
  after commit is straightforward, but may need a small guard to avoid
  double-announcement when Reduce Motion + VoiceOver combine with a
  snap swap (they should announce once, same as crossfade).
- Whether `ContentRail` also needs a new `focusedItemId` derivation
  that consumers can subscribe to, beyond `onItemFocus`. Inline
  callback seems sufficient; revisit only if focus memory behavior
  regresses.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for
> review, not implementation specification. The implementing agent should
> treat it as context, not code to reproduce._

Data + state flow:

```
LIST_EXPERIENCES (extended with VideoHero block per experience)
           │
           ▼
    HomeScreen (app/index.tsx)
      │
      ├── builds experience lookup: experiencesById
      ├── owns useFocusedHero({ experiences, initialId: isHomepageId })
      │        │
      │        ├── state: focusedId, committedId
      │        ├── onItemFocus(id) → reset 300ms timer → commit = setCommittedId(id)
      │        └── returns: currentHero (hero data from committedId), onItemFocus
      │
      ├── <HomeHero hero={currentHero} onExplore={...} />
      │        └── renders stacked prev/current layers, crossfades on hero.id change
      │            respects AccessibilityInfo.isReduceMotionEnabled → snap
      │
      └── <ContentRail items={experiences}
                       onItemFocus={(index, item) => focusedHero.onItemFocus(item.id)}
                       renderItem={... FocusableCard ... onPress={openExperience(item)} />
```

Layer stack inside `HomeHero` (simplified):

```
<View style={heroContainer}>
  <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: prevOpacity }]}>
    {prevHero has video ? <VideoView .../> : <ExpoImage .../> }
    <LinearGradient .../>
  </View>
  <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: currOpacity }]}>
    {currHero has video ? <VideoView .../> : <ExpoImage .../> }
    <LinearGradient .../>
  </View>
  <View style={textOverlay}>
    {heroTitle, heroSubtitle, <Pressable Explore />}  // crossfaded as a block
  </View>
</View>
```

## Implementation Units

- [ ] **Unit 1: Extend `LIST_EXPERIENCES` with per-experience VideoHero block**

**Goal:** Give the home query everything it needs to render any
experience's hero inline, without a second round-trip per focus commit.

**Requirements:** R1, R6, R7, R10

**Dependencies:** None.

**Files:**

- Modify: `apps/tv/src/lib/queries.ts`

**Approach:**

- **Spike first (blocking):** before committing to the query shape,
  write the extended query locally and run it against a populated
  local Strapi. Measure response payload size and confirm that
  Strapi v5's dynamic-zone `blocks` can be queried with an inline
  type-condition returning only `ComponentSectionsVideoHero` fields.
  If Strapi returns every block on every experience regardless of
  type condition, payload will balloon with Containers, Sections,
  Questions, etc. — and this Key Decision must be revisited. Do not
  proceed to Unit 5 until payload is confirmed acceptable on the
  actual schema.
- Add `VideoHeroFragment` (already defined in the same file) into
  `LIST_EXPERIENCES` per experience. Keep `ogImage` — still needed
  as fast thumbnail for R7 fallback and as a safety net during
  Android TV source init.
- `video.images` must be included in the VideoHero selection (it
  already is in the existing fragment) so the thumbnail fallback
  chain — `pickThumbnailUrl(video.images)` → `getMuxThumbnailUrl(streamingUrl)`
  → `ogImage` — is preserved when Unit 5 deletes the separate
  `GET_WATCH_EXPERIENCE` call.
- Verify the gql.tada regenerated types still compile against
  `packages/graphql`. If types drift, run codegen per root CLAUDE.md
  GraphQL change flow.
- Keep the existing `metaDescription` selection — used as subtitle
  fallback when the block has no `subheading`.
- **Blast-radius guard:** a malformed block on a single experience
  currently affects only the experience detail screen for that
  experience. After this change, a malformed block could produce a
  GraphQL-level error on the home query. Verify Apollo's
  partial-data handling for this case; if the whole query rejects,
  consider gating blocks selection with a `@skip`/`@include` pattern
  or falling back to the pre-extension query on error.

**Patterns to follow:**

- `GET_WATCH_EXPERIENCE` already composes fragments via gql.tada's
  second-arg fragment array — mirror that shape.
- Hardcoded `{ locale: "en" }` per `apps/tv/CLAUDE.md`.

**Test scenarios:**

- Happy path: Apollo query returns experiences including the video
  hero block's `streamingUrl`, `heading`, `subheading`, and `video.images`
  when the block exists — verified manually via React Native debugger
  / logging on a local Strapi.
- Edge case: experience with no `ComponentSectionsVideoHero` block
  returns an empty `blocks` filter — query does not error.
- Test expectation: no unit tests — the TV app has no component test
  harness. Verification is typecheck + manual data-shape inspection.

**Verification:**

- `pnpm --filter @forge/tv typecheck` passes.
- Running the home screen against local Strapi shows the new fields
  on every experience in the Apollo cache.

---

- [ ] **Unit 2: Surface rail focus upward via `ContentRail` `onItemFocus` prop**

**Goal:** Give the home screen a reliable callback fired when a rail
item becomes focused, preserving existing focus-memory behavior.

**Requirements:** R1

**Dependencies:** None (Unit 1 independent).

**Files:**

- Modify: `apps/tv/src/components/ContentRail.tsx`
- Modify: `apps/tv/src/components/FocusableCard.tsx` (only if the
  props pathway doesn't already pass onFocus — verify first; do not
  change if not needed)

**Approach:**

- Add optional `onItemFocus?: (index: number, item: T) => void` prop
  to `ContentRail` props (the existing prop name for the items array
  is `data`, per the current component signature — use `data[index]`
  when forwarding).
- In the existing `handleItemFocus(index)` in `ContentRail.tsx`,
  after writing to `focusMemory`, call `onItemFocus?.(index, data[index])`.
- Do not change the module-level `focusMemory` semantics — the rail
  itself depends on it for focus restoration (it is not currently
  consumed elsewhere, but semantics must stay intact).
- The wrapper `View` around each `FocusableCard` in `ContentRail`
  already has an `onFocus` handler that fires when focus enters the
  inner `Pressable`. Verify on both tvOS and Android TV that this
  onFocus still fires when the Pressable gains focus (React Native
  focus bubbling has been observed to vary across tvOS versions). If
  bubbling fails, thread `onFocus` through as an explicit prop on
  `FocusableCard` instead.

**Patterns to follow:**

- Typed generic prop signature style already used in `ContentRail`.

**Test scenarios:**

- Happy path: D-padding right across cards fires `onItemFocus` once
  per card with correct index + item.
- Edge case: existing `focusMemory` behavior is preserved (rail
  re-mount restores last focused index).
- Edge case: rails that do not pass `onItemFocus` continue to work
  unchanged.
- Test expectation: manual QA on tvOS simulator + Android TV emulator;
  no automated tests.

**Verification:**

- Console logs confirm `onItemFocus` fires per card transition.
- Existing `ContentRail` behavior (focus memory, D-pad traversal)
  is unchanged for the home screen, which today is `ContentRail`'s
  only consumer within `apps/tv`.

---

- [ ] **Unit 3: `useFocusedHero` hook — debounced state machine**

**Goal:** Encapsulate the R3 / R4 / R5 state machine (initial, focused,
debounced commit, session reset) in one place.

**Requirements:** R3, R4, R5

**Dependencies:** Unit 2 (consumers rely on `onItemFocus` shape).

**Files:**

- Create: `apps/tv/src/hooks/useFocusedHero.ts`
- Test: none — no test harness for hooks in this app; behavior
  verified through integration (Unit 6).

**Approach:**

- Hook signature (directional): `useFocusedHero({ experiences, initialId })`
  returns `{ currentHero, onItemFocus, resetToInitial }`.
- Internal state: `committedId` (what the hero shows), a `useRef` for
  the pending timer.
- `onItemFocus(id)`:
  - Clear existing timer.
  - Start new 300ms timer. On fire: `setCommittedId(id)`.
- `resetToInitial()`: clear timer, set `committedId = initialId`.
- On unmount: clear timer.
- Derive `currentHero` by looking up `committedId` in an
  `experiencesById` memo.
- Surface a debounce constant (e.g., `FOCUS_DEBOUNCE_MS = 300`) at the
  top of the file so tuning is one-line.

**Execution note:** Write the happy-path behavior first as a
directional skeleton, then layer in unmount cleanup and re-entrancy
safety (rapid successive calls, in-flight timer interrupted by
`resetToInitial`). Manually exercise those paths before wiring
consumers.

**Patterns to follow:**

- `setTimeout`/`clearTimeout` in `useEffect` cleanup — see
  `apps/tv/src/components/sections/VideoCardRenderer.tsx` lines ~87–92.
- `useVideoPlayer`'s `useState(true) + useEffect` one-shot guard —
  `apps/tv/src/components/VideoPlayer.tsx` lines ~136–139.

**Test scenarios:**

- Happy path: `onItemFocus('A')` then wait 300ms → `currentHero.id === 'A'`.
- Edge case: `onItemFocus('A')` then `onItemFocus('B')` within 100ms →
  after 300ms total, `currentHero.id === 'B'` (trailing-only commit).
- Edge case: `onItemFocus('A')`, unmount before 300ms → no state update
  (timer cleared).
- Edge case: `resetToInitial()` while a timer is pending → timer
  cancelled, `currentHero.id === initialId`.
- Error path: `onItemFocus` called with an id not in `experiences` →
  safely ignored (no commit).
- Test expectation: no automated tests (no hook-testing harness).
  Verified by wiring to the home screen and exercising manually per
  Unit 6.

**Verification:**

- `pnpm --filter @forge/tv typecheck` passes.
- Manual scrub: rapid D-pad across 5 cards commits once on the
  landed card, not for in-flight ones.

---

- [ ] **Unit 4: HomeHero — prop-driven, stacked-layer crossfade**

**Goal:** Make `HomeHero` render as a function of a single `hero` prop
(title, subtitle, streamingUrl, posterUrl, onExplore), with clean
crossfade between hero states and no black flash on Android TV.

**Requirements:** R1, R3, R6, R7, R8, R10

**Dependencies:** Unit 1 (shape of `hero` data); Unit 3 (consumer).

**Files:**

- Modify: `apps/tv/src/components/HomeHero.tsx`
- Extract a local `HeroLayer` component inside `HomeHero.tsx` only
  if the inlined two-layer JSX becomes hard to read. Do not create
  a separate file by default — single consumer, two call sites, no
  reuse signal.

**Approach:**

- Refactor props to take a single `hero: HomeHeroData | null` shape
  (id, title, subtitle, streamingUrl | null, posterUrl | null,
  onExplore).
- Track the previous `hero` in a `useRef` updated post-render. When
  the prop changes, keep the previous layer mounted with
  `Animated.timing` opacity 1→0 (~250ms), and mount the new layer
  at opacity 0→1.
- Each layer: `<View pointerEvents="none">` containing either
  `<VideoView>` + gradient (video path) or `<ExpoImage>` + gradient
  (image path) or solid surface (no media path). Gradient uses
  `hexToRgba(COLORS.surface, 0) → COLORS.surface` — never
  `"transparent"`.
- Call `player.play()` in a post-load `useEffect` (per
  `tv-video-hero-blank-autoplay-20260413.md`). Use one `useVideoPlayer`
  per active video layer — the layer is remounted when its hero id
  changes, so expo-video lifecycle is clean.
- First-mount-only `hasTVPreferredFocus` gate on the Explore
  `Pressable` (`useState(true)` + `useEffect(() => setShould(false),
[])`). This prevents focus-pong on re-renders. The Explore
  `Pressable` must live in the **stable text overlay** that sits
  above the two crossfading media layers — never inside a layer
  that unmounts on hero id change. Otherwise the `useState(true)`
  initializer would reset on every commit and yank focus back to
  Explore during rail scrubbing.
- Subscribe to `AccessibilityInfo.isReduceMotionEnabled()` (+ change
  listener). When reduced-motion is active: skip the opacity
  animation, snap between layers, and do not trigger video play on
  the new layer (image-only fallback).

**Patterns to follow:**

- `apps/tv/src/components/VideoPlayer.tsx` — one-shot
  `hasTVPreferredFocus` + deferred `player.play()` pattern.
- `apps/tv/src/components/sections/VideoHeroRenderer.tsx` — canonical
  field mapping (`heading`/`subheading`, image picker, gradient).
- `apps/tv/src/lib/validateUrl.ts` — `validateStreamingUrl()` before
  passing to `VideoView`; `resolveImageUrl()` before `ExpoImage`.
- `docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md`
  and `tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md`
  for the pointerEvents wrapper.

**Test scenarios:**

- Happy path: `hero` prop changes → previous layer fades out over
  250ms, new layer fades in, text swaps. No black frame visible on
  tvOS simulator.
- Happy path: `hero.streamingUrl` is null but `hero.posterUrl` is set
  → image layer renders, no video.
- Happy path: `hero.streamingUrl` and `hero.posterUrl` are both null
  → solid Crimson Gallery surface renders with title/subtitle/CTA.
- Edge case: Reduce Motion enabled → snap swap, no animation, video
  does not autoplay on new layer.
- Edge case: rapid hero changes (A → B → C within 100ms) → layers
  don't leak, only one fade in progress at a time (cancel and restart
  the animation).
- Error path: `streamingUrl` validation fails → treat as null, fall
  through to image / solid-surface path. Log via existing
  `validateUrl` error path.
- Integration: on Android TV, layer transition shows the incoming
  image poster covering any HLS init black frame before the video
  begins. No z-order artifacts.
- Test expectation: manual QA on both platforms; no automated tests.

**Verification:**

- Swap between two experiences with video heroes on the home screen:
  visually clean crossfade on tvOS simulator.
- Same flow on Android TV emulator: no black flash, no invisible
  layers (density scaling sanity check).
- Enable Reduce Motion on tvOS simulator: swaps still commit
  correctly but instantly.

---

- [ ] **Unit 5: Wire the home screen — swap query, mount the hook, pass props**

**Goal:** Replace the home screen's dual-query + hardcoded
homepage-hero layout with `useFocusedHero` + prop-driven `HomeHero`,
and wire rail focus through.

**Requirements:** R1, R2, R4, R5, R6

**Dependencies:** Units 1, 2, 3, 4.

**Files:**

- Modify: `apps/tv/app/index.tsx`

**Approach:**

- Remove the second `GET_WATCH_EXPERIENCE` query for `isHomepage` —
  the extended `LIST_EXPERIENCES` (Unit 1) now carries what the hero
  needs.
- Build `experiencesById` memo. Pick `initialId` = the experience
  with `isHomepage === true`, else first experience.
- Mount `useFocusedHero({ experiences, initialId })`.
- Render `<HomeHero hero={currentHero} onExplore={() => navigate to
currentHero.slug} />`.
- Pass `onItemFocus` into `<ContentRail>`. Inside
  `renderItem`/`FocusableCard`, call through to `focusedHero.onItemFocus(item.id)`
  (via `ContentRail`'s new prop, not per-card).
- R5 reset: on `useEffect` unmount of `HomeScreen`, nothing extra
  needed — the hook state dies with the screen, matching "hero resets
  on leaving home (detail nav, background, remount)".
- Preserve existing navigation on Select (press) behavior: Select
  opens `item.slug`, unaffected by debounce state.
- **Initial loading state:** while `LIST_EXPERIENCES` is in flight on
  first mount, render the existing skeleton (today's home screen
  already has a loading treatment — preserve it). Do not render
  `HomeHero` with `hero={null}` during loading; gate on data
  presence.
- **Hard-error state:** if `LIST_EXPERIENCES` errors entirely,
  render the existing error treatment. Do not attempt to render a
  hero without data.
- **Explore CTA during the 300ms debounce window:** the CTA always
  targets the **committed** hero (what the user currently sees), not
  the transiently-focused card. If the user focuses a new card and
  presses Select on Explore before the debounce commits, Explore
  navigates to the previous committed experience. This matches the
  "what you see is what Explore opens" promise from R5 and avoids
  navigating to content the hero hasn't yet shown.

**Patterns to follow:**

- Existing Apollo hook patterns in `apps/tv/app/index.tsx`.
- Composite React keys: `${item.kind}-${item.id}-${index}` per
  `apps/tv/CLAUDE.md`.

**Test scenarios:**

- Happy path: home mounts → hero shows the `isHomepage` experience
  (R4). D-pad into rail, focus "Christmas" → 300ms later, hero is
  Christmas. Explore CTA label/target now Christmas.
- Happy path: from a focused card, D-pad UP to Explore button → hero
  still shows that card's experience (R5 stick).
- Happy path: press Select on a focused card → opens that experience
  directly (R2), bypassing any hero state.
- Edge case: no experience has `isHomepage: true` → falls back to
  first experience without crashing.
- Edge case: LIST_EXPERIENCES returns an empty list → hero falls
  through to R8 solid surface; rail renders empty; no crashes.
- Integration: navigate Home → Detail → back to Home → hero is
  `isHomepage` again (R5: reset on remount). Initial focus on return
  lands on the Explore button (per R4's initial-render semantics —
  first-mount-only `hasTVPreferredFocus` fires again because the
  screen has remounted), not on a cached rail position.
- Test expectation: manual QA on tvOS + Android TV; no automated tests.

**Verification:**

- All requirement-trace happy paths visually confirmed on tvOS
  simulator.
- Same on Android TV emulator.
- `pnpm --filter @forge/tv typecheck` passes.

---

- [ ] **Unit 6: Accessibility + in-flight polish + QA pass**

**Goal:** Deliver R9 + R10 and validate the whole stack on both TV
platforms.

**Requirements:** R9, R10 (+ system-wide QA for all others)

**Dependencies:** Units 1–5.

**Files:**

- Modify: `apps/tv/src/hooks/useFocusedHero.ts` (optional —
  announcement dispatch hook-in point)
- Modify: `apps/tv/src/components/HomeHero.tsx`
- Modify: `apps/tv/app/index.tsx` (optional — `AccessibilityInfo`
  announce call)

**Approach:**

- On hero commit (inside `useFocusedHero` or immediately after
  `setCommittedId`), dispatch `AccessibilityInfo.announceForAccessibility(\`\${title}. \${subtitle}\`)`
  so VoiceOver/TalkBack speak the new hero after the debounce
  settles — not per transient focus event.
- R10 in-flight: because Unit 1 resolves hero data eagerly on mount,
  no lazy fetch is in the commit path. The committed hero is always
  fully known. If a future iteration switches to lazy fetch, the
  optimistic-ogImage-then-upgrade-to-video flow is the path to
  implement — note this in code comments at the hook site.
- R10 error path: if a hero's `streamingUrl` validation fails at
  render, `HomeHero` falls through to the image layer; the CTA still
  targets the focused experience.
- Add the `accessibilityLabel` on the hero container reflecting the
  current hero title + subtitle, so focus-reads by VoiceOver while
  the user is on the Explore button are meaningful.
- Manual QA pass against every requirement:
  - R1: visual hero swap on focus — confirmed per card
  - R2: Explore targets focused card
  - R3: rapid D-pad doesn't cascade swaps; single commit at landing
  - R4: initial = `isHomepage`
  - R5: stick on focus-up; reset on leaving home
  - R6: video plays muted + looped; swaps cleanly
  - R7: experience with image-only hero shows image path
  - R8: experience with neither shows Crimson Gallery surface; no
    black flash on Android TV source swap
  - R9: Reduce Motion on tvOS → snap swap; VoiceOver announces new
    hero once per commit
  - R10: never blank, never regresses; failure paths graceful
- Cross-platform QA: run via `EXPO_TV=1` against tvOS simulator and
  one real or emulated Android TV target (Fire TV 4K Max or
  Chromecast with Google TV if available).

**Patterns to follow:**

- Existing `accessibilityLabel` usage across `FocusableCard` and
  section renderers.

**Test scenarios:**

- R9: enable VoiceOver on tvOS simulator, D-pad across 3 cards →
  hear exactly 3 announcements (one per commit), not 3 per card per
  intermediate focus.
- R9: enable Reduce Motion → layer swap has no opacity animation;
  announcement still fires.
- R10: manually throw on a single hero's image URL → hero falls to
  solid-surface for that card, CTA still targets it.
- R10: disable network after mount, D-pad across cards → hero still
  swaps (data is cached from initial mount), proving the eager-fetch
  decision pays off.
- Test expectation: manual QA only; no automated tests.

**Verification:**

- All requirement-trace checks above pass on both platforms.
- No console warnings about stale timers, unmounted setState, or
  shared-object expo-video exceptions.

## System-Wide Impact

- **Interaction graph:** `HomeScreen` now owns focused-hero state.
  `ContentRail` gains an optional prop; no other consumer of
  `ContentRail` exists in `apps/tv` today (SDUI renderers inside
  experience detail use their own `FlatList` implementations).
  `apps/mobile` maintains a parallel `ContentRail` — explicitly
  out of scope for this plan.
- **Error propagation:** Eager `LIST_EXPERIENCES` fetch with extended
  hero fields means a single failing hero field (e.g., a malformed
  block from Strapi) could reject the whole query. Validate this:
  Strapi's GraphQL returns partial data with errors by default — the
  existing `LIST_EXPERIENCES` consumer treats empty data as no
  experiences, which is acceptable. If extended selection causes
  blocking errors, we may need per-experience selection resilience
  (selection on `blocks` is already nullable).
- **State lifecycle risks:** The pending-focus timer must always
  clear on unmount. Unit 3's explicit cleanup covers this, but
  verify with React DevTools profiler after the first run.
- **API surface parity:** `ContentRail`'s new `onItemFocus` prop is
  additive; no other callers need to change. Mobile app has a
  parallel `ContentRail` — out of scope for this plan, confirmed
  by Scope Boundaries.
- **Integration coverage:** The Android TV + stacked-video combination
  is the highest-risk integration. Manual validation is mandatory
  per learning `android-tv-density-scaling-and-native-view-clipping-20260416.md`.
- **Unchanged invariants:**
  - `LIST_EXPERIENCES` keeps all existing fields; the extension is
    purely additive, so existing consumers (none besides home today,
    but mobile has its own copy) remain valid if they later pick up
    these fields.
  - `ContentRail` focus memory (`focusMemory` Map) semantics
    unchanged.
  - `FocusableCard` visual behavior unchanged.
  - `HomeHero` public shape changes (single `hero` prop vs. separate
    title/subtitle/streamingUrl/onExplore) — this is TV-app-internal;
    no external consumers.

## Risks & Dependencies

| Risk                                                                                                             | Mitigation                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android TV `VideoView` punches through RN hierarchy during HLS init, causing black flash despite stacked layers. | Cover source init with the poster-image layer (R8, Unit 4 approach). Validate on Android TV emulator in Unit 4 before moving to Unit 5. If unresolvable, fall back to single-player swap with poster cover — still satisfies R8.                                                              |
| `hasTVPreferredFocus` on Explore + prop re-renders causes focus pong back to Explore during swap.                | First-mount-only gate per `VideoPlayer.tsx` pattern (Unit 4 approach). Manual QA in Unit 6 confirms focus stays on the rail during swaps.                                                                                                                                                     |
| Extending `LIST_EXPERIENCES` balloons payload beyond what the assumption allows (e.g., experience count grows).  | Current count is single digits. Plan notes the trigger to switch to lazy fetch if count exceeds ~30. Revisit at that threshold.                                                                                                                                                               |
| `useVideoPlayer` hook lifecycle on layer mount/unmount thrashes on rapid focus changes.                          | Debounce ensures layer mount happens only on commit. Keep the old layer's `useVideoPlayer` until fade completes, then unmount; verify no "shared object released" errors on tvOS.                                                                                                             |
| Reduce Motion behavior differs between tvOS (OS-level) and Android TV (no direct equivalent).                    | On Android TV, `AccessibilityInfo.isReduceMotionEnabled()` returns based on `animator_duration_scale`/transitions setting; treat returned `true` as the gate. If API returns consistently `false` on Android TV regardless of setting, document as a known-limitation and leave animation on. |
| VoiceOver announcements overlap or fire too frequently during rapid D-pad.                                       | Announcement fires on `setCommittedId` (post-debounce), not on every transient focus. If still too noisy, add a minimum-interval guard (e.g., skip announcement if committedId hasn't changed since the last announcement).                                                                   |

## Documentation / Operational Notes

- After landing, add a compound-engineering solution under
  `docs/solutions/best-practices/` capturing:
  - "Focus-driven rail-to-hero pattern on TV"
  - The stacked-layer crossfade technique and why
    single-player-swap was rejected
  - The first-mount-only `hasTVPreferredFocus` gate for prop-driven
    heroes
  - Eager-hero-fetch decision and when to revisit
- No rollout / feature flag required — this is a UX refinement that
  degrades gracefully (worst case is today's behavior if the hook
  short-circuits). Ship behind no flag.
- Update roadmap status for any related feature ticket (none
  currently matches this in `docs/roadmap/`; consider adding one
  under `docs/roadmap/content-discovery/` post-landing if it
  warrants its own entry).

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-17-tv-focus-driven-hero-requirements.md`
- Related code:
  - `apps/tv/app/index.tsx`
  - `apps/tv/src/components/HomeHero.tsx`
  - `apps/tv/src/components/ContentRail.tsx`
  - `apps/tv/src/components/FocusableCard.tsx`
  - `apps/tv/src/components/VideoPlayer.tsx`
  - `apps/tv/src/components/sections/VideoHeroRenderer.tsx`
  - `apps/tv/src/components/sections/VideoCardRenderer.tsx`
  - `apps/tv/src/lib/queries.ts`
  - `apps/tv/src/lib/validateUrl.ts`
- Related solutions:
  - `docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md`
  - `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md`
  - `docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md`
  - `docs/solutions/ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md`
  - `docs/solutions/ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md`
  - `docs/solutions/best-practices/tv-carousel-card-conformance-pattern-20260416.md`
  - `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`
  - `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`
- Platform docs: `apps/tv/CLAUDE.md`, root `CLAUDE.md`
