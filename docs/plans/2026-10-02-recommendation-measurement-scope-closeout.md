---
title: Recommendation measurement scope closeout
type: chore
status: completed
date: 2026-10-02
---

# Recommendation measurement scope closeout

## Scope

Audit content-discovery feat-371, feat-372, feat-374, feat-375, feat-380,
feat-381, feat-505 and feat-566 against current main, the October 2 delivery
policy and accepted coverage report. Preserve working Watch GA, Datadog RUM,
search, sharing, playback and recommendation evidence. This work owns only the
eight ticket files and this scoped plan and learning record. The parent owns
global policy, index, cross-ticket dependencies, merges and production changes.

## Decision procedure

1. Trace each ticket's proposed outcome to current Web/Admin code and retained
   receipts. Separate delivered foundations from proposed expansion.
2. Classify remaining scope as required reliability/correctness work or optional
   measurement/product work. A genuine current defect needs a demonstrated
   failure and repair; old missing evidence cannot be called repaired.
3. For feat-566, enumerate D1–D9 individually. Identify what the historical
   records can prove, what remains unknowable, and which present health checks
   or defect triggers continue independently of this ticket.
4. Update the assigned ticket dispositions with specific reasons and links.
   Preserve historical narratives and state causal benefit as unmeasured.
5. Validate Markdown formatting, roadmap parsing, status/dependency metadata,
   and the scoped diff. Commit, push and open one docs PR; report cross-owner
   dependency changes to the parent.

## Verification boundary

This docs-only audit makes no new deployment claim. The October 2 read-only
production sample is a bounded observation of recorded requests, not fleet-wide
HTTP health. No production fault injection or wait for naturally occurring
terminal responses is required to retire obsolete forensic gates. Fresh errors
or reproduced correctness defects remain actionable under the active policy.
