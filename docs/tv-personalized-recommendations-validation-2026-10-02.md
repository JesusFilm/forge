# TV recommendation implementation — validation checkpoint

Branch: `codex/tv-personalized-recommendations`.
Baseline: `cdfcb4eab` (consolidated TV beta).
Roadmap: `feat-599`, still **in progress**.

## Implemented

- Six-card source-free Home row, deferred until near the viewport, with exact
  audio-language requests and stable cards while the rail is being navigated.
- Installation tokens in SecureStore, inactivity-based session rotation,
  expired/lost-handle bootstrap and independent personalization choice.
- Narrow TV fleet operation allowlist; no account token or search viewer header
  on recommendation calls.
- In-memory selection handoff, episode claims, all-entry playback contexts,
  actual visible-playing intervals, source fencing and immutable bounded retries.
- State callbacks for Swift Native A/B, Android native and React playback.
- Settings grant/withdraw/reset, privacy fencing and pending-withdrawal recovery.
- Feature flag enabled in EAS beta profiles; explicit `false` retains the legacy
  Because you watched path. Missing flags leave the new feature disabled locally.

## Automated validation

TV Jest, strict TypeScript and whole-app ESLint are the current code gates.
Latest completed run: **144 suites / 1,989 tests passed**. TV typecheck and
whole-app ESLint (`--max-warnings=0`) also passed.
Tests exercise identity lifecycle, exact audio requests, privacy controls,
authentication header isolation, claim replay, stale attribution, strict payloads,
visibility qualification, real watch intervals, source changes and immutable
backoff. Mocked tests establish client mechanisms, not native device behavior.

## Live API check

Using the dedicated TV production fleet key pulled from the existing EAS
environment (value never printed or committed):

| Check                                | Result                                |
| ------------------------------------ | ------------------------------------- |
| Installation bootstrap               | Passed                                |
| `en` / `english`, count 6            | Served six items, positions 0–5       |
| Withdraw                             | `session_only`, personalization false |
| Grant                                | `active`, personalization true        |
| Reset                                | `active`, personalization true        |
| Temporary QA profile `delete` action | Accepted                              |

No synthetic playback facts were submitted. Acceptance and reconciliation of
facts from real native playback remain unverified.

## Pending release gates

### Build fix and visible demo — October 2, 2026

Added `plugins/withTVPodDeploymentTarget.js` and registered it in `app.json`.
Regenerated native files and Pods, then successfully built without a deployment
target override. Simulator ad-hoc signing is required for SecureStore; do not
use `CODE_SIGNING_ALLOWED=NO` for the recommendation demo.

Installed the signed build on `Watch Recommendations QA 4K`, connected it to this
worktree's Metro on port 8097, and verified real Recommended for you cards and
D-pad focus on Chosen Witness. The other chat's simulators were not modified.
All 145 suites / 1,992 tests, TypeScript and lint passed. The demo remains open.
No beta upload or full playback-evidence verification is claimed by this smoke.

Screenshot: `/var/folders/8x/js3sg86918nb2px_r6qmnt0w0000gn/T/screenshot_optimized_e7760bd5-384d-412e-b8d1-850d4c60e342.jpg`.

### Resume checkpoint — October 2, 2026

- Re-ran all 144 suites / 1,989 tests, TypeScript and whole-app lint successfully.
- Ran the mandatory TV environment setup; retained the existing TV token without printing it.
- Generated tvOS native files and installed 115 Pods successfully.
- Created an isolated simulator `Watch Recommendations QA 4K` (`EB131AEA-424A-4993-8D45-421710DC7750`) to leave other sessions' simulators untouched.
- Native build failed on ten Pod deployment targets set to tvOS 9–12; the installed Xcode SDK requires at least tvOS 15. Tracked in `.context/compound-engineering/todos/036-pending-p1-tvos-pod-deployment-targets.md`.
- Stopped this session's Metro on port 8097. No installation, native UI verification or beta upload completed. Android TV emulator was explicitly deleted during storage cleanup; creating another requires a new user choice.

The Mac had approximately 1.3 GB available; the user requested waiting while
they free disk space. No native build or beta upload was started.

1. Run `bash scripts/setup-sim-env.sh tv` before starting Metro; preserve the TV
   app's own EAS fleet key rather than borrowing a mobile credential. Set
   `EXPO_PUBLIC_TV_RECOMMENDATIONS_ENABLED=true` for this local QA build.
2. Build and test Apple TV 4K simulator and Android TV emulator, without touching
   physical Apple TV or another thread's booted simulator.
3. Verify row/focus/Back/layout and page-loading timings against the baseline.
4. Exercise all selectable players, pause, seeks, buffering, background, audio
   switches, Up Next, completion and exit. Verify accepted backend facts and
   retained outcomes from actual playback.
5. Verify unavailable language contexts, cooldown/in_flight recovery and offline
   retry on the rendered Home screen, while other Home rows remain usable.
6. Complete native builds and review, commit the validated changes, then build
   both beta binaries from that commit. Upload tvOS with `appletvos` to TestFlight
   and Android AAB to Google Play Internal Testing only. Verify processing and
   tester access before marking the roadmap complete.

Existing uncommitted `apps/tv-feedback` work was not modified. No production
backend configuration, schema, curated language pools or public store track was
changed.
