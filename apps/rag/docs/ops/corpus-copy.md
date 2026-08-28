# Local corpus-copy rehearsal

This procedure copies the legacy local jfrag corpus into a separate local Forge
RAG database without calling an embedding provider. It copies all seven data
tables, including existing `halfvec(1536)` values, raw documents, and caches.
Generated full-text values and secondary indexes are rebuilt by PostgreSQL.

Never pass a connection string on the command line. Put the source and target
URLs in `JFRAG_SOURCE_DATABASE_URL` and `DATABASE_URL` respectively. The tool
prints only database names, redacted host hashes, counts, hashes, IDs, and
retrieval scores; it rejects report output containing credentials or corpus
text.

## Preflight

Start the Forge database, apply its schema, and point the two environment
variables at distinct local databases. Then run the default read-only preflight:

```bash
pnpm --filter @forge/rag db:copy-corpus
```

The preflight validates both schemas, confirms distinct database identities,
and records source/target counts without copying rows. A new copy refuses a
non-empty target.

## Prove interruption and resumption

Run one batch and expect exit status `2` plus a `paused` report:

```bash
pnpm --filter @forge/rag db:copy-corpus --copy --confirm-local-copy --batch-size 10 --max-batches 3
```

Resume the same target. Conflict-safe primary-key inserts make already committed
batches no-ops, while foreign-key order remains deterministic:

```bash
pnpm --filter @forge/rag db:copy-corpus --copy --confirm-local-copy --resume
```

The copy temporarily removes only reproducible secondary indexes and restores
them before reconciliation. If the process is killed while indexes are absent,
rerunning `--resume` completes the copy and restores them.

## Acceptance evidence

Run read-only reconciliation again at any time:

```bash
pnpm --filter @forge/rag db:copy-corpus --verify-only
```

Acceptance requires matching table counts; per-source/language counts; foreign
key and null checks; model and vector dimensions; aggregate row fingerprints;
and identical top-10 chunk ordering for five deterministic vector probes. Score
deltas may not exceed `1e-5`, which accommodates PostgreSQL/HNSW floating-point
variation while requiring the same ranked IDs. The report also records zero
embedding calls.

The redacted machine-readable receipt is written to
`docs/roadmap/rag/evidence/feat-429/local-copy-reconciliation.json`. It is local
rehearsal evidence only and must not be reused as production-copy proof.

## Rollback

The source is always read-only. Before production migration work begins, local
rollback is to discard and recreate only the Forge target database, reapply the
Forge schema, and rerun this rehearsal. Never modify or delete the jfrag source.
