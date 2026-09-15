---
title: "Recover an expired Redis clock sample within the original admission budget"
date: "2026-09-15"
status: "in-progress"
ticket: "feat-496"
---

## Evidence and scope

After #2297 deployed, primary-host trace
`6aa88db600000000152e8555b42ca02f` returned profile HTTP 503 in 184 ms.
Its admission log reports `stage=eval reason=redis_deadline durationMs=46
budgetMs=115`. A delayed TIME response made the conservative server-clock
deadline expire before Web's unchanged 250 ms command budget. The script
returned `unavailable` before reading or mutating either rate-limit bucket.

Reproduce that sequence with real Redis. Permit one fresh TIME/EVAL attempt
only after that explicit no-mutation response, using the remainder of the
original monotonic budget. A timeout, connection error, invalid result or rate
limit must never trigger a retry. Keep the Lua deadline check before mutations,
all limits, connection retirement rules and existing API shapes intact.

## Verification

- Red/green real-Redis test: delayed initial TIME, early Lua deadline rejection,
  refresh succeeds, counters increment exactly once.
- A second expired sample stops after one retry; a retry cannot restart the
  total budget. A late retried EVAL cannot mutate buckets after timeout.
- Existing shared-connection, privacy capacity, clock-skew and atomic-limit
  tests remain green; run full Web tests, build, lint and formatting.
- Review, compound and merge through PR-to-main. Observe fixed production
  windows for actual admission failures, preserving the removed homepage block
  and default-off LaunchDarkly gate.
