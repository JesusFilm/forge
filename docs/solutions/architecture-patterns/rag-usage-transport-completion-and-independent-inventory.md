---
module: apps/rag
date: "2026-09-29"
problem_type: architecture_pattern
component: usage-accounting
tags: [rag, observability, http, deployment-inventory]
---

# Transport completion and independent inventory for honest usage reports

A Fetch `Response` proves that a handler produced a response, not that the Node
server completed it. Count successes on `ServerResponse.finish` with a 2xx
status; settle disconnects on `close` before finish as unsuccessful. Install the
listeners before asynchronous accounting so an early disconnect cannot leave
an unobservable attempt. Deduplicate completion transactionally using random
pending attempt IDs; keep request totals keyed to authenticated admission.

A healthy collector heartbeat proves only that collector. Self-registration
cannot detect a replica that never executes instrumentation. Maintain deployment
intervals and expected replica counts through an independent operator capability
that serving cannot modify. Partition report windows at every deployment and
collector boundary, and fail coverage if the expected set is missing, extra,
undeclared or unflushed. Preserve inventory expectations with database guards.

Freeze watermarks on telemetry failure and persist a gap before advancing after
recovery. If recording the gap also fails, coverage stays unavailable. Preserve
pending uncertainty after response-completion loss. Reconcile a crashed instance
only after an operator confirms it is stopped, recording uncertainty rather than
guessing successes. A later outage does not erase the proven coverage of an
already flushed closed window. Terminal reconciliation must reject or ignore a
stopped collector before deleting pending state, recording gaps or updating its
stop time. Retrying after the stale lease timeout must not extend that collector
into a healthy replacement deployment. The public-store regression in
`apps/rag/src/adapters/postgres/consumer-usage-reconciliation.integration.test.ts`
checks closed complete, crash-partial and replacement-complete windows before
and after a rejected retry.

Regression evidence lives in `apps/rag/src/serving/http/usage.test.ts`,
`apps/rag/src/adapters/postgres/consumer-usage-roles.integration.test.ts` and
`apps/rag/src/adapters/postgres/usage-inventory.integration.test.ts`. Force real
DB privilege failures and a missing expected replica; handler-only mocks cannot
prove these guarantees.

Human report access and machine report credentials are separate capabilities.
The portal reuses its live admission/session check for all-consumer reports;
consumer ownership still controls mutations only. Share window validation and
coverage response handling between portal and machine endpoints, while keeping
cookie and bearer authentication at their respective boundaries. Configure the
server's aggregate-only reader independently of optional machine bearer hashes.

An all-consumer UI should not repeat external portal-admission lookups once per
row. Bound its batch to one 20-row page, validate all UUIDs/windows first and
recheck admission once for that protected batch. Serial report reads bound DB
concurrency while preserving each report's snapshot/watermark. Load its client
module only when navigating to Usage. In the UI, suppress unavailable totals,
mark partial counts, and invalidate in-flight rendering on navigation or session
loss so stale responses cannot repopulate cleared report data.
