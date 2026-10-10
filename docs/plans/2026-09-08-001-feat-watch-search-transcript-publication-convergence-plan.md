# Watch Search transcript publication convergence plan

Scope: implement Forge issue #2145 in Admin's incremental transcript publisher,
its Prisma persistence contract, and focused real-PostgreSQL/controlled-
Typesense tests. No GraphQL or consumer contract changes are in scope.

1. Extend the publication event into a durable repair ledger: add lifecycle and
   dead-letter classifications, retain orphaned transcript identity across
   canonical cascades, and enqueue exact deletion evidence before a transcript
   disappears.
2. Refine the claim protocol so candidate-lease contention is observed before
   mutation, claims remain generation/token fenced, superseded events retain
   stale-id unions, and bounded failures stop retrying without losing evidence.
3. Split publication execution by work kind: publication upserts and verifies
   canonical chunks before stale deletion; lifecycle work performs exact,
   independently verified deletion without requiring the canonical parent.
4. Reconcile database completion outcomes against event-bound revision
   evidence, preserving idempotence after external success and database
   failure.
5. Cover every discriminating failure and race with the real PostgreSQL suite
   and the controlled Typesense seam, then run scoped format, lint, typecheck,
   migration, and test validation.
