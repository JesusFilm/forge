# Android weekly-report integration into the TV feedback branch

## Scope

Bring the remaining Android TV improvements from the September 21 weekly report into `codex/tv-feedback-android-startup`: fast JESUS details and warm revisits, including strict canonical Mux URL validation; Resume/Start over loading through the first rendered frame; non-dropping on-screen Search input; first-press media keys; and focus restoration after closing player menus. Recheck offline Retry.

## Source and exclusions

The implementation source is the dirty `codex/android-home-startup` worktree. Port individual behaviors and tests, not the whole tree. Preserve the current feedback flow, Play TV-only manifest declarations, Profile pause, tvOS behavior, and installed Play app. Exclude old QA identity files, unrelated native track-picker work, and duplicate roadmap IDs.

## Validation

Run focused and full TV tests, TypeScript, lint, native compile, release APK build, then install a side-by-side QA package on the physical Chromecast. Verify Home, JESUS details/revisit, Search, Resume/Start over, player keys and menu focus, and Retry where safe. The weekly report's 34.45-to-3.37-second and 11.5-to-3.35-second numbers are historical, not a performance claim for this integrated build.
