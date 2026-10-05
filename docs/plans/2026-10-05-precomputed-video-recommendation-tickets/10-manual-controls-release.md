---
date: 2026-10-05
draft_id: "10"
title: "Control A/B launch, promotion, and rollback manually"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2575
roadmap: feat-590
draft_blocked_by: ["09"]
---

# 10: Control A/B launch, promotion, and rollback manually

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

Complete the authorized Admin and agent control path for starting a prepared A/B
test, later promoting a specifically reviewed result, and returning immediately
to the incumbent. Rehearse the complete flow in an isolated environment and make
missing live prerequisites visible to the operator.

These controls deliver the experiment's reversibility; implementing or verifying
them does not authorize a production deployment or public activation.

## Acceptance criteria

- [ ] Public A/B start is an explicit authorized operation requiring a complete generation, fixed source cohort/control identity, stable assignment, predeclared stopping policy, measurement readiness, and storage capacity evidence.
- [ ] First A/B start does not require a winner report that can only exist after the test. Promotion after evaluation does require explicit identification of the reviewed experiment, evaluation revision, and generation.
- [ ] Authorized Admin operators and agents use the same control semantics, with auditable state changes and stale/incompatible target rejection. Content-generation tools cannot activate themselves.
- [ ] A build finishing, a report being read, or a winner being computed never changes serving state. Inconclusive evidence keeps the incumbent.
- [ ] A rollback restores incumbent selection without deleting experiment evidence or requiring another model build. Existing visibility, availability, admission, and retention protections continue to apply.
- [ ] Private generation refresh can continue without changing the first test's frozen generation. Recurring scheduling remains disabled until the user chooses cadence after the actual first-build cost report.
- [ ] Isolated end-to-end rehearsal covers Admin review, both Watch arms, bot/empty/fallback cases, exact primary counts, evaluation, explicit activation, rollback, and denied activation.
- [ ] Readiness reporting distinguishes code/fixture verification from outstanding warehouse/model access, current traffic/bot-signal audit, numeric policy agreement, physical headroom proof, and the first actual catalog run.
- [ ] The run procedure explains how to obtain the real cost/coverage report once access is configured and how to request later manual activation, without creating or messaging another chat.
- [ ] Touched-scope checks, generated-contract drift, native database behavior/capacity checks, and browser loading verification pass. All deployments follow normal PR-to-main; no direct production deployment occurs.

## Implementation context

Keep the incumbent intact and keep additive/mixed readers while experiment data
is retained. Record how to disable and later remove experiment components safely.
Publication of code or completion of this ticket is not a public-traffic switch.

## Blocked by

- #2574

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
