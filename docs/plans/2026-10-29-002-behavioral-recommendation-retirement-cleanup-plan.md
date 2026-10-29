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

After the U4 drain, a separate normal-release follow-up must decide which
retired tables, indexes and code can be physically dropped and measure actual
relation allocation and filesystem space. Do not mark that later schema or
physical-capacity work complete from row counts or DELETE receipts.

The retired 19-table list and measured catalog are documented in
`/home/nisal/.codex/research/recommendation-behavioral-retirement-cleanup-design/design.md`.
Deleting rows makes PostgreSQL space reusable; it does not promise filesystem
reclamation.
