# Apple TV Top Shelf integration

## Scope and provenance

Task 2, feat-603. Source: `/Users/up/.codex/worktrees/tv-release-consolidation/forge-dev-container`, branch `codex/tvos27-scene-startup`, committed base `819b4166a` plus tracked and untracked Top Shelf changes. Source remains untouched.

Integration: reuse the clean Apple TV checkout `/Users/up/.codex/worktrees/tv-startup-pr/forge-dev-container` on `codex/apple-tv-top-shelf-integration`, based on main `77f6563ed`.

Reviewed previous TV PR states: #2222 native Swift players, #2422 beta feedback, #2070 Search Back, #2610 startup/Settings Back, and #2623 single loading/restart are merged. Keep their code and production identifiers. Do not restore old startup assets, loaders, navigation patches or generated build 14 settings from the donor.

## Missing from main

- Native Top Shelf extension, bundled verified editorial artwork/preview, App Group bridge and persistent Expo target/entitlement/version plugin.
- TV-owned recommendation client dependencies needed for eligible public snapshot content; credentials stay inside the app, never in the extension.
- Bounded, stable daily snapshot synchronization, real Continue Watching progress, collection/topic destinations and cold/warm intent handling.
- Apple TV beta Settings selector: Automatic plus five concepts, refresh status and eligible-content fallback. Production ignores beta preview choices.

Exclude the donor's Android Engage SDK/publisher, Android Home Settings and unrelated root dependency/lockfile changes. Integrate shared entry points surgically; do not replace the donor's whole Home, Settings, preferences or player route.

## Review and implementation

Follow `docs/roadmap/topic-experiences/feat-603-tv-system-home-five-concept-rotation.md`, `docs/tv-system-home-validation-2026-10-02.md` and `docs/analytics-and-recommendation-policy.md`. Review schema/eligibility, language, publication/playability, privacy generation fencing, extension bounds, route validation, target idempotency and matching app/extension build versions.

## Verification and delivery

Run scoped tests, whole-TV tests, typecheck, lint, repository formatting and native prebuild/build. Use the Apple TV 4K simulator only. Check eligible styles and unavailable-style fallback, remote focus, Play/More Info, cold/warm opening, real saved progress, startup/loading/Back regressions and load timing against main.

Record actual simulator scenes with explanatory narration/captions and label any unsupported or unverified OS interactions. Deliver the video, a focused PR and remaining verification. Do not claim physical-device or TestFlight/store release proof. Do not merge this new PR unless requested.

## Verification history

- Imported the missing Apple extension/bridge/sync/selector and required TV-owned recommendation client, not the Android Engage work. Added only Top Shelf seams to latest main's Home, Settings, preferences and watch route. Android warm-link behavior remains unchanged; cold Apple shelf playback waits for the existing intro and preferred dub.
- Initial targeted checks: 11 suites / 84 tests and TV typecheck passed. Whole-TV run reached 164 suites / 2,109 tests with one expected auth allowlist assertion needing the newly enabled recommendation operations; extended that assertion and added per-operation credential-separation cases. Follow-up targeted run: 10 suites / 88 tests passed, including preview/preference and integration guards. Full final validation remains pending.
- Main baseline is `77f6563ed`. Saved integration changes in recoverable Git stash `d5b43e02780247f8083d04d84d58c75dcd84e8a8`, built the unchanged main source, then restored the exact stash without dropping it. Xcode 27 initially rejected old CocoaPods deployment minima; baseline build used `TVOS_DEPLOYMENT_TARGET=16.0`, matching the integration's persistent plugin minimum.
- Baseline Release native compilation succeeded according to the completed build log despite the MCP request timing out. Log: `/Users/up/Library/Developer/XcodeBuildMCP/workspaces/forge-dev-container-fdf8d06a3dc8/logs/build_run_sim_2026-10-08T06-39-54-152Z_pid12081_adf01c42.log`. Built app: the same workspace's `DerivedData/Build/Products/Release-appletvsimulator/JesusFilmWatch.app`. Installation, timing and visual baseline capture are not yet verified.
- Build output grew disk usage; only about 350 MiB remains. No cache was deleted. Requested approval to remove only the old donor cache's `DerivedData/JesusFilmWatch-0e946430b3db/Build` (about 4.3 GiB), preserving source, logs, simulator data and the newly compiled baseline. No external volume is mounted.
- Mac is locked; requested manual unlock. GUI remote control and walkthrough recording remain blocked until it is unlocked. Native Top Shelf prebuild/build, app/extension version matching, runtime links/progress/all-five visual checks and video are pending, not passed.
- Correctness review reproduced a retirement race: a native write completing after cache reset re-created the retired local snapshot and reported success. Added a post-native-await authority/foreground/cancellation fence with a failing-then-fixed regression test. Native write/clear operations now share one serial background queue so an earlier write cannot overtake a queued clear or language replacement. Swift queue API was checked against the installed Expo Modules Core; feature native build remains pending.
- Simplicity/scope review removed the donor's unrelated playback-learning/selection/evidence APIs and queue. Kept only recommendation reads, anonymous identity and existing personalization-control semantics needed by shelf authority fencing. Fleet allowlist adds only the three required recommendation operations; all original search/account header isolation remains.
- Runtime found the Continue Watching card remained black: the normal session selected Tera while the shelf autoplay gate waited for English with an unset preference. Top Shelf now explicitly selects the eligible link language using the session setter's non-persisting option; normal one-argument user selection still saves preferences. Added a regression test for the no-write seam. Native replay/progress verification requires the rebuilt bundle; the earlier black frame is failure evidence, not a resume pass.
- User approved deletion of only the old donor `Build` folder. Rechecked canonical path and idle handles, removed that exact folder without force flags, and verified source, logs, simulator data and current baseline build were retained. Free space rose to about 4.9 GiB immediately; later concurrent/APFS changes showed more space, not attributed solely to this deletion. No other cache was removed.
- Mac unlock verified. Xcode 27 uses Device Hub, not the old Simulator.app path; its named remote buttons operate the selected Apple TV 4K simulator. Baseline installation/launch and usable Home are now visually verified. Main shows the static red Watch logo on system Home, captured at actual 3840×2160 resolution.
- XcodeBuildMCP video start succeeded but stop failed to save its `axe-video` output twice. Switched to the native `simctl io recordVideo` recorder, stopped the exact recorder with SIGINT, and verified a valid 3840×2160 MP4. This is real simulator footage, not generated UI. Baseline Home and cold-launch recordings are saved under `test-results/top-shelf-integration-20261008/` (ignored).

## October 8 current result

- Release build passed after the resume-language fix, then passed again after rejecting duplicate autoplay parameters consistently on cold and warm links. App and embedded `ForgeTopShelf.appex` both report version **1.0.0 / build 1**, the same App Group, and a valid deep simulator signature. This is local simulator signing, not distribution provisioning.
- Whole-TV validation: **165 suites / 2,116 tests passed**, typecheck and lint passed, repository format check and `git diff --check` passed. Plugin tests verify repeat prebuild target/resource/dependency idempotency and Expo/native build-version parity. Native prebuild and CocoaPods installation passed with no root dependency or lockfile change.
- Apple TV 4K (3rd generation), tvOS 26.5, actual 3840×2160 capture. Live API recommendations published Spotlight (3), Collection (5), Short (5, 84–565 seconds), Journey (one real matching topic), and Continue Watching (one existing JESUS history item). All five rendered on system Home. Automatic restored its stable Collection selection. No mock recommendations or watch history were inserted.
- Selecting the real Continue Watching JESUS card opened moving Native A playback. Saved position was 1,160 seconds before entry and 1,184 seconds after playback; audio preference stayed null and Native A stayed selected. Remote Back returned to Watch Home. The earlier black frame remains failure evidence and is not included as a successful demo.
- Warm system Home Collection selection opened Chosen Witness details. Journey selection opened the matching “What Really Makes Us Happy?” collection with focused film cards. Cold More Info URL opened film details; cold Play URL completed the existing intro, opened moving Native A and retained saved progress. Search → remote Back returned to Watch Home on the final installed build, preserving #2070.
- Startup samples from baseline main and integrated Release builds both first show usable Home at approximately nine seconds at one-second sampling. This is a single paired visual smoke comparison, not a statistical benchmark. Top Shelf fetch starts four seconds after Home and remains off the intro/render-critical path.
- One beta refresh reported unavailable recommendations; reselecting succeeded and the unexpired shelf was retained. No server security or language eligibility was relaxed. Low-resolution unused donor artwork was excluded from the PR; only catalog-referenced resources are included.
- Recorded footage is under `test-results/top-shelf-integration-20261008/`. The narrated edit is `Watch TV - Apple TV Top Shelf Integration - 2026-10-08.mp4` in Downloads. It labels baseline, beta selector, five concepts, real resume, cold entry and remaining gates. Simulator source capture is silent; the edit adds local English narration, not a claim of captured startup audio.

## Remaining verification

- Native carousel fullscreen artwork renders, but its OS Play/More Info buttons could not be reliably focused using Device Hub's directional remote controls. Link semantics and cold/warm destinations are tested; the actual native carousel button interaction remains open.
- Signed App Group/extension provisioning and a distribution archive/TestFlight processing were not attempted or authorized here. Simulator build 1 is not a store release.
- Android Engage/Google Home integration and its onboarding/device gates are excluded from this focused PR. Feat-603 stays in progress for those broader gates; the Apple integration milestone is implemented and simulator-verified with the exceptions above.
- Source donor, primary checkout, stash and prior startup/loading/navigation changes remain preserved. New PR is for review only; do not merge without user direction.
