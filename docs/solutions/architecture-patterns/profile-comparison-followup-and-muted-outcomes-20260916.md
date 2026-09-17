---
title: "Keep complete profile follow-up and count muted viewing once"
date: "2026-09-16"
module: "Recommendation usefulness experiments"
problem_type: "integration_issue"
component: "service_object"
symptoms:
  - "Direct profile delivery bypasses experiment assignment"
  - "Enrollment cutoff can truncate the last viewers' follow-up"
  - "Muted preview and manual playback can be miscounted as separate views"
root_cause: "missing_workflow_step"
resolution_type: "code_fix"
severity: "high"
tags: [recommendations, experiments, intent-to-treat, playback, privacy]
---

# Profile comparisons need complete follow-up and explicit measurement versions

## Problem and decision

A prepared evaluator does not establish that production is assigning viewers.
The September 16 read-only readiness capture contained no assignments, shadow
runs or decisions. Ordinary personalized CTR is confounded by viewing history.
The owner also clarified that visible muted previews are meaningful behavior.

Keep the ordinary recommendation route and add a separately gated profile-unit
comparison. The `profile-usefulness-assignment-v1` policy requires a current
profile generation, 50/50 bounded approval, eligible English semantic/profile
inputs before enrollment, and exact strategies. A legacy session A/A cannot
stand in for a profile-unit A/A. Overlapping profile studies fail closed.

## Durable implementation rules

- Distinguish enrollment cutoff from follow-up and retention. For this policy,
  `endsAt` closes enrollment; existing units retain their own 24-hour window.
  Keep assignment rows beyond the additional six-hour fact horizon. Require
  experiment expiry beyond the last possible mature outcome capture.
- Gate first enrollment on both strategies' usable inputs. Later missing
  projections do not remove an assigned viewer or choose a new arm. Keep units
  with no cards, impressions, clicks, or successful issuance in the denominator.
- Serialize enrollment under the profile row lock. Recheck profile generation,
  assignment, experiment and promotion authority when issuing the response.
  Reset/delete must order before or after enrollment, not between its checks.
- Both arms need identical history, fallback and collection policies. The exact
  topic-profile comparison disables mode affinity in both arms while retaining
  mode collection. Outside the comparison, sound-off ranking remains available.
- Compare ranker parity before recent-video composition. Comparing the composed
  row with the old unsuppressed order falsely triggers a semantic fallback.
  Record the actual recent-video composer version when that policy is used.
- Start extraction at the assignment ledger and require its exact configured
  enrollment window. Select the latest compatible outcome revision before
  counting. Count each episode once when manual playback, muted preview, or
  both modes qualify. Version this observable-viewing metric separately.
- Preserve unknown coverage. A technical error excludes an affected viewing
  contribution but is not itself a conflicting outcome. Missing profile A/A
  and external HTTP/latency evidence stay failed gates; never synthesize passes.
- Shadow history is a bounded same-session reconstruction before the original
  request. Use server receipt cutoffs and label reconstruction/retention gaps.
  It is not a captured serving snapshot or evidence of zero repetition.

## Verification and limits

`experiment/usefulness.db.test.ts` uses the production Prisma PostgreSQL adapter
and actual migrations. It covers concurrent sticky enrollment, zero-exposure
units, reset fencing, sound/manual deduplication and superseding outcomes.
Routing tests cover both semantic A/A arms, the exact hybrid challenger, later
cold profiles, shared history, and isolation from sound-mode ranking.

The extractor is read-only with a repeatable snapshot, row cap and SQL deadlines.
It cannot certify profile A/A equivalence or external operational guardrails;
those require separate reviewed evidence. Likewise the shadow composer remains
unpromoted while editorial inputs and weight calibration are incomplete. These
limits must remain visible in the roadmap and release claims.
