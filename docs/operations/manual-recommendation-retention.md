# Manual recommendation retention

Open Admin **System Status** as an Admin and select **Run expired-data cleanup**. The action queues one bounded pass of the same workflow the normal scheduler uses. It has no date, table, or batch-size override. It deletes only records whose persisted expiry has passed and records the operator in `workflow_run` with trigger `manual`; the separate `recommendation_retention_run` records committed counts and any failure or yield. The scheduler remains active.

An operator with access to the **deployed Admin image** can instead run `pnpm --filter @forge/admin retention:run-once --expired-only` through Railway SSH. This command invokes the same bounded job once and writes a manual workflow ledger. It does not use source from an unmerged local checkout. Run one path, then reconcile it before another invocation.

Before using it in production, verify the actual Admin HTTP and worker revisions, health and runner roles. Read aggregate expired backlog, all retention-health types, both ledgers, PostgreSQL relation allocation, WAL, and direct PGDATA free bytes. If a pass is already running, the advisory lock makes the manual pass skip. If the browser returns an error or loses its response, reconcile the manual ledger and runtime before pressing the button again. Do not assume that a queued response means rows were deleted.

The browser request carries a unique operation key. Repeating the same request cannot start another workflow; it returns the existing workflow receipt. A dispatch transport failure may leave a queued ledger with an uncertain runtime outcome. Inspect that ledger and the independent retention ledger before making a new request. The one-pass workflow does not automatically retry a failed purge.

After the pass, compare the separate ledger statuses and committed `row_counts` with fresh aggregate backlog and capacity reads. A manual pass never qualifies for feat-554's two clean ordinary cycles. Ordinary `DELETE` may make PostgreSQL pages reusable without reducing the relation file or increasing filesystem free bytes. Do not run `VACUUM FULL` as a substitute for this check.

As of the October 23, 2026 read, no Watch exposure rows had passed their stored expiry; the earliest persisted expiry was October 27. Running this action earlier can clean other expired recommendation records, but it cannot remove that exposure cohort. Older pre-policy exposures keep their original 29-day expiry despite the 14-day policy for new rows.
