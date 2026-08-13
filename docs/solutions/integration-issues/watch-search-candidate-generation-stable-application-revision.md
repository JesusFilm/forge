---
title: Keep Watch search Candidate generations compatible across unrelated Admin deploys
date: 2026-08-12
last_updated: 2026-08-12
category: integration-issues
module: admin_watch_search_candidate
problem_type: integration_issue
component: service_object
symptoms:
  - "The production Admin comparison page kept Current search valid while Candidate failed with profile_unavailable or search_failed."
  - "An unrelated Admin deployment made an otherwise unchanged evaluation candidate generation incompatible with the running application."
  - "Restoring Candidate comparison required rebuilding and repointing the evaluation generation even when the candidate query and index contracts had not changed."
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - "candidate generation lifecycle"
  - "Typesense Watch search comparison"
  - "candidate benchmark and indexing scripts"
tags:
  - "watch-search"
  - "typesense"
  - "candidate-generation"
  - "application-revision"
  - "admin-comparison"
  - "deployment-compatibility"
---

# Keep Watch search Candidate generations compatible across unrelated Admin deploys

## Problem

The private Watch search comparison could stop resolving its Candidate profile
after an unrelated Admin deployment. Candidate compatibility was coupled to the
Admin deployment revision even though a deployment can change without changing
the candidate physical schema, projection, or retrieval-field contract. The
generation resolver intentionally rejects an application-revision mismatch
(`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:332`),
so using a deploy SHA as that identity made a healthy generation appear
incompatible.

This availability bug was fixed in [PR #1919](https://github.com/JesusFilm/forge/pull/1919).
It is separate from multilingual relevance: a Candidate pane that completes can
still rank the desired video poorly.

## Symptoms

- The comparison page continued to show valid Current results while Candidate
  displayed a failure such as `profile_unavailable`. The comparison service
  deliberately executes Current independently and turns Candidate setup failure
  into only the Candidate outcome
  (`apps/admin/src/services/typesense-watch-search-comparison.service.ts:175`).
- Candidate could work immediately after generation, then fail after a later
  Admin deployment even though the Typesense collections and transcript
  projection had not changed.
- Rebuilding and repointing the Evaluation generation restored Candidate only
  until another unrelated deployment changed the compatibility identity.

## What Didn't Work

Rebuilding or repointing the Candidate generation could restore the comparison
temporarily, but it did not remove the coupling. A later unrelated deployment
could produce another identity mismatch.

Weakening the compatibility check was also the wrong repair. The strict check
prevents genuinely incompatible generations from being used and also protects
the transcript collection and projection identity
(`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:330`).
The identity needed a more accurate source, not less validation.

Treating each visible failure code as an isolated UI or admission problem also
missed the lifecycle issue. Current remaining successful was expected
fail-isolation behavior, not proof that Candidate setup had completed
(`apps/admin/src/services/typesense-watch-search-comparison.service.ts:216`).

## Solution

PR #1919 introduced one explicit compatibility identity for the Candidate
search implementation:

```ts
export const TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION =
  "watch-search-candidate/v1"
```

The source documents its lifecycle: keep this value stable across unrelated
Admin deployments and application-only ranking changes, and bump it when a
schema, projection, or retrieval-field change requires rebuilding the generation
(`apps/admin/src/services/typesense-watch-search-candidate-identity.ts:3`).

Application-side ordering has an independent identity:

```ts
export const TYPESENSE_WATCH_SEARCH_CANDIDATE_RANKING_REVISION =
  "title-and-brand-v1"
```

The benchmark stores this revision in qualification evidence. Candidate serving
requires an exact match, so old ranking evidence cannot authorize the new
ranker even when the same physical generation is reused.

Every Candidate boundary obtains its application revision from the shared
helper:

- Candidate indexing and publication store the stable revision with the
  generation
  (`apps/admin/src/scripts/index-typesense-watch-search-candidate.ts:598`).
- The private comparison resolves the Evaluation generation with the same
  revision
  (`apps/admin/src/services/typesense-watch-search-comparison.service.ts:300`).
- Candidate benchmarking and qualification resolve and record the same identity
  (`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:813`).
- Candidate serving passes the same revision to serving-profile resolution
  (`apps/admin/src/services/index.ts:170`).

After deployment, a fresh Candidate generation was built with
`watch-search-candidate/v1` and selected for Evaluation. During authenticated
production QA on 2026-08-12 in the session that produced this learning, five
multilingual queries—`耶稣`, `耶穌`, `イエス`, `Иисус`, and `يسوع`—were
submitted through the real comparison page; both Current and Candidate
completed for every query. This session-observed result verified
frontend-to-backend Candidate availability. It did **not** verify relevance:
the same QA run observed no Traditional Chinese Candidate results and weaker
Japanese and Russian ranking than Current.

## Why This Works

`applicationRevision` represents Candidate collection compatibility, not the
currently deployed Admin build or application-side ordering. Unrelated
deployments and ranking changes keep `watch-search-candidate/v1`, so they can
continue using collections built for that physical contract. A deliberate
physical-contract change still requires changing the constant, which makes the
existing strict generation check reject stale generations until compatible
collections are rebuilt
(`apps/admin/src/services/typesense-watch-search-candidate-identity.ts:4`,
`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:332`).

Ranking qualification remains fail-closed: passing evidence uses the v2
qualification envelope, carries the exact ranking revision, and serving
resolution rejects legacy evidence that lacks that identity.

The safety model remains intact. Candidate identity must still match its lease
on generation ID, application revision, transcript collection, and transcript
projection revision (`apps/admin/src/services/typesense-watch-search-profile.ts:291`).
Only the unstable source of the application revision changed; compatibility
and lease checks were not bypassed.

## Prevention

- Keep one source of truth for Candidate compatibility. The regression test
  changes `RAILWAY_GIT_COMMIT_SHA` and proves the Candidate revision remains
  `watch-search-candidate/v1`
  (`apps/admin/src/services/typesense-watch-search-candidate-identity.test.ts:10`).
- Guard every Candidate boundary against reintroducing deploy-SHA coupling.
  The focused test reads indexing, benchmark, comparison, and serving sources,
  requires the shared helper, and rejects known deployment-revision environment
  variables
  (`apps/admin/src/services/typesense-watch-search-candidate-identity.test.ts:20`).
- Retain an end-to-end profile-resolution test across an unrelated Admin
  deployment
  (`apps/admin/src/services/typesense-watch-search-comparison.service.test.ts:134`).
- When the physical schema, projection, or retrieval-field contract changes,
  deliberately bump `TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION`
  and rebuild the generation. For application-side ranking changes, bump the
  Candidate ranking revision and rerun qualification without rebuilding
  compatible collections. Do not bump either identity for ordinary Admin
  deployments.
- Verify the deployed comparison through the authenticated production UI before
  declaring the availability bug fixed. Require both panes to complete across
  multiple scripts, while recording ranking defects separately as relevance
  work rather than reopening the lifecycle fix.

## Related Issues

- [Precomputed hybrid search serving index](../best-practices/precomputed-hybrid-search-serving-index-20260803.md)
  defines the immutable Candidate generation, Evaluation, and Serving model.
- [Candidate trigger JSONB operator precedence](../database-issues/watch-search-candidate-trigger-jsonb-operator-precedence.md)
  documents a different root cause that can surface the same
  `profile_unavailable` symptom.
- [Admin Watch search production rollout](../best-practices/admin-watch-search-production-rollout-20260720.md)
  covers the broader production-verification discipline.
