# Manual recommendation retention

Open Admin **System Status** as an Admin and select **Run expired-data cleanup**. The action queues one bounded manual pass. It has no date, table, or batch-size override. Manual mode selects rows whose stored expiry has passed, plus necessary dependent children of expired roots; it keeps the guarded expired precomputed-proof page but skips the scheduler's age/status-only precomputed generation and object-store cleanup. The retired behavioral profile/co-watch families are no longer part of ordinary or manual retention. It finalizes a concluded baseline report only when its run or a child visit has reached stored expiry. It records the operator in `workflow_run` with trigger `manual`; the separate `recommendation_retention_run` records committed counts and any failure or yield. The ordinary scheduler keeps its full maintenance behavior and cadence.

An operator with access to the **deployed Admin image** can instead run `pnpm --filter @forge/admin retention:run-once --expired-only` through Railway SSH. This command invokes the same bounded job once and writes a manual workflow ledger. It does not use source from an unmerged local checkout. Run one path, then reconcile it before another invocation.

The command emits one aggregate JSON result after the database connection is
closed, then exits. A successful full batch reports
`continuationRequired: true` from `batchLimitReached` even if no rows are yet
overdue. A skipped or budget-yielded pass exits nonzero for operator review;
earlier committed row counts can still be nonzero. An absent response or
transport timeout is uncertain, not evidence that the pass failed or rolled
back. The durable ledgers and fresh backlog are authoritative.

A nonterminal phase refused before work yields even when the five-second
cleanup deadline has already elapsed. Finalizing that yield uses a separate
ledger-only transaction with a one-second transaction limit and a separate
500 ms acquisition limit. These are not a combined wall-clock guarantee. It
performs no cleanup or backlog scan and does not extend the cleanup budget.
The transaction changes only a RUNNING ledger and returns its committed counts.
The service reports a yield only after commit acknowledgement. Genuine query,
transaction, commit and ledger failures still propagate; fallback persistence
never overwrites an already terminal ledger after an uncertain acknowledgement.

Before using it in production, verify the actual Admin HTTP and worker revisions, health and runner roles. Read aggregate expired backlog, all retention-health types, both ledgers, PostgreSQL relation allocation, WAL, and direct PGDATA free bytes. If a pass is already running, the advisory lock makes the manual pass skip. If the browser returns an error or loses its response, reconcile the manual ledger and runtime before pressing the button again. Do not assume that a queued response means rows were deleted.

The browser request carries a unique operation key. Repeating the same request cannot start another workflow; it returns the existing workflow receipt. A dispatch transport failure may leave a queued ledger with an uncertain runtime outcome. Inspect that ledger and the independent retention ledger before making a new request. The one-pass workflow does not automatically retry a failed purge.

After the pass, compare the separate ledger statuses and committed `row_counts` with fresh aggregate backlog and capacity reads. A manual pass never qualifies for feat-554's two clean ordinary cycles. Ordinary `DELETE` may make PostgreSQL pages reusable without reducing the relation file or increasing filesystem free bytes. Do not run `VACUUM FULL` as a substitute for this check.

Older pre-policy Watch exposures keep their original 29-day stored expiry despite the 14-day policy for new rows. The completed behavioral-retirement drain is historical; its CLI and runtime writer were removed in feat-905 U1. Do not restart that campaign or infer physical filesystem recovery from its deletion counts.
