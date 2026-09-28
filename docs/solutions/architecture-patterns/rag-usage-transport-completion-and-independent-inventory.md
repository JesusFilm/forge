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
already flushed closed window.

Regression evidence lives in `apps/rag/src/serving/http/usage.test.ts`,
`apps/rag/src/adapters/postgres/consumer-usage-roles.integration.test.ts` and
`apps/rag/src/adapters/postgres/usage-inventory.integration.test.ts`. Force real
DB privilege failures and a missing expected replica; handler-only mocks cannot
prove these guarantees.
