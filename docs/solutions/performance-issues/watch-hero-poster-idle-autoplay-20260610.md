# Watch Hero Poster-First Idle Autoplay

## Context

The watch page already had working SSR metadata, canonical URLs, JSON-LD, and
ISR cache HITs after the cold-path follow-up. The remaining large performance
cost was not SSR itself; it was the hero player mounting Mux immediately and
starting muted autoplay during the page-load window.

Live comparison evidence showed that blocking only Mux video traffic cut the
mobile Lighthouse payload from about 6.3 MiB to about 1.4 MiB and reduced Total
Blocking Time from about 890 ms to about 245 ms. That made player startup the
largest practical optimization target.

## Pattern

Render a plain, eager hero poster first, then mount the selected Mux backend
after load plus an idle window:

- Server HTML includes the poster image, so the first visual surface does not
  depend on the Mux custom element or its dynamic import.
- Normal page loads do not mount `MuxPlayer` or `MuxVideo` on the initial
  render.
- Idle muted preview activation waits for `window.load` and
  `requestIdleCallback`, with a bounded timeout fallback.
- Hidden documents and offscreen heroes defer idle activation to avoid starting
  video work the user cannot see.
- Explicit user intent still wins: `?autoplay=1` and "Play with Sound" activate
  the player immediately.

## Evidence

- Focused HeroPlayer tests passed, including poster-only initial render, idle
  activation, hidden/offscreen deferral, `?autoplay=1`, click-before-idle, and
  MuxVideo branch parity.
- `@forge/web` typecheck, lint, and production build passed.
- Local SSR probe for
  `/watch/life-of-jesus-gospel-of-john.html/english.html` returned `200`.
- The initial server HTML contained exactly one `hero-player-poster`, exactly
  one `h1`, and no rendered Mux backend element.
- Helium opened the local route with no page errors. Immediate runtime state
  showed the poster src, one H1, zero Mux backend elements, zero `video`
  elements, and no Mux stream requests. After `1800ms`, one Mux backend mounted
  and one Mux stream manifest request appeared, matching the intended delayed
  preview behavior.

## Follow-Up

If product later wants the strongest cold-path savings, the next step is
tap-to-play only: keep the poster indefinitely and remove idle muted preview
activation for first-time loads.
