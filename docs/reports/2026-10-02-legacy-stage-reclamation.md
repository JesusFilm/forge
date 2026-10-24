# Production legacy stage reclamation

On October 2 NZDT (October 1 UTC), the owner authorized disposal of all remaining
legacy stage detail, including former quality and investigation holds. Compact
payloads, request/run metadata, served items, events, profiles and ordinary privacy
expiry remain. This replaced the expired finite campaign; that job must never restart.

## Measured result

Migration `0127_recommendation_legacy_stage_bulk_retirement` committed at
**October 1 22:25:50.314993 UTC**, taking 5.084 seconds. The stage relation is empty
and still exists with its schema and reader compatibility intact. There are no
unresolved Prisma migrations. No full-population row count was collected.

| Measurement                     |  Before recovery | After reclamation |                          Change |
| ------------------------------- | ---------------: | ----------------: | ------------------------------: |
| Legacy relation allocation      | 16,431,259,648 B |          24,576 B |      16,431,235,072 B reclaimed |
| PostgreSQL filesystem available |  9,367,367,680 B |  25,511,591,936 B | 16,144,224,256 B more available |
| Current database allocation     | 39,015,667,391 B |  22,603,183,807 B | 16,412,483,584 B less allocated |
| WAL allocation                  |    419,430,400 B |     687,865,856 B |            268,435,456 B larger |

The before observations were taken at 22:17 UTC; after observations at 22:27 UTC.
The filesystem measurements have the same verified PGDATA/database binding.
**16.431 GB of relation files were reclaimed; net free disk increased 16.144 GB.**
WAL and concurrent writes explain why these measurements are different quantities;
the interval does not isolate every other filesystem change. Decimal GB are used.
Previously removed indexes are excluded, so these savings are not double-counted.

The stopped unattended script had previously removed 342,235 stage rows across
5,110 reconciled runs, without reclaiming the table's files. That historical count
is separate from this operation, which discarded all remaining stage rows.

## Release and recovery

[PR 2532](https://github.com/JesusFilm/forge/pull/2532) introduced the bounded,
restrictive truncate migration through the normal PR-to-main path. Its first
deployment hit the statement timeout during parent retirement preparation and
rolled back. Prior serving instances remained healthy; no space was recovered.

[PR 2534](https://github.com/JesusFilm/forge/pull/2534) added checksum-bound recovery
to the existing migration wrapper. It committed retirement markers in bounded
500-parent pages, serialized concurrent deployers, resolved only the exact failed
migration and ran the unchanged migration. The preparation logs reached 213,383
newly retired parents; this is not a count of deleted stage rows. The truncate
then reclaimed files. No timeout was widened, no CASCADE or VACUUM FULL was used,
and no local worktree was directly deployed.

The recovery release is `755345a92d0c4c12d920535800be5cd80f38a74f`.
At 22:30 UTC both Admin HTTP and worker deployments succeeded, actual processes
reported that revision, health returned 200 and both used compact writers. Web
remained on `1fde61c3a`, separately observed at 22:27, with `/watch` health 200 at
22:29; this Admin-only release does not imply identical commits across services.
Fresh Railway inventory still showed a ready nominal 50,000 MB volume. Provider
used-size accounting had not caught up with the directly measured filesystem.

The latest 1,000 candidate runs contained no legacy writes or compact payload
omissions. Post-migration checks found no lock waiters or cleanup operation.
These bounded observations are storage/serving checks, not universal quality proof.
The owner waived the former per-cohort preservation verification; no fresh
authenticated trace-detail UI smoke is claimed. Native reader/preservation tests
and all 33 focused tests passed, followed by all required CI. The previous healthy
`1fde61c3a` images remain compatible code rollback options; code rollback cannot
restore discarded observations.

## Remaining monitoring

Feat-554 remains open: September 30 and October 1 normal retention cycles recovered
after failures, so there are still zero qualifying failure-free loaded cycles.
The next normal cycle is October 2 at 10:30 UTC. Require two qualifying cycles and
continued headroom before closing retention verification. Daily monitoring remains
active; the old finite deletion job remains permanently stopped. No monthly
steady-state growth or 5 GB/month whole-database claim follows from this snapshot.

Sanitized local evidence is under
`/home/nisal/Documents/Codex/2026-09-28/recommendation-traffic-isolation/outputs/heartbeats/20261001T-bulk-reclamation/`:
`pg-binding-recovery-premerge.json`, `storage-recovery-premerge.json`,
`pg-binding-after.json`, `storage-after.json`, `runtime-final.json` and the final
closeout receipt. `unattended-latest.json` points to the current result.
