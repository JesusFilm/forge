---
date: 2026-08-11
topic: appletv-native-parity
---

# Native tvOS App — Feature Parity with apps/tv

## Problem Frame

`apps/appletv` is a native SwiftUI tvOS client built alongside the React
Native TV app (`apps/tv`). It currently covers roughly 6% of the RN app's
surface: 1,797 LOC against 30,110, three sections against nine routes, and
about eight views against seventy components. A viewer moving from the RN
app to this one loses the entire watch experience — no dub or subtitle
selection, no series, no Experience pages, no settings.

The goal is feature-for-feature parity. The strategic question of which app
ultimately ships on Apple TV is deliberately left open; parity is what makes
that decision possible later, so the work is sequenced by dependency order
rather than by what would answer a business question soonest.

## Requirements

### Watch experience (the largest gap)

- **R1.** A watch screen reachable from any playable card, showing the video
  with its title, description, and metadata.
- **R2.** Audio-language (dub) selection, defaulting by the same priority
  chain the RN app uses: saved preference → device locale → the video's
  primary language → English → first available.
- **R3.** Subtitle selection, including off, with the chosen track rendered
  during playback.
- **R4.** An in-player menu reachable during playback for switching dub and
  subtitle without losing playback position.
- **R5.** An "up next" continuation rail on the watch screen.
- **R6.** Share and download affordances matching what RN offers.

### Series and Experiences

- **R7.** A series screen listing episodes, with its own language selection.
- **R8.** Experience pages render every block type the RN app renders:
  video hero, media collections, video carousels, navigation carousels,
  text, Easter dates, Advent countdown, Bible quotes, CTA, related
  questions, quiz buttons, and nested containers. An unknown block type
  degrades to nothing visible rather than an error.

### Home and Search

- **R9.** Home's hero uses the same deterministic daily queue the RN app
  and web use, so all three surfaces feature the same content on the same
  day.
- **R10.** Continue Watching appears on Home, reflecting real playback
  progress, and resumes at the stored position.
- **R11.** Search offers browse-by-letter equivalent capability and recent
  searches, in addition to text search.

### Settings, identity, and telemetry

- **R12.** A settings screen with parity to RN's, including the showcase
  controls RN exposes there.
- **R13.** Device-grant sign-in works end to end on real hardware: code
  display, approval, token persistence, refresh, and sign-out with
  revocation. (Built but never verified end to end.)
- **R14.** Showcase/kiosk mode: the unattended reel with per-chapter
  language hops, stills, and stat interstitials.
- **R15.** Telemetry reaches Datadog with the same signal set as RN —
  route views, playback QoE, search, and content actions — carrying no
  PII, matching the zero-PII posture RN documents.

### Cross-cutting

- **R16.** Every screen reports loading, empty, and failure states, and
  every failure offers a retry.
- **R17.** D-pad focus reaches every interactive element, and no focusable
  element is a dead end. Cards that cannot be opened yet remain focusable
  rather than being skipped.

## Success Criteria

- A viewer can complete, on the native app, every task they can complete on
  the RN app: find something (browse, search, or Experience page), choose
  their language and subtitles, watch it, resume it later, and sign in.
- Side-by-side on real hardware, the two apps show the same content, the
  same day's hero, and the same daily rails.
- No screen in the native app is a dead end for the Siri Remote.

## Scope Boundaries

- Android TV is out of scope; `apps/tv` keeps that platform regardless of
  what happens to this app.
- No new server capability. The native app consumes the same production
  APIs the RN app already uses; anything RN cannot do, this cannot either.
- No decision about replacing the RN app is being made by this work.
- Not distributed: no TestFlight record, no CI, no EAS. Bundle id stays
  `org.jesusfilm.forgetv.native` so both apps coexist on one device.
- The parked UI-localization work (`feat/tv-ui-i18n-core`) stays out; RN
  has no UI localization either, so it is not parity.

## Key Decisions

- **Full parity, dependency-ordered**: everything RN does, sequenced so
  each unit builds on what precedes it, rather than front-loading whatever
  demos best.
- **Native everywhere except brand-critical surfaces**: system components
  by default — search keyboard (including the Siri Remote's dictation key),
  pickers, state screens, focus, transport controls. The hero composition,
  rail cards, and the WATCH palette stay pixel-matched to RN, because those
  carry the product identity. This resolves the tension between "same as RN"
  and "use Apple native style": RN defines WHAT, Apple defines HOW.
- **Chrome is the platform's job**: hand-built navigation chrome is
  explicitly not re-implemented. One attempt cost a full day of dead-focus
  debugging across two input paths.

## Dependencies / Assumptions

- Parity is measured against `apps/tv` on `main` as of 2026-08-11.
- The RN app's own conventions (deterministic hero queue mirroring web,
  dub-default priority chain, zero-PII telemetry) are treated as product
  requirements, not implementation details, because viewers and other
  surfaces depend on them.
- Verification happens on the physical Office Apple TV. Physical tvOS
  offers no screenshot channel, so visual confirmation requires a human;
  automated checks must assert on state, not screens.

## Outstanding Questions

### Resolve Before Planning

_None._

### Deferred to Planning

- [Affects R14][Technical] Showcase mode's dual-player language hop exists
  because `replaceAsync` blanks the surface on tvOS. Does AVPlayer's own
  item-preloading remove the need for two players, or does the same
  constraint apply?
- [Affects R8][Technical] Whether the SDUI block pipeline is best ported as
  a typed enum + view builder, or whether some renderers collapse into
  shared ones on tvOS.
- [Affects R10][Needs research] Continue Watching and watch events are
  device-local in RN with no server sync. Confirm whether the native app
  should share that storage with RN or keep its own.
- [Affects R17][Needs research] Whether the reported "cannot move down into
  cards" on physical hardware persists under the native TabView build — it
  has never been tested on device with system chrome.

## Next Steps

→ `/ce:plan` for structured implementation planning
