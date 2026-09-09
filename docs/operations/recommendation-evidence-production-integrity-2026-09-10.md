# Recommendation production integrity audit — 2026-09-10 NZ

All timestamps below are UTC on 2026-09-09. Production database access is now
available and the current-pointer audit passed after scheduled reconciliation.
Overall release acceptance remains open; this record does not enable feat-447.

## Target and method

The owner supplied a Railway project token for direct PostgreSQL verification.
Railway's `projectToken` query confirmed project
`98952497-a4d9-4714-8fe8-0cdbff3147c9`, production environment
`5f41e037-90e4-4674-a3ea-66bbd05fb3b4`. Admin's configured database matched
service `2a2edd87-6748-4029-a94a-b8e1a0227ba4`; the public connection belonged to
that same service. Credential values were excluded from reports and commits.

Each audit used a repeatable-read, read-only PostgreSQL transaction, with a
60-second statement timeout and a three-second lock timeout. The connection
also set `default_transaction_read_only=on`. No production data, permissions,
deployment, monitor, or ranking configuration was changed by this audit.

The pointer check invoked the existing
`loadRecommendationProfileReconciliationOverview` from
`apps/admin/src/services/recommendations/admin-ops/profile-reconciliation.service.ts`
against production, using its shared serving/reconciliation eligibility SQL.
This is authorized database evidence from the Admin query, not an authenticated
browser screenshot. No Admin session was fabricated.

## Current pointers and convergence

At 20:59:51 and 21:00:28, the Admin query reported `currentPointerInvariant:
violated`. Small-cohort details were suppressed by the Admin contract. The
affected lineage included a superseded eligibility decision and invalid source
lineage. These failed snapshots are retained; the result was not initially clean.

The scheduled 21:01:17 batch queued the affected replacements with zero
classification failures, dispatch failures, exhausted attempts, or stale runs.
At 21:02:43, the same production query reported:

| Invariant or observation           | Result |
| ---------------------------------- | -----: |
| Current-pointer invariant          |  clean |
| Ineligible current generations     |      0 |
| Affected current pointers          |      0 |
| Invalid current contributions      |      0 |
| Rebuild candidates / backlog       |  0 / 0 |
| Stale claims                       |      0 |
| Replacement publications, 24 hours |    146 |
| Pointer rows in the database       | 72,782 |
| Published, unexpired generations   | 77,898 |
| Unexpired contributions            | 26,694 |

The last three rows establish a populated production database, not an empty
fixture. A further invalid-contribution query at 21:03:18 returned no rows.
This proves convergence at these snapshots; it does not claim pointers can never
become stale between future eligibility changes and the next scheduler batch.
The shared read-time eligibility fence must remain enabled.

A repeat of the full Admin query at 21:12:25 remained clean, with zero affected
pointers, invalid contributions, rebuild candidates, backlog, and stale claims.
That later snapshot contained 72,838 pointer rows and 26,718 unexpired
contributions. Its rolling 24-hour publication and terminal-run totals differ
as older activity leaves the window; do not compare them as cumulative counters.

The completed replacement runs in 21:00–21:03 retain their original published
generations, point to published replacements that are now current, and show
exactly one pointer-generation advance. This verifies the stored replacement
chain without publishing profile or session identifiers.

The Admin overview still labels its 24-hour state `degraded` because its
`terminalRuns` count includes 32 fenced runs. Inspection found
`eligibility_input_fenced` and `pointer_generation_fenced` outcomes, not failed
projection runs in the inspected unexpired population. Do not hide that displayed
state or confuse successful concurrency fencing with an exhausted batch.

## Durable reconciliation batches

For the fixed 18:30–20:30 observation, PostgreSQL's workflow runtime contains
23 completed reconciliation steps and 23 completed heartbeat steps. The stored
CBOR/devalue results were decoded locally and checked as aggregate counters:

| Counter                 | Total |
| ----------------------- | ----: |
| Classification attempts |    64 |
| Affected pointers       |    16 |
| Rebuilds queued         |    16 |
| Classification failures |     0 |
| Dispatch failures       |     0 |
| Exhausted attempts      |     0 |

Batch completion timestamps span 18:34:23.025–20:25:48.853; corresponding
heartbeat completions span 18:34:23.523–20:25:49.398. This independently verifies
the previously observed 23 primary Admin/worker heartbeats and their substantive
batch results. Parse Prisma `timestamp without time zone` values as UTC when
using a standalone PostgreSQL client; local NZ parsing otherwise shifts ledger
timestamps by 12 hours without changing the stored data.

## Stored facts, replays, and finalization

The episode cohort is creation time 07:01–20:30. The first snapshot contained
3,423 episodes and 31,402 facts. Every episode's fact count matched
`next_fact_sequence - 1`; event IDs and sequences were unique and contiguous.
All 806 replay receipts belonging to those episodes matched their episode's
transport replay count and contiguous replay ordinals.

Separately, all 841 replay receipts observed during 07:01–20:30 joined to an
original fact with the same event, capability, and stored payload digest. There
were zero missing originals or binding/digest mismatches. Receipt observation
time and episode creation time define different populations and must not be
forced to have equal totals.

A later snapshot contained 31,403 facts as the live cohort continued receiving
evidence. Reconstructing events from stored JSON exactly reproduced 25,581
digests. The other 5,822 all reproduced the original digest when fractional
numeric payload fields were varied by at most four adjacent IEEE-754 values;
event identity, kind, timestamp, and other payload fields were unchanged. No
unexplained mismatch remained in this bounded diagnostic. This establishes a
numeric-representation difference, not a byte-for-byte JSON round-trip guarantee.
Do not rewrite original digests or weaken exact incoming-payload replay checks.

The finalization snapshot contained 1,266 finalized and 1,404 timed-out episodes;
all had finalization timestamps and an `active-watch-proxy-v1` outcome. The
remaining 243 pending and 510 claimed episodes had zero finalization work items
overdue by more than ten minutes. These are database observations, not a new
browser lifecycle or live-personalization proof.

Historical crawler attribution remains unknown without retained trusted linkage.
No episodes were relabeled by timestamp, and no eligibility was manually promoted.

## Operational observation and remaining release requirements

Primary Web still serves `76ae13f1a92e12527cb095a673409edc43e22c0e` on
`53a63aa9d644`. The settled 18:30–20:30 playback metric reports 5,523 HTTP 200,
three 401, 1,013 403, two 409, and two 503: **2 / 6,543 = 0.03057% 5xx**.
Both Railway environments still share its environment/revision dimensions; a
complete primary-only request denominator remains unverified.

Primary logs contain 4,434 Web and 4,435 Admin accepted fact batches, plus 79
replay batches on each side. Trace `8637482585547799394` accounts for an Admin
acceptance at 19:07:13 after Web timed out at 19:07:12. This confirms an ambiguous
acknowledgement; retaining identical retries is necessary. There were two terminal
binding observations on each side, zero retryable-binding signals, 2,510
recognized-crawler terminal rejections, zero crawler-success signals, and zero
logged receipt-collision candidates or exhausted transaction signals.

The fresh monitor search returned only unrelated Forge TV monitor `303307205`.
The six recommendation alert definitions remain unverified as installed. The
Railway token supplies database access, not Datadog monitor-management access;
the owner's existing Datadog read-only restriction remains in effect.

The fresh current-pointer and durable batch-result gates are now evidenced.
Keep feat-464 and feat-459 in progress until the remaining transport acceptance
requirements, including scoped request accounting and installed alerts, pass.
Feat-447 also retains its separate browser lifecycle and production-vector
latency requirements. No profile ranking, experiment, promotion, or learning
activation occurred.
