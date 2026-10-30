# Behavioral recommendation retirement: accepted production closeout

The independently reviewed October 29 production evidence accepts feat-902/U4's
bounded cutover and row drain. The D operation completed at 07:18:45 UTC; a
later exact read found zero rows in all 19 retired direct-delete tables.
[Feat-902](../roadmap/content-discovery/feat-902-semantic-metadata-only-recommendations.md)
is complete for this scoped production result. See the accompanying documentation
PR and root [#2541](https://github.com/JesusFilm/forge/pull/2541) for exact-head
review, CI, merge and normal-deployment receipts. The owner retired viewer profiles,
co-watch and behavioral learners while keeping semantic/metadata recommendations, video content
summaries, playback, native installation identity and current precomputed A/B
evidence.

## Independently accepted production evidence

The assembled local evidence (`/home/nisal/.codex/research/recommendation-retirement-release/final-retirement-evidence-20261029T072642Z.json`)
(SHA-256 `bd29722d83068229cb5a5e6d7179523283b80c7d42537e941a384473952bba54`)
binds the source, operation and receipts below. The independent
production acceptance review (`/home/nisal/.codex/research/recommendation-retirement-release/final-production-acceptance-review.md`)
(SHA-256 `44d32fad257b575035412885af2a9f852ed17bdd45b9f3e5951ac0a54b86013e`)
accepted the bounded cutover and U4 row drain. These are dated observations,
not an eternal-zero or global serving guarantee.

| Feat-902 evidence                         | Observed result and receipt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Review state                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| CLI completion and durable reconciliation | The final D CLI window returned `complete` at **07:18:45.058906 UTC**. The 07:20 summary reconciles **3,088,917 direct deletes**, **18,055 explicit detached-reference updates** and **31,080 batches** against the durable ledger for the same operation/source. Direct deletes exclude cascade descendants and ordinary expiry. `retirement-summary-20261029T072014Z.json`; `drain-ledger-20261029T071914Z.json`; final `cleanup-window-20261029T071842645839Z.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Accepted in independent production review |
| Retired table and reference state         | A read beginning **07:19:15 UTC**, after CLI completion, counted **zero rows in each of the 19 direct-delete tables** and zero remaining shadow, decision and experiment-assignment profile references. `retired-counts-20261029T071915Z.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Accepted in independent production review |
| Retained data and serving                 | After the drain, request, served-item, playback, content-profile and precomputed-visit presence probes each reached a 1,000-row cap; native viewer count was 47 and curated pools 360. Current precomputed control remained `ab` with one `public_ready` experiment, two complete generations and one active link. Caps are lower bounds, not row-by-row preservation proof. `retained-presence-20261029T071915Z.json`. A separate uncapped natural 07:18:45–07:26:23 cohort had 27 requests: 15 served, ten empty (nine `no_candidates`, one `no_playable_connections`) and two `seed_embedding_unavailable` fallbacks; 60 semantic, 19 precomputed and 12 curated generator contributions; zero personalization decisions and zero recent profile/projection/co-watch creates. Its SQL labels nine `no_candidates` and two `seed_embedding_unavailable` candidate-run reasons as `candidate_internal_failures`; the alias does not establish actual internal errors. The sample does not inspect every stage-level error, so no zero-error claim is made. `serving-smoke-20261029T072619Z.json`. The sample does not prove usefulness or global reliability. | Accepted in independent production review |
| Final source and admission                | Actual Admin HTTP/worker ran D `786902d4d3a0288bf86b2661e63f6c2ccd1e9195`; Web ran A `c2f0a0e52a58b62a848617fd773ba7d228bdcde6`. Expected runner roles, compact mode and 200/ok health passed. Migration 0164 checksum/catalog and retirement admission passed with no pending projection business rows. `roles-20261029T071915Z.json`; `migration-proof-20261029T071915Z.json`; `admission-proof-20261029T071915Z.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Accepted in independent production review |
| Capacity and physical limits              | At **07:19 UTC**, PGDATA had **6,855,544 KiB available**, 86% used; WAL was **622,604 KiB**. The empty retired relations still allocated **2,261,729,280 bytes**. The database was about 41.13 GB. `physical-capacity-20261029T071915Z.json`; `retired-counts-20261029T071915Z.json`. DELETE is not physical filesystem recovery. Reusable pages were **unmeasured**; causal reclamation and CPU-efficiency improvements were not established.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Accepted in independent production review |
| Independent closeout                      | The independent production review accepted the cutover and U4 drain. Feat-902 is complete. See the accompanying documentation PR and root [#2541](https://github.com/JesusFilm/forge/pull/2541) for exact-head review, CI, merge and normal-deployment receipts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Production accepted; see PR receipts      |

Local receipt names in this table are under
`/home/nisal/.codex/research/recommendation-retirement-release/`.
A fresh zero read after the last profile deletion is a bounded observed state
under the deployed source, not an eternal-zero promise or fixed wait/activity
requirement. If later retired rows appear, another separately coordinated
source-bound drain and recheck is needed; this report does not authorize one.

## Durable history and constraints

The B fence at 01:29 UTC timed out before mutation because its admission query
scanned about 1.27 million workflow runtime rows. C's indexed repair retained
the five-second limit; separate read-only candidate plans took 4.615 and
2.010 ms, without proving production drain throughput. C fenced the fresh
32-row pending cohort at 02:29 without rewriting FAILED runtime history. The first C cleanup
invocation at 02:30 was refused before connecting to the database because its
CLI parser rejected the required `--proof-sha256` flag. Durable reconciliation
found zero batches, deletions and updates for that operation; it was not
retried. These are dated failures, not the current fence or drain state.

D [#2960](https://github.com/JesusFilm/forge/pull/2960) fixed the parser
mismatch and merged as `786902d4d3a0288bf86b2661e63f6c2ccd1e9195`
after independent review and green checks. Its first source-bound window
committed 1,856 direct deletes in 20 reconciled batches. The 03:44 and 04:37
durable checkpoints recorded 249,845/2,500 and 373,750/3,740 deleted
rows/batches respectively. These are historical subsets of the final 07:20
total, not competing current states. Railway rate-limited an inventory check
at 03:54 **before** the next dispatch; proof expired at 04:14, and provider
control recovered after the conservative 04:32 cooldown. At 06:34:55 a
quota-reset timestamp crossed 37 ms before the HTTP 200 response
was captured, so strict validation stopped before another dispatch. A fresh
inventory and durable reconciliation passed and the parent resumed at 06:37.
At 06:56 a read-only PostgreSQL schema/catalog query exceeded its five-second
statement timeout. The known remote exit was 1; the wrapper's null exit code
was a parser limitation, not an unknown database outcome. Durable ledger and
acknowledgements prove zero additional mutations for that failed window. A
checkpoint overlapped in time, but causation is unproved; a later read-only
execution of the same catalog plan took 0.121 ms. Independent review approved
one unchanged canary, which reconciled 2,000 deletes in 20 batches before the
bounded drain continued. Preserve the 06:56 failure without widening the
timeout or calling it a successful window. The optional 05:49 diagnostic
collector's original outcome remains unknown; a separately observed 06:05
raw-preserved collection does not replace it.

The reusable cutover, operator and quota lessons are recorded in the
[retirement learning](../solutions/architecture-patterns/retire-writers-before-bounded-data-deletion-20261029.md);
this report remains the dated source for production outcomes.

Suppression is inserted from database inputs within one caller transaction,
not retained in application memory across transactions. The profile fence
locks and updates the profile before suppression; completion must update the
profile before commit. Cleanup drains session and source inputs before
suppression and profiles last. Deleting a profile first would make erasure
completion fail and roll back its suppression insert. Retained-reference
checks and the post-completion source-bound inventory observed the intended
state as independently accepted.

A separate 02:15 UTC read-only retained-lane baseline found 45 native
installation identities and 360 curated pools. Current precomputed control was
`ab` with one `public_ready` experiment and two complete generations. Request,
served-item, playback, content-profile and precomputed-visit presence probes each
reached their 1,000-row cap; they are lower bounds, not exact table totals. This
baseline precedes the row drain and does not prove those rows will survive it.

The bounded natural A request cohort from 00:40:20–00:42:42 UTC had eight
requests: five served, two valid `no_candidates` empty results and one curated
fallback for `seed_embedding_unavailable`. Served items included 24 semantic,
six curated and one precomputed; there were no personalization decisions or
new viewer profiles, projection runs/generations or co-watch generations in
that sample. These observations support a bounded cutover check, not a global
reliability guarantee, catalogue-exhaustion finding, causal usefulness result
or A/B winner. Accepted empty/partial coverage stays separate from recorded
internal errors and correctness defects.

A separate bounded D cohort at 03:31 UTC recorded 35 naturally issued
requests: 24 served, ten valid empty results and one supported fallback. It
recorded zero new behavioral creates and zero personalization decisions in
that sample. This is bounded serving evidence, not proof of all requests,
coverage completeness or usefulness.

Ordinary expiry is a separate service. October 23 and 27 are the two accepted
ordinary loaded failure-free cycles; October 28 had six failures, 107 safe
budget yields and 542 successes and earns no new clean-cycle credit. The
one-shot 07:19 post-retirement observation (`ordinary-retention-postcheck/observation-final-20261029/result.json`)
captured all five read-only assets. Across 26 health families, 383,444 rows
were newly stored-expired after the October 28 13:49:18.176 UTC success expiry
cutoff, with zero more than 24 hours overdue; all nine extra bounded inventories
were zero. The persisted scheduler and runtime remained running without error,
with next wake October 29 10:30 UTC. The historical 23 unfinished durable and
three wrapper rows remain recorded; they do not prove current locks. There were
zero lock waiters or long transactions in the separate database frame. These
observations do not add daily-cycle credit or show the newly expired backlog
already cleared.
Feat-554's continued operational margin and feat-756's Watch capacity remain
open. A manual behavioral-retirement pass earns no ordinary daily-cycle credit.
The existing storage observer remains active.

Release B intentionally leaves the 19 retired tables and indexes in place.
[Feat-905](../roadmap/content-discovery/feat-905-retired-behavioral-schema-removal.md)
tracks their later physical schema/index/code removal after accepted row-drain
evidence. Neither row DELETE nor a later schema change should be reported as
recovered filesystem bytes without direct measurement. Historical co-watch
refresh feat-573 is cancelled by the owner decision, not completed by a
successful refresh; the original 40-path inventory is 11 complete, 26
cancelled and three in progress, with feat-902 and feat-905 outside that count.
