---
title: "Expo dev client can relaunch on a cached bundle — verify an edit reached the device by grepping the served bundle"
date: "2026-08-13"
category: "developer-experience"
module: "apps/mobile"
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Verifying that a source edit is actually running on a simulator or emulator dev client"
  - "A fix appears not to work after a force-stop and relaunch of the dev client"
  - "Judging device behavior right after editing code that only executes on certain screens"
tags:
  - expo-dev-client
  - metro
  - cached-bundle
  - fast-refresh
  - verification
---

# Expo dev client can relaunch on a cached bundle — verify an edit reached the device by grepping the served bundle

## Context

Twice during the SDK 57 regression work (2026-08-13), a force-stop and relaunch of the Expo dev client did not refetch the JS bundle from Metro — the app came back on a cached bundle from before the edit under test. Both times the edit appeared "not to work" and invited a wrong diagnosis. The tell in hindsight: Metro's log showed no new `Bundled` line for the relaunch.

## Guidance

Never treat a force-stop + relaunch as proof that the device runs current code. Two cheap checks make it certain:

1. **Prove the edit is in the served bundle** (Metro-side truth). Grep the bundle Metro serves for a literal your edit introduced:

   ```bash
   curl -s "http://localhost:8090/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&minify=false" \
     | grep -c "textureView"
   ```

   The count changing (or the literal appearing) proves Metro has the edit. It says nothing about the device yet.

2. **Force connected clients to refetch and remount** (device-side truth):

   ```bash
   curl -s -X POST http://localhost:8090/reload
   ```

   The reload endpoint makes every connected dev client fetch the current bundle and rebuild the React tree — unlike a cold app relaunch, which may serve from the client's cache.

A related trap with the same shape: `expo run:android` / `run:ios` deep-link the dev client at their own default Metro port. After a build, re-deep-link the client at the Metro you intend (`exp+<scheme>://expo-development-client/?url=http%3A%2F%2F<host>%3A<port>`), or the device runs a different checkout's code entirely.

## Why This Matters

Judging a fix against stale code produces confident, wrong conclusions in both directions: a real fix "fails" (invites reverting correct code) or removed code "still works" (masks a break). Both cost re-diagnosis loops that the two curl probes close in seconds. Native-prop edits are the worst case: some (like expo-video's surfaceType) only apply at view mount, so even a delivered update needs a remount — the reload endpoint provides both.

## When to Apply

- Before concluding any on-device verdict about an edit made since the app last provably fetched a bundle.
- Always after switching worktrees, branches, or Metro instances.

## Examples

From the incident: an import repair was pushed via file save; the app was force-stop relaunched; the hero still failed. The bundle grep showed the repair WAS served; the failure had a different cause (a stale native view). Without the grep, the repair itself would have been suspected. The complementary case earlier the same day: a relaunch reused a cached bundle and the edit truly was absent — the missing Metro `Bundled` line plus the grep caught it.

## Related

- `docs/solutions/developer-experience/deleted-worktree-under-live-metro-unresolve-error.md` — sibling class: the dev client faithfully running a Metro whose backing files vanished.
- `docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md` — the publish-time sibling: stale Metro cache at export time.
