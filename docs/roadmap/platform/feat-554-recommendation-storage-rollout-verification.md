---
id: "feat-554"
title: "Roll out compact recommendation traces and verify production headroom"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-09-28"
duration: 2
depends_on:
  - "feat-558"
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "database"
  - "capacity"
  - "operations"
---

## October 27 projection-run selector repair

The [projection-run selector repair](../../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-projection-run-selector-repair)
merged normally as `e2a06589` (PR #2932) after independent exact-head review,
91 focused tests, 44 PostgreSQL tests, full Admin typechecking and green PR checks.
Existing expiry/reference indexes and captured-reference/current-expiry guards
replace the broad run scan while preserving the page bound, five-second deadline,
root admission guard and real failure accounting.

Local sparse and high-fan-out SELECT fixtures improve; 100,000 empty parents
regress from 153.544 to 303.414 ms and probes remain linear. This is not production
CPU or full-invocation efficiency proof, or proof that P2028 cannot recur.
All main workflows passed and both actual Admin roles were verified on the exact
merge, with matching source hashes, compact mode, expected runner roles and
healthy responses. The 16 GB worker had no OOM or limit events. The dated snapshot
still found 87,166 expired rows across 26 health families, fixed cohort 35,203
and additional expiry categories outside that total. No clearance follows.
The release-bound operator amendment and new historical-execution proof passed
independent review before one new parent-coordinated bounded window was authorized.
The earlier continuation remains revoked, with 1,550
known manual roots, four failed partial attempts and historical 301 separate at
the last reconciliation. Keep this ticket in progress: October 23 supplies one
accepted ordinary loaded failure-free cycle, one further cycle is required, and
manual work earns no credit.

The [first cleanup window on this release](../../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-decision-unlink-recurrence-after-projection-run-repair)
committed 200 additional request roots, then stopped on a decision-unlink P2028.
The known manual total is 1,750, including five failed partial attempts. Pass one
had positive run-link and decision-link progress; the later failed operation
does not identify SELECT versus guarded UPDATE. Original postchecks passed and
300 memory samples peaked at 6,038,208,512 bytes of 16 GB without OOM or throttling.
The fixed cohort fell to 34,340 and current 26-family expiry to 85,529, with extra
inventories separate. No retry or further window is authorized. Bounded read-only
and local diagnosis continues; the daily scheduler and observer remain enabled.
Keep the ticket in progress with no manual daily-cycle credit.

## October 27 capacity increase and resumed cleanup

The user removed the operator-imposed 4 GB and no-rising-memory admission rules
and authorized additional worker headroom. The existing production worker's
memory limit was increased from 8 to 16 GB, with CPU unchanged at 8. Actual
container enforcement and the API agree; the same process and deployment
continued without restart or redeploy. Direct memory/OOM tracking replaces any
Datadog prerequisite; no arbitrary replacement reserve applies.

The first pass on the reviewed `ce23241a9` runtime committed 50 expired request
roots, then yielded. All durable counters matched the CLI, and the manual wrapper
succeeded without an error in 4,510 ms. Post-pass services were healthy, with
zero OOM events, no lock waiters or long transactions and 8,030,261,248 free
PGDATA bytes. The measured fixed cohort fell from 39,390 to 39,299; the later
rolling expired inventory was 41,761 across 26 families. These inventories do
not cover every cleanup category and do not prove complete drainage.

The [current receipt and continuation policy](../../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-worker-capacity-and-resumed-deletion)
supersede the old memory and stop-on-any-yield operator rules. Bounded distinct
passes may continue after positive committed progress and matching ledgers;
actual errors or uncertain results stop the window. The daily scheduler remains
enabled. Keep this ticket in progress: October 23 supplies the only accepted
ordinary loaded failure-free cycle, and manual passes add zero credit.

The next window stopped after one failed pass at 00:21 UTC. Both ledgers
record 100 further committed roots and a transaction-expiry failure (854 ms
allowed, 870 ms elapsed); the exact failing statement is not retained. The
fixed cohort then measured 38,861 and rolling current expiry 41,548. Services
remained healthy on 16 GB capacity without OOM events. No second pass or replay
followed in that window. A later distinct pass committed another 100 roots and
yielded safely, bringing post-resize committed roots to 250. The fixed cohort
then measured 38,431 and rolling current expiry 42,068; no global clearance or
ordinary-cycle credit follows.

The [post-configuration admission repair](../../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-post-configuration-admission-repair)
merged normally as `742f25c2` (PR #2923) after independent exact-head review,
57 focused and ten native tests, full Admin typecheck and green PR checks. It
rechecks the existing 750 ms floor after successful configuration and before
nonterminal work, retaining the five-second budget and genuine failures. The
exact-base native regression fails and final code passes with no domain read
after a local configuration delay. The earlier production failure's cause is
still unproved; the speculative query/index change was excluded. Both actual
roles now run the merged revision with matching source hashes and health;
worker capacity remains 16 GB. All main CI, image and CodeQL checks passed,
including the actual native retention and production-startup steps.

The next bounded window committed another 250 roots across three passes:
50 and 100 in acknowledged yields, then 100 before an actual third-pass
failure. Post-resize committed roots therefore total 500 across six attempts;
both failed partial attempts remain failures. The fixed cohort fell from
38,431 to 37,442, and current expiry from 44,345 to 43,474 across 26 families.
Separate bounded inventory also found at least 1,001 expired profile-session
links and one pending profile erasure; these are outside that 26-family total.
There is no global-clearance claim or additional ordinary-cycle credit.

The safe failure receipt identifies `projection_decision_unlink_page`:
796 ms remained at admission and the operation consumed 808 ms; acquisition,
advisory lock and configuration each took 3 ms. The wrapper identifies
`recommendationPersonalizationDecision.findMany` and an expired transaction
(802 ms allowed, 812 ms elapsed). This localizes the current failure to an
admitted operation, not configuration exhaustion; the underlying SQL/client
cost and historical failure cause remain unproved. No fourth pass or replay
followed. Astra owns the targeted efficiency repair before another coordinated
manual window. Both services stayed healthy; 300 one-second samples found no
OOM, memory-limit events or CPU-quota throttling on the 16 GB worker.

The user's efficiency objective is separate from this correctness and capacity
evidence: demonstrate less CPU/database work per committed expired row under a
comparable workload, with useful progress and live-request-latency effects.
Worker limits, sleeps, lower concurrency or longer timeouts alone do not prove
efficiency. Keep shared-process measurements and the distinct profile
reconciliation maintenance path clearly identified; no CPU-spike attribution
is established.

The [selection repair](../../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-projection-decision-selection-repair)
merged normally as `50cb6a3e` (PR #2926) after independent exact-head review,
80 focused tests, 37 PostgreSQL tests, full Admin typecheck and all applicable
PR checks. It uses existing expiry/reference indexes and guards the captured
reference and current expiry before unlinking. The local sparse-match fixture
reduced decision heap rows examined from 182,895 to seven, but empty-parent
probes remain linear; this is not a global work bound or production CPU claim.
The initial broader test timeout is retained alongside its unchanged isolated
passing rerun. All three main workflows passed, and both actual Admin roles
were verified on the exact merged revision at 03:18–03:19 UTC, with healthy
responses, compact mode and correct runner roles. The worker retains 16 GB
with no recorded OOM or limit events. Cleanup had not resumed at that snapshot;
subsequent windows and the stop are recorded below. The then-current 26-family
inventory was 65,913, including 17,593 expired Watch
exposures; the fixed cohort remains 37,442. Extra expired session links remain
at least 1,001, while the one pending erasure is not stored-expired eligible.
Keep this ticket in progress with the same ordinary-cycle requirement and
remaining inventory.

## October 27 resumed cleanup failure

The [resumed cleanup and root-delete failure](../../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-resumed-cleanup-and-root-delete-failure)
records 350 new request roots and 5,000 expired Watch rows across two windows
on the selection repair. The second window's third pass failed after 50
committed roots; its 150-root total preserves that partial commit. Later
windows were cancelled without replay. Today's known manual root total is
850, including three failed partial attempts. All manual work still earns
zero daily-cycle credit, and the historical 301 roots remain separate.

The root-delete operation failed with an unknown Prisma request error at
855 ms after admission with 853 ms; exact SQL/client/CPU cause remains
unproved. Astra is investigating this distinct early phase. Neither window
establishes that the rewritten projection selector ran. Keep the original
missing post-health/filesystem check separate from the later healthy
read-only follow-up. No memory gate was reinstated. Further manual cleanup
requires a reviewed correction and a new coordinated window; the ordinary
daily scheduler remains enabled and this ticket remains in progress.

## October 27 root-chunk cost admission repair

The [root-chunk cost admission release](../../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-root-chunk-cost-admission-repair)
merged as `e25a0a7d` (PR #2930), with independent exact-head review, 94 focused
tests, 38 native PostgreSQL tests, full Admin typecheck and all applicable PR
checks. The next root chunk must have more time than the preceding acknowledged
chunk consumed, with the existing 750 ms baseline and five-second deadline
unchanged. The modeled regression proves avoided underfunded dispatch; a later
more expensive chunk can still fail. Production query/CPU improvement and the
historical production SQLSTATE remain unproved.

All main workflows passed, and both actual roles were verified on the merged
revision at 05:10–05:11 UTC with compact mode, correct runners and healthy
responses. The moving 26-family expired count was 81,944 and the fixed cohort
36,997; additional expiry categories remain separate. The source-bound
operator amendment and fresh historical execution proof passed independent
review. The first new bounded window, `r2930-w01`, completed three normal yields
with matching ledgers and postchecks: 300 roots, 3,000 Watch exposures and
100 expired projection runs plus 100 contributions in the third pass. The
manual root total reached 1,150 at this window's close, retaining three earlier failed partial attempts;
historical 301 remain separate. The moving 26-family count ended at 79,905,
the fixed cohort at 36,431 and the watermark unchanged. This demonstrates
progress, including some later-phase work, but neither selector/guard-specific
causality nor production CPU improvement or backlog completion.
Keep this ticket in progress, preserve October 23's one accepted ordinary
loaded failure-free cycle and require one further qualifying cycle. Manual
work adds no credit and neither the 26-family health inventory nor root
progress alone establishes clearance of every stored-expired category.

## October 27 later projection unlink failure

The [stopped continuation receipt](../../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-later-projection-unlink-failure-and-stopped-continuation)
records 400 additional roots and 5,000 Watch exposures across windows 02–03.
The last attempt failed after 100 committed roots; the series preserves that
partial work, its failure and a known manual total of 1,550 at reconciliation.
Four failed partial attempts remain failed, historical 301 are separate, and
windows 04–07 were revoked without attempts. Original postchecks passed; the
moving 26-family inventory ended at 76,825 and the fixed cohort at 35,203.

The later `projection_run_unlink_page` operation reported `P2028` with no
SQLSTATE, outside the root-only guard. Exact failed SELECT-versus-UPDATE and
timer attribution remain unknown. Read-only plans support a targeted
expiry/reference-index selection investigation; sequential timings do not
prove production CPU improvement. Astra owns the scoped query repair and
local/native validation. Keep manual cleanup stopped pending reviewed normal
release and fresh verification, retain the daily scheduler and observer, and
preserve October 23 plus one further required ordinary loaded failure-free
cycle. This ticket remains in progress.

## October 27 pre-work deadline correction

An isolated PostgreSQL regression reproduced an additional boundary bug: after
an acknowledged root commit exhausts the cleanup budget, the next nonterminal
admission throws before its safe-yield guard. The correction includes zero and
negative budgets in that guard and finalizes only the ledger in a separate
bounded transaction. It preserves committed counters and terminal states after
uncertain acknowledgements; genuine operation and transaction failures remain
failures. The full nine-test native standalone suite and 94 focused unit,
scheduler, job and diagnostic tests pass locally. This is not proof of the SQL
behind October 25–26 P2028 errors or of a production repair.

Independent exact-head review and all applicable PR checks passed before normal
merge `ce23241a9` on October 26 at 22:54:20 UTC. Main CI, production image and all
four CodeQL analyses passed. The [release receipt](https://github.com/JesusFilm/forge/pull/2920#issuecomment-6429275387)
records actual HTTP at 23:15:00.760 UTC and worker at 23:08:28.256 UTC, both on
that exact revision with matching retention source hashes, health 200/ok,
compact mode and the correct runner roles. These separate observations verify
deployment; the finite observed ledger window contains zero attempts and does
not establish post-release cleanup behavior.

At 23:15:49 UTC, all 26 current health families contained 39,404 expired rows
and zero over 24 hours overdue. The fixed 23:15:00.760 cohort had 39,390 rows at
its separate read; the successful expiry cutoff remained 21:45:44.183 and
includes manual success. Other cleanup categories, including owner releases and
old retention-run ledgers, were not remeasured. The
normal scheduler remained RUNNING without error, next wake October 27 at
10:30 UTC. Historical unfinished ledgers were preserved. Separate 23:16 reads
found PGDATA free 8,025,223,168 bytes and WAL 167,772,160, with no lock waiters or
long transactions; no physical reclamation or whole-backlog completion follows.

The user-requested GPT-6 Astra task owns the active repair and backlog follow-up;
the previous storage task retains the existing daily read-only monitor. Manual
drain was held at the 23:08 worker memory reading of 4,573,614,080 bytes,
above the former 4 GB gate; no second sample or pass followed in that window.
The later user decision and capacity/deletion receipt above supersede that hold.
Keep this ticket in
progress and retain October 23's one accepted cycle; manual work supplies no
ordinary-cycle credit. The [active closeout plan](../../plans/2026-10-02-002-recommendation-roadmap-final-closeout-plan.md#october-27-retention-repair-and-astra-handoff)
records the superseding backlog authorization and current operating policy.

## October 26 follow-up: continuing deletion with failures

The independently reviewed [October 26 ledger receipt](https://github.com/JesusFilm/forge/pull/2541#issuecomment-6425467086)
adds **no qualifying cycle**. At 19:27:51 UTC, the separate ledgers recorded:

| Ordinary cycle (UTC)       | Durable ledger                                             | Scheduled wrapper ledger | Elapsed first start to last finish | Mean completed wrapper duration, including failures |
| -------------------------- | ---------------------------------------------------------- | ------------------------ | ---------------------------------- | --------------------------------------------------- |
| October 25                 | 270 succeeded, 381 budget yields, 37 failed                | 651 succeeded, 37 failed | 6h40m33s                           | 4.380s                                              |
| October 26, as of snapshot | 191 succeeded, 52 budget yields, 8 failed, 1 stale RUNNING | 243 succeeded, 9 failed  | 1h46m52s                           | 4.005s                                              |

Each ledger returned 940 rows below its 20,001 cap. The October 25 window spans
10:30 UTC to the next 10:30; the October 26 query ends at 21:00, later than the
snapshot, so it is only as-of evidence. All wrappers were scheduled. Successful
wrappers include safe durable yields; there is no shared key for pairing the
two ledgers. Both cycles committed loaded deletion, including descendants, but
their failures permanently exclude them from failure-free acceptance. The last
success expiry cutoffs were October 25 17:11:15.884 and October 26 12:17:30.484;
cutoffs are not execution completion timestamps or current-backlog proof.

[PR #2900](https://github.com/JesusFilm/forge/pull/2900#issuecomment-6385131395)
deployed phase diagnostics after the October 24 incident. It is not a timeout
fix. Static review found the leading-JSON log shape conflicts with the repository
Railway logging convention; historical request-handler transport evidence does
not prove loss from the scheduled worker. The bounded logging-envelope/consumer
correction merged as [PR #2915](https://github.com/JesusFilm/forge/pull/2915),
`f27980447bef1bc24c815553698501afb9f6bc2e`, after independent exact-head review
and 28 terminal PR checks: 20 success and eight expected scope skips. The
reviewer independently passed 44 unit/CLI tests, including malformed input and
bounded stream parsing; applicable native PostgreSQL retention steps passed in
CI. Budgets, expiry, error/yield classification and committed counters are
unchanged. The [independently reviewed actual release receipt](https://github.com/JesusFilm/forge/pull/2915#issuecomment-6427366581)
verified both Admin roles on descendant `63a1ccc40` at 20:59:48.987-20:59:53.009
UTC, healthy/compact with correct runner roles and unchanged retention source.
Replacement main CI, production image and all four CodeQL analyses passed;
earlier main jobs cancelled by the later Co-watch push are not counted as green.
This is not a timeout fix or another qualifying cycle.

At 21:00:15, each independent ledger contained zero new attempts from 20:59:53,
below its 10,001 cap. Its future 02:00 query bound does not extend the observation.
A separate worker log window through 21:01:56 returned zero events; no loaded
throughput or production failure-log execution/transport is proved. Scheduler
ledger/runtime were RUNNING without error, next ordinary wake October 27 10:30
UTC. The pre-release success cutoff remains 12:17:30.484.

The 21:00-21:01 snapshots found **32,024 currently expired rows** across 26
families, zero over 24 hours overdue, with both fixed daily-start cohorts clear.
Eight additional fixed-expiry probes were zero; a separate pending-erasure
probe found one request from 20:10:34.6 without an expiry guard, not an overdue
eligibility result. Guarded baseline/experiment parents were eligible/held zero;
generation-proof eligibility remains unmeasured. PGDATA free was 8,080,678,912
bytes, WAL 184,549,376, with no lock waiters or long transactions. The first old
Watch exposure expiry remains October 27 01:54:46.228 UTC; its capped recent
sample does not prove the full distribution or the upcoming wave's throughput.
No physical-reclamation or exhaustion forecast follows from these snapshots.
The retained SQL definitions match the aggregate output, but prepared/not-executed
headers mean the saved bundle alone does not prove exact invocation provenance.

The worker separately returned 503 at 19:19:58 UTC, then 200/ok on two follow-ups
on the same deployed revision/ID `605ff68e38`. Its initial response body was not
captured. Child process/container continuity and the cause remain unverified;
neither Redis nor retention is established as the cause.

A separate independently reviewed read-only bundle at 19:31-19:33 UTC found both
roles healthy, compact and correctly assigned. The 26-family backlog was
**26,194 currently expired rows**, zero over 24 hours overdue; oldest expiry
12:17:35.988 followed the latest success cutoff. Fixed October 25/26 10:30 cohorts
were zero across those 26 families. Nine extra fixed categories and checked
precomputed parent guards were also zero without hitting their caps. Exact
fixed-cohort predicate SQL was not in the audited bundle, and precomputed-generation
proof eligibility was not sampled; this is not clearance of all expired rows.
The service health endpoint is not a live retention-health result. Current
retention-health source scans 26 expiry families; the older 21-type shorthand
must not be carried forward.

At separate snapshots, PGDATA had 7,503,618,048 free bytes of 48,891,670,528;
WAL was 771,751,936 bytes, with stage rows, lock waiters and long transactions
zero. No growth forecast or physical recovery is established. The Watch sample
found no expired exposure and first stored expiry October 27 01:54:46.228 UTC,
but reached its 1,001-row cap; it cannot prove the full expiry distribution or
absence of early deletion globally. Three bounded filtered worker log windows
returned zero phase-event matches; asserted unfiltered controls were not retained
in the audited set. The log-transport limitation remains unresolved.

October 23 remains **one** accepted ordinary loaded cycle; one more failure-free
completed cycle is required. The scheduler snapshot was RUNNING without a
recorded error, next wake October 27 10:30 UTC. Keep the daily monitor active,
the temporary outage monitor paused, and this ticket in progress. No manual
cleanup, stale-ledger replay or timeout widening is authorized by this receipt.

## October 24 failure after one qualifying daily cycle

The ordinary October 23 cycle qualifies as **one** loaded, failure-free cycle.
Independent review accepted all 85 scheduled passes: zero failures or yields,
84 full batches and a final drain. They cleared the fixed October 23 10:24:08 UTC
cohort from 12,129 expired rows across 26 families to zero, with the nine extra
expiry categories and expired precomputed parent guards also clear. The last
success watermark was 10:51:19.463 UTC, and the scheduler returned to its next
daily wake. Mean wrapper duration was 3.61 seconds; elapsed catch-up time was
20 minutes 4 seconds. No manual purge launched. The [reviewed production receipt](https://github.com/JesusFilm/forge/pull/2541#issuecomment-6363320357)
retains both ledgers, descendants, backlog and capacity. The 95 newly expired
tracked/session-link rows in the final snapshot all expired after that watermark;
this was not a claim that production remained globally empty.

The October 24 cycle does **not** qualify. A bounded 12:49-12:50 UTC snapshot
recorded 308 durable successes, 91 safe budget yields, seven failures and one
stale RUNNING entry; the wrapper ledger separately recorded 399 successes and
eight failures. There is no shared per-attempt key between these ledgers, so
their entries must not be paired by proximity. A later bounded failure read
captured a ninth failed scheduled wrapper, started at 12:50:22 UTC. Five wrapper
errors reported expired/closed interactive transactions, two reported the batch
deadline, one reported a generic transaction error and one a terminated
connection. Reported operations do not establish which SQL consumed the budget.
The exact cause remains under investigation; no timeout correction is claimed.

The fixed October 24 10:30 UTC cohort was clear across the 26 monitored families
at the 12:50 snapshot; 1,196 currently expired rows remained across those families,
with zero over 24 hours overdue, plus 31 expired profile-session links. The
scheduler was still running bounded catch-up. Both actual
Admin roles ran healthy, compact `6360b78ca`, a descendant of `85e97f521` with
unchanged retention code. PGDATA had 9,684,131,840 free bytes of 48,891,670,528,
WAL was 201,326,592 bytes, and no lock waiters or long transactions were observed.
These dated observations do not erase the failures or prove physical reclamation.
Sanitized evidence is retained under the storage owner's
`outputs/heartbeats/20261024T-diagnostic/` and the parent incident checkpoint.

Keep this ticket in progress: **one further ordinary loaded, failure-free cycle
is required**. The October 23 credit remains valid. Continue bounded diagnosis
and the existing daily read-only monitor; do not replay orphaned attempts,
widen timeouts or manufacture acceptance with manual cleanup. A safe yield may
precede a genuinely completed cycle; yield-only progress is not completion.

## October 23 daily automation verification

The owner requested automatic daily deletion of rows whose stored expiry has
passed. Main `64bb087209128e8cca6a8bbd79475aafff180a42` already implements this
through the Admin worker's durable recommendation-retention scheduler: a daily
10:30 UTC wake (23:30 NZDT), bounded passes and 60-second continuation when
more expired work is reported. No duplicate scheduler or change to persisted
expiry is needed. The operational details and live verification procedure are
in `docs/operations/semantic-recommendation-tracer.md`.

At October 23 06:36:15 UTC, a bounded read-only join of `workflow_run` to
`workflow.workflow_runs` confirmed both the scheduler ledger and its actual
persisted workflow runtime were `running`, without recorded errors. The next
daily wake was October 23 10:30 UTC. This proves the stored runtime state,
not an actively executing step or a future successful cycle. The storage-owner
receipt is `outputs/heartbeats/20261023T0417-drain-audit/scheduler-runtime-sql.json`.
The expired-row accumulation between daily wakes is compatible with the
schedule; it does not by itself prove the preceding cycle stopped early.
The parent verified 46 existing workflow/job tests covering daily scheduling,
bounded continuation, yields, failures and singleton startup. The tests do not
replace actual runtime and production deletion evidence.

The strict manual cleanup repair in [#2878](https://github.com/JesusFilm/forge/pull/2878)
merged as `85e97f521`. Both actual Admin roles ran that revision with correct
runner roles, compact mode and health 200 at 09:03:53 UTC. At 09:12:17, the
scheduler ledger and deployed durable runtime were again verified RUNNING
without errors, with the next wake at 10:30 UTC. The [release receipt](../../reports/2026-10-23-watch-exposure-fortnight-rollout.md#strict-stored-expiry-release)
preserves exact review, test, deployment, interrupted-window and scope evidence.
The ordinary scheduler is unchanged; this is not a clean daily-cycle receipt.

The separately authorized manual catch-up remains owned by the storage task.
Manual deletion receipts give no credit toward the two ordinary loaded,
failure-free daily cycles. October 22 still contains genuine failed attempts;
its eventual recovery does not qualify it. Keep this ticket in progress until
later ordinary cycles meet the existing throughput, complete-backlog, lock,
watermark and capacity gates.

## October 6 eligibility-source unlink failure

The first ordinary loaded cycle on the phase-admission release is **not
qualifying**. At the 19:41 UTC bounded snapshot, both durable ledgers recorded
980 successes, ten `budget_yield` skips and 86 scheduled failures. Six early
failures reported expired/closed transactions; their budget-consuming SQL
remains unproved. Eighty later failures were PostgreSQL P0001 while deleting
expired request roots. A separate later check found 81 such failures, not an
additional count in the original ledger snapshot. No failure-free daily cycle
has been proved.

The later failures match an exact schema conflict: request deletion cascades to
an eligibility decision, whose FK clears the source ID on a retained published
profile contribution. The contribution CHECK requires its source revision to
clear with the ID, while the shared immutability trigger permits only the
older outcome-source FK cleanup. Preserve the contribution and its remaining
observation fields through its own lifetime. The scoped append-only migration
`0129_recommendation_projection_eligibility_retention_unlink` permits only the
FK-triggered pair-null transition after the decision is gone, retaining the
published-child guard for all other edits. Native PostgreSQL proves the
pre-fix failure/rollback, actual expired-request purge failure and subsequent
successful cleanup with retained evidence. This local proof is not a production
release or a repaired timeout claim.

The sanitized `outputs/heartbeats/20261006T1939-daily` receipt records separate
ledger, backlog and capacity timestamps. At 19:41 all 21
retained types were inside the 24-hour propagation window and PGDATA had
22.43 GB free, but failures continued after the last success. Deploy the
reviewed fix through PR-to-main, verify both actual Admin roles and then two
later ordinary failure-free loaded cycles with descendants, complete backlog,
lock skips and headroom. Keep this ticket in progress until those gates pass.

## October 6 phase-budget repair in progress

The October 5 ordinary scheduled cycle still had four failed attempts amid
3,498 successful attempts on the deployed descendant of the five-episode-page
repair. Successful attempts committed 9,505 request roots and 33,123 served
items; failed attempts separately committed 100 roots and 390 served items.
The later full health read found zero rows beyond the 24-hour propagation
limit, but the cycle is not failure-free. No normal daily cycle yet qualifies.
The reported expired-transaction operations vary, so the exact production
slow statement remains unproved.

An owned PostgreSQL fixture demonstrated a separate avoidable failure: a new
phase was admitted with 287 ms left before a 500 ms deletion and then timed
out. The scoped repair requires minimum remaining time before another phase,
including after a delayed lock acquisition. A safe pre-work yield records exact
committed counters as `SKIPPED` / `budget_yield`, leaves the oldest-expired
state unknown, and asks the existing bounded scheduler to continue. Actual
transaction and terminal failures stay FAILED. Local proof is complete; a
reviewed release remains pending. Neither replaces the required two later
ordinary failure-free loaded cycles with descendants, backlog, lock and
headroom evidence. Repeated yields under sustained load remain possible, so
the oldest-expired age and successful-completion watermark remain live gates.

## October 5 follow-up after the episode-page release

The October 4 ordinary loaded cycle had six failed attempts amid 438
successful attempts; a later read found zero overdue rows. It is not a
qualifying failure-free cycle; the count remains zero. PR #2556 reduced only
the pre-root standalone episode page from ten to five under the existing
five-second whole-run budget. It deployed to both Admin roles on October 4 at
20:38:17 UTC. The October 5 loaded cycle still had four failed attempts, as
recorded above; the page change was not a complete cure.
An owned mixed PostgreSQL fixture measured 4,467 ms versus 2,767 ms on its
first attempt, while total fixture time rose about 6.0%; a separate slow-tail
fixture still failed at the deadline, preserving earlier committed root work
and rolling back the tail transaction. Neither fixture proves the production
failure's exact statement or a complete cure.

The bounded October 4 expiry histogram counted 26,071 surviving standalone
episodes through October 6 10:30 UTC without reaching its 50,001-row cap.
A conservative conditional half-rate prefix calculation found no modeled
24-hour-deadline shortfall for those surviving cohorts. Created-at counts are
not expiry inflow. Continue to measure live deletion throughput,
oldest-age/backlog and headroom. Keep this ticket in progress until two later
ordinary failure-free loaded cycles pass. See the
[normal release receipt](https://github.com/JesusFilm/forge/pull/2556#issuecomment-5984170981).

## October 4 query release: natural catch-up snapshot

[PR #2553](https://github.com/JesusFilm/forge/pull/2553) merged normally as
`e8e7fb3475af975835856a9f9380805f83d2f3b1` after independent exact-head review
and green required CI. Both actual Admin HTTP and worker processes converged
at October 3 22:05:59 UTC, healthy and compact, with HTTP runner disabled and
worker runner enabled. Post-merge CI passed too. The change affects only the
eligibility child-count query; expiry, deletion order and execution limits remain.

Natural attempts at 22:06:07 and 22:07:40 failed after committing work, with four
successful attempts between them. The first failure committed 12,746 expired
profile-session links; that is not proof that their deletion was the failing
statement. A durable-ledger receipt collected around 22:17:02 counted 28
successful and two failed attempts, with 2,800 roots committed by successes
and another 200 by failures. No new failure had occurred since 22:07:40.
A separate 22:17:23 backlog read found overdue request roots and projection
runs clear, but 1,387 standalone episodes and 961 eligibility decisions kept
the full serving gate overdue. At that snapshot, further natural catch-up
was required; do not infer full recovery from root progress or HTTP health.

At **22:47:11 UTC**, the full 21-type retention-health read found zero rows
beyond the 24-hour propagation limit, with latest success watermark
22:47:06. The accompanying ledger receipt had 204 scheduled successes and the
same two earlier failures, with 10,080 roots committed by successes and 200 by
failures. A separate 22:49:11 read again found zero overdue rows; the later
ledger had 212 successes and no additional failures. Serving-health recovery
is now observed on `e8e7fb3`.

The 22:47 receipt still had 18,169 younger expired standalone episodes, 12,046
eligibility decisions and one projection run inside the propagation window.
Their normal catch-up continued; the scheduler is a persistent loop, so its
running status does not mean an incomplete purge attempt or resumed daily-only
cadence. Direct PGDATA measurement at 22:47:59 found 24,396,324,864 free bytes on
a 48,891,670,528-byte filesystem, 100,663,296 WAL bytes, and no lock waiters or
long transactions. The legacy stage relation stayed empty at 24,576 bytes.

At 22:51:26, a bounded post-clearance read found ten naturally created requests,
all issued: nine served and one fallback, with zero unavailable/issuance-failed
results and the cap not reached. This is a small observed sample, not universal
serving proof. A separate 22:51:49 ledger snapshot counted 228 scheduled
successes and the same two earlier failures, no scheduler error and three
freshly expired request roots inside the propagation window. No synthetic
writes or production mutations were used for verification.

This is not a qualifying clean daily cycle. Keep the ticket in progress until
two later ordinary, failure-free, loaded daily cycles
provide descendant, throughput, lock, backlog/oldest-age and headroom evidence.
No manual purge or production fault injection may manufacture acceptance.
See the timestamped receipts on #2553 and the consolidated closeout report.

## October 4 pre-release follow-up: deployed episode cap did not restore root progress

Historical snapshot before PR #2553 merged. Pending-release statements in this
section describe that earlier state; use the release receipts above for current
deployment evidence.

Both Admin HTTP and worker were verified on PR #2551's merge revision before
the October 3 21:02 UTC natural scheduled attempt. That attempt failed at the
unchanged five-second deadline after durably deleting ten request-free episodes
and nineteen direct actions, with **zero expired request roots** deleted. The
older October 4 incident section below describes the pre-#2551 backlog and
local episode-cap proof; that proof did not establish production recovery.

The next scoped repair changes only the request-root eligibility child count.
The emitted Prisma `LEFT JOIN ... OR` SQL was captured on a local fixture with
dummy IDs. Bounded read-only production plans for the equivalent shape and a
request-parent-driven `UNION` count took 329.175 ms and 2.548 ms respectively
on the same oldest-fifty-root cohort. These are read-plan measurements, not
delete timings or proof that the complete retention run will pass. An owned
PostgreSQL fixture deleted twelve expired roots in 1,138 ms while its first page
also deleted ten standalone episodes; the fixture is not production recovery.
The query-only PR is pending review and normal release. Feat-554 remains
in-progress: verify natural root/descendant progress and backlog recovery
after actual release, then require two later ordinary failure-free loaded daily
cycles with lock, backlog and headroom evidence before closure.

## October 4 pre-release standalone-episode incident and scoped repair

Historical snapshot before PR #2551 merged. The local repair and future release
steps below describe what was known before its observed production attempt.

The October 3 normal scheduled cycle failed on every observed attempt before
deleting expired request roots. A bounded read of the durable and workflow
ledgers found 125 failed wrappers at roughly the fixed five-second deadline;
each attempt committed 24–56 request-free playback episode deletions but no
request roots. The oldest expired request exceeded the 24-hour propagation
limit, so the retention serving gate is unhealthy. At 20:07 UTC, no new
recommendation request row had been recorded in either of the prior two hours;
that is a bounded serving-impact signal, not a synthetic delivery test.

The new scoped repair caps the pre-root standalone episode selection at ten
while preserving each episode's existing full dependency lock/recheck and
atomic transaction, the 50,000-dependency guard, five-second deadline and
29-day expiry. A full page requests normal catch-up. An owned native PostgreSQL
test reproduces the deadline failure under controlled per-row latency and
verifies first-pass request-root progress, descendants, graph invalidation,
live lineage, continuation and failure accounting. The prior October 3
profile-tail release was deployed on both Admin roles, but this earlier phase
prevented that repair from being reached.

This local repair is not production recovery or ticket completion. After a
reviewed PR-to-main release, verify actual Admin HTTP/worker revisions and a
natural catch-up attempt that deletes request roots, reduces the backlog and
restores the serving retention gate. Then require two later ordinary,
failure-free, loaded daily cycles with descendants, lock/backlog and headroom
proof. Keep this ticket in progress until the separately reviewed evidence
closeout merges.

## October 3 repair in progress

The October 2 scheduled run again recovered only after an initial transaction
deadline failure. The failed wrapper committed 100 expired request roots, 371
served descendants and 8,265 expired projection runs, then exhausted the fixed
five-second whole-run budget before the next phase could commit. A scoped repair
pages the four previously unbounded projection-tail deletes and live generation
reference detachments under the existing batch size. Native PostgreSQL fixtures
cover root-free continuation, contributions, interests, live run and decision
references, and eventual generation expiry. This local repair is not production
acceptance. Feat-554 remains in progress until two subsequent normal,
failure-free, loaded cycles meet the existing backlog and headroom criteria.

## October 2 NZDT status: loaded retention still open

The October 1 22:51 UTC production read confirmed 25,630,932,992 B of direct
PGDATA availability, 553,648,128 B of WAL files, healthy compact Admin HTTP and
worker processes, zero recent legacy writes/missing compact payloads, and an
empty 24,576-B legacy stage relation. Feat-555/575 are complete; U1–U3 storage
efficiency is complete in feat-574. See
`docs/reports/2026-10-02-recommendation-storage-efficiency-closeout.md` for exact
format, capacity and retention evidence.

October 1's scheduled retention eventually committed 7,846 roots and 27,216
served descendants, but four attempts failed first. That day is **not** a
qualifying failure-free loaded cycle; neither was September 30. Current count:
zero. The next normal starts are October 2 and 3 at 10:30 UTC (23:30 NZDT each
date). Each must remove actual expired roots and descendants without failure,
with acceptable lock skips, backlog and headroom. Do not substitute a manual or
zero-deletion run. The daily monitor remains active. No supported monthly growth
forecast follows from the post-reclamation snapshot. If a new defect is proved,
repair it and then re-establish two qualifying normal loaded cycles.

## Problem

The remediation preserves full 29-day trace history and reduces new trace
storage. PR #2429 is deployed on both production Admin roles, migrations
0100–0102 passed, and removing the redundant index returned approximately
2.37 GB of allocation (2.34 GB net additional filesystem space over the measured
interval). PR #2433 activated compact writes through the normal release path; both
actual processes were verified on the new revision with compact flags and
healthy roles at 23:25:17 UTC.
A local synthetic benchmark and immediate disk relief do not prove live
cascade deletion throughput or full-transition headroom.

## Entry Points — Read These First

1. `docs/reports/2026-09-28-production-db-storage/storage-remediation-runbook.md`.
2. `docs/reports/2026-09-28-production-db-storage/README.md` and `probes.sql`.
3. `apps/admin/prisma/migrations/0100_recommendation_candidate_compact_trace/migration.sql`.
4. `apps/admin/prisma/migrations/0102_recommendation_candidate_stage_duplicate_index_drop/migration.sql`.
5. `apps/admin/src/config/env.ts` — `RECOMMENDATION_CANDIDATE_TRACE_FORMAT`.
6. `apps/admin/src/workflows/recommendationRetention.ts` — bounded continuation.

## Grep These

- `RECOMMENDATION_CANDIDATE_TRACE_FORMAT|trace_format_version`
- `recommendation_candidate_trace_format_check`
- `recommendation_candidate_stage_run_stage_idx`
- `batchLimitReached|catchUpNeeded|overdueAfterRun`

## What To Build

- Refresh read-only disk, relation, index, WAL, and growth measurements. Coordinate
  capacity protection before the remaining operational headroom is exhausted.
- Deploy through PR-to-main with the default legacy writer; verify migrations,
  constraints, duplicate-index removal, and legacy detail on every Admin replica.
- Confirm a reader-capable rollback image, then enable compact writes through
  the normal configuration/deployment process. Verify representative complete
  traces, outcomes, evaluation, and default behavior on all serving lanes.
- Measure write latency, error rate, daily storage growth, purge batch duration,
  deleted roots and descendants, WAL, lock waits, oldest expired age, and vacuum
  reuse through the first nonempty production request purge and the next daily
  cycle. Preserve 29-day retention and all detail.
- Record the last legacy write and any rollback. Once all legacy traces expire,
  plan a separate migration to retire old storage and reclaim its allocation.
  Do not rewrite a nearly full live table or perform unreviewed retained-trace
  backfills. The separately reviewed feat-560 ten-run lossless conversion pilot
  preserved all observations and expiry; it does not authorize bulk conversion
  or establish immediate filesystem savings.

## Verification

- Migrations 0100–0102 are finished; compact check is validated; the unique
  stage-ordinal index remains and the duplicate index is absent.
- Mixed-format detail matches the established Admin contract. Compact runs have
  complete payloads and no new legacy rows; default-legacy rollback remains
  readable on the reader-capable release.
- Loaded retention removes expired roots and their descendants at a rate above
  incoming volume without request errors or transaction-budget failures.
- Available disk and its slope support the 29-day overlap with explicit margin.
- Store timestamps, measurements, release versions, activation time, operator,
  rollback trigger, and final decision in the storage investigation report.

## Constraints

No production deployment, index change, deletion, or capacity change is authorized
by a local test result. Follow the normal release process and existing access
policy. Wider recommendation capacity graduation remains feat-396.

## Rollout Record and Open Gates

`docs/reports/2026-09-28-production-db-storage/production-rollout.md` is the
timestamped release and evidence record. The reader-compatible rollback floor
is `2cc8105ffb00a9f595cefe10594bd8537561099f` on both roles; production activation
release is `ea13e146faf4c188f9fb8d40c2b9dc1e33440751`. Compact fleet convergence
and bounded parity passed for the latest 100 compact and 100 legacy runs,
with no new legacy writes after fleet convergence. Initial operational logs
showed no observed recommendation errors/timeouts in the ten-minute window;
see the report for sample sizes, latency, and coverage limits. The last observed legacy
write expires October 26 at 23:24:43.126 UTC, subject to a later legacy rollback
and actual retention purge; feat-555 must re-establish the live horizon.

Keep this ticket in progress until the remaining gates are demonstrated:

- Authenticated compact detail smoke passed September 28; protected compact and
  retired-detail smoke passed September 29. Repeat against the eventual
  reclamation release; these bounded samples do not prove universal quality.
- Full 29-day capacity margin; the proposed nominal 75 GB buffer is not applied.
- September 30's first nonempty purge and the following daily cycle, including
  actual deletion throughput, continuation, errors, oldest-expired age, and WAL.

The existing `recommendation-storage-follow-up` local Codex heartbeat checks
every six hours and reports meaningful changes or failures. It requires the
computer to be on and Codex running. Physical empty-table reclamation remains
feat-555: it may follow proven natural expiry/purge or the separately authorized
finite early retirement and lossless conversion path. Feat-554 still requires
two loaded normal retention cycles and capacity monitoring before it can be
marked complete, even if feat-555 reclaims a proven-empty relation first.

## October 2 Reclamation and Remaining Retention Gate

`docs/reports/2026-10-02-legacy-stage-reclamation.md` records completed owner-authorized
bulk legacy disposal: 16.431 GB relation recovery and 25.512 GB available filesystem
space. Feat-555 and feat-575 are complete; this ticket stays in progress.
September 30 and October 1 normal loaded cycles recovered after failures, so neither
qualifies as failure-free acceptance. Require two normal loaded cycles with no
failures, sufficient descendant throughput, acceptable expired backlog/lock skips
and continued headroom. The next scheduled cycle is October 2 at 10:30 UTC.

The active `recommendation-storage-daily-check` monitor runs every 24 hours and
supersedes the earlier heartbeat schedule described above. The old finite deletion
job is permanently stopped. Follow `unattended-latest.json` and its bulk-disposal
receipt; never restart the expired campaign. No new monthly steady-state forecast
or universal quality claim follows from the reclamation measurement.

## September 30 Supplement

`docs/reports/2026-09-30-recommendation-storage-rollout.md` records further index
work and the first owner-authorized early-retirement pilot. Feat-575 (formerly
feat-572) permits early retirement of unprotected legacy stage detail only; all
protected evidence and operational records keep normal expiry. This exception
does not satisfy the two loaded-retention cycles or capacity gates above.
