# Compact recommendation trace validation

The local implementation stores every observation in one versioned JSONB payload
on its candidate run. Shared run identity and expiry remain on the parent. The
default writer remains legacy until every replica and the rollback image support
both formats. Production has not been changed by this implementation.

## Physical storage experiment

The reproducible PostgreSQL 18.6 benchmark used 400 runs per format, 71,300 stage
observations, four cohort sizes (82, 113, 195, 323), and varying 1-, 3-, and
16-source evidence with longer provenance text. Both formats use the same
constraints and retain full evidence. The legacy baseline already excludes the
duplicate index. The benchmark checks complete field round trips, exact row
counts, and equal-count replacement after deleting half the roots. The run used
Linux x64, Node 24.16.0, eight available logical CPUs, and a local pgvector
PostgreSQL 18 Docker container on a shared development machine.

| Measurement                                             | Legacy stage rows | Compact run payload |
| ------------------------------------------------------- | ----------------: | ------------------: |
| Run + stage physical bytes, including TOAST and indexes |        86,360,064 |          21,512,192 |
| Committed write p50                                     |          28.58 ms |            28.50 ms |
| Committed write p95                                     |          57.30 ms |            54.27 ms |
| Full projected detail query, 323 observations           |          18.03 ms |            20.59 ms |
| Delete 200 request roots and trace descendants          |          49.38 ms |            11.25 ms |
| Run + stage bytes after deletion and ordinary vacuum    |        86,360,064 |          21,512,192 |
| Bytes after replacing the same number of roots          |        98,828,288 |          21,757,952 |

Compact storage was **75.1% smaller** in this synthetic sample. This is separate
from removing the production duplicate index, measured at 2.358 GB. Write timings
varied between runs under shared load; there is no established write-latency
improvement. The full detail projection matched in every cohort and was slightly
slower for compact traces. These local timings are not production performance
guarantees. JSONB validation, compression, and decoding have a CPU cost to observe
after activation. The application also selects only the run ID after insertion,
avoiding an unnecessary return of the complete payload; this pg-based benchmark
does not measure Prisma serialization or the full issuance path.

The delete/vacuum measurement did not shrink relation files. Compact replacement
largely reused existing allocation; legacy replacement grew especially its
indexes. Production capacity must include old/new relation overlap, other
recommendation tables, traffic and evidence distributions, and maintenance
margin. Do not extrapolate the 75.1% directly to the entire production database.

Raw results: `synthetic-storage-benchmark.json`. Harness:
`apps/admin/scripts/benchmark-recommendation-trace-storage.mjs`. Deployment and
rollback: `storage-remediation-runbook.md`. Production verification is tracked
by `docs/roadmap/platform/feat-554-recommendation-storage-rollout-verification.md`.

## Verification record

- Full Admin migrations applied successfully from an empty disposable database.
- Focused real PostgreSQL tests pass for old/new detail parity, compact issuance,
  constraint failures and transaction rollback, mixed trace cascades, wait
  attribution, index preservation, and lock-timeout/retry behavior.
- Focused retention tests cover young expired backlog, exact batch boundaries,
  bounded batches/time, skipped locks, exhausted retries, and older step results.
- Final full Admin suite: 7,392 passed, 348 skipped, and one existing todo across
  518 files. Database tests are opt-in and run separately against PostgreSQL.
- Final focused database pass: 22 tests across candidate migrations, actual
  delivery persistence, wait attribution, and Admin detail. Mixed-format
  lifecycle/cascade tests also passed in the earlier focused database run.
- Admin typecheck, lint, and production build passed. The build verified two
  compiled recommendation retention workflows and five steps.
- GraphQL schema regeneration produced no public schema changes. Both roadmap
  hidden-lane checks passed. Changed files passed formatting and diff checks.
- GPT-6 Sol reviewers covered correctness, testing, maintainability, project
  standards, agent access, migration integrity, performance, reliability,
  adversarial failures, TypeScript, API contracts, schema drift, prior learnings,
  and deployment readiness. Review fixes strengthened the actual detail-query
  benchmark, full writer-to-reader parity tests, and centralized benchmark
  configuration. An additional ORM projection fix avoids returning unused
  payloads. Re-review left no actionable findings in the local implementation.

Production headroom, real deletion throughput, and performance after activation
remain unverified and belong to feat-554. Local completion does not establish
that production capacity is safe.
