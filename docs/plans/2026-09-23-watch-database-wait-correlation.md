---
title: "Correlate intermittent Watch persistence delays with database waits"
status: active
type: fix
---

# Watch database wait correlation

Continue in-progress feat-496 from fresh main `a4998bc6a`, in the dedicated
`codex/watch-evidence-wait-diagnostics-20260923-m4q` worktree. The owner requests
a reproduction/diagnostic PR and determination of the intermittent failure's
cause. No deadline, durability, attribution, pool-budget or homepage change.

The latest failed 220-row INSERT spent 1,186 ms in its driver call after fast
transaction acquisition. Existing logs cannot distinguish PostgreSQL waiting
from an already-completed statement awaiting application processing. Earlier
local parameter reduction improved performance but did not reproduce this
natural incident. Selection's capability-budget delay remains separate.

## U1. Correlation without another database round trip

Add a server-generated observation ID and bounded transaction/backend metadata
to existing runtime records. In the existing transaction setup statement, set
a transaction-local application name and return the backend PID. The name must
contain only diagnostic correlation, never identity, capability or content.
Restore automatically on commit and rollback; preserve calls outside observation.
Verify concurrent isolation, exhausted metadata bounds and pooled reuse.

## U2. Independent bounded database observer

Provide a read-only CLI that samples tagged backends from a separate process.
Report observation/transaction correlation, backend PID, query start, statement
category, state, wait category/event and blocker count. Never export query text,
parameters, database URLs or application identity. Bound duration, frequency,
query timeout, accumulated overhead and output. Close the connection on every
exit. Sampling gaps and query age must not be labelled measured wait duration.

## U3. Controlled failure discrimination and representative workload

On a fresh owned PostgreSQL 18 database with all migrations, test actual evidence
issuance under a held table lock, server-side delay and delayed application
processing. An independent observer must distinguish those mechanisms and keep
rolled-back issuance empty. Test timeout/error cleanup and metadata restoration.
Use realistic batches and concurrency to measure instrumentation overhead.
Injected failures validate the instrument, not the historical production cause.

## U4. Review, release and causal capture

Run sequential Compound Engineering review, appropriate Admin checks and real
PostgreSQL tests. Incorporate newer main before normal PR merge. Verify the
exact automatic deployed revision; run an independent bounded production
observer and reconcile natural slow writes with traces. Record what is proved
and what remains unobserved. Compound the correlation and measurement lessons;
keep feat-496 open until its actual recovery gates pass.
