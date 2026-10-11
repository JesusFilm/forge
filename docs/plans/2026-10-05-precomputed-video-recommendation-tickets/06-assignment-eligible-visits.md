---
date: 2026-10-05
draft_id: "06"
title: "Assign stable A/B arms and count eligible visits"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2571
roadmap: feat-590
draft_blocked_by: ["05"]
---

# 06: Assign stable A/B arms and count eligible visits

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

In private test mode, assign browsers to a fixed 50/50 experiment arm and record
eligible Watch visits independently of whether recommendation delivery succeeds.
Expose per-arm eligible-visit counts and delivery/coverage diagnostics in Admin.

Make the server-owned eligibility and visit identity contracts explicit before
adding clicked-visit scoring. Public A/B activation remains disabled.

## Acceptance criteria

- [ ] Experiment configuration declares its immutable generation, control algorithm configuration, source cohort, and policy versions. Ordinary control personalization and live availability checks remain intact.
- [ ] A browser keeps its arm across repeated sessions for the experiment under existing consent/measurement boundaries; the current 24-hour recommendation session alone is not treated as sufficient.
- [ ] Visit identity handles delivery retries and route navigation deterministically. Admission is independent of strategy output; repeated delivery attempts do not silently become new eligible visits.
- [ ] Later source-catalog additions remain outside both arms of the fixed test. Admin previews/test traffic and known bots/prefetch/prerender are excluded under one server-owned policy.
- [ ] Inspect available trusted bot signals, record policy/qualification, and expose unknown classification rather than claiming the current user-agent heuristic is perfect.
- [ ] Eligible visits with zero cards, errors, or incumbent technical fallback remain counted in the original assigned arm. Record actual delivery separately without duplicating verbose payloads.
- [ ] Admin reports denominators, zero-result visits, excluded/unknown traffic, and fallback/measurement availability consistently for both arms.
- [ ] The new assignment identity is for measurement only, is not a model input, and does not introduce raw cookies, IPs, or viewer identities into retained evidence.
- [ ] Native contract tests cover stickiness beyond one legacy session, retry identity, fixed cohort/generation, empty/error/fallback cases, automation exclusion, and consent boundaries.
- [ ] No migration, fixture, or configuration default starts a public test.

## Implementation context

Extend the existing experiment and evidence contracts; existing A/A/hybrid
admission is not already this experiment. Define unavailable measurement honestly
rather than certifying a denominator when persistence failed. Final inference
thresholds and public launch approval remain later inputs.

## Blocked by

- #2570

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
