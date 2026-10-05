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
   feat-609 and platform feat-591. Own only the named native test fixtures and
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

This plan stays active solely for platform feat-554: two normal failure-free
loaded daily retention cycles must be observed. October 2, 3 and 4 failed and
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
Recovery and local mitigation evidence do not replace the two later ordinary
loaded daily cycles. Existing daily monitoring sends
new proof to the coordinating owner, who completes the scoped evidence PR,
review/merge, final merged-main inventory and index update. Do not mark the plan
complete or disable that monitor before the required closure merges.
