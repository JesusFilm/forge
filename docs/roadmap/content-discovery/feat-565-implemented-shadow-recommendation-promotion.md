---
id: "feat-565"
title: "Activate implemented co-watch and MMR with owner approval"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-29"
duration: 8
depends_on:
  - "feat-563"
blocks:
  - "feat-573"
tags: [admin, recommendations, cowatch, experiments, ranking]
---

## Current production disposition

**The G5 replacement is revoked as of September 30 00:22:59.967 UTC; co-watch/MMR
is not currently eligible to serve.** It activated normally at 00:17:30.177 UTC,
then lost authority to another `eligibility_changed` invalidation. All 20 immediate
captured-source successors kept the same positive effective decision and changed
population measurements. Repair avoidable measurement-only revision churn before
another publication. Three natural fallback diagnostics before revocation prove
missing themes only, while other required inputs were available; the conditional
catalog read then refused revoked authority. Existing cards continued on fallback.
No direct co-watch execution has been observed. Feat-573 owns automatic refresh for
expiry and legitimate source changes. Full shadow acceptance, causal usefulness,
broader ranking inputs and dormant exposure coverage remain separate open work.

This ticket remains in progress: the bounded natural window through 23:10:08 UTC
contained 38 issued requests but no exact direct owner provenance. Eight shared
fallback markers comprised seven missing-composition-input reasons and one sparse
co-watch reason. Investigate the missing input before declaring the rollout
verified; failed owner composition persists the incumbent platform, so those
historical rows cannot identify the missing attempted input. Full evidence and its
attribution limits are in the activation operation record.

## Problem

The owner requested live use of implemented shadow work on September 29.
Co-watch and the source/interest/theme MMR composer exist only in shadow;
ordinary profile personalization already participates in live delivery.
The remaining learned/candidate roadmap is unimplemented and cannot be enabled
by flags. This ticket owns exact runtime/manifest integration and governed
promotion of the implemented policies, not a blanket readiness declaration.

## Entry Points — Read These First

1. `docs/plans/2026-09-30-001-feat-owner-approved-cowatch-live-plan.md` — current
   direct activation contract. The September 29 plan remains historical study
   implementation context; its trial prerequisites are superseded below.
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
- Publish exact owner-approved direct authority for the implemented MMR input
  contract; missing editorial/series/speaker inputs remain under feat-393.
- Bind source qualification, approved configuration, execution, refresh, expiry
  and rollback without creating a study or claiming measured usefulness.
- Preserve the optional study facility and historical evidence dispositions.

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
- Fresh scoped storage and operational readiness; supported recent-auth direct
  activation, exact operation reconciliation, graph replacement and stop.
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

## September 30 direct activation decision

The owner explicitly approved activating co-watch/MMR without a trial: “I don't
think we need a trial lets just activate it you have my approval to do so.”
This supersedes the A/A and controlled-efficacy prerequisite for this deployment.
It does not create missing graph data or waive privacy, source integrity, access
control, bounded storage/work, truthful provenance, fallback or rollback.
Implement an explicit owner-approved direct activation path through the normal
reviewed PR-to-main flow; do not manufacture a passed study or edit production
SQL to impersonate existing trial authority. Retain controlled usefulness work
as follow-up evidence, not a blocker imposed contrary to this decision.

The full feat-387 shadow acceptance and feat-505 controlled usefulness gates no
longer block this direct release. Their reverse dependency entries are removed;
real graph source qualification, Admin inspection and supported runtime execution
remain required within this ticket. Neither upstream ticket is falsely completed.

The current production operator cannot directly activate this bundle: its live
authority requires a study, a frozen qualified graph and composition authority.
The fresh production check at September 29 18:35 UTC still found all eight new
authority tables empty. This ticket remains in progress while the direct path
and actual graph/runtime readiness are implemented and verified.

The initial direct operator provides explicit graph replacement and honest
expiry/fallback. Sustainable bounded automatic refresh is tracked by feat-573;
report the exact initial graph deadline rather than implying perpetual graph
coverage from a single activation.

Local direct-path implementation and reviewed validation are recorded in
`docs/operations/recommendation-owner-live-activation-2026-09-30.md`. This does not
claim production activation or close this ticket.

## September 30 production confirmation blocker

PR #2478 merged as `85656b946c7519cb39d501d44ce6d1d998ec7d9b` through the
normal release flow. The supported direct operator is implemented, superseding
the earlier study-only operator limitation above. Activation is not yet recorded.

The production emergency-stop control opened a native `window.confirm` prompt
that the in-app browser did not expose. A fresh authenticated Admin inspection
still showed pointer generation 1 at control with no committed stop audit. The
original user tab recovered after a normal reload; no transition remained pending.
The user's explicit activation approval remains valid; this is an inaccessible
product confirmation, not a new authorization requirement.

Replace that native prompt with an accessible in-page confirmation for stop,
clear, rollback and permanent-default actions. Keep the exact confirmation text,
explicit Confirm/Cancel, generation and CSRF checks, permission enforcement and
unknown-acknowledgement handling. Confirm must submit at most once; cancel must
not issue a mutation. Record the actual deployed operator outcome separately.
The ticket remains **in progress**, including fresh capacity coordination: the
September 29 21:25 UTC observation had 8.612 GB free, 1.074 GB resident WAL and one long
transaction, and did not satisfy the prior seven-day runway projection.

## September 30 canonical-origin blocker

PR #2488 merged as `3abde2aa564e30c16631979b5d9403fc4c265403`; both Admin
processes and compatible Watch were healthy at September 29 22:02 UTC. Exact
0116/0117/0118 catalog and deployed publication-source checks passed. The earlier
21:25 capacity concern is historical: the 21:47 observation restored 10.659 GB
free and a conservative 7.835-day projection, without credit for future savings.
Fresh admission remains necessary at actual publication.

The in-page confirmation now works, but the supported POST was rejected by the
CSRF guard before mutation. A canonical-origin unauthenticated diagnostic confirms
`csrf_failed`; the client mislabeled this as a role refusal. Repair the exact
canonical-origin check and error distinction under this ticket, retaining all
operator authorization. Pointer generation remains 1/control, no graph has been
published and no owner release is active.

## September 30 successful direct cutover

The normal release chain was #2478 (direct authority), #2488 (accessible controls)
and #2494 (canonical-origin CSRF repair). Subsequent compatible storage release
#2495 ran on both healthy Admin roles during cutover; Watch remained healthy at
`0a707123`. Supported stop/clear retired the empty bootstrap, with immutable
G2/G3 audits. Two exact-source publication refusals wrote no graphs. A focused
read-only diagnostic proved clock-dependent discovery-link expiry can change
identity without counts; a reviewed one-use fresh-preflight/publication handoff
retained all source, byte, transaction and process bounds and the exact generation
recheck.

The published graph contains 6,680 qualified sources, 35,632 contributions and
9,000 edges (613 supported), from the original fixed seven-day window.
Release `4459344d-202b-4665-aab3-75fa17920c10` selected graph
`7a0df065a6562c562ea49809e4db4fd68d3a112729368bcfd0033679ea7270fa` through
recent-authenticated Admin. The active response and reloaded G4 serving pointer
agree. No study assignment, synthetic viewer evidence or causal PASS was created.
Native production-shaped fixtures cover direct execution, source/privacy fencing,
replacement and rollback; production supported stop/clear was observed before
activation. We did not stop the newly activated release merely to manufacture a
production rollback sample.

Exact evidence and remaining natural issuance disposition:
`docs/operations/recommendation-owner-live-activation-2026-09-30.md`.

## October 1 restoration

The exact first retained G6 successor reproduces the historic eligibility digest
format without `directInfluenceAllowed`; it precedes invalidation by 11 ms. The
compatibility repair retains full source/actor/policy/expiry/watermark/decision
guards, and unmatched changes continue to revoke. Missing theme input is a
separate metadata/composition defect. Revoked G4/G5/G6 audit history is preserved.

See `docs/validation/cowatch-restoration-20261001/production-investigation.md`
for bounded evidence and its limits, and
`docs/operations/recommendation-cowatch-refresh-2026-10-01.md` for the normal
PR/autodeploy and owner activation sequence. Feat-573 owns bounded refresh.
The no-study authorization above remains applicable. Record supported activation
and exact observed serving provenance, distinguishing actual contribution from
successful incumbent fallback.

## October 2 owner disposition

The restoration task recorded G7 activation and refresh authorization in
[PR #2530](https://github.com/JesusFilm/forge/pull/2530). For delivery readiness,
apply `docs/analytics-and-recommendation-policy.md#delivery-health-and-accepted-coverage`.
Sparse coverage and zero observed co-watch cards are accepted outcomes when the
normal fallback works; positive co-watch contribution is not a gate on proceeding.
Keep provenance observations truthful and operational verification separate from
delivery defects. This policy clarification does not certify a later refresh
or change release authority.
