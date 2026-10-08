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
