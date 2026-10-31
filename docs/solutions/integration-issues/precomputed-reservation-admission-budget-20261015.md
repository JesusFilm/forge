---
title: "Keep database reservation waits inside fresh model admission"
date: "2026-10-15"
category: integration-issues
module: "Precomputed recommendation generation"
problem_type: integration_issue
component: service_object
symptoms:
  - "A valid reservation commits after the adapter has stopped waiting"
  - "Three model receipts succeed while a fourth reservation remains pending without a process"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [precomputed, recommendations, reservations, timeouts, admission]
---

# Align reservation and admission deadlines

Admin permits a 30-second edge transaction. The local adapter allowed only 15
seconds for the complete reservation request. Serializing new reservations did
not remove contention with in-flight receipt transactions on the same generation.
A production reservation took 19,177 ms, committed successfully and returned
HTTP 200 after the adapter had stopped admission. No fourth model process spawned.

Allow 45 seconds for the reservation, retaining the total 60-second admission
freshness limit: both account and allowance observations must be no older than
15 seconds before reserving. Check freshness again before dispatch so event-loop
delays cannot invalidate the budget. Keep fail-closed handling after 45 seconds;
a late reply must never start a model process.

A real 20-second test reproduces the old failure and dispatches once with the fix.
Tests reject 16-second-old admission observations, expired observations at reply
handling, and late responses after the full deadline. Native PostgreSQL tests
retain the no-dispatch audit's immutable original row/null usage and unchanged
source checkpoints for both members of the sealed incident.

A separate continuation delay came from leaving 20-minute leases active even
after a clean attempt drained. Close now expires live claims only when all
profile, edge and legacy calls in that attempt have terminal usage and receipts.
It holds the generation lock, and the existing closed-attempt replay returns
before cleanup, so a replay cannot expire a newer attempt's claims. Unknown calls
retain their leases. The native recovery test reproduces the old delay, then
recovers two calls consecutively without test-only expiry mutations. Native tests
also preserve unresolved leases and protect newer claims against close replay.

Migration 0153 admits only that exact reviewed no-dispatch call. The metadata trace
shows four reservation requests, three provider processes that all started before
the delayed reservation, three successful exits, and a closed drained attempt.
Keep this evidence separate from dispatched calls whose consumption is unknown.
Do not infer zero usage from a missing receipt alone.

References: `docs/plans/2026-10-15-004-fix-reservation-admission-budget-plan.md`,
`apps/mastra/src/services/precomputed-recommendations/codex-subscription-astra.ts`,
`apps/admin/prisma/migrations/0153_precomputed_admission_no_dispatch/migration.sql`.
