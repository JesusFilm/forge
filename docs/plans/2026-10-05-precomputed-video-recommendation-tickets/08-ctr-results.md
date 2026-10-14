---
date: 2026-10-05
draft_id: "08"
title: "Publish durable CTR results without activating a winner"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2573
roadmap: feat-590
draft_blocked_by: ["07"]
---

# 08: Publish durable CTR results without activating a winner

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

Evaluate the frozen experiment from qualified visit/click evidence and expose a
versioned report in Admin and through an authenticated AI read contract. Report
a clear winner only under the predeclared policy; otherwise report inconclusive.

Retain the result and sufficient compact measurement state so a long test remains
valid after ordinary raw-event expiry.

## Acceptance criteria

- [ ] Primary CTR is distinct clicked eligible visits divided by all eligible visits in each assigned arm. Empty results, technical failures, and fallbacks remain in that arm's denominator.
- [ ] Store a versioned stopping policy before public test start, including inference method, repeated-browser clustering, sample/duration requirements, detectable uplift, late-event cutoff, and measurement-health criteria.
- [ ] Numeric settings are derived from the measured human baseline and agreed before live activation. Fixtures can test explicit settings but cannot stand in for that launch decision.
- [ ] Reports include counts, CTR and uncertainty, secondary card CTR, exclusions, fallback rates, evidence loss/health, fixed cohort/window, generation/control identity, policy version, and winner/inconclusive outcome.
- [ ] Invalid tracking, insufficient sample, or an unmet stopping rule cannot produce a certified winner from a numerical lead. Treat repeated browser visits consistently with the chosen inference method.
- [ ] Compact sufficient statistics preserve counts, attribution, retry deduplication, late-event handling, and the selected uncertainty method across the 29-day raw lifecycle. Do not silently retain raw events longer.
- [ ] Evaluation revisions are addressable and bounded; late accepted evidence produces explicit revisions under the policy rather than silently rewriting a reviewed result.
- [ ] Admin and authorized AI reads return the same result. Build, evaluation, and result-read operations cannot activate or promote a generation.
- [ ] Tests cover a clear win, loss, tie/inconclusive, multiple visits per browser, missing impressions, fallback, exclusions, tracking failure, replay, and late evidence.
- [ ] Native expiry/reconciliation tests prove raw-to-aggregate count agreement and retained report validity after raw cleanup.

## Implementation context

Extend existing experiment evaluation and reporting patterns, which currently
provide A/A health evidence rather than this CTR decision. The method's aggregate
state must be justified by the selected inference model, not assumed to be two
global counters. Warehouse export remains excluded.

## Blocked by

- #2572

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
