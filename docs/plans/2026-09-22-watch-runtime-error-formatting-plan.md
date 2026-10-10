---
title: "Remove reproduced GraphQL error-formatting stalls and finish Watch recovery"
type: fix
status: active
date: 2026-09-22
---

## Scope and evidence

Continue feat-496 and the existing Watch 4xx closure plan. All four unfinished
tickets remain in progress. The September 22 production verification identifies
206 Yoga field errors after one catalog PostgreSQL shared-memory failure,
overlapping a 38.55-second loop delay and 63 playback deadline failures. The
isolated pinned Next inspector reproduction blocks for 10.86–11.46 seconds.
This does not explain the separate capability-budget selection timeout.

## U1: Remove repeated production error inspection

Characterize the actual Yoga error path in `apps/admin/src/app/api/graphql/route.ts`.
Add a production logger that retains every error and native error details while
avoiding Next's synchronous custom source-map inspector. Keep development
inspection, default log levels, trace correlation, error masking, API responses,
identity, authorization and admission unchanged. Do not silence, deduplicate or
retry errors. Do not change the global Error prototype or production callbacks.

Test first: real Yoga field fan-out logs every error and preserves masked response
paths; native error inspection retains stack/cause/details without invoking a
custom inspector. Verify domain errors and successful operations remain unchanged.
Reproduce with the exact source-map structure, then in an owned actual Next build
with concurrent real selections/playback. Preserve a failing baseline and compare
the same workload with the fix. All services/databases must be task-owned.

## U2: Continue independent database and selection diagnosis

Distinguish the catalog query's shared-memory allocation failure from the earlier
capability-budget call. Read query plans and bounded pool/server wait evidence;
reproduce the demonstrated mechanism in owned PostgreSQL before changing it.
Preserve the separately committed 32-attempt capability budget, 700 ms selection
boundary, database integrity and lack of ambiguous mutation retries.

## U3: Release and finish acceptance

Run scoped regression/performance checks, complete Admin checks and sequential
Compound Engineering review. Fetch newer main and incorporate it before the
normal PR squash merge; verify exact automatic deployments and a sustained
production window with separate HTTP and envelope outcomes. Never deploy local
code or trigger a redeploy. Continue the existing feat-464, feat-459 and feat-447
acceptance gates using available authorized access, without manufacturing evidence
or authorization. Close each only when its actual requirements pass.

Keep the authored English homepage recommendation block absent and its flag
default off. No Mobile/TV UI, account linking or curation changes. Compound the
proven causes and negative controls at completion.

## U4: Separate server budget work from the complete driver call

The catalog and error-inspection corrections are deployed, but the independent
701 ms capability-budget call remains unattributed. Stored transaction timestamps
argue against assigning the whole interval to pool acquisition; later server
samples show WAL waits, without measuring the historical commit duration.

Evaluate a minimal diagnostic inside the existing single independently committed
budget statement: materialized clock-before/function/clock-after stages return
only server execution milliseconds alongside the existing attempt result. Compare
that duration with monotonic client elapsed time in a bounded slow-call event.
The remainder still includes pool acquisition, parsing/planning, commit, network
and result scheduling; never name it WAL time. Keep all user/capability/request
identifiers and raw exceptions out of the event. Database errors must propagate
unchanged, and failed telemetry must not change a successful budget result.

Prove that the function executes once, clock sampling brackets actual server
work, successful/exhausted/concurrent budgets keep their durable limits, and the
wrapper adds negligible overhead in the owned database and actual Next workload.
Reject this diagnostic if it changes transaction boundaries, retries, deadlines,
authorization or mutation outcomes. This is diagnosis, not a claimed latency fix.
Release through normal PR/main automation only after sequential review and the
required checks. No global production PostgreSQL setting change is necessary.
