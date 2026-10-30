# Retired behavioral recommendation schema removal

The owner requested physical cleanup after feat-902 independently drained the
behavioral recommendation rows. Feat-905 removes the remaining runtime
queries, 19 empty tables and their indexes, 11 unused enum types, 21 orphan
functions and six co-watch triggers on retained tables. It keeps semantic and
metadata retrieval, curated fallback, native viewer/push identity, playback,
eligibility, current precomputed A/B evidence and historical experiment,
study, shadow, composition, promotion and owner-release records. The completed
retirement operation's 31,080 receipt rows remain.

## Reviewed releases

| Release               | PR                                                    | Reviewed head                              | Normal main merge                                                   | Actual role verification                                        |
| --------------------- | ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Compatible runtime U1 | [#2963](https://github.com/JesusFilm/forge/pull/2963) | `eb27a45a02b136ee43e8c69c6fc827c918ff4280` | `fef631df330a6d0dd6c5477f2209cfeed09fd993`, October 29 23:53:44 UTC | October 30 00:07:25–00:07:43 UTC: HTTP 1/1, worker 1/1, Web 2/2 |
| Empty schema U2       | [#2965](https://github.com/JesusFilm/forge/pull/2965) | `ad16f75631767560030f49b495b63c3758e8d4d0` | `161fd1e36d64453ac549bccc69b362a68cecf304`, October 30 00:09:59 UTC | October 30 00:16:55–00:17:13 UTC: HTTP 1/1, worker 1/1, Web 2/2 |

U1 leaves the old schema intact while eliminating all application dependencies.
Every actual HTTP and worker replica was verified on the compatible source
before U2 merged. Web remains on its separately verified semantic/metadata release.
After U2, U1 is the oldest safe application rollback target.

Migration `0165_remove_retired_behavioral_schema` has SHA-256
`5e0cb5d8a2bc499ae3c54fb1d9dcfe47efd3c7a2b2ccfca609e32bd54475008f`.
It checks all 19 tables are empty, three retained reference categories are null,
and retired workflow/runtime links are terminal. It fences concurrent writes,
uses explicit object names and `RESTRICT`, and retains a stricter existing
transaction timeout or establishes a five-second cap before table locks.
Unexpected data, dependencies or lock contention roll back the DDL.

## Admission and production result

The final pre-U2 read on October 30 at 00:08 UTC followed successful actual
U1 all-role verification. It found all 19 tables exactly empty, all three
retained reference categories null, no active retired workflow or graph/owner
authority, 31,080 retirement receipts, no unfinished migration and no selected
catalog drift. All 352 constraints, 37 triggers and 23 function definitions
matched the local historical schema baseline. No lock waiter or transaction
older than 60 seconds was observed. A separate bounded existence-plan read
executed in 0.683 ms after 4.958 ms planning; it does not measure the subsequent
DDL or establish cold production latency.

Final independent source receipts cover U1 `eb27a45` and U2 `ad16f75`.
The final U2 tree and scoped diff were identical after rebasing onto the U1
squash merge. Both releases merged only after every relevant exact-head check
was independently classified as passing or an explicitly conditional skip;
no cancellation, abandonment, unknown result or timeout counted as validation.
U2's [CI run](https://github.com/JesusFilm/forge/actions/runs/40976440157)
passed without retry. The pre-merge [admission receipt](https://github.com/JesusFilm/forge/pull/2965#issuecomment-6511569704)
records the precise gate and source.

Production migration 0165 finished at 00:14:37.716664 UTC with the expected
checksum, one applied step, no rollback and no unfinished migration. The 00:18
catalog read found none of the 19 tables, 21 orphan functions, 11 enums or six
retained-table co-watch triggers. The three retained scalar references remain
null and their new NULL-check definitions match the reviewed fixture. Both
retained guard hashes and all 12 trigger definitions, attachments and enabled
states match the post-0165 native fixture. The retirement receipt count remains
31,080; this is count continuity, not a digest of every row's contents.

Every actual Admin HTTP/worker process runs U2, with matching deployment and
replica IDs, health 200/body `ok`, compact mode and runner false/true. Both Web
replicas remain on A with matching IDs and `/watch` 200. The CLI stderr contains
only its SSH-agent diagnostic, not a runtime error.

Bounded retained-table observations found request/served/playback/content-profile
and precomputed-visit presence at the 1,000-row reporting cap, 47 native viewers
and 360 curated pools. Current A/B control remains active with one linked
`public_ready` experiment. These are presence/control observations, not exact
large-table totals or recommendation usefulness evidence.

From 00:17:14 to 00:19:44.909345 UTC, all 20 persisted natural requests fit
within the 1,000-row cap: 18 served, one empty with `no_candidates`, and one
fallback with `seed_embedding_unavailable`. Issued items included 42 semantic,
47 precomputed and six curated items; no personalization decision was written.
These coverage outcomes are accepted, but do not establish usefulness or global
reliability.

The aligned logs do contain six Admin retryable `facts`/`transaction_busy`
attempts, including attempts one and two; one matching retry event was already
present before U2. Accepted facts events also occur, but there is no request
correlation proving every failed attempt later succeeded. The Web application
log reached its 200-line cap and includes ten React server-component ref errors
and missing LaunchDarkly flag defaults. Neither a narrow pre-U2 window nor a
separate pre-U1 window returned the targeted React error; its cause, route and
user impact are unproved, so it is not declared preexisting or harmless.
Worker error and Admin/Web HTTP 5xx queries returned zero in the aligned
interval. A narrower Web failed-recommendation-evidence query also returned
zero. Those bounded log results do not erase internal errors or prove every
request succeeded. The retained recommendation event samples are capped. They include at least
five playback `forbidden` HTTP 403 responses for `crawler=not_recognized`,
seven `ordinary_browser` delivery `invalid_fetch_metadata` HTTP 403 responses,
and one recognized-crawler playback rejection. Without request/capability
context, the ordinary-browser/unrecognized-crawler refusals are unresolved
reliability signals, not classified as correct rejections or proved playback
breakage. The zero `outcome=failed` and 5xx queries cannot establish absence of
these refusals or of rendering errors.

The fact retry messages are attempt-level observations emitted by
`transaction-retry.ts` before bounded retries continue; no terminal exhaustion
was found in the uncapped Admin error sample. They do not by themselves prove
failed persistence, nor does the available evidence correlate every eventual
commit. The unlocalized Web rendering error is recorded separately in
[feat-907](../roadmap/platform/feat-907-watch-server-component-ref-errors.md).
No global delivery-clearance claim is made.

Independent production review accepted the physical schema removal and bounded
retained-database compatibility evidence, with the delivery limitations above
explicitly retained. The private receipt is
`final-production-schema-acceptance-review.md`; its SHA-256 is
`6e2041bdade9a6ebee0f513ebc0d139490f93740950043dd5f92eca24c567019`.
The retry/refusal signals stay with
[feat-792](../roadmap/content-discovery/feat-792-watch-recommendation-event-reliability.md);
the React rendering investigation is feat-907. Neither is counted as repaired
by this cleanup.

## Measured storage

| Observation                         | Before U2        | After U2                  |
| ----------------------------------- | ---------------- | ------------------------- |
| Timestamp (UTC)                     | October 30 00:08 | October 30 00:18          |
| Database allocation (bytes)         | 41,312,048,831   | 39,187,658,431            |
| Retired relation allocation (bytes) | 2,127,486,976    | 0; exact table set absent |
| PGDATA filesystem available (KiB)   | 7,205,188        | 9,280,128                 |
| PGDATA filesystem used (%)          | 85               | 81                        |
| WAL allocation (bytes)              | 100,663,296      | 100,663,296               |

Observed filesystem availability rose by 2,074,940 KiB (2,124,738,560 bytes),
while database allocation fell by 2,124,390,400 bytes. These are separate from
the 2,127,486,976 bytes of retired relation allocation. Concurrent database work
can affect filesystem and WAL snapshots;
this release does not isolate reusable heap pages or forecast future capacity.
No manual ordinary purge, direct redeploy, timeout widening or VACUUM FULL was
used to obtain the result.

## Verification and repaired findings

- U1: 848 recommendation unit tests; 22 retained PostgreSQL cases; full Admin
  lint, sharded typecheck, build and generated workflow verification. SDL and
  typed-client generation produced no public-contract drift.
- U2: 19 populated native migration cases, 11 retained expiry/context cases,
  all 276 tests in the precomputed CI suite, 15 applicable semantic native
  cases (one expected opt-in drill skipped), and 103 distinct migration/runtime
  cases across the original run and focused corrected-detail rerun. Full Admin
  typecheck, build, generation, focused lint and normal commit hooks passed.
- Independent review caught a missing current-session CTE, stale workflow build
  expectations and lost retained native coverage; each was repaired. The parent
  also removed three implicit Prisma profile relation reads in playback/evidence.
  Obsolete positive profile dashboard assertions and old profile/consent fixture
  writes were corrected while preserving historical data and current A/B proof.
- Local timeout proof: two three-second statements after locks triggered
  PostgreSQL `25P04` at approximately five seconds, rolled back and released the
  retained writer. A warm local 121.8 MB dead-page fixture completed unchanged
  migration plus rollback in 94 ms. Neither establishes cold production latency.

U1's second CI run encountered the existing feat-609 filtered HNSW fixture
failure: ANN returned zero versus 12 exact eligible videos; pgvector 0.8.7,
strict ordering, 20,000 scan tuples, eight loops with zero returned rows and
159 filter removals per loop. The assertion and production retrieval files were
unchanged. One supported failed-job retry on the same reviewed head was
requested and passed in run 40974368637 attempt 2. All relevant final U1
checks passed before merge. A passing retry does not fix feat-609 or prove
production retrieval correctness; the original failure remains recorded.

## Ordinary expiry and remaining roadmap work

The 00:19 UTC read captured all 21 retained health families: 254,617 newly
stored-expired rows, including 244,902 Watch exposures, and zero more than
24 hours overdue. Both extra expiry inventories were zero and uncapped. This
is a dated backlog before the next ordinary daily wake, not whole-inventory
clearance. The success expiry cutoff remains October 29 13:16:34.512 UTC.
The persisted scheduler and runtime are running without a recorded scheduler
error, with next wake October 30 10:30 UTC (23:30 NZDT).

Both uncapped 48-hour ledgers preserve the October 28 six and October 29 eight
failed attempts. October 29 has 424 durable successes, 95 budget yields and
eight failures; its 519 successful wrappers combine successes and budget yields,
so wrapper success alone does not establish completion. No new daily attempt
appears after this release. The 23 unfinished durable records and three wrapper
records predate the release; their newest starts are October 26 and 23,
respectively. This deployment does not run an ordinary expiry cycle and earns
no new daily cycle credit. October 23 and 27 already meet the accepted cycle-count gate.
The October 29 eight genuine ordinary-retention failures remain historical;
their exact latency cause is not established by schema removal. Feat-554's
operational margin, feat-756's Watch expiry/capacity work and feat-609 remain
open. No additional fixed clean-day requirement is introduced.

The existing daily observer remains active with the retained 21-family/two-extra
inventory and actual release references. Historical 26-family/nine-extra
receipts remain dated evidence; it must not query dropped tables. The expired
outage monitor remains paused. The original 40-path inventory, reread from current frontmatter, remains
11 complete, 26 cancelled and three in progress; feat-902/905 are separate
from that original count.

Local original observations and review receipts are retained under
`/home/nisal/.codex/research/recommendation-schema-removal-905/`, including both
original streams on any failed provider read. The related plan and durable
learning explain the compatibility boundary and retained regression coverage.
