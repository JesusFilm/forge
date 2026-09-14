---
title: "Resolve remaining Watch runtime timeouts"
date: "2026-09-15"
status: "in-progress"
ticket: "feat-496"
---

## Scope

Trace and reproduce the first production admission/transaction timeout, fix its
cause, and verify through the normal PR-to-main deployment. Keep the homepage
recommendations block removed and its LaunchDarkly gate default off. Preserve
API contracts, viewing-history rules, atomic admission and existing deadlines.

## Evidence and assumptions

- Main and production run `c769661236623fde33f669a1f23e5c0311ff26e5`.
- Fresh primary Web failures at 23:05 UTC on 14 September fail inside Redis
  admission before Admin. A first timeout retires the shared connection and
  subsequent callers fail during backoff. Trace
  `6aa87da20000000047f77c40f866669a` is the first failure in that cluster.
- Trace `6aa87da80000000021ea01374a3e1cba` fails Lua's deadline check in 5 ms
  with a reported 61 ms remaining. Its full request lasts 196 ms. Redis clock
  sampling is conservative; investigate actual scheduling before changing it.
- The affected Web revision reports sustained high event-loop utilization and
  70–338 ms maximum delays. GC pauses of 23–52 ms cannot individually explain
  the longest delays. Metric tags can combine replicas; traces identify the
  primary host. Profile the workload to identify synchronous work.
- Web uses private Railway Redis and Admin URLs. Admin uses private Postgres;
  its HTTP runtime has workflows disabled. External endpoint configuration is
  not the cause of these failures.

## Work and verification

1. Capture fixed production windows, first-failure traces and runtime evidence.
2. Reproduce the workload with the deployed code and local Redis/Postgres,
   measuring event-loop delays, database waiting and CPU work independently.
3. Explain the causal chain and test a discriminating prediction before fixing.
4. Add regression coverage and make one bounded change at a time. Run real
   service tests where applicable, typecheck, lint, format and production build.
5. Review, compound the findings, open a scoped PR and merge after checks pass.
6. Confirm deployment, repeat actual playback/profile feedback, and compare
   fixed production failure windows. Do not equate hidden UI with recovery.
