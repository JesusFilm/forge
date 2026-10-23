# Manual recommendation retention pass

## Scope

An Admin operator needs a way to start the existing retention job without waiting for its scheduled wake. The owner limited this operation to records whose **stored expiry has passed**. In particular, pre-policy Watch exposure rows retain their original 29-day expiry; the manual path does not redate or delete them early.

## Implementation

- Add an Admin-only, same-origin POST action and a button on System Status. The action accepts no cutoff, batch-size or table arguments.
- Queue exactly one `runRecommendationRetention` workflow pass with a manual `workflow_run` trigger and actor audit. It calls the same bounded purge service as the scheduler, including its advisory lock, five-second deadline, individual page caps, durable retention ledger, failure reporting and normal continuation semantics.
- Provide an operator command in the deployed Admin image for the same one-pass job when an interactive Admin session is unavailable. The command requires `--expired-only` and creates a manual workflow ledger. Running deployed source through Railway SSH is an operator invocation, not a direct local-code deployment.
- Do not launch another pass automatically. A lost response must be reconciled against the manual workflow ledger before an operator retries. The scheduler keeps its own cadence.
- The browser sends one UUID operation key stored as the workflow ledger ID. A repeated request with the same key returns the existing receipt rather than starting a second workflow. A failed runtime-start response remains uncertain rather than falsely marked failed; the manual workflow step has no automatic retry.
- Verify the running Admin HTTP and worker revisions after reviewed PR-to-main deployment, then use one manual path once. Compare before/after aggregate expired backlog, both ledgers, relation allocation, WAL and direct PGDATA free bytes. Ordinary `DELETE` may only create reusable PostgreSQL pages, so do not call that physical filesystem recovery.

## Limits

The first old Watch exposure expiry is October 27, 2026 in the October 23 production read. A manual pass before that date cannot delete those rows. This action does not replace the normal catch-up scheduler, bypass retention, issue `VACUUM FULL`, or qualify a manual run for feat-554's two ordinary clean loaded cycles.
