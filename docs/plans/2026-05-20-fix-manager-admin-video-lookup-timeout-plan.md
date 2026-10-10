---
title: Fix Manager Admin Video Lookup Timeout
type: fix
status: completed
date: 2026-05-20
---

# Fix Manager Admin Video Lookup Timeout

## Summary

Reduce the admin `videosByCoreIds` lookup latency used by manager enrichment dispatch so transcript retries do not fail at manager's 10 second admin-fetch timeout. Keep the manager/admin trigger contract unchanged and make the fix observable with a slow-lookup breadcrumb.

## Problem Frame

Production enrichment retries showed manager returning 502 after roughly 10010ms while admin GraphQL logged aborted `videosByCoreIds` requests near 9975ms. The trigger path needs only primary-language dispatch fields, but admin was loading full relation graphs for every video in the batch before filtering in application code.

## Requirements

- R1. Preserve the existing `videosByCoreIds` response contract for manager enrichment dispatch.
- R2. Avoid loading all dubs/subtitles relation rows for each requested core ID.
- R3. Preserve missing-artifact behavior: absent mux asset IDs or subtitle URLs still surface as null fields.
- R4. Add regression coverage that proves the lookup uses a targeted projection and keeps existing normalization rules.
- R5. Add a production-safe breadcrumb for slow lookups without printing secrets.

## Scope Boundaries

- Do not change manager enrichment job semantics, queue behavior, or retry batch policy in this fix.
- Do not backfill missing mux/subtitle data; validation failures from missing media metadata remain separate data follow-up.
- Do not change scene embedding retry behavior or the admin embedding pipelines.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/services/video.service.ts` owns `getByCoreIds`, the service method behind admin GraphQL `videosByCoreIds`.
- `apps/admin/src/services/video.service.test.ts` contains feat-125 manager admin-trigger lookup coverage.
- `apps/manager/src/lib/admin-video-lookup.ts` sets the manager admin lookup timeout and reports admin lookup failures back to trigger routes.
- `apps/admin/src/services/manager-trigger.service.ts` converts manager HTTP failures into `DISPATCH_FAILED` trigger report items.

## Key Technical Decisions

- Use a single SQL projection for enrichment dispatch fields: the trigger needs video ID, core ID, label, primary language, primary-language mux asset ID, and primary-language subtitle URL, not the full Prisma relation graph.
- Keep the raw SQL inside `VideoService.getByCoreIds`: this preserves the GraphQL/service contract and avoids widening manager coupling to admin persistence details.
- Prefer the same subtitle selection score as the old implementation: primary subtitles first, then non-AI over AI when possible.

## Implementation Units

### U1. Replace Relation-Graph Lookup With Targeted Projection

**Goal:** Query only the fields manager needs for enrichment dispatch.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/services/video.service.ts`
- Test: `apps/admin/src/services/video.service.test.ts`

**Approach:**

- Replace the Prisma `video.findMany(...include...)` relation graph load with a `$queryRaw` projection.
- Use `LEFT JOIN LATERAL` subqueries to pick at most one primary-language mux asset and one primary-language subtitle per video.
- Keep soft-delete and empty-string filtering in SQL so missing artifact fields remain null.

**Execution note:** Characterization-first: preserve the existing test cases for null/empty mux and subtitle values, label normalization, cap validation, and duplicate input handling.

**Patterns to follow:**

- `apps/admin/src/services/video.service.test.ts` existing feat-125 tests.

**Test scenarios:**

- Happy path: fully populated row returns the same dispatch fields as before.
- Edge case: no primary language, no mux asset, or no subtitle returns null fields.
- Edge case: empty mux asset ID and empty subtitle URL normalize to missing.
- Regression: service does not call `video.findMany` for `getByCoreIds` and the SQL includes targeted `video_dub` and `video_subtitle` projections.

**Verification:**

- Admin service tests pass for `video.service.test.ts`.

### U2. Add Slow Lookup Breadcrumb

**Goal:** Make future production latency regressions visible without exposing secrets.

**Requirements:** R5

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/services/video.service.ts`
- Test: `apps/admin/src/services/video.service.test.ts`

**Approach:**

- Measure wall-clock duration around the targeted lookup.
- Emit a concise warning only when duration crosses a small threshold, including core ID count and duration only.

**Test scenarios:**

- Test expectation: none for logger timing; this is a diagnostic breadcrumb and the existing behavior contract remains covered by service tests.

**Verification:**

- Typecheck and lint pass with the new helper.

## System-Wide Impact

- **Interaction graph:** Admin GraphQL `videosByCoreIds` remains the manager lookup endpoint; manager route contracts do not change.
- **Error propagation:** Faster admin lookup should reduce manager 502 timeout failures; real missing media metadata still returns validation failures.
- **State lifecycle risks:** Read-only query; no writes or migrations.
- **API surface parity:** Response shape is unchanged.

## Risks & Dependencies

| Risk                                        | Mitigation                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Raw SQL drifts from Prisma schema names     | Cover query shape in tests and keep table/column names aligned with `apps/admin/prisma/schema.prisma`. |
| Subtitle/mux selection changes subtly       | Preserve primary-language filtering and subtitle preference scoring from the old service behavior.     |
| Timeout failures continue for another cause | Slow-lookup breadcrumb narrows whether admin lookup latency is still the bottleneck after deploy.      |

## Verification

- `pnpm --filter @forge/admin test -- src/services/video.service.test.ts src/graphql/schema.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
