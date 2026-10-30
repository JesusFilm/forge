# TV animation defaults and menu switch

## Scope

Expose a code boolean for the Animations Settings menu, default it off, disable
startup animation and audio by default, and use the existing logo with three-dot
loader as the loading default. Preserve saved animation choices, all available
previews, the current players, Top Shelf and local environment configuration.
No native module or dependency changes are planned.

The code switches live together in `apps/tv/src/lib/logoAnimations.ts`:
`ANIMATION_SETTINGS_ENABLED` controls the menu and direct route, while
`STARTUP_ANIMATION_ENABLED` independently controls the launch intro. Both default
to `false`. `DEFAULT_LOADING_ANIMATION` becomes `dots`. Enabling the menu does not
implicitly turn on startup audio; existing stored selections remain available.

## Verification

Use the existing TV harness, TypeScript, lint, Jest and formatting. Cover disabled
startup without audio/playback gating, re-enabled intro lifecycle, default and
persisted loading choices, and both animation route switch states. Verify Settings
visibility and cold launch on the existing Apple TV 4K simulator. Compare two
baseline and candidate interactive-Home timings on the same Debug app and Metro.
These small samples are a local smoke comparison, not a release benchmark.
Android runtime remains unverified without a selected device; no native code is
changed by this task.

## Results

Implemented locally. Both code switches are left `false`; loading defaults to
`dots`. Disabled animation deep links redirect to Settings. The restart-intro
preview action is hidden while startup is disabled, while silent effect previews
remain available when the menu is enabled. Existing saved choices are preserved.

- TV typecheck, whole-app lint, Jest, and changed-file formatting passed through
  the development harness. Regression coverage includes disabled startup,
  re-enabled one-shot startup, animation route switch states, invalid/missing
  preferences and retained valid preferences.
- Apple TV 4K (third generation), tvOS 27, signed Debug dev client and Metro 8081:
  hidden Settings section, no startup intro, visible remote focus, and Settings
  Back passed. Temporarily switching only the menu to `true` restored the menu;
  navigation into Loading preview showed the selected default logo with three
  dots. Restored `false` and reran the final launch/Settings checks successfully.
- Interactive Home timings, two process launches each, same target/build/Metro:
  baseline **10.879 / 10.862 s**; final **3.949 / 4.057 s**. Mean changed from
  **10.870 s to 4.003 s**. These measurements include XCTest launch overhead and
  live catalogue responses; they are a small Debug smoke comparison, not a
  production benchmark. An earlier candidate pair was 3.839 / 3.753 s.
- Evidence: `.local-tools/discovery-ui/animation-baseline.xcresult`,
  `animation-enabled.xcresult`, and `animation-final.xcresult`; harness run
  `apps/tv/test-results/development-harness/animation-defaults-a5cc143d-ea9d-4176-9c66-6bc63f831daf/`.
- No native modules or dependencies changed. Android runtime/performance remain
  blocked without a selected device, so full cross-platform acceptance is not
  claimed. No push, deployment or feedback submission was performed.

## Maintenance note

Keep menu visibility separate from startup activation. Hiding a configuration
screen must not erase saved choices, and disabling the intro must prevent its
component/audio from mounting rather than adding another launch delay. The
process-local session starts completed when startup is disabled.
