---
date: 2026-04-17
topic: tv-focus-driven-hero
---

# TV Home — Focus-Driven Hero

## Problem Frame

On the TV app home screen, the video hero currently reflects a single
"homepage-featured" experience regardless of which card the user focuses in
the Experiences rail. The rail's cards are essentially thumbnails with no
preview affordance, so users can't tell what an experience will feel like
until they open it. We want the hero to act as a live, 10-foot preview of
the currently-focused card — the canonical TV interaction pattern used by
Apple TV, tvOS apps, Netflix, etc. — so browsing the rail feels responsive
and cinematic rather than static.

Who's affected: every TV user on the home screen (Apple TV + Android TV).

## Requirements

**Focus-driven swap**

- R1. When a card in the Experiences rail is focused, the hero must swap to
  reflect that experience: background video, title, subtitle, and the
  Explore CTA target. Canonical source for title/subtitle is the first
  `ComponentSectionsVideoHero` block's `heading`/`subheading`, falling back
  to `Experience.title` / `Experience.metaDescription` only when no hero
  block exists. This mirrors how `VideoHeroRenderer` already renders hero
  text for experience detail.
- R2. Pressing Select on the Explore CTA while a card is focused must open
  the currently-focused experience (not the homepage-featured one).
- R3. The swap transition must be a debounced crossfade: wait for focus to
  settle (~250–400ms) before swapping, then crossfade video + text between
  the previous and new hero. No swap should happen while the user is still
  D-padding quickly across cards.

**Initial + focus-up state**

- R4. On first render (before any card has been focused), the hero shows
  the homepage-featured experience (`isHomepage: true`). This preserves
  today's "above the fold" moment for users who don't explore the rail.
- R5. When focus moves back UP from a rail card to the hero's Explore
  button, the hero must "stick" to the last-focused experience within the
  current home-screen session. The Explore CTA continues to target that
  experience. "Leaving the home screen" resets the hero back to the R4
  initial state (homepage-featured experience) — this includes navigating
  to Experience Detail and then back, app backgrounding/foregrounding, and
  remount-level navigation. The hero does not persist across such
  transitions.

**Fallback behavior**

- R6. If the focused experience has a valid hero video, play it (muted,
  looped) — same playback behavior as the current hero.
- R7. If the focused experience has no hero video but has an image
  (ogImage or still), show the image with the experience's title /
  subtitle / CTA.
- R8. If the focused experience has neither, show a solid Crimson Gallery
  surface (`#161311`) with the experience's title / subtitle / CTA over
  it. During a video source swap, the hero must never expose a black or
  empty state — if the platform (particularly Android TV `VideoView`)
  cannot cleanly cross-dissolve two video layers, the implementation must
  cover the underlying surface with a poster image (the outgoing
  experience's image, or the incoming one, whichever is ready) for the
  duration of source init.

**Accessibility + in-flight state**

- R9. The hero must respect accessibility and motion preferences:
  - On tvOS when Reduce Motion is enabled, disable the crossfade and
    simply snap between hero states at the end of the debounce window.
    Optionally fall back to image-only (skip video autoplay) when the
    user's system-level motion reduction is active.
  - When the hero swaps, announce the new hero's title + subtitle to
    VoiceOver / TalkBack (via an accessibility live-region-equivalent
    pattern — e.g., `AccessibilityInfo.announceForAccessibility` on RN,
    or updating `accessibilityLabel` on the hero container with an
    appropriate role). The screen reader must not remain stuck on the
    previous hero's text while the visual state has moved on.
- R10. Between the debounce firing and the focused experience's hero data
  being fully loaded, the hero must not regress visually:
  - If `ogImage` is already known from `LIST_EXPERIENCES`, crossfade the
    hero to the focused experience's `ogImage` + title/subtitle/CTA
    immediately, then upgrade to video when the hero block resolves
    (upgrade may be a silent source swap on the same image poster).
  - If no image is known yet, hold the previous hero's visuals (no flash,
    no blank) until data arrives, then crossfade.
  - If the hero fetch fails (network error, missing block), fall through
    to R7 (image) or R8 (solid surface) for the focused experience. The
    Explore CTA still targets the focused experience.

## Success Criteria

- Focusing any card in the rail swaps the hero to that card's experience
  within one debounce window, with a visible crossfade. Verification must
  confirm all four swap elements change correctly: background video/image,
  title, subtitle, and Explore CTA target.
- Rapidly D-padding across the rail does not start-then-cancel multiple
  video loads; only the experience the user lands on has its hero loaded.
- Pressing Explore on a focused hero opens the focused experience every
  time (verified on both Apple TV and Android TV).
- No visual flash-of-empty-hero during a swap, even when the next
  experience has only an image or nothing at all.
- Back-navigating from a rail card up to the Explore button leaves the
  hero on the last-focused experience; no unexpected revert.
- With tvOS Reduce Motion on, the hero still swaps correctly but without
  crossfade animation, and never triggers video autoplay beyond what the
  user's motion setting allows.
- Enabling VoiceOver and D-padding across the rail produces an audible
  announcement of the new hero's title + subtitle each time the hero
  swaps (not on every transient focus event — only after the debounce
  commits).

## Scope Boundaries

- No changes to the Experiences rail's card visual design or focus ring —
  those stay as-is.
- No changes to the navigation stack model; this is still Home → Experience
  Detail → Playback.
- No autoplay of audio, no unmute-on-focus — hero stays muted + looped to
  match current behavior.
- No new CMS editorial flag or "featured experience" concept; we continue
  using the existing `isHomepage` flag only for the R4 initial render.
  (Query-shape changes to `LIST_EXPERIENCES` — or adding a per-experience
  hero-detail fetch — are in scope as a data-fetching implementation
  choice; see Deferred to Planning.)
- No implementation of this behavior on mobile or web in this pass; TV
  only.
- No preloading of every experience's hero video on mount. Only the
  initial-featured experience is eagerly loaded; other hero media is
  fetched as a card settles as focused.

## Key Decisions

- **Full-hero swap, not video-only**: the hero becomes a live preview of
  what pressing Select would open. A video-only swap would create a
  mismatch between what the user sees and what Explore opens, which is
  worse than today's static hero.
- **Debounced crossfade (~300ms) over instant swap**: D-pad movement is
  discrete and fast; instant swapping would thrash network + video
  decoders on TV hardware and feel chaotic. 300ms is the "intent settled"
  window common in TV UIs.
- **Initial state stays on `isHomepage`**: preserves the current
  above-the-fold moment for users who never touch the rail, and avoids
  coupling initial render to rail focus ordering.
- **"Stick to last focused" on focus-up**: matches the mental model "what
  you saw is what Explore opens." Reverting to homepage-featured when
  focus moves to the Explore button would make the hero lie about what
  Explore does.

## Dependencies / Assumptions

- Every Experience in Strapi can have a `ComponentSectionsVideoHero`
  block. Verified: the existing `VideoHeroFragment` in
  `apps/tv/src/lib/queries.ts` covers it and is already consumed by
  `GET_WATCH_EXPERIENCE`.
- `FocusableCard` already exposes `onFocus`/`onBlur` props and
  `ContentRail` is wrapped in `TVFocusGuideView`. However, today's rail
  `renderItem` in `apps/tv/app/index.tsx` does not pass an `onFocus` into
  each card, and `ContentRail`'s internal focus tracking writes to a
  module-level `focusMemory` Map with no upward notification. Implementing
  R1 therefore requires either (a) passing an `onFocus` into each
  `FocusableCard` from `HomeScreen`, or (b) adding an `onItemFocus` prop
  to `ContentRail` that forwards the focused index/item. This is
  additive but is a new prop on a shared component, not pure consumer
  wiring.
- `HomeHero`'s Explore `Pressable` currently sets `hasTVPreferredFocus`
  unconditionally (see `apps/tv/src/components/HomeHero.tsx`). With R1's
  prop-driven re-renders, this can steal focus from the rail on every
  hero swap. Planning must gate initial focus claim to first-mount only
  (e.g., via a ref guard or `hasTVPreferredFocus` only while
  `lastFocusedExperienceId === null`) and verify focus does not pong
  between Explore and rail during crossfades on both platforms.
- Current `LIST_EXPERIENCES` query returns only `ogImage` per experience
  and does not include hero block data. Planning will need to decide
  whether to extend that query with hero fields, fetch hero data lazily
  when a card settles as focused, or prefetch for a small set — but this
  is a data-fetching shape decision, not a product decision.
- `expo-video` on tvOS/Android TV can swap its source without remounting
  the player. Unverified — planning should confirm, as it affects whether
  the crossfade is a single-player swap or a two-player cross-dissolve.
  On Android TV specifically, `VideoView` renders above the React Native
  view hierarchy (documented in `apps/tv/CLAUDE.md`), which may preclude
  clean two-layer opacity crossfades and require a poster-image cover
  layer during source swap.
- Experience count on the home screen is currently small (single digits as
  of 2026-04-17, expected to stay under ~20 in the near term). Data-
  fetching-shape trade-offs should be sized against this, not a
  many-hundreds case.

## Outstanding Questions

### Resolve Before Planning

(none — all product decisions captured above)

### Deferred to Planning

- [Affects R1, R3][Technical] Data-fetching shape: extend
  `LIST_EXPERIENCES` to include the first `ComponentSectionsVideoHero`
  block + streaming URL per experience, or fetch hero data on-focus per
  experience (with caching)? Trade-off is payload size on mount vs.
  latency on first-focus-per-card.
- [Affects R3][Needs research] Crossfade technique on `expo-video` for TV
  — can we swap the source on a single player without a visible flash, or
  do we need two stacked `VideoView`s cross-fading via opacity? Verify on
  both Apple TV and Android TV; Android TV in particular has known
  VideoView z-order quirks (see `apps/tv/CLAUDE.md`).
- [Affects R3][Technical] Exact debounce duration and whether to use
  leading + trailing vs. trailing-only. 300ms is a starting anchor, not a
  committed value.
- [Affects R6][Technical] What to do with the previously-playing video
  during the debounce window — keep playing, pause, or dispose? Affects
  perceived responsiveness and resource usage on TV hardware.

## Next Steps

-> `/ce:plan` for structured implementation planning. The user has asked
that planning and execution happen in a new git worktree
(`superpowers:using-git-worktrees`).
