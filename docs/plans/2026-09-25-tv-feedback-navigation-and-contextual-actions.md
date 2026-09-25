# TV beta feedback: Home navigation and contextual actions

Status: implementation in progress. The entries and native bridges compile
locally; physical TV and phone acceptance is pending.

Roadmap: `docs/roadmap/platform/feat-551-tv-beta-qr-feedback-linear.md`.
Extends `docs/plans/2026-09-24-tv-feedback-railway-redis-linear.md`.

## Selected design

Keep **03 Home navigation** from the HTML concepts and add **Contextual action**
from the generated details/player comparison. Use these together as one feedback
entry system for Apple TV and Android TV.

| Surface                                                  | Entry                                                             | Destination                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| Home                                                     | `Feedback` tab after the existing navigation items                | Shared QR screen                                 |
| Film details                                             | `Send feedback` action after the existing film actions            | Shared QR screen with film context               |
| Player                                                   | `Feedback` action alongside the existing playback options         | QR presentation above the active player          |
| Search, Profile, Settings, series and experience details | `Send feedback` in the page's existing header/help or action area | Shared QR screen with originating screen context |

The destination title is exactly **The beta testing**. Supporting copy:
“Scan with your phone to report an issue or share an idea. Add a photo or video
to show us what happened.” Keep the QR large, the reference readable, and a clear
Back action. The generated image is a visual reference; native player controls
retain their platform-specific layout.

Do not introduce the floating corner button or shared side drawer. Preserve all
existing navigation items, including Interactive where present in the target
build. Reconcile the target branch with current navigation work before editing.

## Visual priority — updated after design review

Feedback must be easy to reach but visually secondary to browsing and playback.

- Home: keep `Feedback` last in the navigation bar, with the same readable type
  size as adjacent tabs, muted text and no badge, red accent or resting fill.
- Details: use a compact secondary `Send feedback` pill after the main actions.
  Use subdued neutral text and a light translucent surface; no full-width tile,
  bright red fill or attention animation.
- Player: place `Feedback` last among utility actions. Match their size and
  resting appearance, and show it only while normal player controls are visible.
  For Native A, use its existing transport menu placement rather than a new
  oversized row. Other players should keep a compact utility row.
- Secondary pages: use the existing Help/action area with the same quiet style.
- Keep sufficient text contrast and generous focusable bounds. Reduce emphasis
  through placement and color, not by making labels or remote targets tiny.
- Only the focused action becomes white with dark text and the existing subtle
  focus scale. Do not show a permanent red border or ring around Feedback.
- Keep `The beta testing` as the destination title; show no promotional feedback
  banner or persistent overlay during playback.

## Remote behavior

- Reuse System typography, WATCH_THEME surfaces and white-fill/dark-ink focus.
  Use the existing focus motion and scaled control sizing; avoid the generated
  mockup's red focus outline where it conflicts with current app conventions.
- Feedback is a text-labelled focusable control, never an icon-only target.
  Match at least the existing 72-unit Settings row height where a row is used.
- D-pad/touchpad movement follows the surrounding actions; Select opens feedback.
  No long-press gesture or repurposed system remote button is required.
- Preserve current initial focus on Home, Play/Resume, and Play/Pause. Adding a
  feedback action must not steal focus when a page opens.
- Returning from the QR page restores the originating Feedback button and scroll
  position. From a player, return to Play/Pause with the video paused; the viewer
  explicitly resumes.
- Player Feedback appears only with the normal playback controls. It does not
  remain over the video when the controls hide, and must not cover subtitles,
  the progress track, or skip buttons.
- If a controls row is crowded, use a deliberate second utility row or the
  platform's supported menu placement. Do not shrink labels to force a fit.

## Player lifecycle

1. Capture film, timestamp, audio/subtitle selections and originating player.
2. Pause playback and suspend auto-hide/auto-advance while feedback is presented.
3. Present the QR above the existing player, retaining the player instance and
   media item. Do not exit the film or push a route behind a native controller.
4. Back dismisses only feedback. Keep position and selections, restore controls,
   and focus Play/Pause. Repeated open/close and background/foreground cycles must
   not cause a black screen, reset, duplicate player or unexpected playback.
5. Preserve the same behavior for an already-paused video. If the player errors
   while feedback is open, retain the error and its normal recovery path.

## Implementation sequence

### 1. Shared entry and QR state

- Extract reusable grant loading, cache validation, expiry and retry state from
  `apps/tv/src/components/feedback/FeedbackQrScreen.tsx` into the feedback module.
  Keep one grant lifecycle across entry points and presentations.
- Add a small typed entry-context contract for source screen, film identifier,
  film title, timestamp, player, and selected audio/subtitles. Read current values
  at activation time; do not retain context from a previously opened film.
- Extend `apps/tv/src/lib/feedbackUrl.ts` and the receiving context validation only
  where needed. Prefer keeping detailed context server-side with the grant;
  never put credentials, signed media URLs or private account details in the QR.
- Treat supplied context as descriptive metadata, never proof of app identity.
- Use the existing feedback configuration gate consistently. Hide entries when
  feedback is not configured; after activation, show loading, retryable failure,
  expired or unavailable state with a working Back action.
- Update the shared destination title to `The beta testing`. Opening from a new
  entry point must not reset quotas, bypass attestation, or extend expiry.

### 2. React Native pages

- Home: add the Feedback action to
  `apps/tv/src/components/home/HomeTopBar.tsx` and wire it in
  `apps/tv/app/index.tsx`. Include it in existing focus-memory and up/down links.
- Film details: extend
  `apps/tv/src/components/watch/DetailsActionRow.tsx`, its action identity/focus
  types in `actionRowScrollGlide.ts`, and `apps/tv/app/watch/[slug].tsx`.
- Add contextual access to the existing page/action components used by
  `apps/tv/app/{search,profile,settings}.tsx` and
  `apps/tv/app/{series,experience}/[slug].tsx`; keep the existing Settings entry.
- Inventory additional interactive routes in the implementation baseline and
  apply the same contextual entry convention. Avoid adding controls inside
  keyboard, language or subtitle modal dialogs; returning to their parent must
  expose Feedback through a predictable path.

### 3. Players

- **Apple Native A:** add a labelled `UIAction` in the existing
  `updateTransportItems()` integration in
  `apps/tv/modules/native-swift-player/ios/NativeSwiftPlayerView.swift`.
  It already uses `transportBarCustomMenuItems` for Explore/language/subtitles;
  use that supported extension point instead of replacing AVKit controls.
- **Apple Native B:** add the contextual action in
  `apps/tv/modules/native-swift-player/ios/NativePlayerChromeView.swift` and wire
  its callback through `NativeSwiftPlayerView.swift`.
- Extend `NativeSwiftPlayerModule.swift` and
  `apps/tv/src/components/NativeSwiftPlayer.tsx` with the minimal feedback
  request/presentation/dismissal bridge. Present a native QR panel over the
  player using shared validated grant state. Do not instantiate another player.
- **Android native:** extend `NativePlayerChrome.kt`,
  `NativeAndroidPlayerView.kt`, `NativeAndroidPlayerModule.kt`, and
  `apps/tv/src/components/NativeAndroidPlayer.tsx` with matching behavior and
  explicit D-pad focus neighbors.
- **React player fallback:** locate its existing controls owner through
  `VideoPlayerContext` and add the same contextual action and pause/return
  behavior. Player preference/default selection remains unchanged.

### 4. Validation and delivery

- Unit-test context capture, capability gating, stale grant/context reuse and
  feedback open/close state transitions. Add regression coverage where a new
  focus identity or native bridge contract changes existing behavior.
- Run TV typecheck, scoped tests and native builds. Check documentation format.
- Inspect the new layouts at 1080p and 4K: readable labels, safe margins, focus
  growth without clipping, and no overlap with Explore or skip controls.
- On physical Apple TV and Chromecast/Android TV, test every entry with the
  remote, repeated Back/Select, playing and paused videos, resume playback,
  subtitles, QR loading failure, and network interruption.
- Scan the QR on a phone and confirm that a test report reaches Linear with the
  correct film, timestamp and source screen. Verify that opening another entry
  does not create additional report allowance.
- Measure Home and film-details load timing before/after. QR verification starts
  only when feedback opens; no background attestation request on each page load.
- Simulator/emulator testing may cover layout and navigation when requested;
  physical-device verification remains the release gate for attestation and
  native player behavior. Native bridge changes require new TV binaries.

## Done when

Every main page has an obvious labelled feedback entry; Home retains its selected
navigation design; details and all supported players offer contextual feedback.
The shared QR screen says `The beta testing`, returning preserves focus and
playback state, and a real TV-to-phone report reaches Linear through the existing
verified grant flow. Record device results separately from builds and UI previews.
