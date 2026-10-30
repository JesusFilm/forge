# October 27 ordinary recommendation retention cycle

The ordinary scheduled cleanup ran from October 27 10:31:10 to 11:22:13 UTC.
The storage observer collected bounded aggregate evidence at 17:14:49 UTC.
Independent review accepted October 27 as the second qualifying ordinary loaded,
failure-free cycle, alongside October 23. The two-cycle requirement is met.
Feat-554 remains in progress for its continued capacity-margin obligation;
feat-756 retains the separate larger Watch expiry-wave assessment. Manual
cleanup earns no cycle credit. No additional fixed number of clean days is
required by this decision.

## Scheduled work

| Observation              | Successful passes | Safe budget yields | Total  |
| ------------------------ | ----------------- | ------------------ | ------ |
| Durable attempts         | 240               | 2                  | 242    |
| Committed request roots  | 6,011             | 100                | 6,111  |
| Served items             | 26,889            | 439                | 27,328 |
| Watch exposures          | 72,558            | 2,000              | 74,558 |
| Projection runs          | 21,373            | 200                | 21,573 |
| Projection contributions | 11,217            | 200                | 11,417 |
| Standalone episodes      | 5,890             | 27                 | 5,917  |

The durable ledger reported zero failures. The wrapper ledger reported 242
successful scheduled invocations and no errors. Their agreement is aggregate;
there is no asserted shared per-attempt linkage. The two durable
`SKIPPED/budget_yield` attempts retain their committed counts and do not advance
the success watermark by themselves. The later successful work and return to
the next daily wake establish completion of this catch-up cycle. Different root, descendant and
unlink categories must not be summed as unique deleted records.

The scheduler and its runtime were running without an error, with the next
daily wake at October 28 10:30 UTC. The latest successful expiry cutoff was
October 27 11:22:12.235 UTC. This was ordinary production work; the read-only
observer did not trigger cleanup or modify production.

## Expiry and capacity at observation time

All 26 health families reported zero rows more than 24 hours overdue. Their
current expired total was 108,672, including 90,201 Watch exposures. The oldest
reported current expiry was 11:22:14.570 UTC, after the successful cutoff.
The sealed query covers all 26 families; its collector computed the total,
oldest expiry and overdue sum before printing the top seven family counts. The
other 19 individual counts are unavailable, although their combined count is 506. The oldest expiry is 2.335 seconds after the success cutoff, distinguishing
later expiry from the observed pre-cutoff cohort. This does not establish a
globally empty database.

Nine additional inventory probes remain separate from the 26-family total.
Expired profile-session links reached the 1,001-row cap; that is a lower bound,
with no more-than-24-hour expiry in the earliest-expiry ordered sample. Older
matching rows cannot be hidden behind that earliest sample. There were 72
expired suppressions. The other extra probes were zero, including pending
erasures that satisfied the stored-expiry eligibility predicate. Pending erasure
alone is not sufficient deletion authority.

PGDATA had 7,448,707,072 bytes available out of 48,891,670,528. WAL occupied
234,881,024 bytes. The retired stage table had zero rows and 24,576 bytes of
allocation. No lock waiters or long transactions were observed. These are dated
capacity measurements; logical deletions do not establish physical filesystem
reclamation or a calibrated exhaustion forecast.

## Release identity and original evidence

The original collection was recovered from the existing Codex tool event,
including its exact stdout, successful exit, empty stderr, invocation metadata
and effective SQL assembled from the five reviewed assets. It was not rerun.
The 12-file manifest is
`bbd4f9433b4bae888806b40e668de5046464fb014a9e32d01215f562bfa7f996`;
the original stdout hash is
`65fed86bda8296d5cec5201d7abe25fd276775149f4716e4bb243a6bcac402f0`.
Both 10,001-row ledger limits were not reached. Their time window starts at
10:30 UTC and ends at the original observation, with no manufactured per-attempt
pairing.

A separate 17:19 UTC status/HTTP/worker collection found both actual Admin roles
on `9f39bd8686ff4303ccd59f85c74a9f53c2995c35`, with successful deployments created
at 12:28:26 UTC, after the cycle. Both were healthy, compact and correctly assigned
runner roles. All 13 tracked retention source/dependency hashes still matched
the earlier `b78fa7a6` release. The worker used 6,211,256,320 bytes of its 16 GB
limit and HTTP used 2,683,867,136 bytes of 24 GB, with no observed OOM kills.
The old exact-revision validator correctly rejected the newer revision; that
rejection was retained rather than relabelled as a passing exact-b78 check.

The current processes started around 12:36. A single capped, metadata-only
deployment-history request returned HTTP 403 and no rows; it was not retried.
Thus the exact serving process/revision during 10:31–11:22 remains unknown.
Pre-cycle b78 verification and unchanged tracked source across the known main
lineage corroborate the release context but do not establish uninterrupted
production process identity. Complete provider history is not an accepted
ordinary-cycle gate; independent review accepted the observed scheduled outcome
without claiming an exact cycle revision. Neither later collection replaces
the failed original manual w07 postchecks.

The seven-file current-release manifest is
`f5c7726614b592e936a5890f215083be2a4c0f3f9a551b66e8f2f31a1013c581`;
the history-response manifest is
`11626b23944947b34dea2802fa829bdb187877f11ceb0d4387e53dbfa392c0c0`.
Independent cycle acceptance is sealed as
`73920a5ba1970e26cf4f07f42a503e9ea24fe0830990e479784539e02ccc646d`.

## Approaching Watch expiry wave

A separately authorized read-only collection at 17:27 UTC measured the
stored-expiry horizon without repeating the original cycle ledgers:

| Watch expiry bucket                            | Rows    |
| ---------------------------------------------- | ------- |
| Already expired at observation                 | 92,617  |
| Further expiry by October 28 10:30 UTC         | 285,843 |
| Expiry from October 28 to October 29 10:30 UTC | 498,507 |
| Total through the measured horizon             | 876,967 |

The index-ordered horizon did not reach its 1,000,001-row cap. Earliest stored
expiry was October 27 11:22:39 UTC, after the accepted cycle's success cutoff.
The query retained five-second statement and one-second lock limits and was not
retried. These are stored-expiry cohorts, not an inferred old/new policy boundary
based on event timestamps.

Watch relation allocation was 8,483,897,344 bytes: table 3,163,807,744 bytes
(including heap 3,162,914,816 and 892,928 bytes of table overhead), plus indexes
5,320,089,600. It had increased 183,345,152 bytes from the separate October 26
23:16 snapshot, while PGDATA free space was 546,918,400 bytes lower. At 17:27,
PGDATA had 7,478,304,768 bytes free, about 15.3% of its 48,891,670,528 bytes;
WAL was 201,326,592 bytes, with no lock waiters or long transactions.

Table statistics estimated 564,184 live and 138,571 dead tuples, with cumulative
666,869 inserts and 102,579 deletes. The autovacuum count was zero and its last
timestamp was null. These estimates and cumulative counters do not establish
exact relation cardinality, disabled vacuum, reusable space, bloat or physical
reclamation. The dated allocation/free-space differences are not a causal growth
or exhaustion forecast.

The collection exited successfully with all expected aggregate frames. CLI
stderr was nonempty; only its hash was retained, so its cause is unavailable.
An initial generic `provider_or_sql_error` classification was corrected locally
to `nonempty_unclassified_cli_stderr`, with an explicit missing-stderr-text flag.
The saved initial frame values agree with the final values, but the original
pre-reseal receipt/manifest bytes and per-file hashes are unavailable. Exact
SQL/stdout byte identity across that local reseal is therefore not independently
recoverable. The current four-file manifest remains immutable at
`77138b64b03196f2c1ccbdedbe83a73c39ac5685f30e382db55d614ea15279e1`.
The separate provenance addendum manifest is
`6dc281d99c2b4edd360298e9b2ee83aca8048a73994c303810b6445bfa3ef9ba`.
Neither the corrected classification nor complete frames establish zero stderr
or a known benign warning. Independent Watch capacity review is
`8a6e6cac335a828407b0394bd61628474de93bf0df995c17741661abce38d59f`.

## Acceptance and remaining work

The [October 23 accepted cycle](https://github.com/JesusFilm/forge/pull/2541#issuecomment-6363320357)
remains valid. October 24–26 failures do not add cycle credit. The October 27
manual campaigns and their failed original observation windows remain separate
from this ordinary scheduled cycle.

The first-wave deletion of 74,558 Watch rows does not establish drainage of the
larger measured horizon within available capacity. Feat-756 therefore retains
its heavier-wave throughput/capacity gate. Feat-554's own continued operational
margin also remains open; that obligation has not been moved to feat-756.
The obsolete nominal 75 GB proposal and literal legacy-overlap duration do not
become new acceptance gates.

Use the existing next ordinary observation to reconcile committed Watch
deletions, remaining oldest/overdue expiry, both ledgers, relation allocation or
reuse evidence, and direct PGDATA/WAL headroom under the measured larger wave.
If margin becomes inadequate, coordinate evidence-backed capacity protection.
No additional fixed count of daily cycles, manual purge or synthetic load is
required. Delivery reliability, accepted content coverage limitations and
unmeasured recommendation usefulness remain separate.

The daily production scheduler and existing read-only observer remain enabled.
The expired temporary CI-outage monitor remains paused. No old manual window
authorization is revived by this report.
