# Finite unattended legacy recommendation drain

The owner authorized a programmatic drain and one monitoring check every 24 hours. This replaces repeated AI approval of small cohorts. It does not authorize a repeating deletion schedule, changed retention, removal of the quality holds, or physical reclamation of a nonempty table.

## Authorization and execution

The deployed session CLI accepts an explicit `unattended-finite-v1` lease with a fixed review timestamp and expiry no more than twelve hours later. Its source review has the same timestamp. Ordinary manual leases retain their exact thirty-minute duration and two-minute startup source-review freshness. Neither mode changes the deletion service or its transaction budgets.

The CLI is a privileged operator interface, not a signed authorization service. It validates the lease shape and lifetime; the reviewed local supervisor, runner and client bind the authority to the exact private master, scope, source, registry, quality baseline and tool bytes. A scope hash alone is not sufficient authorization. The supervisor cannot replenish the roster or manufacture a new human review. Each child is a consecutive disjoint slice of the campaign roster, at most 1,000 runs and 100 batches across ten waves. Each transaction remains capped at ten runs, 4,000 declared stage rows and 16 MiB.

Before each child, collect fresh read-only evidence for actual Admin HTTP and worker revisions, source hashes, target identity, PostgreSQL data-directory binding, retention, serving, locks, WAL and filesystem availability. Require at least 8 GB available, at most 2 GB WAL, and the existing serving thresholds. Refresh external permits during the child; actual source and database checks still run remotely before transactions. The original quality and investigation records remain excluded; uncertain/incomplete evidence follows the existing lossless conversion path or stops the job.

Each child archives its exact manifest before mutation, then independently reconciles durable ledgers and typed parent, item, run and expiry state before the next child may start. Completed audit files may be gzip-compressed only after verification of the exact decompressed SHA-256 and a durable archive receipt. Compression changes local audit storage only.

## Process and failure handling

Run the finite supervisor as a user systemd service with `Restart=no`, a fixed runtime limit and an exclusive process lock. Keep its tools, authority, roster and status in a private persistent directory outside the repository. It invokes no model. Check local disk space before children so audit material cannot fill the operator host. The job requires the host and authenticated operator CLI session to remain available.

A changed input, expired lease, failed gate or uncertain transport result stops the whole job. It never retries a sent operation, reconnects, restarts, renews approval, or skips a failed child to continue. The service's stopped state is not proof that a remote command did not commit. Reconcile the last operation against exact durable ledgers and typed state before any replacement writer. A replacement campaign requires a genuine new review and excludes previously verified work.

The aggregate status records verified completed groups/runs, conversions, retirements, removed stage rows, last proof and stop reason. It never logs request identifiers, viewer data or trace payloads. Private source evidence remains private.

## Daily monitoring and completion

Once every 24 hours, inspect actual service state, the last verified progress receipt and any terminal failure. Reconcile production fleet, health, filesystem availability, WAL, comparable relation allocation and normal retention ledgers using bounded read-only probes. Alert for a stopped/stalled job, completed campaign, changed failure, less than 5 GB available or a comparable trend below seven days of headroom. Never treat an unchanged heartbeat as authority to launch or renew a writer.

Campaign completion proves only that its fixed eligible roster was processed. Deferred holds, rows outside that master and naturally expired requests require a separate census. Normal privacy expiry continues. Feat-575 remains open until its actual retirement criteria pass; feat-554 still needs qualifying scheduled loaded retention cycles.

Ordinary row deletion creates reusable PostgreSQL space. It does not establish physical filesystem recovery. Feat-555 requires exact global stage-table emptiness, no legacy writers, protected parity and the separate reviewed fail-closed reclamation migration through PR-to-main. Report reclaimed file bytes only after deployment and direct measurement.
