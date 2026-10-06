# Precomputed recommendation Mastra runtime storage

This note covers only `precomputed-catalog-generation` and
`precomputed-source-generation`. Admin owns the durable generation, source
claims, accepted connections, reasons, cost receipts, and resume state. Mastra
stores a run snapshot for each launch in `mastra.mastra_workflow_snapshot` and
workflow traces in its shared `mastra-observability.duckdb` file. The workflow
input is a compact generation ID, cutoff, mode flag and (for catalog builds)
capacity attestation; output is status and counts. It does not store a second
copy of the catalog, transcripts, GA rows, or full model responses. The
production default observability output processor redacts span input/output;
the private launch paths also request hidden trace input/output.

## Retention and safety

The deployed production runtime arms a six-hour retention timer; importing
the module, building it, or running development does not delete rows. This
timer is **not** a catalog refresh schedule. Each sweep is bounded to ten
100-row batches of old terminal workflow snapshots, one 20-row page of old
nonterminal snapshots, one 20-trace page of old running traces per workflow,
and ten 100-trace batches of ended traces. The cutoff is 29 days since
the last snapshot update or trace end. Successful sweeps emit count-only logs.
They never log generation IDs, input, transcript passages, or model responses.

Terminal snapshots (`success`, `failed`, `canceled`, `tripwire`, `bailed`,
`skipped`) are deleted with row locks and `SKIP LOCKED`. Running, waiting,
suspended, paused, pending, and unknown states are never deleted for age alone:
a catalog build is one long step and may have an old snapshot while it works.
For an old nonterminal row, Mastra asks Admin's existing authenticated ingest
endpoint for `retention_status` protocol 2. It requires the immutable
generation ID, exact UTC input cutoff, generation protocol, digest presence,
and history mode to match the snapshot, and `sourceWorkResumable: false`. Admin
fences source writes against retiring/terminal generations under generation
row locks. The small Admin retirement tombstone keeps proof available after
generation deletion. A missing, mismatched, expired, or unavailable proof
retains the snapshot and increments the unresolved/stale count. This is an
explicit retention gap to investigate; it is not treated as safe to erase.
The scan carries a cursor so unresolved early rows do not starve later rows.

Private service-route launches stamp the root trace with only generation ID,
cutoff, and history mode. This immutable identity survives even if a different
batch or replica deletes the Postgres snapshot first. Old `RUNNING` traces
are deleted only after the same matching Admin retirement proof; active work
and traces lacking identity remain. A paged scan moves past unresolved roots,
and count-only logs expose the unresolved backlog. Older identity-less traces
cannot be proven safe automatically and are a readiness gap until reviewed.

Ended DuckDB trace deletion filters the root `workflow_run` span by its `entityId`,
requires a matching workflow ID and an end time before the cutoff, and checks
that the trace is not running before deleting. The installed DuckDB provider's
`rootEntityId` list filter fails with a SQL binder error, so the working root
`entityId` selector is intentional. Traces from other workflows, recent
traces, and open traces are retained.

## Measurement and interpretation

`measurePrecomputedRuntimeSnapshots` returns feature row count, logical
snapshot bytes (`sum(pg_column_size(snapshot))`), nonterminal/stale counts, and
the **shared** snapshot relation's heap, index and total allocated bytes.
`measurePrecomputedRuntimeTraces` returns feature trace count, running count,
and the total running backlog older than 29 days, including identity-less
traces. The DuckDB provider does not expose reliable per-feature byte
allocation; its file size is shared with other Mastra traces. Neither the
shared Postgres relation total nor shared DuckDB file size may be summed into
an experiment-only storage forecast. Postgres row deletion releases space for
reuse within the relation; it does not imply smaller database or Railway
filesystem bytes. DuckDB logical trace deletion likewise does not prove its
file shrank. The production sweep logs feature logical snapshot bytes and
shared Postgres relation/DuckDB file bytes with distinct labels. Measure WAL
and filesystem free space separately after a sweep.

A read-only production baseline captured on 2026-10-06 showed approximately
5.125 GB for the **whole** Mastra Postgres database, 5.107 GB allocated to
the **shared** workflow snapshot relation, 83.9 MB of WAL, 1.019 GB of
**shared** Mastra `/data`, and 43.64 GB free on PGDATA. These are existing
service totals, not precomputed feature deltas or a capacity approval. The
feature-specific rows and bytes need a fresh deployed-runtime observation
after a controlled build, along with Admin's native retained-volume report.
Until then the readiness result remains unmeasured for this component.

Native tests use an isolated PostgreSQL schema and temporary DuckDB file.
The cleanup fixture verifies terminal/nonterminal isolation, concurrent row
locks, pagination past unresolved proofs, both source and catalog identities,
and replay. A separate actual Mastra workflow run invokes the real source
generation service with a controlled catalog, transcript chunk, model reply,
and Admin ingest. It verifies the emitted snapshot identity and trace path;
the GA history branch is not exercised by this storage smoke. In the
2026-10-06 run, its one Postgres snapshot measured **1,283 logical column
bytes**, the returned trace serialized to **2,147 JSON bytes**, and the
isolated shared DuckDB file allocated **12,288 bytes** after shutdown. The
JSON length is not a DuckDB per-trace physical allocation, and the file
includes database overhead. These fixture sizes are **not** a production
forecast. The cross-app
integration test in `tests/integration/precomputed-catalog-build.db.test.ts`
exercises the Admin retention proof/tombstone with Mastra's native workflow
rows; it also does not replace a production footprint reading.
