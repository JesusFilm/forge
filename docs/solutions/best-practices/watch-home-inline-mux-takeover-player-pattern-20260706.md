---
title: Watch Home inline Mux takeover player pattern
date: 2026-07-06
category: docs/solutions/best-practices
module: apps/web
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - Adding playable Mux-only promotional inserts to the Watch home carousel
  - Reusing the Watch page custom player chrome outside the single-video route
  - Pausing carousel auto-advance while a preview becomes an intentional player
  - Moving between carousel slides while takeover animations are in flight
tags:
  - watch-home
  - mux
  - hero-player
  - carousel
  - player-chrome
  - portal
  - animation
  - regression-test
---

# Watch Home inline Mux takeover player pattern

## Context

Watch Home can include Mux-only promotional inserts in the TV carousel. These inserts have a playback id, poster, copy, and sometimes a primary CTA such as `Join Us` or `Share Our Mission`, but they do not have the catalog identity needed for a normal Watch video page route. The initial implementation exposed them as muted previews, so viewers could not intentionally watch the full short film from the carousel.

This work started as a secondary `Watch Short Film` button that opened a modal. User feedback moved the design inline: clicking the secondary action should animate away the carousel copy and side controls, stop auto-advance, unmute the active Mux media, and reveal the same custom player surface used on the single-video Watch page. (session history)

## Guidance

Treat the interaction as a takeover of the existing hero surface, not as a separate player.

The slide data should keep the external mission CTA as the primary action and add `Watch Short Film` only when the Mux insert already has a primary action. Passive time-of-day inspiration inserts stay preview-only:

```ts
secondaryAction: overlay.action
  ? { label: "Watch Short Film", type: "watch-short-film" }
  : null
```

In the carousel component, store both the slide being taken over and a short transition phase:

```ts
const [shortFilmSlide, setShortFilmSlide] =
  useState<WatchHomeTvCarouselSlide | null>(null)
const [shortFilmPhase, setShortFilmPhase] = useState<
  "transitioning" | "playing" | null
>(null)
```

Pause the carousel hook by slide id instead of stopping timers indirectly from the component:

```ts
useWatchHomeTvCarousel(carouselSlides, {
  autoAdvancePausedForSlideId: shortFilmSlide?.id ?? null,
  suppressLeavingSlide: shortFilmSlide != null,
})
```

During takeover, make the active media behave like the player:

- Use `muted={false}` while takeover is transitioning or playing.
- Disable preview `onEnded` during takeover so a near-end preview cannot advance the carousel before the player finishes entering.
- Switch to `object-contain` in full-player mode and remove visual layers/gradients so the background is black behind the film.
- Reuse `HeroPlayerControls` with a live player state and a real wrapper ref instead of enabling native browser controls.

The `HeroPlayerControls` bridge needs the same ref invariant as the Watch page. Keep a callback ref that updates both `videoRef.current` and React state, then pass the stateful `player` into the controls. This lets the chrome re-bind when the Mux element remounts:

```tsx
const handlePlayerReady = useCallback((next: MuxPlayerRef | null) => {
  setPlayer((current) => (current === next ? current : next))
}, [])

<HeroPlayerControls
  player={player}
  playerRef={videoRef}
  wrapperRef={wrapperRef}
  overlayAnchor={overlayAnchor}
/>
```

When embedding portaled chrome on Watch Home, keep the anchor width-aligned with the hero surface and restore global header/search chrome when the player is exited or scrolled away. `HeroPlayerControls` emits global chrome visibility events for the single-video page; on Watch Home those events can otherwise leave the logo/search/account UI faded while the user is browsing the rest of the page.

## Why This Matters

The Mux insert preview and the intentional short-film player share the same video element, so state transitions compete with existing carousel behavior. If takeover is modeled only as a visual state, the preview `ended` handler, auto-advance timeout, or stale leaving-slide animation can still act underneath the player.

Reusing the shared Watch player chrome gives the short films parity with the single-video page, but it also imports that component's portal and ref contracts. A zero-width or misplaced overlay anchor makes the controls feel detached; a stale player ref makes play, timeline, mute, volume, or fullscreen controls silently stop working after remounts.

Session history surfaced several review findings that are worth preserving: suppress `onEnded` as soon as takeover starts, not only after the delayed full-player phase; pass the actual transition boolean into the player animation class; re-query carousel cards after player state changes in tests; and keep roadmap dependencies bidirectional. (session history)

## When to Apply

- A Mux-only carousel insert needs full playback but should remain distinct from catalog video routes.
- The primary CTA should remain an external mission/action link and playback should be a secondary action.
- The player must feel like the existing Watch page player rather than a native browser video or modal.
- Carousel auto-advance, rail selection, and global header/search chrome all remain active around the hero.

## Examples

Regression coverage should exercise the whole takeover lifecycle, not just the presence of a button:

```ts
await act(async () => {
  shortFilmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
})

expect(playSpy).toHaveBeenCalled()
expect(heroVideo.hasAttribute("controls")).toBe(false)
expect(heroVideo.className).toContain("watch-home-player-enter")

await act(async () => {
  heroVideo.dispatchEvent(new Event("ended", { bubbles: true }))
})

await act(async () => {
  await new Promise((resolve) => window.setTimeout(resolve, 380))
})

expect(
  document.body.querySelector('[data-testid="hero-player-custom-chrome"]'),
).not.toBeNull()
expect(heroVideo.muted).toBe(false)
expect(container.textContent).not.toContain("Watch Short Film")
```

Also cover the negative data case: a passive Mux insert without an external CTA should not receive `secondaryAction`, and the page should not render `Watch Short Film` for that slide.

## Related

- [Mux Player + custom React-rendered chrome pattern](../design-patterns/mux-player-custom-react-chrome-pattern-20260430.md) documents the underlying `HeroPlayerControls` ref, portal, and visibility contracts.
- [Watch Next countdown must cancel through portaled player chrome](../ui-bugs/watch-next-countdown-portaled-chrome-cancellation.md) documents the same portal boundary from a Watch page interaction-state perspective.
- [Embla Carousel bleed-alignment port pattern](../design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md) documents related carousel alignment and test infrastructure patterns.
- [PR #1464](https://github.com/JesusFilm/forge/pull/1464) introduced this Watch Home short-film takeover.
