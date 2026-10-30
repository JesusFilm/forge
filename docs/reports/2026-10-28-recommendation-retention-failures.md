# October 28 ordinary retention failures

The ordinary cycle continued deleting stored-expired rows but recorded six
genuine failures. This is not a failure-free cycle. The accepted October 23 and
October 27 cycles still satisfy the two-cycle requirement; feat-554 remains in
progress for continued operational margin, and feat-756 remains open for the
larger Watch expiry wave. No additional fixed number of clean days is imposed.

## Bounded observation

The October 28 15:15 UTC read-only snapshot covered the 10:30–15:15 UTC window.
All 16 original frames were present and their manifest hashes verified.
The collection command exited zero with nonempty, unclassified stderr retained
by hash. Complete frames do not explain that stderr or establish a SQL/provider
error; the failure counts below come from the returned ledger data.

| Observation                                 | Result                                              |
| ------------------------------------------- | --------------------------------------------------- |
| Durable retention ledger                    | 542 SUCCEEDED, 107 SKIPPED / budget_yield, 6 FAILED |
| Scheduled wrappers                          | 649 SUCCEEDED, 6 FAILED                             |
| Committed request roots                     | 8,411                                               |
| Committed Watch exposures                   | 457,098                                             |
| Failed attempts' committed prefix           | 131 roots and 4,317 Watch exposures; still FAILED   |
| Latest successful cutoff                    | October 28 13:49:18.176 UTC                         |
| Current expired rows across 26 health types | 39,264, including 34,863 Watch exposures            |
| Expired more than 24 hours                  | Zero in those 26 health types                       |
| Database size                               | 41,612,940,991 bytes                                |
| PGDATA free / total                         | 6,961,348,608 / 48,891,670,528 bytes                |
| WAL                                         | 218,103,808 bytes                                   |
| Watch relation / indexes                    | 8,728,821,760 / 5,472,903,168 bytes                 |

Ledger counts agree in aggregate across 655 attempts; they do not provide
per-attempt linkage. Do not add different row families into a unique-row total.
The oldest Watch expiry was 13:49:23.084 UTC, after the successful cutoff.
Additional inventories remain separate: profile-session links were capped at
at least 1,001 with oldest expiry 13:49:20.420 UTC; suppressions numbered 79.
The scheduler had no recorded error and its next wake was October 29 10:30 UTC.
Historical 23 durable and three wrapper RUNNING rows are unchanged observations,
not evidence of 26 active invocations or authority for manual cleanup.

No blocking locks or long transactions were observed at the snapshot. That
does not describe the failure instants. Dead/live row estimates and zero recorded
autovacuum runs do not establish bloat or disabled vacuum. Deletions do not prove
filesystem reclamation or future capacity. Role health and process memory were
not collected after this failure; older role observations remain dated.

## Filtered failure evidence

One bounded provider-log request against the previously known worker deployment
returned six strictly validated envelopes, with no truncation or parser rejection.
All reported Prisma P2028 and successful fallback-ledger persistence. No SQL,
parameters, business identifiers or raw provider error text were retained.
Deployment continuity was not reverified; envelope counts agree with the ledger
only in aggregate.

| Failed phase               | Boundary               | Budget before acquisition | Observed boundary duration                |
| -------------------------- | ---------------------- | ------------------------- | ----------------------------------------- |
| profile_fence_and_erase    | operation              | 1,027 ms                  | 1,629 ms incomplete operation             |
| oldest_expired_scan        | counter_update         | 1,692 ms                  | 1,347 ms incomplete counter update        |
| expiredPromotionApprovals  | advisory_lock          | 755 ms                    | 1,140 ms incomplete lock query            |
| terminal_success           | configure_timeout      | 744 ms                    | 735 ms incomplete configuration           |
| select_experiments         | advisory_lock          | 1,444 ms                  | **1,624 ms acquisition before the query** |
| projection_run_unlink_page | commit_acknowledgement | 1,248 ms                  | 1,584 ms incomplete acknowledgement       |

These are different boundaries, not proof of one slow SQL statement. Available
decision-helper CPU/heap observations belong to an earlier completed helper,
not the failed boundary; they do not establish GC or CPU contention as a cause.

## Narrow correction and remaining work

The [acquisition admission plan](../plans/2026-10-28-retention-acquisition-admission.md)
adds the missing nonterminal budget check immediately after transaction
acquisition, before the first query. Existing 750 ms / observed-root-cost
admission, five-second cleanup budget and terminal behavior remain unchanged.
Safe yields retain durable counts, unknown backlog and bounded continuation
without advancing the success watermark. Real acquisition, query, counter and
commit failures remain failures. A yield-only sequence is not completion.

This guard addresses the demonstrated acquisition gap. It does not explain the
delay itself or resolve the other five failures. Release verification and later
ordinary evidence must be recorded separately; local tests are not production
resolution or cycle credit. The existing daily observer stays active and the
expired temporary outage monitor stays paused. No manual cleanup was started.

Frozen manual/operator parser bundles that predate the new
`post_acquisition_admission` stage must be refreshed and independently reviewed
before any future authorized manual diagnostic dispatch. The current source
parser accepts the new stage; no manual dispatch is authorized by this repair.

Evidence manifests, verified against the retained originals:

- Ordinary observation: `8a82a6ca76a5ec53e67a2f1b0fe6c66926707eda167f13fbfe84d28bdb4e09ba`.
- Sanitized phase diagnosis: `0ef418980fa555e492efae1202b97bc16a61ed97ca522755a84602e8c0416b9b`.
