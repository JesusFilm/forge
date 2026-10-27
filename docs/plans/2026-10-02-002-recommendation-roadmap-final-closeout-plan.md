---
title: Recommendation roadmap final closeout
type: chore
status: active
date: 2026-10-02
---

# Recommendation roadmap final closeout

## Authority and scope

The October 2 owner request authorizes reconciliation, necessary implementation,
explicit cancellation of obsolete scope, reviewed PR merges and normal release
verification. Preserve the original checkout. Use current main and isolated
worktrees. The delivery classification in
`docs/analytics-and-recommendation-policy.md` and the observations in
`docs/reports/2026-10-02-recommendation-coverage-acceptance.md` override older
coverage, study and natural-failure gates.

The durable inventory is
`docs/reports/2026-10-02-recommendation-roadmap-closeout.md`. Identify each ticket
by full path because IDs collide. Every scoped ticket must finish complete or
cancelled with an evidence-backed reason; necessary unfinished work cannot be
hidden in a successor ticket.

## Work units and ownership

1. Reconcile production co-watch and composition: content-discovery feat-387,
   feat-393, feat-565 and feat-573. Reuse the existing release owner. Verify
   refresh lifecycle separately from cards contributed and causal usefulness.
2. Reconcile storage: platform feat-554, feat-555, feat-574 and feat-575. Reuse
   the existing storage owner and measured receipts, including PRs 2534/2537.
   Preserve independent loaded-retention and capacity verification.
3. Repair database test fixtures and add CI coverage: content-discovery
   feat-612 and platform feat-591. Own only the named native test fixtures and
   necessary CI wiring; preserve expiry and owner-authority semantics.
4. Finish Watch measurement and navigation authority: content-discovery
   feat-373 and feat-564. Audit runtime and existing deployed evidence first;
   complete actual gaps with cache-safe behavior and page-load verification.
5. Reconcile deployed client rollout: content-discovery feat-447 and feat-517.
   Verify existing privacy, control and fallback contracts and close honestly.
6. Reconcile optional measurement and future product programme: remaining
   listed recommendation tickets, including feat-055/063. Retire obsolete
   studies and optional expansion with explicit product dispositions. Preserve
   working analytics and recommendation behavior. Review feat-566's earlier
   remediation commitment individually rather than dismissing it wholesale.
7. Integrate reviewed PRs in dependency order; regenerate indexes, repair
   bidirectional dependencies and update active guidance. Audit merged main.

## Verification and sequencing

Audit before edits; each implementer records a scoped plan before runtime changes.
Independent areas use separate GPT-6 Sol chats, with no further delegation;
the October 27 user-requested retention handoff uses GPT-6 Astra.
Shared production operations and merges belong to the coordinating owner.
Children own their ticket files and evidence; root owns the consolidated record,
policy, global index and cross-ticket dependency reconciliation.

Native database verification must use the correct isolated database per suite,
including historical playback-upgrade timestamps, current viewing-mode schema,
co-watch refresh, digest reuse, trial authority and source-query regressions.
Frontend changes require behavioral and loading-performance evidence. Runtime
changes require normal PR-to-main deployment confirmation and bounded observed
verification. Documentation-only changes require formatting and CI-sensitive
validation, not claims about new runtime deployment.

Independent review checks correctness, preservation of contracts and honesty of
every disposition. Complete and cancel mean different things: cancelling a
usefulness study leaves benefit unmeasured. Empty rows do not establish defects
or exhaustive catalogue absence. HTTP 200 does not excuse internal errors.

## Exit criteria

- Every scoped path appears in the closeout record with owner, reason, PR and
  evidence; merged-main frontmatter has zero open scoped tickets, unless an
  exact genuine external dependency is explicitly documented.
- No required implementation is relabelled as optional because it is difficult.
- Delivery reliability, coverage, generator usage and refresh lifecycle remain
  separate, with observed, inferred and unmeasured claims labelled.
- Original working-tree changes are preserved; no direct production deployment
  or fault injection is used.

## Execution state

The implementation and scope decisions are integrated through PRs 2538, 2539,
2540, 2543, 2544, 2545 and 2546. Root PR 2541 reconciles the dated ledger,
bidirectional dependencies, generated index and guidance. Independent reviews
and required checks cover each scoped PR; normal Roadmap deployment is verified
separately from local behavior and page-load checks.

The retention track stays active for platform feat-554: two normal failure-free
loaded daily retention cycles must be observed. October 2, 3, 4, 5 and 6 failed and
do not qualify. Runtime repairs #2550, #2551 and #2553 merged normally. Both
Admin roles were verified on `e8e7fb3` at October 3 22:05:59 UTC. Natural catch-up
then produced successful batches as well as two failed attempts; at 22:17:23,
overdue requests and projection runs were clear, but standalone episodes and
eligibility decisions still kept the serving gate overdue. At 22:47:11, all
21 overdue categories were clear with a current success watermark; a separate
22:49:11 check confirmed that recovery. Normal catch-up of younger expired
records continued in the persistent scheduler. The October 4 ordinary cycle
then recorded six failures and 438 successes. Its 19:39 UTC health audit still
found zero overdue rows, but it supplies no clean-cycle credit. The storage
owner investigated those fresh failures with bounded reads and isolated tests.
PR #2556 merged as `66eccae12` at October 4 20:29:08 UTC after independent review
and green CI, reducing only the episode page from ten to five. Paired native
tests measured more first-attempt deadline headroom at about 6.0% greater total
fixture drain time; a negative slow-tail test preserves real failure accounting.
The expiry-prefix capacity calculation is conditional, not observed future
throughput. Actual Admin HTTP/worker deployment receipts belong on #2556.
The October 5 ordinary cycle on descendant `904647329` then recorded four
transaction-expiry failures amid 3,498 successes through 19:40 UTC. Its 19:41
audit found all 21 overdue types clear and 23,093,526,528 bytes free, but it
does not qualify. PR #2580 adds a minimum remaining-time admission guard after
an owned PostgreSQL fixture reproduced an avoidable late-phase timeout. A
pre-work yield preserves exact committed counters as `SKIPPED` / `budget_yield`,
leaves backlog unknown, does not advance the full-completion watermark and
requires bounded continuation. Real failures remain failures. Four native
PostgreSQL 18 tests passed, including two yields with slow triggers retained
before deferred work completed. After GitHub runner recovery, independent review
reconfirmed the unchanged source tree at final head `5d590566c`; all 39 executed
PR checks passed with six expected scope skips. Parent checked every underlying
job rather than relying on the aggregate gate. Normal squash merge
`0cb08416ce3e9a1278997d061fc2f8e12e6b2b66` completed October 5 at 23:11:49 UTC.
Both actual Admin roles matched that merge at 23:27:53 UTC: successful
deployments, healthy compact traces and correct runner roles. Both ledgers had
zero natural attempts since merge at the 23:28 read, so loaded behavior remains
unobserved. All 21 health types were within the 24-hour window; the successful
expiry cutoff remained 22:04:29.558, before release. Separate capacity evidence
found 22,988,713,984 bytes free, 117,440,512 WAL bytes, an empty legacy stage and
no lock waiters. The next ordinary start is October 6 at 10:30 UTC. Full
[release evidence](https://github.com/JesusFilm/forge/pull/2580#issuecomment-6005424722)
preserves the timestamps and deployment IDs. The exact production
budget-consuming SQL remains unproved. Repeated yields do not prove eventual completion under
sustained arrivals, so oldest-age and success-watermark checks remain necessary.
Recovery and local mitigation evidence do not replace the two later ordinary
loaded daily cycles. Existing daily monitoring sends
new proof to the coordinating owner, who completes the scoped evidence PR,
review/merge, final merged-main inventory and index update. Do not mark the plan
complete or disable that monitor before the required closure merges.

The October 6 ordinary cycle on actual revision `0cb08416c` recorded 980 durable
successes, ten `budget_yield` skips and 86 failures by the 19:41 UTC read. Six
earlier failures were transaction-expiry errors; 80 later request-root deletion
failures hit the published-profile-child immutability guard, with another
guard rejection present in a separate 19:44:59 read. The 990 successful workflow
wrappers include the ten yields, not 990 completed purges. All 21 overdue types
were clear at 19:41:43, but the latest successful cutoff remained 13:49:56.061
and the cycle earns no clean credit. Separate capacity reads found
22,426,816,512 bytes free, 117,440,512 WAL bytes, no lock waiters and an empty
legacy stage. Read-only schema metadata confirms an eligibility `SET NULL`
foreign-key action conflicts with the published-child update guard and the
paired ID/revision check. Isolated native tests reproduced the old rejection and
rollback, then passed actual FK cleanup with exact purge counters and retained
evidence after the proposed migration. Direct unlinking, reassignment, mixed
edits, nested non-FK changes and published-interest edits remain rejected. The
full five-test standalone-retention suite passed. Independently reviewed PR
#2594 passed all required checks and merged normally as `2913616a2` at
October 6 20:23:11 UTC. Migration 0129 applied at 20:32:40.596 with matching
checksum/guard body; both actual Admin roles were healthy, compact and correctly
assigned on `2913616a2` by 20:36:58. Eight later naturally scheduled attempts
succeeded, committing 800 roots and 2,877 items with no failure or yield in the
20:37:46–20:38:11 window. All 21 overdue types were clear at 20:38:57 and the
success cutoff advanced to 20:38:08.969. The later release snapshot contains 98
pre-migration failures, so this is recovery, not a qualifying daily cycle.
The six timeouts remain a separate unresolved class: rejected calls spanned
counts and deletions, without proof of the statement that exhausted the budget. Do not broaden timeout budgets or perform a manual
production purge to accelerate the acceptance gate.

The post-merge HNSW six-card CI assertion failed once and passed the single
bounded retry; all required post-merge jobs then passed or were expected skipped.
This pre-existing retrieval fixture failure is separate from retention and the
resolved runner outage. Eight isolated runs passed but did not explain the CI
failure. Newly discovered follow-up feat-609 retains the missing failed actual
plan/settings and correction proof; no assertion, timeout or production behavior
was weakened. The original 38 paths remain 12 complete / 25 cancelled / one open;
including feat-609, 39 tracked paths contain two open tickets. Do not claim the
HNSW issue fixed by a passing retry or transfer feat-554's two-cycle gate to it.

PR #2595 merged as `20f55715c` after independent review and green checks. It adds
failure-only actual plan/settings diagnostics and a transaction-local scan-memory
comparison, retaining the original ANN assertion and 1.5-second retrieval budget.
Seven additional full-file local runs, three targeted runs and 121 preceding
CI-batch tests passed without reproducing the failure. Feat-609 remains
in-progress; no runtime fix or production retrieval defect is claimed. Parent
reconciles the generated index and consolidated release record; the existing
daily storage monitor retains feat-554's two later ordinary clean, loaded cycles.
The expired temporary outage monitor stays paused.

### October 23 continuation

The current scope is 40 paths: 12 complete, 25 cancelled and three open after adding the directly related platform feat-756. The historical original-scope counts above remain dated. The current [rollout checkpoint](../reports/2026-10-23-watch-exposure-fortnight-rollout.md#strict-stored-expiry-release) supersedes the earlier deployment wait and pending strict-mode repair. Both actual Admin roles ran `85e97f521` at 09:03:53, and the existing daily 10:30 UTC worker scheduler and durable runtime were reverified at 09:12:17 without error. #2877 records its 46 focused tests; no duplicate scheduler was added.

Continue in this order:

1. **Complete:** #2878 enforces stored-expiry scope in both manual entry paths, including previously persisted workflow inputs. It retains guarded expired-proof cleanup and required expired-visit reporting, while excluding unrelated age/status maintenance. Scheduled policy is unchanged. Exact published head `b81fa7356` passed independent review, 80 unit plus 12 native PostgreSQL tests, normal validation/hooks and PR CI before normal merge and actual deployment.
2. **Release verified; incident preserved:** keep window 37's interrupted RUNNING ledgers and partial committed counts without replay or terminal rewriting. Twelve samples proved actual Next process continuity but did not pass the old literal non-rising memory rule. Independent review conditionally accepted a distinct one-pass recovery with two fresh 30-second-separated readings at or below 4 GB of 8 GB, stable identity, health and refreshed process/DB/expiry/capacity gates. Parent owns the launch decision. Do not infer OOM causation or an unbounded leak from these receipts.
3. Resume only authorized stored-expired cleanup when safe, then reconcile both ledgers, all retained families and additional expiry categories, counters, watermark, locks, WAL and free bytes. Windows 01–36 deleted 8,509 request roots; the 09:05:27 read still found 8,369 expired rows across 26 types and a separately capped session-link backlog. No zero-backlog claim is justified. The two historical manual profile-erasure counters retain unknown expiry eligibility and a possible scope breach; the new release does not retroactively clear that uncertainty.
4. Keep feat-554 open for two later ordinary loaded failure-free daily cycles and feat-756 open for the October 27 historical exposure wave/capacity evidence. Manual work and budget yields do not manufacture daily-cycle credit. The existing daily monitor remains read-only and active.
5. Keep feat-609 open: #2878 main CI's HNSW failure followed by one unchanged failed-job retry establishes no correction. Bounded local experiments and CI environment comparison found no supported fixture/runtime fix. The next discriminator requires a naturally failing original-geometry index retained before teardown. Do not weaken the assertion, repeat blind CI retries or confuse this with the historical hosted-runner outage.

The window 38 admission was held without launch at 09:18:15 after worker memory rose above 4 GB. No new cleanup command or attempt was issued, and no further manual retry is authorized by this plan. Preserve the backlog as unresolved and let the existing daily monitor verify ordinary scheduled progress, errors, memory and capacity. The production daily scheduler remains enabled; do not confuse this manual hold with disabling automation.

Parent merged the earlier evidence PR #2868 and owns this later release record, review/merge and final inventory. The storage owner retains coordinated production operations and daily read-only monitoring. No duplicate automation, direct deployment, manual restart, early Watch expiry or capacity purchase is authorized.

### October 24 continuation

This checkpoint supersedes the October 23 pre-cycle backlog and zero-credit
state above. The independently reviewed October 23 ordinary cycle completed
85 successful passes without failures or yields and cleared its fixed expired
cohort. It earns one feat-554 cycle; no manual cleanup launched. The [current
closeout checkpoint](../reports/2026-10-02-recommendation-roadmap-closeout.md#october-24-checkpoint)
and feat-554 ticket retain the final watermark, descendant/backlog and capacity
evidence. One further qualifying cycle is needed.

October 24 recorded genuine failures and earns no credit, even though its fixed
10:30 UTC cohort was clear in the 12:50 snapshot. The nine observed wrapper
failures include expired transactions, explicit batch deadlines, a generic
transaction error and a terminated connection. The exact expensive operation
and connection-failure cause remain unproved. Keep both ledgers independent;
do not replay or rewrite stale RUNNING entries.

The storage owner continues bounded diagnosis using the captured evidence and
owned local fixtures. Require a causal explanation and discriminating test
before claiming a runtime fix, then independent review, green required checks,
normal PR-to-main release and actual deployment verification. Preserve the
five-second budget and truthful failure/yield classification. The already
enabled daily scheduler and separate read-only daily monitor remain active;
do not start manual cleanup or revive the expired outage monitor. Keep the
October 27 exposure wave and the unresolved HNSW fixture separate from feat-554.

### October 26 continuation

The [current evidence checkpoint](../reports/2026-10-02-recommendation-roadmap-closeout.md#october-26-current-checkpoint)
records 37 failed scheduled wrappers on October 25 and nine on October 26.
Independent review accepts no new cycle credit: October 23 remains one proved
ordinary loaded, failure-free cycle. Keep the separate ledgers independent and
do not rewrite or replay the stale RUNNING row. The October 26 query is as of
19:27:51 UTC; its later upper bound does not establish future-window completeness.

The existing storage owner's bounded read-only incident bundle is complete and
independently reviewed: the fixed daily-start cohorts were clear across 26
families, but 26,194 newly expired rows remained, with zero over 24 hours overdue.
PGDATA had 7,503,618,048 free bytes; separate probe times and capped/missing
surfaces limit inference. Preserve those limits in the linked checkpoint.
The minimal logging-envelope and consumer correction for the confirmed format
mismatch merged as reviewed, green PR #2915 (`f27980447`); actual Admin HTTP and
worker samples on descendant `63a1ccc40` were verified healthy/compact with
correct runner roles at 20:59:48.987-20:59:53.009 UTC. PR #2900
deployed diagnostics, not a timeout fix; worker log transport and the original
timeout cause remain unproved. The transient worker 503 recovered on two health
samples, with cause and child process/container continuity still unverified.
No fault injection, timeout widening, direct deployment or manual cleanup is
authorized. The independently accepted [release bundle](../reports/2026-10-02-recommendation-roadmap-closeout.md#october-26-diagnostic-format-release)
found zero new natural attempts at its 21:00:15 ledger snapshot and zero phase
events in the separate bounded log window, so it does not prove production
failure-log transport, loaded execution or retention acceptance. Continue the
existing daily monitor with the new parser and actual release. Preserve the
separate October 27 Watch expiry-wave verification
and unresolved HNSW fixture work. The later Co-watch PR #2916 reopened feat-573;
current scope is 40 paths, **11 complete, 25 cancelled and four open**. Its owner
remains the existing Co-watch release task; do not duplicate its work or treat
its separate statement-timeout change as a retention change. Replacement main
CI, production image and all four CodeQL analyses passed; the cancelled older
merge jobs remain cancelled. One further qualifying ordinary loaded cycle is
required, with fresh genuine failures routed to bounded diagnosis.

### October 27 retention repair and Astra handoff

The user explicitly authorized clearing the remaining stored-expired backlog,
repairing cleanup failures and transferring that work to GPT-6 Astra task
`01a17a53-3d0b-7b51-806c-78af8d6cfc3c`. The previous storage owner stopped edits
and manual operations and retains only its existing daily read-only monitor.
Parent continues independent review assignments, exact-head merges and shared
production coordination. No duplicate task, scheduler or monitor is required.

The [current correction and handoff](../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-exhausted-budget-correction-and-cleanup-handoff)
records PR #2920's reproduced pre-work exhaustion defect, 94 focused and nine
native PostgreSQL tests, independent exact-head approval and green normal merge
`ce23241a9`. Preserve the five-second cleanup budget, committed counters, unknown
backlog on yield, unchanged success watermark and actual-error semantics.
Historical P2028 SQL remains unproved. Both actual Admin roles were verified on
exact `ce23241a9` with matching source hashes, health, compact mode and correct
runner roles at separate 23:08 worker and 23:15 HTTP observations. Main CI,
production image and all four CodeQL analyses passed. The finite ledger window
contained zero attempts; the release establishes no loaded deletion behavior.

The user's later October 27 instruction removes the operator-imposed 4 GB
admission threshold and no-rising-memory rule. Those rules in earlier dated
receipts are historical, not current prerequisites. Do not replace them with an
arbitrary reserve. Datadog access and a completed memory root-cause diagnosis are
also not prerequisites. Track actual container memory, its enforced limit and
OOM events directly, alongside service health, correct deployed revision/roles,
PGDATA above 5 GB and no competing cleanup, lock waiter or long transaction.

The user authorized additional headroom or a dedicated worker. The existing
production worker was increased from 8 to 16 GB with CPU unchanged at 8, within
the verified 24 GB plan allowance. API readback and the running container's
actual limit both confirmed 16,000,000,000 bytes. The same PID 1, process start
and deployment remained; no restart or redeploy was issued. The first subsequent
pass committed 50 expired request roots and yielded safely, with matching
durable counts and a successful manual wrapper. See the
[capacity and deletion receipt](../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-worker-capacity-and-resumed-deletion).

The later explicit backlog request supersedes the older no-further-manual-work
instructions in the dated checkpoints above. A parent-reviewed admitted window
may run at most five individually reconciled deployed expired-only passes or
five minutes. A committed positive-progress budget yield may continue into a
distinct next pass after both ledgers reconcile; this supersedes the earlier
stop-on-any-yield operator rule. Stop on an actual error, uncertainty, mismatched
counts, unhealthy service or OOM/limit events, competing execution, unsafe
database/capacity conditions or no progress.
Use the reviewed exclusive-attempt recorder, preserve expected exit-3 payloads
and never replay an uncertain invocation. No manual pass is authorized merely
by the read-only verification assignment or the existing daily heartbeat.

The next window stopped on its first pass at 00:21 UTC: both ledgers failed
after 100 further committed roots, with an expired transaction reporting
854 ms allowed versus 870 ms elapsed. No second pass or replay followed.
A later distinct pass committed another 100 roots and yielded safely; total
post-resize committed roots are 250 across three invocations. Do not reclassify
the earlier failure as a safe yield or a memory-admission hold.

The [post-configuration repair receipt](../reports/2026-10-02-recommendation-roadmap-closeout.md#october-27-post-configuration-admission-repair)
records separately proven missing admission logic, native exact-base RED/final
GREEN, independent review and green normal merge `742f25c2` (PR #2923). The
speculative query/index migration was excluded. Both actual roles now run that
revision with matching source hashes, health and correct configuration; the
worker retained 16 GB through the normal rollout. All main CI, image and CodeQL
checks passed, including actual native retention and production-startup steps.
The next bounded window committed another 250 roots across three attempts:
two acknowledged yields (50 and 100), then a genuine failure after 100 further
committed roots. Post-resize committed roots total 500; neither failed partial
attempt is reclassified. No fourth pass or replay followed. The fixed cohort
fell from 38,431 to 37,442, and current expiry from 44,345 to 43,474 across 26
families; additional bounded inventory found at least 1,001 expired
profile-session links and one pending profile erasure outside that total.

Current diagnostics localize the failure to admitted projection-decision
selection: 796 ms at admission, 808 ms in the operation, and 3 ms each for
acquisition, lock and configuration. Astra owns a targeted efficiency repair,
with representative scan/work measurements, full-drain correctness and
nonexpired preservation. Parent owns independent review, merge and subsequent
production coordination. No further manual invocation follows this stopped
window before a reviewed correction is normally deployed. The normal deployment
is required; no direct deploy/redeploy or local-code publication is authorized.
Underlying SQL/client cost and historical failure causation remain unproved,
and a yield-only sequence does not prove completion.

Continue observing both ledgers, all 26 current retention-health families,
expiry cohorts, success watermark and capacity. Those 26 families do not cover
every cleanup category, so neither their count nor a yield-only sequence proves
global clearance. Keep memory diagnosis separate from the active drain.

The user's later efficiency objective requires less CPU and database work per
committed expired row while making useful drain progress. Added capacity and
the admission-boundary correction are separate outcomes, not efficiency proof.
Measure costly selection scans, joins, FK/cascade work, waits and repeated or
rolled-back work before choosing an optimization. Compare committed rows per
elapsed time and CPU under comparable workloads, with effects on live request
latency. Shared-worker CPU and health-probe latency are contextual measurements,
not isolated deletion cost or live-request latency. Profile eligibility
reconciliation is a separate maintenance path; do not attribute its failures or
the reported CPU spike to retention without evidence.

Keep feat-554 in progress until one further qualifying ordinary loaded,
failure-free cycle supplements October 23. Preserve the Watch exposure wave,
HNSW fixture and separate Co-watch work without claiming them closed. Update
release receipts and the same daily monitor with actual deployed evidence;
keep the expired outage monitor paused and the scope at 11 complete,
25 cancelled and four open until new acceptance evidence supports a change.
