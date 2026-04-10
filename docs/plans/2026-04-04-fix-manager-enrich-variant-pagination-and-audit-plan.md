---
title: "fix: Manager enrich variant pagination truncation and pagination audit"
type: fix
status: completed
date: 2026-04-04
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# fix: Manager enrich variant pagination truncation and pagination audit

## Overview

Fix the manager enrich flow so source selection sees the full set of video variants instead of Strapi's silently truncated default subset. While doing that, audit the rest of `apps/manager` for similar GraphQL pagination mistakes, especially nested relations that omit explicit `pagination`.

This plan is intentionally narrow:

- fix the confirmed correctness bug in `/api/enrich`
- audit manager GraphQL entrypoints for the same failure mode
- patch any directly adjacent pagination drift discovered in the audit
- do not redesign the coverage UI or enrichment product behavior here

## Problem Statement / Motivation

The manager enrich route currently queries:

- [`apps/manager/src/app/api/enrich/route.ts`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/enrich/route.ts)

with a nested GraphQL field:

```graphql
variants {
  ...
  downloads(pagination: { limit: -1 }) { url }
}
```

On Strapi v5, nested relations without explicit pagination default to `limit: 10`. That means the route only sees the first 10 variants for a video, even when the CMS record contains many more.

Confirmed local repro on April 4, 2026:

- video: `3_0-40DWJ_36-0-0`
- title: `Day 36: Crucified`
- direct DB query shows `26` variants, including:
  - English `3_529-0-40DWJ_36-0-0`
  - Spanish `3_21028-0-40DWJ_36-0-0`
  - French `3_496-0-40DWJ_36-0-0`
- manager's actual GraphQL route query only returned `10` variants, omitting `en`, `es`, and `fr`

User-visible effects:

- enrichment can pick the wrong source language
- enrichment can report `No downloadable source available in a Mux-supported language` even when English or Spanish is present
- source-language selection appears inconsistent with the CMS record and the public website

## Relevant Research

### Internal learning

- [`docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md)

Key point from that solution:

- Strapi v5 GraphQL silently truncates nested relations to `10` items unless explicit `pagination` is passed

### Related brainstorm

- [`docs/brainstorms/2026-04-02-manager-coverage-query-performance-requirements.md`](/Users/o/.codex/worktrees/1ec2/forge/docs/brainstorms/2026-04-02-manager-coverage-query-performance-requirements.md)

That brainstorm is mostly about `/api/videos`, but it reinforces the same operational theme:

- manager endpoints should not rely on accidental GraphQL defaults for large relation sets

## Audit Findings In Manager

### Confirmed nested-relation bug

- [`apps/manager/src/app/api/enrich/route.ts`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/enrich/route.ts)
  - `variants` is missing explicit pagination
  - this is the active bug to fix now

### GraphQL entrypoints already guarded

- [`apps/manager/src/lib/state.ts`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/state.ts)
  - `parents(pagination: { limit: -1 })`
- [`apps/manager/src/app/dashboard/jobs/page.tsx`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/dashboard/jobs/page.tsx)
  - `parents(pagination: { limit: -1 })`
- [`apps/manager/src/app/dashboard/jobs/[id]/page.tsx`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/dashboard/jobs/[id]/page.tsx)
  - `parents(pagination: { limit: -1 })`
- [`apps/manager/src/app/api/coverage-snapshots/route.ts`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/coverage-snapshots/route.ts)
  - top-level pagination is explicit, and there are no nested relation reads in the critical payload

Audit result after implementation:

- no additional unsafe nested collection relations were found in the current manager GraphQL entrypoints
- adjacent top-level language queries remain bounded by their current usage and were not changed in this fix

### Adjacent pagination drift to check while in here

- [`apps/manager/src/app/dashboard/jobs/page.tsx`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/dashboard/jobs/page.tsx)
  - `languages(pagination: { pageSize: 100 })`
- [`apps/manager/src/app/dashboard/jobs/[id]/page.tsx`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/dashboard/jobs/[id]/page.tsx)
  - `languages(pagination: { pageSize: 100 })`
- [`apps/manager/src/app/api/enrich/route.ts`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/enrich/route.ts)
  - `languages(pagination: { pageSize: 10 })`

These are not the same nested-relation bug, but they are similar pagination assumptions that can silently truncate results when the query expects "all matching languages."

## Proposed Solution

### 1. Fix `/api/enrich` to fetch all variants explicitly

Update `GET_VIDEOS_WITH_MUX` so the route reads:

```graphql
variants(pagination: { limit: -1 }) {
  ...
  downloads(pagination: { limit: -1 }) { url }
}
```

Why:

- the route already limits top-level videos to the selected set
- `videoIds` is capped at `100`
- enrich is a selection-time workflow, not a hot dashboard preload
- correctness matters more than shaving a few relation rows here

### 2. Preserve the current source selection policy, but give it complete input

Do not change the recently added language priority policy in this fix. The bug is upstream of the policy:

- requested supported target language
- then `en`
- then `es`
- then `fr`
- then any other Mux-supported language

Once all variants are present, that policy should behave deterministically.

### 3. Audit all manager GraphQL operations for missing nested pagination

During implementation, inspect every `graphql(...)` operation under `apps/manager/src` and classify each relation field as one of:

- explicit `pagination` present
- safe scalar/object field with no collection pagination needed
- missing `pagination` on a collection relation and therefore unsafe

Any newly discovered unsafe nested collection relation should be fixed in the same PR if:

- it is low-risk
- it is in manager
- it follows the same pattern as the enrich fix

If an additional issue is discovered but is not safe to broaden into this PR, document it in `todos/` with reproduction details and file references.

### 4. Tighten pagination assumptions on language lookups

As part of the audit, decide whether the current language label queries should:

- remain fixed-size because the UI only needs a bounded set, or
- switch to an explicit "fetch all relevant labels" pattern

Expected default here:

- keep the PR primarily about the enrich variant truncation
- only change the jobs/enrich language queries if the audit shows they are actually truncating real manager behavior today

## Technical Considerations

- Strapi v5 nested relation default limit is the critical behavior here, not a CMS data bug
- top-level `pageSize: 100` on `videos` is acceptable because the request schema already caps `videoIds` at `100`
- `limit: -1` on `variants` is safe here because the route is scoped to a user-selected list, not the full library
- the route should keep `fetchPolicy: "no-cache"` so selection-time enrich sees the latest CMS shape

## Implementation Plan

### Phase 1: Reproduce and lock the bug with tests

- Add or extend route/service-level coverage so a video with more than 10 variants and a late-position English variant is represented correctly
- Capture the exact failure mode:
  - query result omits English before fix
  - source selection fails or picks the wrong language
- Preferred test surface:
  - route-level query shape assertion if practical
  - otherwise a focused integration-style test around route -> stage clone selection

### Phase 2: Fix enrich query pagination

- Modify [`apps/manager/src/app/api/enrich/route.ts`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/enrich/route.ts)
- add `pagination: { limit: -1 }` to `variants`
- keep `downloads(pagination: { limit: -1 })`
- rerun the known repro for `3_0-40DWJ_36-0-0`

### Phase 3: Audit manager GraphQL entrypoints

- inspect all `graphql(...)` operations under `apps/manager/src`
- verify collection-valued nested relations use explicit pagination
- record one of:
  - no further unsafe nested relations found
  - additional unsafe nested relations fixed
  - additional unsafe nested relations deferred into explicit todos

### Phase 4: Verification and browser QA

- Browser QA:
  - open coverage
  - select English
  - enrich `Day 36: Crucified`
  - confirm the job is created instead of failing unsupported
- API/metadata QA:
  - inspect job `materialization`
  - confirm:
    - `sourceLanguageCode: "en"` or the expected deterministic fallback
    - `sourceSelectionReason` is truthful
    - no false unsupported error
- Regression QA:
  - confirm videos with truly unsupported source sets still fail cleanly

## SpecFlow / Edge Cases

- video has >10 variants, with the best candidate beyond the first 10
- video has >10 variants and multiple fallback candidates (`en`, `es`, `fr`) beyond the first 10
- video has no downloadable MP4 even after full variant expansion
- video has many variants, but only unsupported languages
- selected batch contains:
  - one fixed video that now succeeds
  - one truly unsupported video that still fails

## Acceptance Criteria

- [x] `/api/enrich` fetches all variants for selected videos instead of relying on Strapi nested defaults
- [x] `3_0-40DWJ_36-0-0` no longer fails with `No downloadable source available in a Mux-supported language` when English is requested
- [x] source selection uses the full variant set and records truthful source metadata
- [x] manager GraphQL entrypoints have been audited for similar nested collection pagination mistakes
- [x] any additional unsafe manager query discovered during the audit is either fixed in the same PR or documented in `todos/`
- [x] automated tests cover the regression
- [x] browser QA confirms the real user flow

## Success Metrics

- Known repro video enriches successfully when a valid English source exists
- No more contradiction between:
  - public site availability
  - local CMS data
  - manager enrich behavior
- manager audit yields a clear list of safe vs unsafe GraphQL relation reads

## Implementation Notes

- The exact `3_0-40DWJ_36-0-0` repro moved forward from the false unsupported-source error to the separate pre-existing job creation bug documented in [`todos/010-pending-p1-enrich-job-creation-invalid-relations-for-some-video-ids.md`](/Users/o/.codex/worktrees/1ec2/forge/todos/010-pending-p1-enrich-job-creation-invalid-relations-for-some-video-ids.md).
- Browser QA used sibling `40 Days with Jesus` episode `3_0-40DWJ_08-0-0`, which has the same 52-variant shape and now enriches successfully through the coverage UI with English selected.

## Dependencies & Risks

### Risks

- adding `limit: -1` to a nested relation can increase payload size
- broadening the audit too far could turn a surgical bug fix into a pagination cleanup PR

### Mitigations

- keep the fix scoped to selected videos only
- do not reopen full-library query work in this PR
- treat the audit as "fix nearby issues if trivial, document the rest"

## References & Research

- [`docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md)
- [`docs/brainstorms/2026-04-02-manager-coverage-query-performance-requirements.md`](/Users/o/.codex/worktrees/1ec2/forge/docs/brainstorms/2026-04-02-manager-coverage-query-performance-requirements.md)
- [`apps/manager/src/app/api/enrich/route.ts`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/enrich/route.ts)
- [`apps/manager/src/services/stageClone.ts`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/stageClone.ts)
- [`apps/manager/src/lib/mux-language.ts`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/mux-language.ts)
