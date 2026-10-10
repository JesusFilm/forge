---
id: feat-241
title: "TV/mobile fleet search token provisioning + rebuild"
owner: urim
priority: P1
status: in-progress
start_date: "2026-07-09"
duration: 2
depends_on:
  - feat-240
blocks: []
tags:
  - tv
  - mobile
  - search
  - infrastructure
---

## Problem

With admin per-IP fleet bucketing live (PR #1493) and dedicated fleet keys minted in admin
(feat-240), TV and mobile search still returns `401` on TestFlight/production until each app
ships a build that actually carries the fleet token. The client plumbing already exists — the
operation-scoped consumer bearer attaches to the `SemanticSearch` op only (TV
`apps/tv/src/lib/apolloClient.ts`; mobile PR #1226) — so only the token value and a rebuild
remain. This ticket un-embargoes the token and ships the builds.

> **Status 2026-07-16:** Token provisioned in EAS (`EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` per surface) and
> search verified working (no `401`) on preview builds for **Android TV, Android mobile, and Apple TV**
> (iOS mobile covered by inference). Stale docs refreshed (PR #1589). REMAINING: production store builds +
> ship (App Store / Play / Apple TV release) and an iOS-mobile production real-device check. Still gated by
> feat-240 (origin bypass + the `enforce` flip).

## Entry Points - Read These First

1. `apps/tv/.env.example` + `apps/mobile/.env.example` - `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN`
   (the client-side fleet bearer; unset today = search 401 on prod).
2. `apps/tv/src/lib/apolloClient.ts` - `authHeadersForOperation` attaches the bearer to the
   `SemanticSearch` op only; no client code change needed.
3. `apps/admin/CLAUDE.md` - "Fleet-aware rate-limit bucketing": deploy ordering + rotation.
4. EAS environments (`eas env:create` per profile) for `apps/tv` and `apps/mobile`.

## Grep These

- `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN`
- `authHeadersForOperation`
- `SemanticSearch`

## What To Do

1. **Provision the token.** Set `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` to each surface's own fleet
   key (from feat-240) in the TV and mobile EAS `production` + `preview` environments.
2. **Rebuild + ship.** Cut new EAS builds. TV → TestFlight via `xcrun altool -t appletvos`
   (NOT `eas submit`) + Android APK/app-bundle; mobile likewise. The token is inlined at build
   time, so an env change alone does nothing without a new build.
3. **Rotation overlap.** Keep the old fleet key valid in admin's `FLEET_ADMIN_API_KEYS` for a
   multi-week overlap until install metrics confirm the new binaries reached the fleet; only
   then have feat-240's owner remove the old value.
4. **Refresh stale docs.** Update `apps/tv/CLAUDE.md` and `apps/mobile/CLAUDE.md` to state the
   client token must live in admin's `FLEET_ADMIN_API_KEYS` (not `WEB_ADMIN_API_KEYS`).

## Constraints

- Do NOT start until feat-240 is deployed (receiver-first) — otherwise the first calls 401.
- A new build is required; do not assume an EAS env change alone activates the token.
- TV store delivery uses `altool`, not `eas submit` (which delivers tvOS as iOS and is rejected).
- Do not revoke the old fleet key while un-updated devices in the field still present it.

## Verification

1. On a TestFlight/production build, search returns results (not `401`) on TV and mobile.
2. Admin logs show `source=fleet` traffic bucketing per client IP; the `consumer:*:unknown`
   share stays near-zero (a rising share means a `cf-connecting-ip` drop / AOP regression).
3. Datadog `service:forge-tv` / mobile sessions show search succeeding for real devices.
