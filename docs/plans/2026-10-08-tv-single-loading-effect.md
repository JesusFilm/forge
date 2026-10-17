# One selected TV loading effect

## Scope

Keep the existing startup intro, audio, timing and ten startup choices unchanged. Add the previous Watch logo with pulsing dots as the final **Loading effect** option, not a startup option. Keep loading default 03 and existing saved preferences.

Home/details pending work displays only the selected React loading effect. Android's native route dialog retains focus and Back ownership, but becomes a transparent input shield instead of painting a second loader. Do not open that shield while the startup intro owns input. Retain the pre-JS native cover and its focus guard, using a plain opaque background without a logo or dots. Native player buffering/resume covers are outside this change.

## Implementation

- `src/lib/logoAnimations.ts`, `watchPreferences.ts`, and `WatchPreferencesProvider.tsx`: separate loading IDs from startup IDs; append `dots` only to loading choices.
- `src/components/LoadingAnimation.tsx`: dispatch one selected motion effect or the previous logo/dots visual; respect background and reduced motion.
- `BrandedLoading.tsx`, `ScreenStateView.tsx`, and Settings previews: use the same loading selection.
- `AndroidLoadingDialog.tsx` and the native Android loading module: preserve request-ID cleanup and cancellation, without duplicate visual rendering.
- Preserve all other apps, player layouts, startup animation assets/provider, network requests, dependencies and lockfile.

## Verification

Test dots-last ordering, independent preference round trips, loading renderer selection and cleanup, Settings previews, and intro/dialog exclusion. Run TV tests, typecheck, lint, format and diff checks. No new asset, network request or startup delay; native route dots stop animating because they no longer render there.

Rebuild Android before runtime verification. On Chromecast check selected effect versus dots, cold/warm entry, slow Home/details, early D-pad/Select/Back and normal readiness. Record startup/time-to-usable-Home evidence; do not claim a runtime or performance pass without a connected target. Track remaining checks in feat-616.

## October 8 Chromecast install and smoke check

- TV validation passed: 150 suites / 2,013 tests, typecheck, lint, formatting and diff check. Android release assembly passed in 1m 23s.
- Connected physical Chromecast (Sabrina), Android 14, ARM32, over wireless ADB. Installed `org.jesusfilm.tv.startupqa`, version 1.0.0 / code 3, labelled **Watch Loading QA**, with the existing matching debug certificate. Generated, ignored Android configuration carries the QA identity; production source identity/version are unchanged.
- APK SHA-256: `910c4d095762442b52b71ba7af806db8b2a5a8dc0b9856ae16756ee963b9c0d7`.
- Preserved the Play-signed `org.jesusfilm.tv` beta and its data. With user permission, uninstalled old `org.jesusfilm.tv.homesdkqa` and `org.jesusfilm.forgetv`; their app data was removed, not backed up.
- Cold launch reached usable Home; recording shows no previous dots before the startup intro. Activity launch timing was 1,366 ms, which is not time to usable Home or comparative performance proof.
- Remote-key smoke reached Settings and Animations. **Logo + dots** appears after effect 10 in Loading, is selectable and previews. Restored Loading to **03 Breathing glow** after checking dots; left the app open.
- Evidence: `test-results/tv-single-loading-chromecast-20261008/` (ignored), including `cold-start.mp4`, `11-dots-last.png`, `12-dots-preview.png`, `13-restored-loading.png` and `16-home-ready.png`.
- Remaining: forced slow Home/details loading, early-input cancellation, preference persistence after cold restart, playback regression checks and comparative startup performance. This smoke check is not a full release QA pass; feat-616 remains in progress.

## Approved follow-up: hide the extra static startup logo

The user confirmed hiding the static logo seen before the startup animation. Keep the native cover opaque with its existing focus/Back protection, but make its child a transparent focus shield. Do not change `StartupIntroProvider`, its selected effect, sound, completion gate or duration. Rebuild and update the same Chromecast QA package, preserve its data, then record a cold launch and inspect the handoff. The earlier recording above describes the previous code-3 build, not this follow-up.

Follow-up completed locally: code 4 of **Watch Loading QA** installed with `adb install -r`, preserving the QA preferences and the separate Play beta. The transparent child skips drawing and animation; the opaque parent still owns the pre-JS backdrop and focus guard. Removed the now-unused `showDots` switch instead of adding another native loading variant.

Validation: 150 suites / 2,013 tests passed, typecheck/lint/format/diff checks passed, and final Android release assembly succeeded in 38s. APK SHA-256: `cc087e1fa7bfc87b568cd047d90619311ae716b18891a678a01229f4fbf73988`. Source/asset diffs confirm the startup intro, logo animation and startup sound are unchanged.

Physical Chromecast: `before-logo-removal.mp4` captures code 3; `logo-free-startup.mp4` captures code 4, without the extra static logo before the same selected animation, followed by usable Home (`17-logo-free-home.png`). Hardware Back during a separate fresh-launch check returned to Google TV Home. Activity launch time was 1,026 ms before and 929 ms after in this single paired sample; this is not a comprehensive performance benchmark or time to content readiness. ADB screen recordings have no audio; audible startup sound still needs the user's listening check. App force-stopped after testing so the user can reopen it fresh.

## Chromecast Restart app & preview follow-up

Code 4 is stuck on **Restarting…** after the user's button press. The release device log shows Expo reinitializing JavaScript but reusing the old React root (existing root ID 11); the old Settings UI remains visible. Back can still exit to Google TV Home.

Use the existing native Android module to recreate the Activity. The prebuild plugin must persist an `onDestroy` hook that clears the legacy React host **after** `super.onDestroy()` has detached the old root. Only this explicit preview restart clears the host; ordinary Back/configuration/background behavior must not. Save preferences before restarting, retain Apple's Expo reload, and do not kill the process, clear data, add runtime dependencies or change startup assets/provider/audio. Add save-order/platform/error and plugin-idempotency tests, rebuild the same QA package, then verify two remote-triggered restarts, selected-effect persistence, usable Home and warm resume. Keep the Play beta untouched.

Completed locally on `codex/android-loading-handoff`: `restartWatchForPreview.ts` saves preferences and chooses the Android native restart versus Apple's unchanged Expo reload. `PreviewAppRestart.kt` recreates the Activity and clears the host only for that pending restart, after the plugin-injected post-super destruction hook. The module has a compile-only reference to the app's existing React Android API; no new runtime package, permissions, dependency versions or lockfile changes. The current app uses the legacy architecture (`newArchEnabled: false`); revisit this path before enabling bridgeless React.

Validation: 152 suites / 2,022 tests, typecheck, lint, formatting and diff checks passed. Final ARM32-capable release build succeeded in 28s. Installed **Watch Loading QA** code 5 with the same certificate and `adb install -r --user 0`; retained preferences and the separate Play beta code 10. APK SHA-256: `6ed108490d5195044a30b113d694a19eecd92afc6a5e97bd88bf05558720cdba`. This QA run did not upload a store build.

Physical Chromecast verification: two D-pad Select presses on the focused **Restart app & preview** button each recreated the runtime, replayed the user's selected **09 Cinematic reveal**, and reached usable Home. Loading **03 Breathing glow** remained selected. Home-key background/reopen was HOT (140 ms activity launch), stayed on Home and did not recreate JS or replay the intro. Remote Back from Animations reached Settings, then Home. The observed restart log contains no old-root reuse error or fatal exception. Initial code-5 activity cold launch was 791 ms; this single sample is not a comparative startup benchmark or time to usable content.

Evidence in the same ignored folder: `18-restart-stuck-code4.png`, `restart-code4-root-reuse.txt`, `20-restart-focus.xml`, `restart-code5-first.mp4`, `restart-code5-second.mp4`, `restart-code5-second-contact.png`, `restart-code5-runtime.txt`, and screenshots 22–28. ADB recordings are silent; they prove visual restart behavior, not audible startup sound. The source/asset diff confirms the ordinary intro provider, animation renderer, sound and production identity are unchanged. Broader QA gates listed above remain open.

PR preparation on October 8: the complete TV suite, typecheck, lint and repository-wide formatting passed again. The reviewed diff is limited to `apps/tv` and related TV documentation. The device is now disconnected, so this PR relies on the earlier physical evidence rather than claiming a new hardware run. QA identity/version/signing changes live only in ignored generated Android files; no APK, credentials or local evidence recordings are included in the PR.

PR CI follow-up: GitHub's loading-renderer unit suite imported the real Expo image module through `LogoAnimation`, which initialized React Native without a native bridge. Isolate that leaf component with a test-only factory mock; retain every selector/props assertion and the real dots animation lifecycle tests. Production code and the installed APK are unchanged. Revalidate the complete suite and require green GitHub checks before the requested merge.
