# feat-373: active hero authority and policy-isolated inspection

Status: implementation follow-up; production acceptance remains parent-owned.

Parent deployment acceptance at `811f1ec81` found the active home hero still
emitting v1 while authored placements emitted v2. Source inspection establishes
that the hero candidate union can exceed 100: its seven-card initial queue draws
from pools whose child counts are uncapped. The production candidate count has
not been queried. A chapters placement filter still returned a mixed v1/v2
128-row truncated report, preventing policy-isolated acceptance.

## Changes

- Cache compact origin-signed hero entries for all eligible source paths. Share
  configuration, expiry and catalog source digest; authenticate each singleton
  using the existing full-manifest HMAC. Each activation submits exactly the
  currently rendered CTA at slot zero. Keep the existing 100-item issuer limit,
  strict verifier, TTL, admission and identity boundaries.
- Reset the external-root measurement controller on active slide identity and
  canonical path changes. Preserve carousel DOM, focus, media and timeline
  state; autoplay/time query changes and duration corrections do not create
  extra delivery windows. Reconcile anchor changes synchronously on selection.
- Add optional Admin policy selection to an exact registered exposure filter.
  Bind the policy in both cohort and ranked SQL before the unchanged 128+1
  sentinel. Invalid or ambiguous selectors withhold exposure queries. Keep
  overview, signed replay window and query budgets unchanged.

## Verification and handoff

Cover over-100 catalogs, every eligible source class, duplicate paths, tampering,
empty/unknown targets, active transitions and duplicate-path slide identities,
load/activation gating, focus and immediate selection. Verify policy isolation
with local PostgreSQL fixtures including a mixed report that truncates while
each policy fits. Measure catalog bytes/signing and browser startup/transition
timings against a fair control; qualify component-fixture versus full-page
evidence. Run appropriate Web/Admin checks and normal hooks, review worker
diffs, then open a focused PR and verify its exact-head CI. Parent owns merge,
normal deployment and actual authorized Admin acceptance. No production queries,
cap increases, hidden-pool inspection or registry-completeness claims here.

The user explicitly leaves fallback home carousel, fallback home grid and video
editorial coverage unresolved for this batch. Preserve registry/product behavior
and keep feat-373 in progress; this scope decision is not completion acceptance.
