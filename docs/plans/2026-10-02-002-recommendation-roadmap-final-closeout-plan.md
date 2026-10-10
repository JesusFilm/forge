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
   feat-590 and platform feat-591. Own only the named native test fixtures and
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
Independent areas use separate GPT-6 Sol chats, with no further delegation.
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
