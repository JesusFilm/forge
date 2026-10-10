---
status: active
---

# Finite unattended legacy-detail drain

The owner authorized an automatically progressing cleanup job with one quiet Codex check every 24 hours. Replace per-cohort AI orchestration with one explicit finite campaign authorization. Keep existing manual sessions unchanged. This does not authorize a repeating cleanup scheduler, new tracking tables, retention changes, physical reclaim or local-code production deployment.

## Contract

The root reviews one immutable private roster from the original master, removing already reconciled work and excluding the original quality/investigation IDs. One fixed approval lasts at most 12 hours and is never renewed automatically. It pins source revision/files, target, canonical holds, original quality baseline, exact selected batch roster, tool bytes and a stop time. A changed file, source, target, hold set or deployment stops the job. A fresh normal release and actual fleet verification precede launch.

The additive session lease variant has `authorization: { kind: "unattended-finite-v1", scopeSha256: <hash> }`. Its reviewedAt is the real campaign review, expiresAt is fixed and no more than 12 hours later, and source.reviewedAt must equal lease.reviewedAt. Its source/holds are not restamped. Legacy leases without authorization retain their exact 30-minute duration and fresh 120-second startup source review. Malformed or unknown authorization fails closed. Session and transaction caps stay at 1,000 runs / 100 batches and ten runs / 4,000 rows / 16 MiB respectively. Ordinary 29-day lifetimes and the original quality parity remain intact.

The local supervisor mechanically derives consecutive disjoint children from that exact roster, with a 14-minute wave end / 15-minute stop bounded by campaign expiry. These are execution windows, not new human approvals. It requires new machine admission and a full fresh fleet, PGDATA-bound capacity, retention, serving and lock check before every child; the existing client refreshes external measurements during each child. Source hashes and target are checked remotely before every transaction. Gates remain 8 GB free, 2 GB WAL, 90-second permits, existing latency thresholds and bounded query/transport timeouts.

Private manifests and attempt markers are fsynced before mutation. An independently implemented read-only reconciliation checks all exact durable ledgers and typed parent/item/run/expiry parity before the supervisor proceeds to another child. Any uncertainty terminates the whole campaign; no automatic reconnect, retry, changed roster, replenishment, approval generation or replay. A later run requires read-only reconciliation and a new real decision. Save aggregate status after each verified child. The OS service uses Restart=no, a fixed deadline and a single-process lock; no LLM is involved in the loop.

## Work units

1. Add and test the explicit server lease variant; preserve the existing protocol and manual constraints. Unit negatives and disposable PostgreSQL proof must exercise the new path, original holds, stale permits, expiry, source drift and exact committed state.
2. Version the existing reviewed local client/runner and implement a finite supervisor. Test static roster binding, disjointness, consumed approvals, changed inputs, deadline/capacity/serving failures, stop-on-uncertainty and required predecessor reconciliation without production calls.
3. Independent code and operational review, normal PR-to-main release, current source/fleet/target/holds/capacity review, one exact launch under a durable OS service. Verify actual startup and advancing durable progress. Configure one quiet daily monitor; do not claim running merely because a process was dispatched.

The daily monitor checks actual process state and durable progress, retention, filesystem/WAL/headroom and any stopped reason. It reports completion, stall, failure or necessary action, and does not renew approvals or launch replacements. Feat-575 stays open until intended retirement completes; feat-554/555 keep their separate acceptance gates.
