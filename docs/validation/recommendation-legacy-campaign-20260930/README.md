# Finite legacy detail campaign validation — September 30

All database work used task-owned disposable PostgreSQL 18 containers
`forge-legacy-campaign-20260930` and
`forge-legacy-campaign-recheck-20260930`, with separate loopback databases.
Both containers were stopped and removed afterward. The profile benchmark
container was untouched. Each fixture had all 120 migrations from the
September 30 checkout applied.

| Proof                       | Command target                                                                                   | Result                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retirement and Admin detail | `admin-ops/detail.db.test.ts -t 'protected legacy detail retirement PostgreSQL proof'`           | 9 passed; v2 incomplete unprotected trace preserved exact stored stage digest, original expiry and counters; v1 manifest dry-run accepted; held and linked protections, rollback and writer races passed.        |
| Empty-table reclaim         | `legacy-stage-reclamation.db.test.ts`                                                            | 7 passed; nonempty refusal, reader/writer lock behavior, restrictive FK refusal, compact detail/outcome/evaluation preservation and physical file reduction passed.                                              |
| Campaign loop and CLI       | `legacy-detail-retirement-campaign.test.ts` plus `retire-legacy-recommendation-campaign.test.ts` | 10 passed; finite multi-batch progress, durable-receipt replay after a progress-file failure even when holds/capacity change, stale capacity/hold/source stops, post-freeze freshness and required execute flag. |

The final native retirement rerun, including the completed-receipt lookup's
absent-then-present assertions, is saved in `native-retirement.log`. It passed
all nine selected retirement cases on a fresh task-owned PostgreSQL fixture.
The final Admin typecheck exited successfully; its output is saved in
`typecheck.log`. Focused ESLint, Prettier and `git diff --check` also passed.

The retirement test command reported two **skipped** tests because the `-t`
filter intentionally excluded the two other describe blocks in
`admin-ops/detail.db.test.ts` (Admin exact request trace and hybrid execution
accounting). No retirement case was skipped. The reclaim fixture measured
1,253,376 bytes allocated before deletion, 1,253,376 bytes after ordinary
deletion, and 24,576 bytes after the guarded truncate: 1,228,800 bytes of
local relation allocation reclaimed. This does not predict production
filesystem savings or prove production lock/scan time.

The SQL asset remains inactive, and no production data or service was changed.
The live cohort still needs a fresh protected inventory, exact source/target,
headroom and writer review, measured bounded throughput, ordinary cleanup of
expired roots, and an exact-empty check before a separately reviewed migration.
