# Watch animation settings

## Design and scope

- Visual: retain the exact original red Watch mark from the supplied motion studies, with the existing dark TV theme and white focus treatment.
- Content: Settings → Animations; independent Startup and Loading choices, all ten names, current selection, and a silent six-second preview.
- Interaction: remote-select a choice to save and preview it; Preview replays the saved choice. Startup defaults to 09 Cinematic reveal, Loading to 03 Breathing glow. Reduced motion uses the original static mark.

User addition: include **Restart app & preview** for startup. Save the current preferences before calling Expo's existing release-compatible `reloadAppAsync`; reload the current bundled app, not a store build/update, OS restart or forced process exit. Show a retry message if saving/reloading fails.

## Implementation

Bundle the exact SVG/CSS reference as TV-sized animated WebP assets using existing Expo Image, not a WebView or another video decoder. Only the chosen animation is decoded, with no runtime network requests. Keep the generation source/script in TV. Add optional validated IDs to the existing preference store, preserving existing player and language choices.

Keep the current once-per-fresh-launch, skippable audio intro and its bounded duration. Start app data providers immediately; do not add another animation wait or replay during navigation. For startup 09, reveal the edge and face, then hold the mark instead of looping back to darkness. Loading animations mount only for pending work; explicit Settings previews are time-bounded. Do not redesign native player controls or touch other app folders.

## Validation

Check defaults, all ten choices, independent persistence, invalid/old stored values, pending hydration writes, background/reduced-motion cleanup and routing. Run TV tests/typecheck/lint/format. Rebuild the authorized Office Apple TV build, check default startup and Settings focus/preview/persistence, capture evidence, and compare the intentional branding duration against the previous 6.8-second intro. Android runtime QA remains separately pending.

Reference: https://watch-logo-motion-studies.sevenuphome.chatgpt.site/ and `apps/tv/scripts/logo-motion-source.html`. These are motion studies, not newly produced Blender renders. Existing startup audio licensing remains a public-release gate.

## October 7 verification

User-reported exit follow-up: reproduced a no-op **Back to Settings** on the physical TV. The original button relied on `router.back()` and a usable previous route, which is not guaranteed after direct entry/restart. Both the visible button and focused remote Back now dismiss explicitly to `/settings`, with Expo Router's replace fallback when that route is absent. Settings also has explicit Home exit. Claim tvOS Menu only while each settings screen is focused and release it on blur; stop/reset previews before exit. Verify both button and remote exit after direct entry and normal Home → Settings navigation.

User copy follow-up: remove the visible “Press Select to skip” startup caption; keep the Select action and accessible skip label. No audio, timing or player change.

Exit/copy update installed on Office Apple TV on October 7: the visible **Back to Settings** button returned to Settings (`animations-button-exit-settings.png`), and remote Back exited Animations to in-app Home (`animations-remote-back-settings.png`; despite that filename, its pixels show Home). Remote Back therefore no longer leaves the viewer stuck, but the single-step intermediate Settings destination was not established in that run. The foreground startup choice was 06 during the final check; it was not reset. Current build includes the caption removal. 160 suites / 2,102 tests passed, followed by passing focused navigation/startup tests, typecheck, lint and formatting after the copy edit. No player layout change, uninstall or store upload.

- Development-signed Release 1.0.0 (14) built and installed on the physical Office Apple TV, preserving installed data. No store upload, push or merge.
- All ten reference effects are bundled as 768×512 animated WebP loops, approximately 6.03 seconds each. The encoder merges identical frames; frame counts vary but cycle duration is preserved. Combined animation payload is 3,193,564 bytes (3.05 MiB), plus the static mark. Only the chosen effect is mounted, no animation network request or movie decoder is added, and background/reduced-motion use the static mark.
- Fresh-launch Cinematic reveal was captured on the physical TV: edge first, then the red face, with startup sound. Startup holds the face after 4.4 seconds rather than fading/repeating the loop. The existing sound/end-event/timeout still owns completion; there is no second animation-completion wait.
- Native Settings layout, readable preview buttons, remote focus into the right-hand controls and **Restart app & preview** were checked. Pressing the restart button on the development-signed Release build reloaded the bundled app and replayed the selected 09 reveal. Watch continued into its existing auto-start Showcase afterward; that preference was not changed.
- Validation: 159 suites / 2,098 tests passed; typecheck, lint, changed-file formatting and `git diff --check` passed. Older/corrupt preferences, all ten valid IDs, independent hydration merge and save-before-reload ordering are covered.
- Evidence is in `/Users/up/Projects/forge-worktree-archive/2026-10-07/apple-tv-install/`: `cinematic-startup-and-settings.mov`, `cinematic-settings-contact.png`, `animation-settings-controls-focus.png`, `restart-controls-focus-check.png`, `after-restart-preview.png`. The Device Hub capture in this chat also shows the reveal immediately after selecting the restart button.
- A screenshot taken immediately after a deep-link launch can catch the native stack transition. Recheck the settled view before treating its temporary transparency as a layout failure. The user's auto-start Showcase also means cold Settings links are not used as the normal Settings navigation test.
- Android runtime verification and a matched before/after load/memory benchmark remain pending. Do not claim Android installation or public-release readiness from the shared implementation alone.

Asset reproduction uses the existing bundled Node packages: `LOGO_RENDER_NODE_MODULES=<bundled node_modules> node apps/tv/scripts/renderLogoAnimations.cjs`. No app dependency or lockfile change was required. SDK references: [Expo Image](https://docs.expo.dev/versions/v54.0.0/sdk/image/); installed `expo-modules-core/src/reload.ts` and platform `CoreModule` implementations establish reload support for the current bundled build.

## October 8 startup flicker fix

- Continued in the existing `codex/tvos27-scene-startup` branch at `/Users/up/.codex/worktrees/tv-release-consolidation/forge-dev-container`; preserved the other pending work.
- The supplied `flicker.mov` shows a blank at 7.683–7.700 seconds. The 4.4-second hold previously changed both the Image key and source, remounting it while the static PNG decoded.
- `LogoAnimation.tsx` now calls Expo Image's `stopAnimating()` on the same mounted image. The installed tvOS SDAnimatedImageView pauses its frame player without clearing the displayed frame. Inactive/background/reduced-motion behavior remains static; Settings previews still loop until their existing timeout. No new dependency, asset, startup delay, audio or player change.
- Release built and installed on the Apple TV 4K simulator, with a 3840×2160 startup recording. A 60-fps analysis of the three-second handoff window found no blank samples (179 samples; logo coverage stayed within 1,573–1,576 red pixels), versus two blank samples in the supplied recording. The startup proceeded to the populated Home screen.
- Validation: 162 suites / 2,107 tests, typecheck, lint, changed-file formatting and `git diff --check` passed. Regression guard ensures the hold uses the image ref without adding hold state to the key/source. No additional fetch, decoder or timer was introduced, and Home continues loading behind the unchanged intro completion gate.
- Proof: `/Users/up/Projects/forge-worktree-archive/2026-10-08/startup-flicker/Watch-Startup-Transition-Proof.mp4` (12 seconds, 4K/60 fps, simulator capture without audio); consecutive-frame sheet `fixed-handoff-frames.jpg` in the same directory.
- No physical-device install, Android runtime claim, commit, push or store upload for this fix. Existing Android/performance follow-ups remain open.

### Authorized physical update later on October 8

Installed development-signed Release 1.0.0 (14), including the flicker and Search
Back fixes, on Office Apple TV (tvOS 27.0), without uninstalling or clearing data.
The native dependency patch required refreshing Pods: the generated project still
referenced the unpatched pnpm path. After rebuilding/reinstalling, physical
Search -> Back returned to Watch Home. See feat-618 for failure/recovery evidence.
The flicker frame-by-frame proof remains simulator-only: this device supports
screenshots but `devicectl screen-record` reported unsupported capability. No
store upload, commit or push.

## October 8 scoped PR verification

- Ported only startup/loading animation foundations, scene lifecycle and Settings navigation to `codex/tv-startup-back-fixes`, based on current main. Top Shelf, Google TV Home/recommendations, player layouts, build numbers and other apps are excluded. Main already contains the Search Back dependency patch; it is not duplicated here.
- Reviewed lifecycle, navigation, persistence, accessibility and tests. Fixed a background-before-preferences-hydration audio race, restored the accessible loading/busy label, and rounded new Android font sizes/line heights.
- Scoped branch validation passed: 147 suites / 1,986 tests, focused final guards, typecheck, lint, repository-wide formatting and `git diff --check`.
- Built and installed Release on Apple TV 4K (3rd generation), tvOS 26.5, 3840×2160. Xcode 27 required the local build argument `TVOS_DEPLOYMENT_TARGET=16.0` for older generated Pods; no Pod configuration change was added to this PR.
- Fresh-launch video showed the animated image retaining its logo throughout a three-second hold window: 180 normalized 60-fps samples had identical nonzero red-logo coverage. Home was populated after the intro. This validates the visual handoff, not an audio or performance benchmark.
- Normal Home → Settings → Animations → one remote Back returned to Settings; the next returned Home. Direct Animations entry plus the visible Back button also returned Settings. Normal Home → Search → one remote Back returned Home; Search entered from Settings returned Settings.
- Local evidence: `/Users/up/Projects/forge-worktree-archive/2026-10-08/startup-pr-qa/`: `startup-scoped-build.mp4`, `startup-contact.jpg`, `home-after-startup.png`, `animations-remote-back-settings.png`, `search-back-home.png`.
- Android runtime, matched load/memory measurements and commercial startup-audio rights remain release gates. Tickets feat-615/616 remain in progress; this PR is not a store upload or public-release approval.
