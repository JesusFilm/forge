# Legacy recommendation reclamation preparation

This is local preparation for [feat-555](../../roadmap/platform/feat-555-recommendation-legacy-trace-reclamation.md),
based on main `fb54d0ab7c280456106cdb31ef0c6646b64c13a3`. The SQL asset is outside
Prisma migrations and has no runtime import, command, schedule or deployment
hook. This PR cannot reclaim production storage. A later separately reviewed
migration must pass the [operations guide](../../operations/legacy-recommendation-stage-reclamation.md)
entry gates and deploy through the normal PR-to-main flow.

## Disposable PostgreSQL proof

All 105 current Admin migrations were applied to a dedicated PostgreSQL 18
fixture on loopback. The exact SQL asset passed six database cases; a seventh,
network-free guard case rejects destination overrides in connection strings.
The database proof is deliberately opt-in and is not in the shared real-DB CI
file list because it requires an empty, separately owned database.

| Check                   | Evidence                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Retained evidence       | Refusal with every stored stage and parent unchanged                                                                                     |
| Reader contention       | One-second lock timeout, rollback and successful later retry                                                                             |
| Concurrent writers      | A pre-lock commit causes refusal; a post-lock writer waits and its evidence survives                                                     |
| Normal expiry           | Five roots and their 1,630 stage observations removed by the real retention service                                                      |
| Compact preservation    | Full detail, parent/run/item/selection/episode/outcome/evaluation values and expiry unchanged                                            |
| Continued functionality | Compact expiry and fresh legacy issuance/detail work afterward                                                                           |
| Atomicity and schema    | Failure after truncate restores allocation; inbound foreign keys refuse without cascade; index definitions retained                      |
| Disposable target guard | Explicit opt-in, loopback host, owned database-name prefix, PostgreSQL scheme, no query overrides or fragments, no existing request data |

In the final fixture run, the stage relation occupied **1,425,408 bytes** both
before and after normal deletion. Truncating the exactly empty relation reduced
it to **32,768 bytes**, returning **1,392,640 relation bytes**, including indexes
and TOAST. This is local allocation evidence, not measured production filesystem
savings. Fixture allocation can vary across runs. Neither the small fixture nor
its lock test establishes scan latency on the historical 18 GB relation.

Run only with `DATABASE_URL` already set to an explicitly owned, disposable
loopback database named `forge_legacy_reclamation_*`, with current migrations
applied:

```bash
CI=1 RECOMMENDATION_DB_TEST=1 pnpm --filter @forge/admin exec vitest run \
  src/services/recommendations/legacy-stage-reclamation.db.test.ts
```

Default and mocked-URL collection each passed the guard case and skipped the six
database cases. Full Admin typecheck, full Admin lint, scoped formatting and
whitespace checks passed. The PR's normal checks provide separate integration
validation. Before migration promotion, rerun this dedicated proof and the
then-current migration/build checks; do not treat a skipped suite as proof.

Independent Sol review covered correctness, testing, maintainability, project
standards, data safety, adversarial scenarios, performance, reliability,
TypeScript, agent parity and prior learnings. Two findings were fixed and
re-reviewed: validated environment access and connection-string destination
overrides. No actionable findings remain. Production-sized empty-scan latency
and reader blocking remain explicit future verification requirements.

## Production remains gated

Read-only reconciliation on September 28, 19:26–19:40 UTC found actual Admin HTTP,
worker and Web on `e020c5d6b1b140a01e08175bda190eb2f2c4788c`, healthy, with compact
Admin writers and no legacy writing after the original fleet convergence.
Latest 100 compact and 100 legacy samples had zero stage-count mismatches.
Sampled indexed traffic showed 163 crawler persistence avoidances in the latest
hour and zero excluded commits; speculative traffic was absent and public For
You remained disabled. These samples are not exact traffic totals.

Direct available filesystem space was **10.568 GB** on the still-nominal **50 GB**
volume. The four-hour slope implied about six days to exhaustion, crossing the
seven-day alert; longer 14.6–20-hour slopes implied about 12–14 days. WAL cycling
accounted for part of the difference. These short observations do not prove the
remaining 28-day overlap is safe. The user was notified; no resize or financial
commitment occurred. A project token can read inventory, but the supported CLI
and API expose no resize operation; the dashboard remains necessary.

The first root expiry remains **September 30, 00:20:47.858 UTC**. Daily cleanup is
at **10:30 UTC**. The latest durable wrapper completed a zero-root invocation in
526 ms; it does not prove loaded cleanup. Verify the first nonempty cycle and
the following daily cycle from the wrapper's actual start/finish times plus the
retention ledger's descendant counts, skips/failures and oldest-expired age.
The ledgers lack a direct shared batch reference.

Last observed legacy write remains September 27, 23:24:43.215 UTC, with maximum
legacy expiry **October 26, 23:24:43.126 UTC**. Extend this horizon if legacy
writing resumes. The legacy relation still occupies **18.393 GB** and retains
evidence. Its exact empty check, verified purge, current fleet and capacity,
authenticated Admin UI proof, and a separately reviewed migration deployment
remain outstanding. Neither feat-554 nor feat-555 is complete.

No new production storage was reclaimed in this preparation. Earlier duplicate
index removal returned 2.344 GB net filesystem space over its historical
measurement interval; do not count that gain again. The reviewed ten-run
conversion pilot provided no immediate filesystem savings and is not replayed
or expanded. Every observation retains its original 29-day lifetime.
