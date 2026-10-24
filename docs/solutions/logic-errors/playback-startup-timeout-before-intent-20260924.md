---
title: "Gate playback startup timing on a real playback intent"
date: "2026-09-24"
category: logic-errors
module: "Watch recommendation playback observations"
problem_type: logic_error
component: frontend_stimulus
severity: medium
symptoms:
  - "A long autoplay preview can consume the startup timer before Watch now is selected"
  - "A later manual attempt can have no startup-timeout fact or time out too early"
root_cause: async_timing
resolution_type: code_fix
tags:
  - recommendations
  - playback
  - preview
  - qoe
  - telemetry
---

# Gate playback startup timing on a real playback intent

## Problem

The Watch Hero can emit native `play` for its preview before a person selects
**Watch now**. The v2 recommendation recorder handled that event by calling
`armStartupTimeout()` even when its `initiation` prop was null. A preview
lasting 15 seconds set `startupTimedOutRef` before any attempt existed, so the
timeout fact was discarded. A later manual attempt could never arm a fresh
timer. A shorter preview consumed part of the later attempt's 15-second budget.
Returning from hidden visibility could also call the same arm path before
intent.

## Symptoms

- A long preview left a later manual attempt without a startup-timeout fact.
- A short preview made the later attempt time out before its own 15 seconds
  elapsed.

## What did not establish correctness

Checking only that `play` starts a timer misses the pre-intent preview case.
Likewise, a production episode with zero pause or QoE facts cannot diagnose
this defect unless it is joined to the controlled browser attempt and its
loaded collector version is known.

## Solution

`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`
now returns from `armStartupTimeout()` while `initiationRef.current == null`.
This keeps the timer tied to the first known manual or automatic playback
intent, regardless of preview `play` events or lifecycle returns. It does
not change the baseline attempt/start payloads or block the player when
telemetry is unavailable.

The focused observation tests first reproduced the long-preview missing
timeout and short-preview early timeout with the old code, then passed with
the guard. A third test covers pre-intent hidden-to-visible return. The full
Web suite passed after the fix. The fix shipped through PR #2420 rather than
being folded into the original emitter deploy.

## Why this works

The browser's native `play` event reports media state, not a request to
measure startup. `initiationRef` is the recorder's intent boundary. Arming
only after that boundary preserves a full 15-second window for each actual
attempt and leaves previews uncharged.

## Prevention

A production browser tab can keep an older JavaScript bundle across
client-side navigation after a new Railway deployment. For emitter
acceptance, start or reload the controlled Watch journey after the desired
Web commit becomes active, and join the browser action to a retained Admin
episode before interpreting a missing fact. In the feat-370 check, a recent
unrelated v2 episode had zero user pauses; that did not contradict a separate
controlled pause. The controlled episode was inspected before the action and
again after it finalized, with the exact paused video position matching the
retained navigation fact.

## Related

- `docs/validation/feat-370-playback-signals/production-verification.md`
  records the bounded production evidence and response-level join limitation.
