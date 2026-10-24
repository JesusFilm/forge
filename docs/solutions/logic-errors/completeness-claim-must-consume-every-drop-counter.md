---
title: "A completeness claim must consume every drop counter"
date: 2026-08-17
category: logic-errors
module: apps/mastra
problem_type: logic_error
component: service_object
symptoms:
  - "erasure CLI exits 0 and reports outcome no_data even though rows matching the subject were removed from the addressable set by the missingTraceIdRows counter before deletion could run"
  - "completeness check inspects only collected.traceIds.length === 0 && !collected.truncated, silently ignoring the counter of visible-but-undeletable rows"
  - "operator runbook treats that no_data line as completion evidence and licenses a requester-facing 'traces have been removed' sentence that is false while unaddressable rows remain"
  - "the whole suite stayed green: the counter was exercised only through formatter fixtures, never through outcome selection"
  - "three independently dispatched reviewers (correctness, security, adversarial) converged on the same line, and an independent validator confirmed it"
root_cause: logic_error
resolution_type: code_fix
severity: high
applies_when:
  - "a claim is consumed as evidence that an irreversible or compliance obligation was discharged (erasure, retention/purge, reconciliation, migration completeness)"
  - "NOT ordinary empty-state or filtered-listing UI reports"
tags:
  - "completeness-claim"
  - "drop-counter"
  - "fail-closed"
  - "erasure"
  - "no-data"
  - "exit-code"
  - "gdpr"
  - "langfuse"
---

# A completeness claim must consume every drop counter

## Problem

`apps/mastra/src/mastra/ai-chat-erasure.ts`'s Langfuse-erasure collector
drops rows into three separate buckets while listing a subject's traces:
`mismatchedRowsSkipped` (wrong owner, drop by design — AE6),
`missingUserIdRows` (ownership unreadable — refuses the whole half, R7),
and `missingTraceIdRows` (`userId` readable and matching, but `traceId`
unreadable — the subject's own rows, visible but undeletable by id). The
`no_data` outcome — read by the CLI, the operator runbook, and ultimately the
requester-facing "your traces have been removed" sentence — was derived from
`collected.traceIds.length === 0 && !collected.truncated` only. It never
looked at `missingTraceIdRows`.

## Symptoms

A subject with zero _addressable_ trace ids but one or more
`missingTraceIdRows` produced `kind: "no_data"`. That flowed straight
through: CLI exit 0 → `event=no_data_for_key store=langfuse` → the operator
runbook's own text names that line as completion evidence → the requester is
told their traces were removed, while the visible-but-undeletable
observations are still sitting in Langfuse. A deterministic GDPR
false-completion claim, and the whole test suite stayed green throughout.
Caught pre-merge in feat-337 PR 2's review, in the uncommitted tree.

## What Didn't Work (and why it stayed invisible)

Every mocked fixture built rows with **both** `userId` and `traceId`
readable, so `missingTraceIdRows` was only ever exercised as a _formatter_
fixture — proving the count renders in the CLI report string — never through
_outcome selection_. The type's own doc comment even asserted the read-only
requery "keeps the report honest"; that was false, because the requery runs
the same collector and drops the same unaddressable rows every time. Nothing
in the diff or the green suite could have shown the gap: the `no_data` doc
comment already promised "a COMPLETE listing (no truncation, no unreadable
rows)" — the doc was right, the code simply never checked the claim it
made. Three separately dispatched reviewers (correctness, security,
adversarial) converged on this exact line — but they were same-family models
sharing the same review context, so the convergence is provenance, not
independent corroboration: it shows that "which counter does this claim NOT
consume?" was the productive question to ask. The load-bearing evidence is
the code and fixture analysis itself, which anyone asking that question
reproduces.

The trap repeated across the arc's own PRs (session history): PR 1 had
already fixed the _connectivity_ version of the same false claim in the
same file — `listThreads` swallows store faults into empty results, so a
store dying mid-listing read as "no data found for this exact key" until a
post-collect probe gated the zero-count report — and had already
established the refuse-don't-skip posture for unreadable rows
(`unreadable_rows` / `filter_mismatch`). PR 2 rebuilt the same claim over a
new store and re-introduced the same hole on a _new axis_ (data shape
rather than liveness), because the claim site was re-derived from the
happy-path length instead of from the full counter list.

## Solution

Added a fail-closed `refused_unaddressable_rows` outcome kind, returned in
**both** preview and execute modes, checked before any delete is attempted
(`ai-chat-erasure.ts:815-821`):

```ts
if (collected.missingTraceIdRows > 0) {
  return {
    kind: "refused_unaddressable_rows",
    ...counts,
    missingTraceIdRows: collected.missingTraceIdRows,
  }
}
```

This sits directly after the existing R7 `refused_unreadable_user_ids` check
(`missingUserIdRows > 0`, lines 801-807) and before the `no_data` derivations
at lines 853-855 (preview) and 859-861 (execute) — so a row that fails this
gate never reaches either `no_data` branch. It also precedes the transient
listing-failure classification (`collected.failure`, lines 822-842):
deliberate, matching R7's placement — a partial listing that already carried
an unaddressable row escalates as the hard refusal rather than the rerun-safe
transient, the fail-closed direction. `exitCodeFor` in
`apps/mastra/src/scripts/erase-user.ts:267` maps the new kind to exit `1`,
alongside the other hard-refusal kinds (`refused_unreadable_user_ids`,
`egress_refused`, Postgres `unreachable`) — an escalation, not a rerun-safe
`2`. The formatter and warn-line paths were extended for the new kind, and
tests were added per branch, including a mixed page (some addressable rows +
some `missingTraceIdRows` in the same listing) that asserts the outcome is
still `refused_unaddressable_rows` and that zero DELETE requests were ever
recorded on the wire. The operator-facing counterpart (exit-code table,
escalation wording) lives in `apps/mastra/CLAUDE.md`'s erasure runbook — this
doc deliberately does not duplicate it.

## Why This Works

The fix moves the check from "does the happy-path collection look empty" to
"did anything upstream produce a row this claim cannot account for". Once
`missingTraceIdRows` gates the `no_data`/`counted`/execute branches, there is
no path left where a nonzero _unreadable-or-unaddressable_ count and a
`no_data` result can coexist. The `mismatchedRowsSkipped` case still coexists
with `no_data` by design: those are OTHER subjects' rows the exact-equality
re-check excluded from the claimed set, so dropping them is what makes the
claim true, not what falsifies it. And the exhaustive `formatLangfuseOutcome` switch forces every new outcome
kind to get real formatter/log coverage instead of silently falling through.
The fail-closed posture (refuse and escalate, never delete around the
unreadable rows) matches the existing R7 pattern one branch above it, so the
runbook's escalation path (console break-glass) already exists to receive
it — no new operator procedure was invented, just a new trigger for the
existing one.

## Prevention

**The law:** at any site claiming "no data" / "zero remaining" / "all
clear", enumerate _every_ counter or filter that can drop rows _belonging to
the claimed set_. Each one gets exactly one of three dispositions:

- **(a) BLOCK the claim** with a distinct non-completion outcome kind. This
  instance took the stronger sub-form — blocking the ACTION too (zero
  deletes), chosen because a partially-erased subject cannot be distinguished
  later; the cost is that no addressable row is deleted until
  escalation/break-glass resolves it. The same code uses the middle
  disposition for `truncated`: delete what the listing proved, return a
  distinct `cap_exceeded` non-completion outcome — honest without refusing.
- **(b) act on the proven subset** and return that distinct non-completion
  kind — the `cap_exceeded` middle ground above, legitimate only where reruns
  are idempotent and a partial state is distinguishable from a complete one.
- **(c) be provably irrelevant** — with the proof written as a comment at the
  claim site AND pinned by a fixture that drives the counter through outcome
  selection asserting the claim still holds. Worked example:
  `mismatchedRowsSkipped` (other subjects' rows, outside the claimed set by
  construction) deliberately coexists with `no_data`, pinned by the
  exact-equality outcome test "re-checks with EXACT equality — a
  prefix-adjacent userId is a mismatch" (`ai-chat-erasure.test.ts:1062`),
  which asserts `kind: "no_data"` WITH `mismatchedRowsSkipped: 1` counted.
  Honest caveat: "outside the claimed set" itself rests on the exact-equality
  re-check — an id-format drift that made the subject's own rows compare
  unequal would move them into this counter and land on `no_data`; that
  residual is accepted (the plan's AE6 settled skip-and-count for mismatched
  rows) and recorded at the claim site.

Auditing only the happy-path collection's length (or any single field of a
multi-field counts object) is the bug shape itself — a claim that consumed
one signal and implicitly asserted the rest don't matter, without saying so.

**Bounded completeness:** the law covers only drops the collector can SEE. A
drop class that produces no counter — a store visibility wall (Langfuse
Hobby hides rows older than 30 days: a subject wholly past the wall lands on
`no_data` with every counter clean), a server-side filter, silent dedupe —
must be surfaced as its own outcome or recorded as a stated bound on the
claim, never assumed absent. See
`docs/solutions/architecture-patterns/diy-retention-sweep-three-controls-visibility-walled-store.md`
(its feat-337 caveat) for the worked instance. And do not over-apply: the law
targets discharge-of-obligation claims, not every empty-state message — an
ordinary filtered listing's "no results" owes nobody a counter audit.

**Test discipline:** one fixture per drop counter must be driven through
_outcome selection_, not just through a formatter/rendering fixture. A
counter that appears only in a fixture asserting the string it prints — never
in a fixture asserting which `kind` gets returned — is an unconsumed counter
waiting to happen. When adding a new drop-counter field to a completeness
report, immediately ask: which existing completeness claim does not check
this yet, and is that omission written down? A structural option beside the
habit: derive the claim guard from an exhaustive destructure of the counts
object, so a newly added counter is a typecheck failure until classified —
the habit alone is what failed twice in this same file across the arc.

**Related:**

- `docs/solutions/best-practices/single-upstream-predicate-bounding-irreversible-blast-radius-20260812.md`
  — the feat-337 PR 1 installment of the same erasure-honesty family (a
  single upstream predicate must bound the whole irreversible action).
- `docs/solutions/architecture-patterns/diy-retention-sweep-three-controls-visibility-walled-store.md`
  — the same arc's connectivity sibling: its 2026-08-12 amendment ("a probe
  must also guard the REPORT of an absent result") is this law's liveness
  axis; this doc is the data-shape axis, fixed by consuming an existing
  counter instead of adding a probe.
- `docs/solutions/architecture-patterns/kill-switch-completeness-follows-data-lifetime.md`
  — sibling law: a completeness/gating claim must be re-derived per path,
  never inherited from a mechanism that only covered one of several paths.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the META home for the fixture-blindness mechanism this bug instantiates:
  every fixture happened to give both fields, so the branch that needed one
  field missing was structurally untested.
