---
title: "fix: Subtitle Review Recovery And Config Gating"
type: fix
status: completed
date: 2026-04-13
completed: 2026-04-13
origin: docs/plans/2026-04-13-feat-manager-subtitle-review-editor-plan.md
review_findings:
  - todos/todo-001-subtitle-review-reload-latest-stale-token.md
  - todos/todo-002-subtitle-review-config-gating.md
  - todos/todo-003-subtitle-review-popup-blocker-fallback.md
---

# fix: Subtitle Review Recovery And Config Gating

## Overview

Close the review findings from the Manager subtitle review editor branch before PR handoff. The happy path already opens the editor from job detail, loads generated subtitles, saves a reviewed VTT, and shows the reviewed revision back in Manager. The remaining work is to harden conflict recovery, deployment configuration behavior, and popup-blocker fallback behavior.

## Problem Statement

The user-facing happy path passed, but review found three cases that can still fail in production or under stricter browser conditions:

- A stale editor tab cannot reload the true latest reviewed subtitle because bootstrap reads the artifact key frozen into the launch token.
- Manager can render a review launch action even when required subtitle-review configuration is missing.
- If the initial popup is blocked, the delayed async `window.open(...)` fallback is likely blocked too.

## Research Context

- `docs/brainstorms/2026-04-11-manager-subtitle-editor-integration-requirements.md` selected a separate Forge-hosted editor app launched from Manager job detail.
- `docs/plans/2026-04-13-feat-manager-subtitle-review-editor-plan.md` made Manager the authority for auth, artifacts, save APIs, and reviewed metadata.
- `docs/solutions/platform/videoforge-manager-integration.md` emphasizes Zod validation at boundaries, no-store authenticated Manager APIs, Railway S3 artifacts, and env validation.
- `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md` supports promoting artifact-backed truth into read-facing helpers instead of making operators inspect raw artifacts.
- `docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md` reinforces non-destructive subtitle workflows and explicit recovery paths.

## Proposed Solution

### 1. Fix Latest-Revision Reload

Update `bootstrapSubtitleReviewSession` so bootstrap resolves the current latest review revision for `token.sourceArtifactKey`. When a reviewed revision exists, return that artifact's VTT, artifact key, and content fingerprint. When no reviewed revision exists, keep returning the generated source artifact from the token.

This keeps the editor's reload button useful after a `stale_base` save response and avoids adding a separate endpoint.

### 2. Gate Missing Subtitle Review Config

Add an explicit configuration helper for subtitle review. It should distinguish:

- editor public URL missing
- allowed origins missing
- session secret missing

Use the helper in the launch route and CORS-gated editor routes so incomplete config produces an intentional no-store response, not a surprise runtime exception. If the feature should remain optional in local dev, keep env vars optional but make the job-detail UI render a disabled or explanatory state when config is incomplete.

### 3. Add Popup-Blocked Fallback

Keep the current pre-opened tab flow for normal browsers. If `window.open("about:blank")` returns `null`, avoid a delayed async popup call. Prefer rendering a follow-up user-clickable link/button with the generated `editorUrl`; current-tab navigation is acceptable if a smaller patch is needed.

## Red/Green TDD Plan

1. Add failing tests first:
   - `apps/manager/src/services/subtitleReview.test.ts`: bootstrap returns latest reviewed VTT and fingerprint when a newer revision exists.
   - Manager route/helper tests: missing subtitle-review config returns a typed failure instead of throwing.
   - Job detail component test or focused unit seam: popup-blocked launch stores/renders a usable fallback link or navigates current tab.
2. Implement the minimum code to pass the failing tests.
3. Keep existing happy-path tests green for session creation, exchange, bootstrap, save, and duplicate save behavior.

## User Smoke Test

Run the existing browser path again after fixes:

1. Coverage Report video section.
2. Start an enrichment job.
3. Open job detail.
4. Click `Review in editor`.
5. Confirm editor opens at `/edit`, pulls generated subtitles automatically, and saves a reviewed VTT.
6. Return to Manager job detail and validate the latest reviewed revision appears with the reviewed artifact link.
7. Add a stale-reload variant if practical: save one revision, simulate or create a second review, trigger reload/latest recovery, and confirm the editor draft updates to the latest reviewed VTT.

Capture screenshots for the editor saved state and Manager reviewed state.

## Acceptance Criteria

- [x] Stale reload returns the latest reviewed artifact, not the token's original generated artifact.
- [x] Missing subtitle-review configuration has a deliberate UI/API behavior.
- [x] Popup-blocked launch still gives the user a reliable way to open the editor.
- [x] Existing editor happy path remains working from job detail.
- [x] `pnpm --filter @forge/manager test` passes.
- [x] `pnpm --filter @forge/manager lint` passes.
- [x] `pnpm --filter @forge/manager typecheck` passes.
- [x] `CI=1 pnpm --filter @forge/manager build` passes.
- [x] `pnpm --filter @forge/subtitle-editor test` passes.
- [x] `pnpm --filter @forge/subtitle-editor lint` passes.
- [x] `pnpm --filter @forge/subtitle-editor typecheck` passes.
- [x] `CI=1 NEXT_PUBLIC_MANAGER_BASE_URL=http://localhost:3002 pnpm --filter @forge/subtitle-editor build` passes.
- [x] Browser smoke test is recorded with screenshots or equivalent validation.

## Work Log

### 2026-04-13 - Review Findings Fixed

**By:** Codex

**Actions:**

- Added red tests for stale bootstrap recovery, missing subtitle-review config, and popup-blocked launch behavior.
- Updated bootstrap to resolve the latest reviewed revision for the token's source artifact before reading VTT content.
- Added explicit subtitle-review configuration state, API 503 responses for missing config, and a disabled Manager UI state.
- Replaced the delayed popup fallback with a current-tab navigation fallback when the initial synchronous popup is blocked.
- Re-ran the browser smoke from Coverage Report video selection through enrichment job, job detail, editor save, reviewed artifact validation, and continue-review reload.

**Validation:**

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `CI=1 pnpm --filter @forge/manager build`
- `pnpm --filter @forge/subtitle-editor test`
- `pnpm --filter @forge/subtitle-editor lint`
- `pnpm --filter @forge/subtitle-editor typecheck`
- `CI=1 NEXT_PUBLIC_MANAGER_BASE_URL=http://localhost:3002 pnpm --filter @forge/subtitle-editor build`
- `pnpm exec prettier --check --ignore-unknown ... && git diff --check`
- Browser smoke screenshots:
  - `/tmp/forge-subtitle-smoke/review-fixes-editor-after-save.png`
  - `/tmp/forge-subtitle-smoke/review-fixes-job-reviewed.png`
  - `/tmp/forge-subtitle-smoke/review-fixes-continue-loads-latest.png`

## Notes

Do not replace generated subtitle artifacts or publish to CMS/Mux as part of these fixes. Reviewed subtitles should remain revisioned Manager artifacts; publish/write-back stays explicit follow-up work.
