---
title: "Attribute the remaining Watch budget and delivery delays"
type: fix
status: active
date: 2026-09-22
---

## Scope and established evidence

Resume feat-496 and the dependent feat-464/459/447 work in the owned
`codex/watch-budget-root-cause-20260922-r4m` worktree, based on freshly fetched
main `f1223455ae9c74524d7bc2d9df69fcc48bed288c`. The two reproduced runtime
fixes and separate budget timing diagnostic are already deployed. The previous
two-hour release observation and its limitations remain authoritative; do not
repeat healthy browser traffic as a substitute for resolving the remaining cause.

## Predictions to distinguish the remaining causes

- **Commit/storage:** naturally slow completed budget calls have near-zero
  function execution and overlap backend WAL waits plus actual database-volume
  pressure. This is established for several 212–312 ms calls, not the longest
  calls or the historical selection failure. A fresh simultaneous capture must
  distinguish database-server wait from application delay without a broad
  historical-table scan. Correlated ordinary workload must be identified before
  proposing an application change or provider/storage correction.
- **Pool amplification:** the configured ten-connection main pool can queue
  requests while slow commits occupy leases. This predicts independent small
  reads delayed before server entry, distinct from function or commit time. Use
  existing retained evidence and a representative owned fixture; preserve the
  ten/five main/sync budgets. Do not equate Prisma's connection span with native
  acquisition. The September 18 measurements are historical, not current proof.
- **Delivery persistence:** the 23:48 fallback overlaps our five-second read
  diagnostic and a long served-item insertion/rollback. Retain diagnostic
  interference as a possible contributor. Its SQL spans alone cannot identify
  lock, execution, transport or scheduling; do not assign it the budget cause.

## Work and release gates

1. Verify current deployed builds and new HTTP/envelope/budget populations.
2. Use only bounded, lightweight read diagnostics with explicit end conditions;
   no heap enumeration, live callback patches, broad workflow scans or forced
   production failures. Record overhead and stop all observers afterward.
3. Reproduce a supported causal chain in task-owned services before implementing
   a correction. No longer deadlines, weaker durability, changed independent
   budget consumption, larger pools or ambiguous mutation retries.
4. Apply the smallest demonstrated fix, regression/performance validation and
   sequential Compound Engineering review. Incorporate newer main and pass
   applicable checks before normal PR/main merge; verify exact automatic release.
5. Continue independent authenticated Admin, alert, terminal browser and fallback
   gates where access allows. Keep the homepage authored block removal explicit;
   do not manufacture a publishing identity. Preserve default-off, Mobile/TV,
   identity, authorization, attribution and curation constraints.
6. Compound new causal learnings and update each ticket against its actual
   acceptance criteria. A diagnostic or documentation merge is not completion.
