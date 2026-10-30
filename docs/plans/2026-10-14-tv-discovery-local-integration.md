# TV discovery local integration

User scope: integrate personalized recommendations and Google TV Home locally,
retain the latest TV app and the imported development harness, and test before
any publication. The later October 14 instruction authorizes committing finished
changes, pushing a branch and creating a draft PR. PR merge, deployment and store
upload remain outside this task.

## Baseline and sources

- Upstream main: `58cd3946399a7a605482a8e1a0ac38f44989ca4f`.
- Local preservation checkpoint: `f53245305` (harness and durable dev-launcher fix).
- Personalization donor: `0ea12867aaecc0732fc30fcd1a2ef7cba10a8ab6`.
- System Home donor: `819b4166a534da380104f5f288dacf357a74fcac`.
- Local branch: `feat/tv-discovery-local`.

## Integration rules

Preserve current Apple Top Shelf authority fencing, cold/warm playback links,
preview styles, Native A default, Android startup/loading fixes, hidden Profile,
Search/Settings Back, and the development harness. Resolve overlapping code by
combining the feature additions with current behavior; do not replace current TV
files wholesale with archived versions. Keep native changes in Expo modules and
plugins. Preserve production Google discovery gating and explicit device Home
publication controls. Follow the current recommendation/analytics policy.

Scope: `apps/tv/` and these features' documentation. Reuse feat-630 for system Home;
renumber the donor personalization feat-599 to feat-697 because main already
uses feat-599 for a different feature. No backend/schema or root dependency changes.

## Validation

Run TV typecheck, lint, Jest, harness evaluation tests and changed-file formatting.
Build the tvOS simulator target; inspect Home, controls, playback and Back on the
4K simulator. Compare baseline/candidate launch timing using the same target and
configuration. Verify Android prebuild and build/runtime when local SDK/device
tools are available. Never infer native success from source tests.

The initial environment has Xcode/tvOS 27 and a working Debug baseline but no
Android SDK/JDK/ADB. Both current and SSD TV environments have a blank TV fleet
key. Live personalized delivery and backend playback acceptance require the
TV-owned credential; do not borrow another app's key or manufacture viewing facts.

## Results

Both donor branches are integrated locally on `feat/tv-discovery-local`, based
on the upstream main revision above. The original harness, startup fix, Apple
Top Shelf implementation, Search Back behavior, hidden Profile and player
defaults are preserved. No backend or root dependency changes were imported.

- TV Jest: **173 suites / 2,182 tests passed**.
- TypeScript, whole-app ESLint and harness changed-file formatting: passed.
- Development harness implementation: **20 tests passed**.
- tvOS and Android Expo prebuild: passed; tvOS CocoaPods: passed.
- Ad-hoc-signed Debug tvOS simulator build: passed using Xcode 27, tvOS 27,
  Apple TV 4K (3rd generation) `CF75173D-94F8-4863-91B3-23BB69F2A862`.
- XCTest Home → Settings → Back: passed. Inspected the rendered recommendation
  controls, visible focus, and return to Home. The missing-key error no longer
  steals focus from the top navigation.
- Android ARM64 Debug APK: **build passed**, including the Google Engage Kotlin
  module. JDK 17.0.20.1, Gradle 8.14.3, Android SDK 36, NDK 27.1.12297006.
  Artifact: `apps/tv/android/app/build/outputs/apk/debug/app-debug.apk` (147 MiB).
  `adb devices -l` reports no connected devices.
- XCTest native playback: **passed**. JESUS renders in Native A, pause holds at
  01:15 for three seconds, resume advances to 01:18, and remote Back leaves the
  native player for the detail page with Play focused. Evidence:
  `.local-tools/discovery-ui/playback3.xcresult`. No audible-audio or backend
  playback-acceptance claim is made.

Local evidence lives in `.local-tools/discovery-*.log`,
`.local-tools/discovery-ui/run3.xcresult` and
`apps/tv/test-results/development-harness/discovery-local-9c3628e8-a665-4013-ae78-f78c3de538fd/`.
These are ignored machine-local artifacts, not portable CI evidence.

## Remaining verification limits

- The initial credential block was resolved in the October 14 EAS follow-up below.
  Live delivery now works. Backend acceptance and projection of actual playback
  facts remain unverified; the earlier simulator playback was performed before
  the TV fleet key was configured.
- No selected Android TV device is available. An APK build does not establish
  Google TV Home placement, SDK service availability or production onboarding.
  Production discovery remains gated; adult opt-in Continue Watching is retained.
- Baseline/candidate launch comparison is **inconclusive**. The isolated baseline
  snapshot could not resolve its shared pnpm dependencies in Metro after bounded
  repair attempts. Candidate Home launches, but no performance non-regression
  claim is made. The failed baseline logs and XCTest result are retained.
- The harness's full acceptance must remain blocked while those gates are open.
  Existing feature tickets remain in progress for the broader release/runtime
  work. Historical beta-upload instructions are not authorization for this task.

## Integration findings

1. The older donor rejected every slate with fewer than six cards. The current
   owner policy accepts sparse coverage: render valid partial results and show
   coverage as empty, separately from service/transport errors. Regression tests
   cover partial delivery and a Thai audio context.
2. The default error Retry control requested TV focus as soon as the delayed
   recommendation request failed. Set `retryAutoFocus={false}` for this rail;
   renderer and simulator checks protect top navigation focus.
3. An idempotent selection/playback retry could outlive a recommendation privacy
   generation change. Capture the generation before the request and retire the
   retry when settings change; regression coverage ensures no second request
   uses retired authority.
4. Use ad-hoc signing for the tvOS Debug simulator build so SecureStore works.
   Source-only tests cannot establish credential storage or native playback.

## October 14 EAS login and live delivery follow-up

Completed Expo device login using the user's browser approval. Retrieved the
production environment from the existing TV EAS project
`jesus-film-project/jesus-film-forge-tv`
(`5c706719-0203-4c73-a663-e354b94f563d`). Its GraphQL endpoint matched this
checkout's existing endpoint. Copied only `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN`
into ignored `apps/tv/.env.local`, restricted file permissions, and removed
the temporary export. No keys were printed or committed; no remote variables,
account settings, app feature flags or production service configuration changed.

Ran the required TV environment setup and restarted Metro on port 8081 so Expo
loaded the key. The existing signed Debug app on the same Apple TV 4K simulator
now renders six live recommendation cards: Chosen Witness, Brothers, What Makes
You Happy?, 1.3 What Does This Life Mean?, Delight, and JESUS. Inspected the
rendered row and accessibility tree; evidence is in
`.local-tools/discovery-ui/live-eas.xcresult` and its exported attachments.
A second XCTest passed live-card delivery, D-pad focus, opening Chosen Witness's
matching detail page, and remote Back to Home:
`.local-tools/discovery-ui/live-eas-navigation.xcresult`.

This is live delivery evidence for the new local environment. The earlier
harness report remains a historical record of the pre-key environment; it does
not certify the changed environment. No synthetic playback facts or profile
resets were submitted. Android launcher and performance limitations above remain.

## October 14 feedback menu configuration follow-up

The local `EXPO_PUBLIC_TV_FEEDBACK_URL` was blank, so the existing conditional
rendering hid both the Home Feedback tab and Settings Send feedback entry.
Restored the TV project's feedback URL and associated Android Play Integrity
project number from its production EAS environment into ignored `.env.local`;
preserved the recommendations key and flags, removed the temporary export, ran
TV environment setup, and restarted Metro. No application source was changed.

XCTest passed Home Feedback visibility, remote focus, opening the feedback
screen, and returning Home with the screen's Back control. Evidence:
`.local-tools/discovery-ui/feedback-menu.xcresult`. The simulator screen reports
"Verified feedback is unavailable. Please try again later." The current Apple
feedback flow requires DeviceCheck; verified QR issuance is not established by
this menu check. No feedback report was submitted or verification bypass added.

## October 14 draft PR preparation

The owner requested committing the finished changes and opening a draft PR while
retaining the latest TV app and development harness. Fetched main at `0c22078df`;
its four newer commits affect admin/Mastra recommendation execution, not TV.
Prepare `feat/tv-discovery-draft` from that main revision with the integrated TV
changes, animation defaults and configuration guide. Preserve the original
`feat/tv-discovery-local` branch and local configuration/evidence. Exclude the raw
chat transcript from both the PR diff and its new commit history.

The local Top Shelf beta picker is now enabled in ignored `.env.local`. A fresh
4K simulator screenshot confirmed all six style options. The old Home/Settings
automation failed its Settings navigation assertion during this follow-up, so
this is visual menu evidence only; it does not supersede or erase that failed run
(`.local-tools/discovery-ui/top-shelf-picker-enabled.xcresult`). The earlier
successful animation and playback runs retain their original scope.

Keep the PR draft while Android runtime/Google Home placement, real-device feedback
verification, backend playback evidence acceptance and the integration performance
comparison remain unverified. Animation-only launch timings are recorded separately
in `2026-10-14-tv-animation-defaults.md`; they do not prove whole-integration
performance. Existing broad feature tickets remain in progress.

Draft preparation checks on the preserved final TV source: typecheck and whole-app
ESLint passed; Jest passed **174 suites / 2,185 tests**; development harness
fixtures passed **20 tests**. Compared the staged TV tree with the preserved
integration snapshot: all TV files, including Top Shelf and the harness, match.
Only documentation and the latest upstream changes differ from the earlier
local integration. Final commit hooks run staged lint/format and the repository
format check; no native rebuild is claimed for this packaging step.

PR packaging renumbers the TV development-launcher ticket from feat-696 to
feat-698 because fetched main already uses feat-696 for the Watch percent-escape
fix. No application source changes accompany this documentation correction.
