---
id: "feat-798"
title: "Mobile release check runner on five local test devices"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-10-21"
duration: 10
depends_on: []
blocks:
  - "feat-888"
tags:
  - "mobile"
  - "infrastructure"
---

## Problem

No automatic check runs the native mobile app before a release. CI does not build a native app or start a simulator, so the checks before a TestFlight build or an over-the-air update are done by hand on one device at a time. A five-device agent pass on 2026-10-15 found 66 problems, and several of them occurred only on some form factors. A test run must also not put data into production analytics (Firebase and GA4, Mux Data, Datadog) or production admin records.

The requirements live in `docs/plans/2026-10-21-1206-feat-mobile-release-check-runner-plan.md` (R1–R38, F1–F3, AE1–AE13). This ticket points to them and does not repeat them.

## Entry Points — Read These First

1. `docs/plans/2026-10-21-1206-feat-mobile-release-check-runner-plan.md`: the Product Contract, the Key Decisions with their session-settled labels, and the Deferred to Planning questions.
2. `apps/mobile/src/lib/adminEndpoint.ts`: the release default to production admin, and the dev-only loopback rewrite.
3. `apps/mobile/src/env.ts`: every `EXPO_PUBLIC_*` value that the test build must set or leave unset.
4. `apps/mobile/src/lib/recommendations/enabled.ts`, `apps/mobile/src/lib/signInGateState.ts`, and `apps/mobile/src/lib/datadog.ts`: the switches that R17 checks.
5. `packages/admin-graphql/src/operations/` and `apps/mobile/src/lib/queries.ts`: the writes that the read-only server must block.
6. `apps/mobile/app/`: the Expo Router screens and route sheets for the screen list check (R22).
7. `apps/mobile/eas.json` and `apps/mobile/app.json`: the profiles, channels, `updates`, and `runtimeVersion` settings.
8. `.claude/commands/build-android.md`: the repo command format.
9. `docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md` and `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`.

## Grep These

```bash
rg -n "mutation [A-Z]" apps/mobile/src packages/admin-graphql/src/operations --glob '!**/__tests__/**'
rg -n "EXPO_PUBLIC_[A-Z_]+" apps/mobile/src/env.ts
rg -n "testID=" apps/mobile/app apps/mobile/src --glob '!**/__tests__/**' -l
rg -n "presentation: \"formSheet\"|READER_SHEET_SCREEN_OPTIONS" apps/mobile/app
rg -n "enqueueWatchSearchTrace" apps/admin/src
```

## What To Build

Follow the plan's Requirements. In short:

- A repo Claude command that asks for consent and starts a plain runner script, and a one-time setup step (R1–R6).
- Five named test devices, one local release build for each platform from a clean working tree, a committed test settings list that copies production's settings that are not secret, a device limit set from free memory and load, a one-device speed pass, and a restart for a device that stops answering the device tools (R7–R11, R33).
- A local read-only server on IPv4 and IPv6: only listed reads go to production admin without credentials, repeated reads reuse their first answer, search comes from saved answers in the repo, and writes are never forwarded (R12–R15, R35).
- Firebase Analytics off permanently in the test build, a check of each build before the run, and a check of the server log after it (R16–R18, R34).
- Fixed journey scripts for every screen and sheet that a signed-out viewer can reach on each platform, a screen list check, and the Not-Tested List (R19–R25).
- A local HTML report that opens with a run summary, in which every failure fails the run, with "known" and "flaky" labels and the same end for every run (R26–R32, R36–R38).

## Constraints

- Do not edit `apps/admin`.
- No test run may send data to Firebase Analytics, GA4, Mux Data, or Datadog, or forward a write or a search request to production (R13, R16).
- The runner must not use or stop a simulator or emulator that it did not create (R7).
- Commit no secrets. The test build needs none (R6).
- A run must not need Claude (R3).

## Verification

- The setup step and a full run succeed on a fresh clone, and the report opens.
- AE1–AE13 of the plan pass, including a build with a planted Datadog token (AE1), an emulator that stops responding (AE6), and a build without the permanent Firebase Analytics off setting (AE9).
- The read-only server log of a full run shows no write and no search request sent to production (R18).
- The screen list check fails a run when a screen with no journey is added, and passes when that screen goes on the Not-Tested List (AE4).
- Two runs of the same commit give the same result for each journey, apart from journeys labeled "flaky".

## Results

2026-10-28: U13, the first full release run, is done, and the mobile owner accepted it.

- Full run `2026-10-27T21-18-29Z-2569` at commit `87dd478d2`: result `fail`, with 133 pass, 5 new, and 5 flaky. The 5 new failures were `bible-sheets` on each device. PR #2867 added testament tabs to the passage picker, and the journey did not tap "Old Testament" before "Genesis". The build check, the log check, and the settings probe passed. The server log showed no forwarded write and no forwarded search (R18).
- Flaky in that run, with no ticket yet: `bible-verse-select` (Android phone), `experience-deep-link` (Android tablet), and `more-and-feedback`, `open-video-a-then-b`, and `play-video` (iPhone SE).
- Commit `2a9304bb4` repaired the journey. Partial run `2026-10-27T23-24-25Z-8526` (`bible-sheets` on the five devices, no speed pass) passed 10 of 10.
- Production sets no Mux Data key, so the test settings need no Mux Data key digests.
- Not verified yet: setup and a full run from a fresh clone (the first QA engineer's pilot does this), and two runs of one commit with the same result.

## CI process-log correction — 2026-10-29

`run()` preserves failures supplied to the log's end callback or exposed by an
already destroyed stream before its error event is delivered. The existing
listener still handles later events. Child deadlines, process groups, aborts,
output bounds and successful-log flushing keep their existing behavior.

Two deterministic regressions failed before the correction and pass afterward:
an asynchronous final-flush failure and an already destroyed log during a
synchronous spawn failure. All 15 process-helper tests pass on Node 24.22.1,
including the original real-file ENOENT case. This correction changes the local
runner's error reporting; the device-release results above retain their scope.
