# Watch runtime release verification — September 22, 2026

## Scope and current verdict

Two reproduced runtime defects are fixed through normal PR/main deployment:
[PR #2369](https://github.com/JesusFilm/forge/pull/2369) removes synchronous
Next error-inspection amplification, and
[PR #2371](https://github.com/JesusFilm/forge/pull/2371) bounds Mux fallback
reads inside PostgreSQL. Neither establishes the cause of the separate
September 21 08:37 selection timeout. No ticket is closed by a short healthy
window. All times below are UTC. The [aggregate artifact](../validation/watch-runtime-release-20260922/results.json)
retains release identities, fixed-window populations, executed plan and read-only
database observations separately.

The owned worktree is `codex/watch-runtime-fixes-20260922-n8v`. The catalog PR
incorporated freshly fetched main `dab14b21717f5c5ce271236841d6c4ab6eeaac37`,
passed its complete CI gate, and merged at 21:38:41 as
`ce421561ee9bcf89991dea5a060a656e45c3434b`. Review was sequential under the
repository's Compound Engineering tool mapping. The real PostgreSQL null-language
priority regression failed before the final correction and passed afterward.
The [catalog record](watch-catalog-memory-recovery-2026-09-22.md) and
[error-formatting record](watch-error-formatting-recovery-2026-09-22.md)
retain separate controls, performance populations, failed experiments and tests.

## Exact releases

The logger release `9492f01e92572777def7432d65b73f9910410fc4` was independently
verified in Admin at 21:21:36 and worker at 21:22:38, including the compiled
logger and opposite workflow-runner roles. Its deployments are
`e4441c32-df51-45c5-ba22-96e7c7311d1c` and
`53da7cef-d5ce-43dc-864a-dfe573a90126` respectively.

The catalog release is independently verified on Admin at 21:49:20:
deployment `d4c99cad-c229-4934-872e-0e2094a9238a`, exact revision
`ce421561ee9bcf89991dea5a060a656e45c3434b`, runner false, and both compiled
corrections present. A first detector required the source helper's function name,
which minification removes; the corrected check uses the distinctive final CASE,
LATERAL and ordering SQL. This was a diagnostic false negative, not missing code.
Worker deployment `23d8bfa9-d49f-4525-88dc-67c419dec76e` was independently
verified at 21:54:11 at the same revision, runner true, with both compiled
corrections. Both deployment records report SUCCESS. The sustained final-revision
observation remains pending; 21:55 is a conservative boundary after both checks.

At 21:48:56 a bounded read-only EXPLAIN ANALYZE of the final LATERAL query shape
(using one array parameter for the selected IDs)
returned 206 rows in **9.982 ms**, planning 1.070 ms. The plan uses the existing
duration and Mux indexes with per-video limits, without a parallel hash. These
are 206 ordered active catalog IDs, not recovered incident parameters. This is
a server execution sample, not an HTTP latency or production failure-rate claim.

Read-only inspection of the actual PostgreSQL service confirms a 64,000,000-byte
shared-memory mount at 21:58 (1,761,280 bytes then used). Its database volume is
63% used, with roughly 18.2 GB available; this is not evidence that historical
shared-memory exhaustion was a full database volume. The database deployment has
been active since August 15. The current limit strengthens the representative
local fixture; the exact incident concurrency and mount occupancy remain unknown.

## Initial logger-only observation

The fixed **21:23–21:40** window is only 17 minutes. Web remained on
`d0c749b981b8c3cf777c6e62bd9e5eae1abbd2bf`.

| POST endpoint |   200 | 401 | 403 | 409 | 5xx | Total |
| ------------- | ----: | --: | --: | --: | --: | ----: |
| Delivery      |    74 |   0 | 105 |   0 |   0 |   179 |
| Selection     |     1 |   0 |   0 |   0 |   0 |     1 |
| Playback      | 1,032 |   1 | 112 |   1 |   0 | 1,146 |
| Evidence      |   227 |   0 |  88 |   0 |   0 |   315 |
| Profile       |   126 |   0 | 290 |   0 |   0 |   416 |

After allowing ingestion to settle, independent Railway and Datadog final
delivery observations both reconcile all 179 primary requests. Of 74 HTTP 200s,
65 are served (49 with six cards; 16 partial), and nine are six-card coverage
fallbacks: four `no_candidates`, five `seed_embedding_unavailable`. There are
**zero observed `delivery_timeout` or `retrieval_timeout` envelopes** in this
complete short population. Initial queries undercounted recent metrics and logs;
the later fixed-window repeat resolved those differences. This does not erase
the three unknown semantic outcomes in the earlier 13-hour corpus.

Railway evidence observations independently reconcile the selection, playback
and initial-evidence populations. Playback includes one exact replay and one
`invalid_binding` HTTP 409 with terminal server disposition. This does not prove
the browser stopped retrying. All 125 recognized crawler submissions are rejected
(88 initial-evidence, 37 playback); no recognized crawler acceptance is observed.
Playback 5xx is 0/1,146, with no excluded traffic. One selection is insufficient
evidence for intermittent-selection recovery.

## Independent budget/commit investigation

The retained [08:37 selection trace](https://app.datadoghq.com/apm/trace/6ab0ecc9000000002cc67b5b00886e66)
contains a 701.119 ms Prisma budget call and 697.378 ms SQL span. A read-only
timestamp join found one matching persisted selection in the three-second window:
selection `received_at` is 08:37:29.032, budget `updated_at` is 08:37:29.041,
and the SQL span runs 08:37:29.044–29.741. The budget has three attempts, consistent
with render, impression and selection. No identities or capabilities are exported.

The function assigns `updated_at = now()` inside its independently committed
statement. Subject to cross-host clock difference and possible later updates,
the stored transaction timestamp near span start argues against assigning the
entire delay to native pool acquisition. It does **not** distinguish row locking,
execution, commit flush, transport or result scheduling after server entry.
Prisma's tiny logical connection span is still not a native-pool measurement.

A separate 61-second read-only observer at 21:17 sampled budget statements in
`IO/WalSync`, `IO/WalInitSync` and `LWLock/WALWrite`; the largest sampled budget
age was 264.884 ms. These later samples establish that WAL waits occur, not the
full cause of the earlier 701 ms incident. A second 93-second observer at
21:40:46 sampled only one running episode-budget statement (0.137 ms, no blockers).
It cannot establish that intermittent waits stopped. Container-address matching
did not identify the application's connections, so it supplies no pool-occupancy
claim. No diagnostic touched live application callbacks or opened an inspector.

Across the separate 156.017-second PostgreSQL counter interval, WAL grew by
32,458,170 bytes and client backends recorded 4,814 normal-context fsyncs.
`track_io_timing` and `track_wal_io_timing` are off: zero timing counters do not
mean zero I/O latency. Fsync, synchronous commit and full-page writes remain on.
No global database or service setting was changed. Observer-local read-only,
statement and lock settings disappeared when each connection closed.

Datadog's Prisma spans use `env:production`; application outcome logs carry
`env:prod` inside raw `@ddtags`. A filter for the wrong environment can falsely
return zero. The available PostgreSQL integration metrics identify other Core
databases, not Forge's Railway database; their storage metrics cannot be assigned
to this incident. The Datadog agent exposes host disk metrics, including the same
device ordinal, but independent SSH checks find a different kernel boot identity
from PostgreSQL. Device-name agreement alone is insufficient to assign those
latencies to the database. Retained spans remain samples, never request denominators.

## Profile evidence advances and remaining gates

At 21:45:11 the exact canonical Admin aggregate query, run read-only against
production, reports zero affected current pointers, invalid contributions,
rebuild candidates, backlog or stale claims. It took 8.224 seconds. This is
database evidence, not the outstanding authenticated Admin UI acceptance.

The fresh 19:45–21:46 terminal-run population contains **11
`pointer_generation_fenced`** and **five `eligibility_input_fenced`** runs.
The follow-up at 21:48:10 verifies that all 16 have no published projection,
all still have a current pointer with eligible canonical lineage, and all 11
pointer-fenced runs have a newer current pointer than the attempted generation.
Nine record an existing expected generation; two expected an initial pointer.
The worker persists these reasons only after the projection service raises the
corresponding typed fence. This is natural production evidence of stale
publication prevention, distinct from scheduler lease recovery. It advances
feat-447's independent publication gate; the matching Admin trace remains open.

Retained requests since September 18 still contain no
`last_known_good_semantic_fallback` result. The independently passing local
fallback drill remains local evidence. The full 41-monitor Datadog inventory
still lacks the required recommendation transport/reconciliation monitors.
Read-only access was preserved; no monitor or dashboard was installed.

| Ticket   | Remaining requirement                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| feat-447 | Matching authenticated Admin lifecycle/trace and independent operational last-known-good fallback proof.                                               |
| feat-459 | Matching authenticated Admin evidence and completion of feat-464.                                                                                      |
| feat-464 | Installed/verified alerts, matching authenticated Admin evidence, actual browser terminal-409 non-retry proof, and sustained final-release acceptance. |
| feat-496 | Complete attribution and demonstrated correction of the independent budget timeout, plus sustained separate HTTP/envelope observation.                 |

## Homepage and concurrent work

The user explicitly reconfirmed **keep the authored English homepage block
removed** after the independent pilot restoration. The read-only rollback
preview identifies only `watch-home-recommendations`, index 2: 14 blocks before,
13 preserved blocks after, no active draft. An authenticated Admin connection
is required to publish that exact change and perform the outstanding UI checks;
none is connected. This task has not removed the restored block and must not
claim otherwise or manufacture an Admin identity.

Newer main `f8f997fc8cb8cb49e5b16e6c460beffb1ad25468` was incorporated into
this evidence branch. PR #2372 separately stages the private tester SDK setup
for a normal Web release; its rollout must not be confused with these Admin
fixes. The flag registry default remains off. No Mobile/TV, account linking or
curation changes were made by this task.
