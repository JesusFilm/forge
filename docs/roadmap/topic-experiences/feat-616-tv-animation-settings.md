---
id: "feat-616"
title: "Watch startup and loading animation choices"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-10-07"
duration: 2
depends_on: []
blocks: []
tags: [tv, tvos, android, startup, settings]
---

## Problem

Let beta viewers independently choose and preview all ten approved Watch motion concepts without losing the unselected options.

## Entry Points — Read These First

- `docs/plans/2026-10-07-tv-animation-settings.md`
- `apps/tv/src/contexts/StartupIntroProvider.tsx`
- `apps/tv/src/components/BrandedLoading.tsx`
- `apps/tv/src/components/settings/SettingsScreen.tsx`
- `apps/tv/src/lib/watchPreferences.ts`
- `apps/tv/scripts/logo-motion-source.html`

## Grep These

`LogoAnimation|LOGO_ANIMATIONS|startupAnimationId|loadingAnimationId|AnimationSettingsScreen`

## What To Build

Shared bundled animation component and native remote-focus Settings page. Defaults: startup 09, loading 03. Persist both IDs in existing preferences; all ten remain available for both uses. Six-second silent previews; loading runs only for pending work.

## Constraints

Original logo outline and branding, TV-only write scope, no player layout changes, no runtime WebView or new decoder/dependencies. No added delay beyond the existing bounded skippable fresh-launch intro. Keep previous preferences and startup audio rights gate.

## Verification

TV unit/guard tests, typecheck/lint/format and physical Apple TV build/UI/persistence proof. Record asset size and measured startup timing. Android runtime QA is pending separately.

October 7: all ten assets/configurable choices implemented; physical Apple TV Release build installed. Default 09 startup, native Settings focus/layout and the new Restart app & preview action verified. 159 suites / 2,098 tests passed. Evidence and remaining Android/performance gates are in the linked plan; this ticket stays in progress pending those checks.

October 8 scoped PR branch: 147 suites / 1,986 tests and static checks passed. Release 4K simulator verified one remote Back from Animations to Settings, then Home, plus the visible exit after direct entry. Unlike the earlier physical run, the intermediate Settings destination is now verified. Android runtime and matched performance checks remain pending.

October 8 Android follow-up is in progress on `codex/android-loading-handoff`: add the old dots as the last loading-only option and eliminate duplicate route-loading visuals while preserving the startup intro. Scope and verification: `docs/plans/2026-10-08-tv-single-loading-effect.md`.

October 8 user-approved follow-up completed locally: extra static Android startup logo hidden behind a plain opaque pre-JS input cover; startup animation/sound code unchanged. QA code 4 installed on Chromecast; recorded cold launch to Home and hardware Back exit verified. 150 suites / 2,013 tests and static checks passed. ADB video is silent, so audible sound confirmation remains a user check; broader performance and QA gates remain open.

October 8 restart follow-up in progress: Chromecast code 4 remains on "Restarting…" after Expo's legacy-architecture JS reload. Device logs show the old React root being reused with an existing ID. Replace only Android's preview restart with Activity recreation and a fresh React host after the old Activity/root has detached; preserve preferences, Apple TV's existing reload and ordinary startup/audio behavior. Verify repeated remote-button restarts on the same Chromecast QA package.

October 8 restart follow-up completed locally: QA code 5 installed preserving data. Two Chromecast remote-button restarts replayed the saved 09 effect and returned to usable Home; Loading 03, warm resume without replay, and Animations → Settings → Home Back paths verified. 152 suites / 2,022 tests and static checks passed; ARM32 release build passed. Evidence and legacy-architecture constraint are in the linked Android plan. Broader QA/performance gates keep this ticket in progress; this QA run did not upload a store build.
