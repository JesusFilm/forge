---
title: "Keep recommendation closeout claims within their evidence boundaries"
date: "2026-10-02"
module: "Watch recommendation roadmap"
problem_type: convention
component: documentation
severity: medium
tags:
  - recommendations
  - observability
  - roadmap
  - evidence
applies_when:
  - "Closing recommendation tickets after a product-scope decision"
  - "Interpreting sparse rows or historical telemetry discrepancies"
---

# Keep recommendation closeout claims within their evidence boundaries

## Context

The recommendation roadmap mixed delivery repairs, catalogue coverage,
experimental usefulness and historical telemetry proof. Closing all four with
one success label would erase real distinctions. The October 2 owner decision
accepts missing translation, transcript, exact audio, approved fallback and
co-watch edge coverage while preserving errors and eligibility defects as issues.

## Guidance

For each ticket, name the exact path and classify each claim separately:

| Claim                        | Evidence needed                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery reliability         | Recorded final response and internal error/timeout state, plus the observation population. A fallback or HTTP 200 cannot hide an internal failure.                |
| Coverage and generator usage | Eligible card count and recorded reason/provenance. An empty row does not prove catalogue exhaustion; zero co-watch contribution does not prove delivery failure. |
| Refresh lifecycle            | Authority, generation, schedule and publication evidence. Card contribution is a different outcome.                                                               |
| Viewer usefulness            | A valid comparison with mature outcomes and uncertainty. Direct activation or observational CTR does not establish causal benefit.                                |

Historical telemetry samples need their own population, release, window and
retained membership. Aggregate equality cannot prove request membership or
acknowledgement; a digest of a sorted request set cannot recover its members.
When old joins were not retained, state that limit explicitly. New tracing may
help future investigations, but cannot retroactively fix the sample.

Cancellation records a product choice about remaining work, not successful
implementation. Link the retained behavior and identify any unmeasured outcome.
Keep fresh server errors, timeouts, failed persistence, playback failures and
reproduced language/publication/eligibility defects actionable under the
[delivery policy](../../analytics-and-recommendation-policy.md#delivery-health-and-accepted-coverage).

## When to apply

Use this split in roadmap dispositions, PR reviews and production acceptance
reports. In particular, inspect existing analytics and receipts before retiring
an expanded measurement ticket so the cancellation cannot accidentally disable
working GA/RUM, Share, search or playback signals. The
[September 29 D1–D9 record](../../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)
is an example of historical limits that remain explicit after a scope change.
