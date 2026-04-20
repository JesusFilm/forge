---
date: 2026-04-17
module: platform
severity: medium
tags:
  - qa
  - e2e
  - maestro
  - playwright
  - testid
  - mobile
  - web
  - tv
---

# Local QA Pipeline — First Real Runs and testID Coverage Gap

## Problem

The cross-platform local QA pipeline (PR #795 — `/qa` Claude Code skill with Playwright for web, Maestro for mobile, and a custom YAML runner for TV) was stood up with comprehensive flow coverage (~135 flows, ~750 scenarios). On the first real end-to-end run, 30 flows failed.

Every mobile flow failure reported the same root cause: `Element not found: Id matching regex: tab-discover|tab-home|tab-library|tab-profile`. Every web flow failure traced to fragile `.or()` CSS selector fallbacks that couldn't find elements without a canonical hook.

## Solution

Add `testID` props to React Native components and `data-testid` attributes to Next.js components — matching the test-hook names already referenced by the Maestro flows and Playwright specs.

Two parallel commits (no file overlap):

- Mobile: `apps/mobile/` — 27 testID references covering tab bar, headers, search, cards, carousels, video controls, accordions, quiz, share, modals, playlists
- Web: `apps/web/src/` — 20+ data-testid attributes with parallel names where the component exists on both platforms (quiz-button, modal-close, mute-button, etc.)

Pure metadata additions — no component logic, styling, or user-visible behavior changed.

## Lessons Learned

1. **Flow authoring and testID coverage must ship together.** Authoring flows that reference testIDs without landing the corresponding component attributes guarantees flow failures on first run. Unblocking is easy (30 mechanical attribute additions), but delaying creates a false signal that the pipeline itself is broken.

2. **Maestro YAML syntax pitfalls surface only on first real run.** Invalid commands that were committed and passed through code review:
   - `wait: { milliseconds: N }` is not a command — use `waitForAnimationToEnd`
   - `scroll: { direction: DOWN, duration: N }` is invalid — plain `scroll` defaults to down, or use `swipe: { direction: ... }`
   - `clearText` is not a command — use `eraseText`

   Fix committed in `fix(qa): correct Maestro YAML syntax across all mobile flows`. Consider adding a Maestro YAML lint step before the QA pipeline runs flows.

3. **Android TV `monkey` returns exit code 251 even on success.** The custom TV YAML runner's initial Android TV adapter used `monkey -p {bundleId} -c android.intent.category.LAUNCHER 1` to launch apps. `monkey` returns 251 when it succeeds (a known Android quirk), which `execSync` treats as failure. Switched to `am start -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER -n {bundleId}/.MainActivity`. Now 38/38 Android TV flows pass.

4. **Bundle IDs in tests must match app.json exactly.** Initial flows referenced `com.jesusfilm.forge` (mobile) and `com.jesusfilm.forge.tv` (TV). Actual IDs per app.json are `org.jesusfilm.forgewatch` (mobile) and `org.jesusfilm.forgetv` (TV). A pre-flight step in the QA skill that cross-checks `appId` in flows against app.json would catch this before runtime.

5. **Playwright's `webServer` config forces spawn even with `reuseExistingServer: true`.** When the dev server is already running, Playwright tries to start its own and errors on port conflict. Fix: make `webServer` opt-out via env var (`PW_SKIP_WEBSERVER=1`) for local dev where the server is already up.

6. **Mobile Metro port conflicts are real in a monorepo.** With multiple worktrees each potentially running their own Metro bundler, the mobile app on iPhone simulator connected to the wrong bundler (a TV Metro on port 8081 from an unrelated worktree) and rendered as the TV app. Fix: kill stray Metro processes before starting the mobile dev server, or configure explicit ports per app.

7. **Android phone vs. Android TV emulators require separate setup.** `expo run:android` auto-selected the Android TV emulator for the mobile build even with `ANDROID_SERIAL=emulator-5556` set. Workaround: build the APK with `expo run:android`, then install manually with `adb -s emulator-5556 install <apk>`. Document the two-emulator setup as a prerequisite.

8. **tvOS adapter uses `idb` for fully-headless input, not AppleScript.** The initial implementation used `osascript` with macOS `key code` events, which required the Simulator to be the frontmost app and collided with whatever the developer typed during test runs. Swapped to `idb ui button` which routes through SimulatorBridge (XPC), matching Android TV's already-headless `adb shell input` model. No Accessibility permission, no frontmost requirement, no interference with host keyboard input. Install once: `brew tap facebook/fb && brew install idb-companion && pipx install fb-idb`.

9. **TV app `exclude: ["e2e/**"]`in tsconfig is required.** The TV YAML runner (Node.js script, uses`node:child_process`, `node:fs`) was picking up React Native type resolution, which doesn't include Node.js types. Excluding `e2e/\*\*`from the app's tsconfig lets the runner type-check correctly via`tsx` runtime.

## First-Run Pass Rates (Before testID Fix)

| Surface                    | Flows         | Passed        | Failed       | Duration           |
| -------------------------- | ------------- | ------------- | ------------ | ------------------ |
| Web (Playwright)           | 200 scenarios | 190           | 10           | 7.1 min            |
| iOS Mobile (Maestro)       | 49            | 29            | 20           | ~15 min            |
| Android Mobile (Maestro)   | 49            | 29            | 20           | ~15 min            |
| tvOS (custom runner)       | 38            | 38            | 0            | 6.7 min            |
| Android TV (custom runner) | 38            | 38            | 0            | 5.2 min            |
| **Total**                  | **374**       | **324 (87%)** | **50 (13%)** | ~50 min sequential |

After testID coverage lands, mobile and web failures should drop dramatically — targeting ≥95% total pass rate.

## Pipeline Operational Prerequisites

Before invoking `/qa` for the first time, verify:

```bash
# Tools
brew install maestro
npx playwright install chromium

# idb (headless tvOS input via SimulatorBridge)
brew tap facebook/fb
brew install idb-companion
pipx install fb-idb

# Env vars (persist in ~/.zshrc)
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$HOME/.maestro/bin"

# Simulators installed
xcrun simctl list devices available     # iPhone, Apple TV
$ANDROID_HOME/emulator/emulator -list-avds   # Phone + Android TV AVDs

# Apps built and installed per surface
#   iOS mobile: EXPO_TV=0 npx expo run:ios (in apps/mobile/)
#   iOS TV:     EXPO_TV=1 npx expo run:ios (in apps/tv/)
#   Android mobile: build APK, install on phone emulator with adb -s <emulator>
#   Android TV: install on Android TV emulator

# CMS running locally (or staging URL in .env.local)
pnpm --filter @forge/cms run dev
```

## References

- **QA pipeline PR:** https://github.com/JesusFilm/forge/pull/795
- **QA pipeline plan:** `docs/plans/2026-04-16-003-feat-cross-platform-local-qa-pipeline-plan.md`
- **Test scenarios doc:** `docs/plans/2026-04-16-003-e2e-test-scenarios.md`
- **testID coverage plan:** `docs/plans/2026-04-17-002-fix-qa-testid-coverage-plan.md`
- **Maestro YAML syntax fix commit:** `d93c2f5` (in PR #795)
- **Android TV `am start` fix commit:** (in PR #795)
- **Bundle ID corrections commit:** `f6426da` (in PR #795)
