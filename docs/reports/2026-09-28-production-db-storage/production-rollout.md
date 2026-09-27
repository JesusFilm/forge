# Recommendation storage production rollout

Rollout owner: Nisal, executed through the authorized Codex task. The user
authorized continuing the release, activation, and verification on September 28.
Production code follows the normal reviewed PR-to-main Railway autodeploy path.

## Predeploy verification

At September 27, 21:55 UTC, read-only PostgreSQL probes reported 39.629 GB database
size, 28.489 GB of recommendation relations, and a 2.367 GB duplicate stage
index. The filesystem was at 82%, with 8.994 GB available. No request roots had
expired; the first expiry remains September 30 at 00:20:47.858 UTC. The existing
1.55 GB/day growth scenario still warrants prompt rollout and continued capacity
checks; these measurements do not prove the transition's eventual peak.

The live service inventory showed one Admin web replica and one Admin worker
replica, each at `e7630a12629c3f4fa1507658bd5d290837fd7061`. Independent SSH
checks returned HTTP 200 health, the expected opposite workflow-runner roles,
and an unset compact-write flag. Both deployments honored their respective
`apps/admin/railway.toml` and `apps/admin/railway.worker.toml` configurations.

Aggregate evidence: [database](./rollout/predeploy-database.json) and
[runtime and filesystem](./rollout/predeploy-runtime.json). No viewer identifiers,
payloads, credentials, or connection strings are included.

## Release gates and remaining proof

- PR #2429 must pass its full CI gate before merge. Its first integration run
  found an older delivery-retriever test fixture that omitted the new migrations.
  The fixture now applies 0100–0102 and uses a current benchmark clock rather
  than an already-expired fixed date. The exact database integration steps pass
  on fresh PostgreSQL 18: Watch 28 tests, recommendation 93 tests, semantic
  retrieval nine passed/one skipped, and profile 15 tests. Remote CI must still
  pass for the final commit.
- Verify migrations 0100–0102, the validated compact check, preserved unique
  index, removed duplicate index, and actual filesystem change after deployment.
- Verify both active service revisions and replicas, old-process drain, legacy
  trace readability, and retained dual-reader images before staging compact
  writes. A healthy web service alone is insufficient.
- Enable compact writes through the normal configuration and PR-to-main release
  path, preserving the legacy default in code. Record activation and the last
  legacy write, then check complete observations and absence of legacy rows for
  compact runs, issuance health, storage growth, and retention.
- The first nonempty request purge and the following daily cycle require future
  observation. Retiring old storage requires all legacy requests to expire at
  least 29 days after the final legacy write and a separate reviewed migration.
  Do not mark these time-dependent checks complete from local tests.

The migration and rollback procedure remains in
[the runbook](./storage-remediation-runbook.md). This record will be updated with
the actual release revisions, measured savings, activation evidence, and scheduled
follow-up before the rollout handoff.
