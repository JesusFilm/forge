---
title: "Native tvOS app — feature parity with apps/tv"
type: feat
status: active
date: 2026-08-11
origin: docs/brainstorms/2026-08-11-appletv-native-parity-requirements.md
---

# ✨ Native tvOS app — feature parity with `apps/tv`

## Overview

`apps/appletv` is a native SwiftUI tvOS client covering ~6% of the React
Native TV app (1,797 vs 30,110 LOC; 3 of 9 routes). This plan sequences the
remaining ~94% into 7 PRs, dependency-ordered, per the origin document's
decision to pursue full parity without yet deciding which app ships
(see origin: `docs/brainstorms/2026-08-11-appletv-native-parity-requirements.md`).

Three research findings changed the shape of this plan before a line of it
was written. They are stated up front because each one invalidates an
approach a reasonable engineer would otherwise take.

---

## 🔴 Finding 1 — the focus bug has a root cause, and it is ours

**The user reports, from a physical Apple TV: cannot move down from the tab
bar into video cards; cannot reach the search keyboard.** Four
compositions were tried and all failed. The cause is now known, and it is
not a tvOS bug.

Apple's documentation for `.focusSection()`:

> `focusSection()` does not affect the focusability of the modified view.
> **If the modified view has no focusable descendants, then the modifier
> does nothing.**
> — <https://developer.apple.com/documentation/swiftui/view/focussection()>

The tvOS focus engine is **geometric**: a swipe searches for a focusable
view in the direction of travel that intersects the projected path. It
fails when nothing focusable is _materialized_ at the moment of the swipe —
and **lazy containers have materialized nothing**.

`HomeView` composes `ScrollView` → `LazyVStack` → `LazyHStack`. At first
layout:

- the first rail rendered had **0 playable items** (verified against
  production: `Experience the Story of Jesus from the Bible`, 4 items,
  0 with a `playbackId`);
- the hero's Play button renders only `if let playbackID` — so with a
  non-playable first card, **there was no hero button either**;
- non-playable cards were deliberately non-focusable (my choice);
- every other rail sat unmaterialized inside `LazyVStack`.

Net: **the content pane had zero focusable descendants**, so every
`.focusSection()` was a no-op by Apple's own last sentence, and every swipe
dead-ended. This also explains why the _simulator_ appeared to work — I was
only ever observing _initial_ focus, never movement.

**Fix (U0):** guarantee ≥1 focusable descendant at first layout —
non-lazy first shelf, hero CTA always focusable (Play when playable, an
inert-but-focusable affordance otherwise), non-playable cards focusable,
plus `.focusSection()` on each visually distinct region and
`.defaultFocus(priority: .userInitiated)`. This must be verified on the
physical Apple TV before any other unit begins, because every screen
inherits it.

---

## 🔴 Finding 2 — dubs and subtitles cannot be native, and why

The origin document's rule is _native everywhere except brand-critical
surfaces_. Research proves a third exception, and it is a **data-model**
constraint, not a preference:

| Fact                                                                          | Evidence                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each dub is a **separate HLS asset** with its own `playbackId`                | `videoQueries.ts` `variants: dubs { hls, muxVideo { playbackId } }`; Mux master manifest has **no** `EXT-X-MEDIA:TYPE=AUDIO` — audio is muxed into each rendition |
| Subtitles are **external `vttSrc` URLs** from admin, per dub's `videoEdition` | `watchDubMediaFragment`; the manifest carries only Mux's auto-generated English track                                                                             |

Consequences:

- **`AVMediaSelectionGroup` cannot serve either requirement.** The system
  Audio/Subtitles tabs would offer Mux's generated English track only —
  a _different_ track from the curated ones.
- **`AVMutableComposition` cannot rescue it**: it does not accept remote
  HLS assets. "Separate URL per dub" means swapping the entire stream.
- **No single-player seamless swap exists.** `AVPlayerItem` does not buffer
  until attached to a player; `AVQueuePlayer.advanceToNextItem()` starts at
  time 0 and cannot swap at a timestamp; `replaceCurrentItem(with:)` is
  where the black frame comes from.

**Decision:** implement dub switching as `replaceCurrentItem` + exact seek,
with the gap masked by the last frame held in `contentOverlayView` — the
pattern most streaming apps ship (~0.3–1.5s hold). Subtitles are
fetched, parsed, and rendered by the app, porting `parseVtt.ts` behavior.

**Recorded for the owner, out of scope here:** the fully-native path exists
but is a _server_ change — consolidating each video's dubs into one
multi-audio Mux manifest would make audio **and** subtitle selection
system-native with zero custom UI, and delete this entire unit. The origin
document scopes out new server capability, so this plan does not assume it;
it is the strategically correct fix and should be raised separately.

**tvOS 26 signal worth verifying:** release notes record _"Fixed:
`AVPlayerLayer` does not ensure a valid video frame is always displayed
during item replacement (151902458)"_. If `AVPlayerViewController` inherits
this, the mask may be unnecessary on tvOS 26. Verify by frame-capture on
device before designing around it.

---

## 🟡 Finding 3 — most RN "laws" are React Native artifacts

Research classified ~90 solution documents. A Swift port **must** honor the
product/architecture laws (account isolation on shared TVs, zero-PII
telemetry, bearer allowlisting, the two-query dub split) and must **not**
cargo-cult the RN workarounds (Hermes `Intl` bans, `hasTVPreferredFocus`
imperative hacks, rn-tvos focus patches, Metro/EAS specifics, Android TV
compositing). Two tvOS-platform facts survive framework change and bind us:

- **AppState**: teardown branches on `background` only — `inactive` is a
  foreground blip (Siri, Control Center). Swift: `scenePhase`.
- **Decode-slot budget**: tvOS caps simultaneous AVPlayer pipelines; a
  _paused but attached_ layer keeps its slot. Backdrops must be **detached**,
  not just paused, when a fullscreen player opens.

---

## 🔴 Finding 4 — collections have no playable dubs (found on device, PR2)

Verified in the simulator against production: `lumo-the-gospel-of-matthew`
returns **56 published dubs, 0 with `hls`, 0 with a `playbackId`**. The
playable media lives on its CHILD episodes; the collection record itself is
metadata. The language sheet correctly showed every row as "Unavailable" —
the app was right, the routing was wrong.

This upgrades the PR1 known-gap (no label on `MediaCollectionItem`, so every
card routes to `/watch`) from cosmetic to **blocking**: opening a collection
on the watch screen is a dead end with a disabled Play button and 56
unusable languages.

Two fixes, both already in the plan, now sequenced earlier:

- **R7 series screen** (PR3) is the real destination for these records.
- **A redirect guard on the watch screen**: `videoBySlug.label` IS available
  on the record once loaded (it renders as the eyebrow — "COLLECTION"), so
  the watch screen can detect a series-shaped record and redirect, exactly
  as RN does with its redirect frame. This does not need the pool query and
  should land with PR3 rather than waiting for PR4's label plumbing.

## Technical Approach

### Architecture

```
Sources/
  Core/        Config · GraphQL transport · Models+projections · MuxURL · Theme
  Data/        Repositories (Video, Series, Experience, Search) + query docs
  Playback/    PlayerController · SubtitleEngine (VTT) · DubSwitcher
  Features/    Home · Watch · Series · Experience · Search · SignIn · Settings · Showcase
  Platform/    Storage (Keychain + defaults) · Telemetry
```

No external dependencies (unchanged). Navigation moves to `NavigationStack`
per tab with a value-based `Route` enum (`video(slug)`, `series(slug)`,
`experience(slug)`) — currently the app has no detail screens at all.

### Implementation Phases

#### PR1 — Focus foundation + navigation + data layer _(blocks everything)_

- **U0 · Focus.** Fix per Finding 1. **Exit criterion is a human
  confirmation on the physical Apple TV** that down reaches cards, select
  plays, and up returns to the bar. No automated check substitutes:
  physical tvOS has no screenshot channel, and this plan's predecessor
  claimed success from blind key presses and was wrong.
- **U1 · Navigation.** `NavigationStack` + `Route` enum; every card
  routes by slug.
- **U2 · Data layer.** Fragment composition, `Codable` models for
  Video/Dub/Series/Experience. **Carry the two-query dub split as a law**:
  `GetVideoBySlug` omits per-dub `downloads`+`subtitles`; `GetVideoDub`
  fetches them for the active dub only. RN's comment records that inlining
  them cost ~9.5MB / ~13s at 2,259 dubs (`birth-of-jesus`). An 8s timeout
  on the per-dub fetch, matching RN.

#### PR2 — Watch experience _(R1–R6, the largest viewer-facing gap)_

- **U3 · Watch detail screen (R1).** Details page, _not_ a player: hero
  backdrop (muted, looping, **detached** when fullscreen opens — decode
  slot), badge, meta line, title, teaser, action row, chapters/up-next,
  about, related questions, Bible quotes.
- **U4 · Dub selection (R2).** List = published dubs, sorted A→Z by display
  name, annotated _before_ sort so the write-back index survives.
  Unplayable hosts render disabled. Default resolution chain, once per
  video documentId, exact `languageSlug` match for preferences (never
  bcp47 prefix — "ko vs ko-kmr, en vs en-nai"): carried series language →
  persisted preference → device locale → video primary → English → first.
- **U5 · Subtitles (R3).** Fetch `vttSrc`, parse (port `parseVtt.ts`:
  `VttCue`, `findActiveCue`), render overlay driven by a periodic time
  observer. `contentOverlayView` is **non-interactive by contract** —
  correct for subtitles, unusable for controls.
- **U6 · In-player menu (R4).** `AVPlayerViewController` via
  `UIViewControllerRepresentable`, using `customOverlayViewController`
  (focusable) or `transportBarCustomMenuItems`. **Pitfall:** custom menu
  items reset when the player detects tracks — apply after `.readyToPlay`
  and re-apply on `mediaSelectionDidChangeNotification`.
- **U7 · Up-next (R5) + share/download (R6).**

#### PR3 — Series + Experience renderers _(R7–R8)_

- **U8 · Series (R7).** Episode rail + language panel.
- **U9 · SDUI pipeline (R8).** Swift enum with associated values +
  `@ViewBuilder` dispatch, mirroring RN's normalizer→dispatcher→renderer.
  13 block kinds; unknown kinds render nothing (RN's `PlaceholderRenderer`).
  **Note from research:** `AdventCountdownBlock` has a fragment and model
  in RN but _no renderer_ — it renders nothing today. Parity means matching
  that, not writing countdown math.
  **Invariant to preserve:** exactly one `videoHero`, authored first — the
  offscreen threshold is top-anchored and a second hero inverts the pause.

#### PR4 — Home + Search parity _(R9–R11)_

- **U10 · Hero queue (R9).** Port the deterministic pool queue; `businessDate`
  is a hand-rolled US-Eastern DST rule _specifically because_ a
  silently-ignored `timeZone` desyncs rotation across surfaces. In Swift
  this is `TimeZone(identifier:)` — but the **day boundary rule must match
  exactly** or TV shows a different day's hero than web.
- **U11 · Continue Watching (R10).** Thresholds are contract:
  `MAX_CONTINUE_WATCHING = 10`, `RESUME_MIN_SECONDS = 30`,
  `RESUME_MIN_PROGRESS = 0.25`, `RESUME_FINISHED_PROGRESS = 0.95`.
- **U12 · Search parity (R11).** Recent searches + browse. `.searchable`
  gives Siri Remote **dictation for free** — it is a property of the system
  keyboard, not of the API, and there is _no_ way to add the mic
  affordance (Apple DTS, FB16430866). Do not ship copy promising it.

#### PR5 — Settings + sign-in verification _(R12–R13)_

- **U13 · Settings (R12).**
- **U14 · Device grant end-to-end (R13).** Already built; never verified
  on hardware. Honor feat-322's laws: form-encoded standard OAuth
  endpoints, `invalid_token` as the real revocation literal, single-flight
  refresh, account-marker isolation on a shared TV.

#### PR6 — Showcase _(R14)_

- **U15.** Chapters, language hops, stills, stat interstitials. The RN
  dual-player design exists because `replaceAsync` blanks the tvOS surface.
  Research confirms **the same constraint applies to AVPlayer** (Finding 2),
  so budget for two players _or_ an accepted seam — this is the one unit
  where a custom `AVPlayerLayer` (abandoning `VideoPlayer`) may be
  justified, and `AVPlaybackCoordinationMedium` (tvOS 26) is the modern
  synchronization primitive.

#### PR7 — Telemetry _(R15)_

- **U16.** `dd-sdk-ios` directly. Its **tvOS support is a fresh
  verification item**, not an inherited patch — the RN patch was for the RN
  SDK. Zero-PII posture is a product law that binds regardless.

---

## Alternative Approaches Considered

- **One multi-audio manifest per video (server change).** Strictly better:
  deletes U4/U5 and makes selection native. Rejected _here_ only because
  the origin document scopes out new server capability. Raise separately.
- **Port RN's custom chrome pixel-for-pixel.** Rejected in the origin
  document; also directly implicated in the focus bug.
- **Apollo iOS + codegen.** Rejected: violates the zero-dependency
  constraint for ~10 queries.

---

## System-Wide Impact

### Interaction graph

Card select → route push → `GetVideoBySlug` (cache-first) → normalize →
active dub resolution (reads persisted preference) → `GetVideoDub` for that
dub → subtitle list → play → periodic time observer → progress write →
Continue Watching → (signed in) watch-event queue → flush to
`recordWatchEvent`.

### Error & failure propagation

Every network path ends in loading / content / error-with-retry (R16). The
per-dub fetch **rejects** on an 8s timeout in RN — a hung admin must
surface, not hang. Playback errors surface through AVKit's own UI; the
invalid-playback-id case renders an explicit state, never a dead player.

### State lifecycle risks

- Decode slots: a backdrop paused but attached keeps its slot → black
  fullscreen player. Teardown must **detach**.
- `scenePhase`: tear down on `.background` only; `.inactive` is a
  foreground blip. A suite covering only active/background passes for both
  the correct and the buggy implementation — **test the `inactive` case**.
- Account isolation: a signed-out TV must not leak the previous viewer's
  history (feat-322 law).

### API surface parity

Both apps consume the same admin queries. Any change to selections must
keep both compiling — this plan adds _no_ server capability.

### Integration test scenarios

1. Dub switch mid-playback preserves position within tolerance.
2. Subtitle cue timing tracks a seek (not just linear playback).
3. Continue Watching resumes at the stored second and disappears past 95%.
4. Hero queue on TV equals web's for the same business date across a DST
   boundary.
5. `inactive` (Siri overlay) does **not** tear down playback; `background`
   does.

---

## Acceptance Criteria

### Functional

- [ ] R1–R6 watch experience, including dub switch with position preserved
- [ ] R7 series; R8 all 13 block kinds (unknown → nothing)
- [ ] R9 hero matches web for the same business date
- [ ] R10 Continue Watching at the exact RN thresholds
- [ ] R11 search with recents + browse; dictation works on device
- [ ] R12 settings; R13 sign-in verified end to end on hardware
- [ ] R14 showcase; R15 telemetry with zero PII

### Non-functional

- [ ] **R17 · No focus dead ends** — every region has ≥1 focusable
      descendant at first layout; verified on the physical Apple TV
- [ ] **R16 · Every screen** reports loading/empty/failure with retry
- [ ] Two-query dub split preserved (no >5MB video payloads)
- [ ] Decode slots released on fullscreen open and on `.background`

### Quality gates

- [ ] XCTest for every pure projection, the VTT parser, the default-language
      chain, hero-queue determinism, and Continue Watching thresholds
- [ ] Each unit's device verification is confirmed by a human, not inferred
      from blind remote presses

---

## Risk Analysis & Mitigation

| Risk                              | Mitigation                                                              |
| --------------------------------- | ----------------------------------------------------------------------- |
| Focus fix does not hold on device | U0 gates everything; human confirmation required before U1              |
| Dub swap seam is unacceptable     | Frame-capture tvOS 18 vs 26 early; escalate the one-manifest server fix |
| Showcase needs a custom player    | Isolated in PR6, last; can ship parity-minus-showcase if it over-runs   |
| `dd-sdk-ios` tvOS gaps            | Verify before PR7; telemetry is additive and can degrade                |
| Scope (~28k LOC of behavior)      | 7 PRs, each independently useful                                        |

---

## Sources & References

### Origin

- **Origin document:** [`docs/brainstorms/2026-08-11-appletv-native-parity-requirements.md`](../brainstorms/2026-08-11-appletv-native-parity-requirements.md)
  — carried forward: full parity dependency-ordered; native-except-brand-surfaces;
  chrome is the platform's job; Android TV and server changes out of scope.

### Internal

- `apps/tv/src/lib/videoQueries.ts:10` — the 9.5MB/13s two-query law
- `apps/tv/src/lib/resolveDefaultLanguage.ts` — default dub chain
- `apps/tv/src/lib/parseVtt.ts` — `VttCue`, `findActiveCue`
- `apps/tv/src/lib/watchEvents/continueWatching.ts:14-19` — thresholds
- `apps/tv/src/lib/watchHome/heroQueue.ts` — `businessDate` DST rule
- `docs/solutions/ui-bugs/tvos-appstate-inactive-vs-background-video-teardown.md`
- `docs/solutions/ui-bugs/tv-backdrop-videoview-decoder-starvation-overlay-20260611.md`

### External

- [`focusSection()`](<https://developer.apple.com/documentation/swiftui/view/focussection()>) — the no-focusable-descendants rule (Finding 1)
- [`VideoPlayer(player:videoOverlay:)`](<https://developer.apple.com/documentation/avkit/videoplayer/init(player:videooverlay:)>) — overlay is below system controls
- [`preferredForwardBufferDuration`](https://developer.apple.com/documentation/avfoundation/avplayeritem/preferredforwardbufferduration)
- [tvOS 26 release notes](https://developer.apple.com/documentation/tvos-release-notes/tvos-26-release-notes) — AVPlayerLayer item-replacement fix (151902458)
- [`searchable`](<https://developer.apple.com/documentation/swiftui/view/searchable(text:placement:prompt:)>) + [dictation](https://support.apple.com/en-gb/guide/tv/atvb21adcfa9/tvos); mic affordance not customizable ([forum 773494](https://developer.apple.com/forums/thread/773494))
- tvOS 18 focus regressions: [698775](https://developer.apple.com/forums/thread/698775), [763591](https://developer.apple.com/forums/thread/763591), [760888](https://developer.apple.com/forums/thread/760888)
