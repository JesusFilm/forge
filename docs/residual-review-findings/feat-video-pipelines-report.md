# Residual Review Findings — Video Pipelines report

Source: `ce-code-review mode:autofix` run `20260728-203627-78036355` against
branch `feat/video-pipelines-report` (base `c8a6db2e228a3c5518a040c7fdd02e28722c1bd7`).
Plan: `docs/plans/2026-07-28-002-feat-video-pipelines-report-plan.md`.

11 reviewers ran (correctness, testing, maintainability, project-standards,
agent-native, learnings-researcher, security, api-contract, reliability,
adversarial, kieran-typescript). Applied fixes are already committed on this
branch (see commit `fix(review): apply code-review autofix feedback`). The
items below are unresolved `gated_auto`/`manual` findings — no GitHub issues
were auto-filed for these (issue creation is a shared-visibility action that
requires the user's explicit go-ahead), so they're recorded here instead.

## P2

- **`apps/manager/src/features/shell/manager-shell.tsx:320`** — `StudioReportSwitcher`'s
  `router.push` navigation on option select has no test coverage. This
  app's vitest config runs `environment: "node"` (no jsdom) and every
  existing component test uses `renderToStaticMarkup`, not simulated DOM
  events, so a real click-driven test isn't possible without introducing a
  new test pattern. (testing, maintainability)
- **`apps/manager/src/features/video-pipelines/video-pipelines-client.tsx:87`** —
  A cell selected while a "Run Now" submission is in flight can be silently
  dropped when the response resolves, because `selectedCellIds` isn't
  snapshotted before the request. `coverage-report-client.tsx`'s
  `handleEnrichSelection` has an analogous request-sequencing guard this
  diff doesn't replicate. Harmless today (button is disabled while
  submitting) but worth a snapshot-based fix if the interaction gets
  faster/more concurrent. (adversarial)
- **`apps/manager/src/features/video-pipelines/video-pipelines-client.tsx:64`** —
  `handleRunNow`'s success/partial-failure/network-failure paths have no
  test exercising the function itself (only the pure `resolveRunSelectionOutcome`
  helper is unit-tested). (testing, kieran-typescript, adversarial)
- **`apps/manager/src/app/api/video-pipelines/run/route.ts`** — The
  `{created, failed}` response envelope has no shared/exported type; it's
  declared independently in the route, `run-selection.ts`, and
  `video-pipelines-client.tsx`, so a coordinated shape change wouldn't be
  caught by the type system. (api-contract)
- **`apps/manager/src/features/video-pipelines/video-pipeline-model.ts:63`** —
  The 31-cell "Devotions - August" collection (titles, dates, thumbnail,
  per-cell mobile/desktop generated state) is produced by a pure function
  called only inside the client component — there's no `GET` endpoint
  exposing it, unlike the Subtitles report's `GET /api/coverage-snapshots`.
  An agent/API client currently has to scrape rendered HTML or replicate
  `generationStateForDay` to get this data. (agent-native-reviewer)
- **`apps/manager/src/features/video-pipelines/pipeline-stat-diagram.tsx`** —
  Reuses the real coverage engine's `.coverage-number-item--human` /
  `--none` CSS classes for its Generated/Not-Generated segments rather than
  dedicated classes. Works today but creates implicit coupling: a future
  CSS cleanup of the real per-language coverage engine's semantic classes
  could silently break this page's styling. (maintainability)

## P3

- **`apps/manager/CLAUDE.md`** — `POST /api/video-pipelines/run` isn't
  documented in the route/env tables the way `/api/admin-trigger/*` and
  `/api/admin-embeds/*` are. (api-contract)

## Not applied (needs a product decision, not a mechanical fix)

None beyond the above — no P0/P1 findings survived review across all 11
reviewers.
