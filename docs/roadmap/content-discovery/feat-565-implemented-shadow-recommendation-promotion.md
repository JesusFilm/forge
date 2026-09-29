---
id: "feat-565"
title: "Promote implemented co-watch and MMR policies through controlled evidence"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-29"
duration: 8
depends_on:
  - "feat-387"
  - "feat-505"
  - "feat-563"
blocks: []
tags: [admin, recommendations, cowatch, experiments, ranking]
---

## Problem

The owner requested live use of implemented shadow work on September 29.
Co-watch and the source/interest/theme MMR composer exist only in shadow;
ordinary profile personalization already participates in live delivery.
The remaining learned/candidate roadmap is unimplemented and cannot be enabled
by flags. This ticket owns exact runtime/manifest integration and governed
promotion of the implemented policies, not a blanket readiness declaration.

## Entry Points — Read These First

1. `docs/plans/2026-09-29-003-feat-shadow-recommendations-live-plan.md` — bounded
   population, dispatch, study lifecycle, serving integration and evidence gates.
2. `apps/admin/src/services/recommendations/delivery.service.ts` and
   `apps/admin/src/services/recommendations/delivery.factory.ts` — existing semantic/profile serving and total deadline.
3. `apps/admin/src/services/recommendations/promotion/manifest.ts` and
   `apps/admin/src/services/recommendations/experiment/assignment.ts` — exact existing two-generator hybrid allowlist.
4. `apps/admin/src/services/recommendations/cowatch/candidate.service.ts` —
   historical shadow context and generation/privacy checks.
5. `apps/admin/src/services/recommendations/shadow-evaluation/slate-composer.ts`
   and `apps/admin/src/services/recommendations/shadow-evaluation/projection.ts` — bounded MMR and separately pending composition decision.
6. `docs/operations/recommendation-usefulness-evaluation-2026-09-15.md` — study
   identity, mature outcomes, calibration and operational evidence.

## Grep These

`semantic-profile-hybrid-v1|cowatch_controlled_evaluation_required|source-interest-theme-mmr-shadow-v1|profile-usefulness-assignment-v1|qualified-view-any-observed-mode-v2`

## What To Build

- Add bounded live co-watch nomination and explicit new manifest/generator-set
  identity without changing the existing hybrid manifest's meaning.
- Publish a separate exact composition decision and governed live composer for
  the implemented MMR input contract; missing editorial/series/speaker inputs
  remain explicit under feat-393.
- Bind study preparation, assignment, executed policy, mature evaluation,
  external guardrails, approval and rollback to the same immutable configuration.
- Advance through actual shadow and controlled evidence; retain terminal
  inconclusive/data-unhealthy/refusal outcomes honestly.

## Constraints

- No new feat-373 prerequisite for feat-505; preserve dormant coverage decision.
- Preserve the September 10 analytics/profile enablement policy, explicit viewer
  disable/reset/deletion, privacy fences, retention and machine exclusion.
- Do not broaden source/pair limits, reinterpret legacy PASS as usefulness,
  fabricate approvals, manually repair production SQL or manually deploy code.
- Storage owner clears exact finite workload and owns loaded-retention proof.
- A combined-policy study measures that bundle, not isolated component effects.

## Verification

- Native database concurrency, lineage, privacy, publication and rollback tests.
- Exact manifest/runtime/evaluation mismatch and stale authority refusal tests.
- Actual browser attribution, bounded load comparisons and Admin reconciliation.
- Fresh scoped storage and operational readiness; naturally mature controlled
  results and supported recent-auth permanent-default operation.
- Close only when both declared policies have the recorded live disposition and
  rollback evidence; code deployment alone is insufficient.

## September 29 integration

The integrated implementation adds `cowatch/live.service.ts`, immutable frozen
trial authority, separate `composition/` qualification, governed study operators
and `delivery-trial.service.ts`. The exact bundle manifest combines at most 64
nominations and serves at most six results under the existing request deadline.
Authority is checked again at issuance; source or composition failure serves the
assigned incumbent with an explicit fallback record. The initial shadow sample,
including an empty cohort, is immutable and cannot shrink to hide retained-data
loss. No registry insertion enrolls viewers or changes the default policy.

Local evidence and the release sequence are in
`docs/operations/recommendation-controlled-live-integration-2026-09-29.md`.
Production qualification and usefulness remain open. A frozen trial graph expires
at its declared horizon; a permanent default also needs a reviewed refresh and
requalification policy informed by the controlled result. Keep this ticket in
progress until actual live dispositions and rollback evidence exist.

## Reviewed integration release

[PR #2470](https://github.com/JesusFilm/forge/pull/2470) merged as
`0a70712399bf99e10d88477b98cc34c8ababcc6b`. The production Admin/worker health
and bounded 0107–0110 catalog checks passed; all eight new authority tables were
empty, with no activated study or graph trial authority. See the release and
capacity sections of
`docs/operations/recommendation-controlled-live-integration-2026-09-29.md` for
exact observations and remaining gates. Implementation and deployment do not
complete production shadow acceptance, mature usefulness evidence or live
promotion. This ticket remains **in progress**.
