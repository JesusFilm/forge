---
title: "Drain retired behavioral recommendation rows"
type: implementation
status: active
date: 2026-10-29
---

# Drain retired behavioral recommendation rows

Release A stops behavioral serving and writers. Release B leaves the retired
tables present but provides a separately admitted, one-off row cleanup. The U4
goal is zero rows in the 19 retired direct-delete tables, with the three
historical references explicitly detached and retained evidence verified.
This is a row-drain goal, not a claim that the physical schema or files are
gone. Parent coordinates the release and every production invocation.

1. Add a forward-only migration that makes legacy experiment assignments and
   shadow runs detachable from profiles without deleting their history. Preserve
   live privacy and expiry FK actions. Guard the operator's parent deletes
   against implicit cascades or set-null with locked IDs and a fresh reference
   check in the same transaction. Retire only obsolete co-watch audit and
   lineage triggers whose old behavior would recreate rows or reject the drain.
2. Add a CLI with an exact source-bound cutover receipt, stable operation ID,
   fixed table/primary-key phases, a dedicated transaction-coupled batch ledger,
   a distinct advisory lock, and conservative page/transaction limits. Resume
   from committed receipts; stop after an acknowledgement failure and report
   whether a separate durable read confirms its batch ID, confirms absence, or
   cannot establish the outcome. A skipped locked page never proves a table empty.
3. Drain children, detach retained experiment/shadow/decision references,
   then drain retired roots. Keep request, playback, eligibility, current
   precomputed A/B, native viewer and push rows. Do not change ordinary expiry.
4. Prove the three external FK/check/trigger boundaries, immutable co-watch
   guard disposition, source refusal, uncertainty handling, and exact empty
   completion in populated PostgreSQL fixtures. Run Admin typecheck, lint,
   format and focused native tests before commit. Parent owns independent
   review, merge, deployment, invocation and physical-capacity verification.
5. Reconcile live learner runtimes by joining actual workflow runtime state,
   rather than changing a historical queued business ledger to satisfy a gate.
   The September 7 profile-reconciliation business row has a joined FAILED
   runtime completed at 2026-09-07 04:12:25.601 UTC; preserve both records.
   The operator still refuses any genuinely nonterminal known workflow runtime.
6. Make the retired projection job's existing terminal fence satisfy the
   database constraint: a FENCED run needs a completed timestamp and a
   failure reason. Prove PENDING and CLAIMED transitions against populated
   PostgreSQL, and prove an already terminal historical run is unchanged.
   This repairs cutover fencing; it neither resumes learning nor authorizes
   the cleanup operator to run.

After the U4 drain, a separate normal-release follow-up must decide which
retired tables, indexes and code can be physically dropped and measure actual
relation allocation and filesystem space. Do not mark that later schema or
physical-capacity work complete from row counts or DELETE receipts.

The retired 19-table list and measured catalog are documented in
`/home/nisal/.codex/research/recommendation-behavioral-retirement-cleanup-design/design.md`.
Deleting rows can leave PostgreSQL pages available for reuse; U4 did not
measure that reuse, and it does not promise filesystem reclamation.

## October 29 independently accepted row-drain evidence

The D CLI returned `complete` at 07:18:45 UTC. The same operation's CLI and
durable ledger reconciled **3,088,917 direct deletes**, **18,055 explicit
detached-reference updates** and **31,080 batches**. A post-completion read
found all 19 direct-delete tables and all three historical reference categories
at zero. The [retirement report](../reports/2026-10-29-behavioral-recommendation-retirement.md)
records the source-bound roles, retained-lane checks, natural serving sample,
ordinary-retention snapshot, capacity and historical transport limits.
Independent production review accepted the bounded cutover and U4 drain;
feat-902 is complete. See the accompanying documentation PR and root
[#2541](https://github.com/JesusFilm/forge/pull/2541) for exact-head review,
CI, merge and normal-deployment receipts.
Reusable pages were **unmeasured**; feat-905 owns the later physical
measurement/removal follow-up.

The parent owns final source-bound acceptance and any later separately
coordinated drain if a future read finds rows. No fixed wait or activity gate
was added. Ordinary retention and Watch expiry remain separate; manual
retirement earns no feat-554 cycle credit. [Feat-905](../roadmap/content-discovery/feat-905-retired-behavioral-schema-removal.md)
tracks later physical schema/index/code removal, not U4 row deletion.
