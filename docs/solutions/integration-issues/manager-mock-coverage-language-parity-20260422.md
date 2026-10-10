---
title: "Manager Mock Coverage Language Parity"
category: integration-issues
date: 2026-04-22
severity: medium
tags:
  - manager
  - mock
  - coverage
  - language-filter
  - parity
  - qa
affected_components:
  - apps/manager/src/cms/gateway.ts
  - apps/manager/src/cms/mock-seed.ts
  - apps/manager/src/cms/gateway.test.ts
  - apps/manager/src/app/api/videos/route.mock.test.ts
  - apps/manager/src/app/api/videos/route.ts
related_docs:
  - docs/plans/2026-04-22-feat-manager-single-process-mock-cms-mode-plan.md
  - docs/roadmap/platform/feat-106-manager-single-process-mock-cms-mode.md
  - docs/solutions/performance-issues/manager-video-coverage-sql-aggregation-20260402.md
  - docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md
---

# Manager Mock Coverage Language Parity

## Problem

The new single-process mock CMS mode made `apps/manager` runnable without Strapi, but the mock coverage path was not honest enough for QA. In mock mode, changing the selected language could still return the same `/api/videos` payload, which made the coverage report look language-aware even when the underlying data had not changed.

This was especially misleading because the UI shape stayed healthy. Reviewers could switch between seeded languages and see a normal coverage screen, but the mock gateway was not preserving the same decision-shaping behavior as the live `/api/video-coverage` contract.

## Root Cause

The bug was in the mock CMS gateway, not the coverage UI itself.

Before the fix, `getVideoCoverage(languageIds)` in `apps/manager/src/cms/gateway.ts` treated language selection as little more than a guard:

- for known language IDs, it returned the same seeded `videoCoverage` payload unchanged
- for unknown language IDs, it could collapse to an empty dataset instead of preserving the video list with zero coverage

That happened because the mock seed only stored top-level aggregate counts, not per-language source data. The mock route therefore had no truthful way to recompute subtitle/audio coverage when the selected language changed.

The review finding was proven directly by authenticated API checks: `GET /api/videos?languageIds=529` and `GET /api/videos?languageIds=6414` returned identical JSON on the reviewed branch.

## Solution

### Add per-language truth to the mock seed

`apps/manager/src/cms/mock-seed.ts` now stores `languageCoverage` per video using explicit `"human" | "ai" | "none"` statuses for subtitle and audio coverage. That gives mock mode a real source of truth for language-specific differences instead of one plausible aggregate for every filter.

### Derive coverage counts from selected languages

`apps/manager/src/cms/gateway.ts` now recomputes subtitle/audio counts from the selected language IDs at read time:

- normalize and deduplicate the requested IDs
- look up each selected language in the video’s `languageCoverage`
- count `human` and `ai` statuses for subtitles and audio
- keep the full video list stable even when a selected language is unknown

This restores the important live-mode behavior: the same videos remain in the response, but coverage counts change with the language selection.

### Prove the contract in tests

Two focused tests now lock the parity in place:

- `apps/manager/src/cms/gateway.test.ts` proves English and French return different coverage for the same seeded video and that unknown language IDs still return the full list with zero subtitle/audio counts
- `apps/manager/src/app/api/videos/route.mock.test.ts` proves `/api/videos` forwards the selected language IDs into the mock gateway and produces different JSON when the gateway returns different language-scoped coverage

## Why This Works

The durable fix was not “make mock mode look more dynamic.” It was “make mock mode preserve the same semantics that matter to the Manager coverage UI.”

The live coverage path treats language selection as a filter over subtitle/audio availability while keeping the video universe stable. The mock gateway now does the same thing:

- `languageCoverage` is the mock truth
- top-level `coverage` is a derived summary
- the route response stays structurally stable while coverage counts change

That keeps the mock UI honest for preview, demo, and QA work without pretending to be a full Strapi emulator.

One intentional non-change is metadata coverage. The Manager route still derives `meta` from `aiMetadata`, not from per-language coverage. That matches the current live route behavior, so future work should not make metadata language-specific unless the product meaning changes first.

## Prevention

1. If a mock read model supports filtering, store filter-specific truth and derive aggregates on read. Do not return one pre-aggregated payload for every filter state.
2. Preserve response shape for unsupported filters whenever the live contract does. Unknown language IDs should zero coverage, not make the catalog disappear.
3. Keep coverage URL/query-param normalization centralized. The coverage page still canonicalizes browser state through `languageId`, while `/api/videos` accepts `languageIds`; future changes should go through the shared helpers rather than inventing new reads and writes inline.
4. Treat mock persistence and in-process caching as separate drift surfaces. When the seed shape changes, validate against a fresh runtime or a fresh `MANAGER_MOCK_DATA_PATH`, otherwise persisted mock state can mask the new behavior.
5. If mock coverage ever becomes mutable at runtime, add explicit cache invalidation or bypass for the filtered video caches. The current SWR caches are process-lifetime and safe only because mock coverage is effectively static during a run.

## Verification

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager build`
- `git diff --check`

User-facing smoke for this fix should verify both API truth and visible UI behavior:

- compare `/api/videos?languageIds=529` vs `/api/videos?languageIds=6414` and confirm the payloads differ
- verify an unknown language ID preserves the video set while zeroing subtitle/audio coverage
- open `/dashboard/coverage?languageId=529` and `/dashboard/coverage?languageId=6414` on a fresh mock-mode runtime and confirm the same coverage page changes meaningfully between languages rather than only changing the selected chip

## Related

- [`docs/solutions/performance-issues/manager-video-coverage-sql-aggregation-20260402.md`](../performance-issues/manager-video-coverage-sql-aggregation-20260402.md) — the live `/api/video-coverage` contract that mock mode should mirror semantically
- [`docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md`](./manager-coverage-language-first-empty-state-20260410.md) — the coverage query-param normalization seam between `languageId` and `languageIds`
- [`docs/plans/2026-04-22-feat-manager-single-process-mock-cms-mode-plan.md`](../../plans/2026-04-22-feat-manager-single-process-mock-cms-mode-plan.md) — parent implementation plan for the single-process mock CMS mode
- [`docs/roadmap/platform/feat-106-manager-single-process-mock-cms-mode.md`](../../roadmap/platform/feat-106-manager-single-process-mock-cms-mode.md) — roadmap ticket for the broader mock-mode feature
