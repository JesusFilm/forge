---
id: "feat-596"
title: "Pause Profile on Apple TV and Android TV"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-09-25"
duration: 1
depends_on: []
blocks: []
tags: ["tv", "auth", "navigation"]
---

## Problem

Profile is still visible in development builds and in release builds whose EAS environment has the old opt-in flag. The product decision is to hide it on both TV platforms for now without removing the sign-in implementation.

## Entry Points — Read These First

1. `apps/tv/src/lib/auth/profileFlagState.ts` — shared visibility policy.
2. `apps/tv/app/index.tsx` — Home top-bar Profile entry.
3. `apps/tv/app/profile.tsx` — direct route and device-grant side effects.

## Grep These

- `resolveProfileSurfaceEnabled|isProfileSurfaceEnabled`
- `home-topbar-profile-tab|ProfileRoute`
- `EXPO_PUBLIC_TV_PROFILE_ENABLED`

## What To Build

Make the shared gate return false on Apple TV and Android TV regardless of build type or the old EAS flag. Redirect direct Profile route visits to Home before mounting its sign-in flow. Keep the underlying grant and account code for a later product decision.

## Constraints

- Do not remove saved account data or alter device-grant server behavior.
- Do not modify mobile, web, or store environments in this change.
- The old flag may remain provisioned temporarily; it must have no effect.

## Verification

- Unit-test the visibility policy with dev, release, and opt-in inputs.
- Typecheck and lint the TV app.
- Confirm Home has no Profile tab on both platforms and direct `/profile` returns Home.

## Progress — 2026-09-25

- Shared-gate tests pass with development and release inputs, including the old opt-in flag.
- Android TV QA build installed on the physical Chromecast; Home shows no Profile tab.
- Physical Apple TV build and screen check remain pending because XcodeBuildMCP is unavailable in this task.
