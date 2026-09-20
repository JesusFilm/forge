---
id: "feat-519"
title: "Mobile lapse reminders bring a lapsed viewer back to their last video"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-09-16"
duration: 3
depends_on: []
blocks:
  - "feat-524"
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

## Unapplied review findings

All six actionable findings from the Tier-2 review (run
`20260917-093538-f3da69b2`) were applied. These are the justified concerns that
review raised and this change deliberately did NOT act on, with the reason.

- [ ] **Same-identifier replacement is unproven on Android.** The lifecycle
      suite's fake adapter is a `Map` whose `set()` overwrites by construction,
      so every R5 assertion — including the 300-iteration fuzz case — proves
      only JS promise-chain serialisation. The plan's own Android contingency
      (schedule the new pair, then cancel the old) was never implemented. Only
      U7 can settle this. _Raised by: testing._
- [ ] **`dismissDelivered()` is app-wide, not feature-scoped.** It maps to
      `dismissAllNotificationsAsync()`, so every sign-out and every
      denied-permission pass clears all of the app's notifications. Harmless
      today: the only other producer is the download foreground-service
      notification, which Android will not let `cancelAll()` remove. Any future
      non-FGS notification would be silently cleared. _Raised by: correctness._
- [ ] **The payload's slug allowlist is narrower than what the store
      persists.** `payload.ts` accepts only the RFC 3986 unreserved set;
      `snapshot.ts` persists any 1-200 character string. A production slug
      outside that set degrades every reminder for that video to Home, and the
      pass still logs `outcome: "scheduled"`, so nothing separates a real watch
      payload from a silent Home fallback. Admin's full slug space was never
      enumerated. _Raised by: correctness._
- [ ] **The wiring guard proves token presence, not slot wiring.** Its
      `missingWiring` check passes as long as a token appears anywhere in the
      provider, so `subscribeToRecordClear: () => () => {}` would survive it.
      The new kill-switch gate over the last-watched writer is not pinned by it
      either. _Raised by: adversarial._
- [ ] **The per-kind native calls run sequentially.** Running the two
      concurrently would shorten the background pass, which matters because
      Android can end the process mid-pass. Declined for now: the benefit is
      unmeasured, and the fake adapter cannot show whether the native scheduler
      tolerates concurrency, so no test here could catch a regression. Revisit
      with U7 evidence. _Raised by: the simplify pass's efficiency reviewer._
- [ ] **`createLapseReminderLifecycle` has no active/detach guard**, unlike the
      tap handler and the permission prompt, which both carry one. Its detach
      only unsubscribes, so queued passes keep running. Not production
      reachable: the provider's effect has `[]` deps and sits above the
      element-type-swapping shell. _Raised by: adversarial._
- [ ] **Importing `expo-notifications` runs `DevicePushTokenAutoRegistration.fx`
      at module scope** from the root layout's guarded require block, on the
      cold-launch critical path. No token is fetched, so "local notifications
      only" holds, but it is unmeasured startup work on every launch. _Raised
      by: adversarial._
- [ ] **The kill switch only acts when the app is next opened.** Reminders
      already pending on a device whose owner never reopens still fire with
      their original payload. Inherent to an OTA-flipped local-notification
      gate. _Raised by: adversarial._
- [ ] **`docs/roadmap/README.md` was not regenerated** for this ticket. Its
      generator blanks the Start/Due cells when run from NZ, so regenerating it
      here would corrupt the index.
