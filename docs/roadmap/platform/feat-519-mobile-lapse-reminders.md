---
id: "feat-519"
title: "Mobile lapse reminders bring a lapsed viewer back to their last video"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-09-16"
duration: 3
depends_on: []
blocks: []
tags:
  - "mobile"
  - "platform"
---

## Problem

A ministry stakeholder asked for a way to bring people back into the app after
they drift away, and the team wants to lift retention. The app has no
re-engagement channel today: no notification capability, no reminder, and no way
to reach a person who has not opened it. Once a viewer closes the app, the only
path back is their own memory.

## Entry Points — Read These First

1. `docs/plans/2026-09-16-1101-feat-mobile-lapse-reminders-plan.md` — the
   implementation-ready plan. It carries R1-R19, AE1-AE9, KTD1-KTD9 and the
   seven implementation units, and it is the authority for every decision below.
2. `apps/mobile/CLAUDE.md`, section "Lapse reminders (local notifications)" —
   what an agent must know before touching this code.
3. `apps/mobile/src/lib/lapseReminders/` — constants (a dependency-free leaf),
   schedule (due-time math), payload (build and validate), notificationsAdapter
   (the only file that imports `expo-notifications`), lifecycle (the schedule
   pass), permissionPrompt, tapHandler.
4. `apps/mobile/src/lib/lastWatched/` — the slug-keyed record the tap resumes.
5. `apps/mobile/src/contexts/LapseReminderProvider.tsx` — the composition root.

## Grep These

- `LAPSE_REMINDERS_ENABLED` — the build-time gate, at three call sites
- `lapse_reminder.` — every Datadog event this feature emits
- `registerDeepLinkSlug` — how a reminder tap records its arrival
- `lastWrittenSlug` — the writer latch that is deliberately not reset on a clear

## What To Build

Delivered in U1-U6 on `feat/mobile-lapse-reminders`: the `expo-notifications`
dependency and its native configuration, the gate and due-time math and payload
contract, the last-watched record with its sign-out clearing, the schedule pass
behind one adapter, the first-launch permission prompt, and reminder tap
handling with deep-link attribution.

## Constraints

- Local notifications only. No server, no push tokens, no backend job.
- Two reminders per lapse, then silence. No repeats beyond day 7.
- Copy is two fixed English strings that never name the video.
- No exact-alarm permission on Android; the module's inexact fallback is
  accepted, and delivery may lag the target.
- No in-app path back after a permission decline.

## Verification

- `pnpm --filter @forge/mobile test`, `typecheck`, `lint`
- The four guards: app config, entry point, kill switch, and wiring
- **U7, the manual device pass, is the release gate and runs after merge**
  against real builds: a physical iPhone and a signed Android release build with
  a reboot. It is the only thing that can prove same-identifier replacement on
  Android, which no test in the repo can reach.
- Before release: final copy from the stakeholder, and read `aps-environment`
  from the production archive (the plugin writes `development` by default).
