# Loaded retention default batch, September 30

The first loaded scheduled retention cycle on the existing release showed that
the default 500-root batch can exhaust the unchanged five-second whole-run
deadline. One attempt failed after 400 committed roots and 16,670 stage rows
when a deletion transaction exceeded its remaining budget. The next failed
after 500 roots and roughly 3,000 each of expired projection runs and session
links, with the static batch-deadline error. The automatic continuation then
succeeded in five further batches, draining 2,981 roots and 23,046 stage
descendants across the cycle. These observations show a narrow headroom issue,
not a persistent failure or proof that the new default is live.

`RECOMMENDATION_RETENTION_BATCH_SIZE` is reduced from 500 to 100. The existing
50-root transaction chunks, five-second whole-run deadline, all later retention
phases, committed-count ledger, success watermark, and scheduler continuation
remain unchanged. An exact-size root selection sets `batchLimitReached`, so the
existing bounded catch-up loop continues rather than treating a partial backlog
as complete. This may require more catch-up passes for a large backlog; the
eight-batch/30-second catch-up window and subsequent cadence still apply.

The native PostgreSQL 18 regression uses 120 expired roots with 42 legacy stage
rows each, plus 3,000 expired profile projection runs and 3,000 expired session
links in the same first purge. The first default purge succeeded, deleting 100
roots, 4,200 stage rows, and both 3,000-row tail families in 764 ms locally;
a repeat on the warm database took 540 ms. The continuation succeeded for the
remaining 20 roots and 840 stage rows in 672 ms, or 373 ms on that repeat.
These timings exclude fixture construction, are local synthetic
measurements, and are not a production latency guarantee. The regression
asserts successful full-phase completion and exact counts under the service's
existing deadline; it does not assert a machine-specific elapsed threshold.
The native test for committed deletion counts without a false success watermark
also passed, as did the focused retention unit and native suite (54 tests).

Source: `apps/admin/src/services/recommendations/retention.service.ts`,
`apps/admin/src/services/recommendations/retention-composition.db.test.ts`, and
`apps/admin/src/workflows/recommendationRetention.ts`. Production aggregate
evidence: `outputs/heartbeats/20260930T103016Z-loaded-retention/` and
`outputs/heartbeats/20260930T104147Z-loaded-retention/README.md` in the
recommendation traffic isolation investigation. This local correction requires
normal review and PR-to-main promotion; its effect on the next loaded cycle
must be measured on the deployed release.
