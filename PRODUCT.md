# Product

> Scope: the **consumer watch experience** — `apps/mobile` (forge-watch), and by extension the
> `apps/web` and `apps/tv` watch surfaces that share the admin content layer. `apps/admin` and
> the manager app are internal operator tools with a different register and are out of scope here.

## Register

product

## Users

JesusFilm's global audience: people seeking faith content — feature films, segments, and series —
offered in thousands of languages and audio dubs. They arrive on a phone (often a low-end Android
device) over constrained, low-bandwidth cellular networks. The job to be done is simple from their
side: find something to watch in my language, watch it without friction, and discover what's next.
Many will not have fast hardware or a reliable connection, so "works on the worst phone on the
worst network" is a first-class requirement, not an edge case.

## Product Purpose

forge-watch is the consumer app for watching JesusFilm content. It renders a server-driven home
feed (admin controls the content blocks and order), lets a viewer pick a language from a large dub
catalog, plays HLS video with custom controls and CMS subtitles, and surrounds the player with
related content — Up Next siblings, study questions, Bible quotes — that invite the viewer deeper.
Success: a viewer reliably finds and plays content on any device or network, then keeps exploring
the content below the video instead of leaving.

## Brand Personality

Warm, welcoming, and modern. Approachable and human, not clinical or corporate. The craft of the
player should feel on par with a polished mainstream streaming app, but the surface is inviting
rather than aggressive — it draws the viewer toward the content rather than demanding attention.
Voice: clear, plain, and human. No jargon, no hype, no pressure.

## Anti-references

- **Cluttered / ad-heavy streaming apps.** No autoplay traps, nagging overlays, engagement dark
  patterns, or controls competing for attention. The chrome serves the content, then gets out of
  the way.
- **Cold, corporate, sterile tools.** No gray, impersonal enterprise look. Warmth is carried by the
  palette, typography, and imagery.

## Design Principles

1. **Controls serve the content, then recede.** The player chrome appears on demand, fades when
   idle, and never fights the footage. The film leads; the UI supports.
2. **Invite exploration.** The watch screen is a doorway, not a dead end. Up Next, study questions,
   and Bible quotes below the player are part of the experience, not afterthoughts.
3. **Works on the worst phone on the worst network.** Low-end Android and low-bandwidth cellular are
   the design center, not a fallback. Fast first frame, bounded work on the JS thread, no jank
   during interaction.
4. **Accessible by default, not retrofit.** Reduce-motion, screen-reader operability, and
   gesture-free control paths are built in from the start, not bolted on.
5. **Warm, never cluttered.** Every affordance earns its place. Warmth through tone and craft;
   restraint through what we leave out.

## Accessibility & Inclusion

- **Floor: WCAG 2.1 AA.** Text contrast >= 4.5:1 (>= 3:1 large), non-text/UI contrast >= 3:1,
  touch targets >= 44x44, every control labeled and operable without a precise gesture.
- **Reduced motion** is honored everywhere: fades snap, lifts snap, no motion is required to use a
  control.
- **Screen readers** (VoiceOver / TalkBack): auto-hide is suspended while a screen reader is active,
  chrome force-reveals, and the seek bar is operable via increment/decrement actions rather than a
  drag.
- **Low-end Android / low bandwidth** is an inclusion concern: a concurrent-decoder budget, a
  fast-first-frame buffering profile, and cache-first re-entry keep the app usable on weak hardware
  and slow networks.
