---
title: "Manager subtitle editor: popup-safe launch with latest reviewed reload"
category: ui-bugs
module: Manager Subtitle Review
date: 2026-04-13
problem_type: ui_bug
component: service_object
symptoms:
  - "Subtitle review editor launch could fail when the browser blocked the popup"
  - "Editor bootstrap reopened the original generated subtitle instead of the latest reviewed revision"
  - "Manager could show review actions when subtitle-review editor configuration was incomplete"
root_cause: async_timing
resolution_type: code_fix
severity: medium
tags:
  - manager
  - subtitle-review
  - subtitle-editor
  - popup-blocker
  - latest-reviewed
  - config-gating
affected_components:
  - apps/manager/src/features/jobs/subtitle-review-launch.ts
  - apps/manager/src/features/jobs/live-job-steps-table.tsx
  - apps/manager/src/services/subtitleReview.ts
  - apps/manager/src/lib/subtitle-review-session.ts
  - apps/manager/src/app/api/jobs/[id]/subtitle-reviews/response.ts
  - apps/manager/src/app/api/jobs/[id]/subtitle-reviews/session/route.ts
related_docs:
  - docs/plans/2026-04-13-fix-subtitle-review-recovery-config-plan.md
  - docs/plans/2026-04-13-feat-manager-subtitle-review-editor-plan.md
  - docs/roadmap/media-generation/feat-081-manager-subtitle-review-editor.md
  - docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md
  - docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md
---

# Manager subtitle editor: popup-safe launch with latest reviewed reload

## Problem

The Manager subtitle review editor happy path worked: job detail could launch the editor, pass generated subtitles into the editor, save a reviewed VTT, and show the reviewed artifact back in Manager. Review found three production-shaped edge cases:

1. If the browser blocked the synchronous `about:blank` popup, the fallback tried a second `window.open(editorUrl)` after an async session request. Browsers commonly block that delayed popup because it is no longer inside the original user gesture.
2. Editor bootstrap trusted the artifact key and fingerprint frozen into the signed edit token. If another reviewer saved a newer revision after the tab opened, reload/latest recovery could return the old generated VTT instead of the true latest reviewed artifact.
3. Subtitle review configuration was optional at env-validation time, but the UI and API behaved as though it was always present. Missing `SUBTITLE_EDITOR_PUBLIC_URL`, `SUBTITLE_EDITOR_ALLOWED_ORIGINS`, or `SUBTITLE_REVIEW_SESSION_SECRET` could leave operators with enabled launch controls and runtime failures.

## Root Cause

This flow crosses three boundaries at once: browser popup policy, short-lived editor tokens, and optional cross-app deployment configuration.

The launch path mixed a user-gesture-sensitive operation with async session creation. The token bootstrap path treated the launch token as the source of truth for the current subtitle base. The config path validated individual env vars lazily instead of giving Manager one runtime answer for whether subtitle review was actually available.

## Solution

### Keep popup-sensitive work synchronous

Move the browser launch details into a small testable helper. The click handler tries to open a placeholder tab synchronously and clears `opener` when it succeeds:

```ts
export function openSubtitleReviewPopup(openWindow: SubtitleReviewOpenWindow) {
  const popup = openWindow("about:blank", "_blank")
  if (popup) popup.opener = null
  return popup
}
```

After the session API returns the editor URL, navigate the pre-opened tab if it exists. If the initial popup was blocked, navigate the current tab instead of attempting another delayed popup:

```ts
export function completeSubtitleReviewLaunch(
  popup: SubtitleReviewPopup | null,
  editorUrl: string,
  currentTab: SubtitleReviewCurrentTab,
) {
  if (popup) {
    popup.location.href = editorUrl
    return
  }

  currentTab.assign(editorUrl)
}
```

That fallback is less luxurious than preserving Manager in the current tab, but it is reliable because it does not ask the browser for a second popup outside the click gesture.

### Resolve the latest reviewed artifact at bootstrap time

`bootstrapSubtitleReviewSession` now treats the token's source artifact as the identity of the subtitle being reviewed, not as a frozen pointer to the current base. At request time, it checks current job artifacts for the latest reviewed revision tied to that source artifact:

```ts
const latestRevision = getLatestSubtitleReviewRevision(
  job.artifacts,
  token.sourceArtifactKey,
)

const baseArtifactKey = latestRevision?.artifactKey ?? token.baseArtifactKey
const baseFingerprint =
  latestRevision?.contentFingerprint ?? token.baseFingerprint

const vtt = await readSubtitleArtifact(job, baseArtifactKey)
```

If a reviewed revision exists, the editor receives that VTT, artifact key, and fingerprint. If not, bootstrap still falls back to the original generated artifact from the token. Save conflict handling still compares the submitted base fingerprint against the latest reviewed fingerprint and returns `409 stale_base` with `latestArtifactKey` when the editor tab is stale.

### Gate the feature through one runtime config helper

Keep subtitle review env optional for environments that do not deploy the editor, but make runtime behavior explicit. Manager now has one helper that reports missing required subtitle-review variables:

```ts
export function getSubtitleReviewConfiguration() {
  const missing: SubtitleReviewConfigVariable[] = []

  if (!configuredValue(process.env.SUBTITLE_EDITOR_PUBLIC_URL)) {
    missing.push("SUBTITLE_EDITOR_PUBLIC_URL")
  }
  if (!configuredValue(process.env.SUBTITLE_EDITOR_ALLOWED_ORIGINS)) {
    missing.push("SUBTITLE_EDITOR_ALLOWED_ORIGINS")
  }
  if (!configuredValue(process.env.SUBTITLE_REVIEW_SESSION_SECRET)) {
    missing.push("SUBTITLE_REVIEW_SESSION_SECRET")
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true }
}
```

Session, exchange, bootstrap, save, revision, and CORS-facing paths use the same config gate. When config is incomplete, Manager returns a typed, no-store `503` instead of throwing from deeper route code. Job detail also receives `subtitleReviewConfigured` and disables the launch action with an explanatory message.

## What to Preserve

- Reviewed subtitles stay revisioned Manager artifacts. Do not overwrite the generated subtitle artifact.
- Saving a reviewed subtitle does not implicitly publish to CMS or Mux. Keep CMS/Mux write-back as an explicit follow-up action.
- The editor token can identify the source artifact, but the current base must be resolved from live job artifacts during bootstrap and save conflict checks.
- Route-level config gates are required even when the UI disables the feature, because an already-open editor tab or direct API caller can still hit those endpoints.

## Verification

The fix plan records red tests for stale bootstrap recovery, missing config behavior, and popup-blocked launch behavior, followed by green validation:

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `CI=1 pnpm --filter @forge/manager build`
- `pnpm --filter @forge/subtitle-editor test`
- `pnpm --filter @forge/subtitle-editor lint`
- `pnpm --filter @forge/subtitle-editor typecheck`
- `CI=1 NEXT_PUBLIC_MANAGER_BASE_URL=http://localhost:3002 pnpm --filter @forge/subtitle-editor build`
- `pnpm exec prettier --check --ignore-unknown ... && git diff --check`

Browser smoke was also recorded from Coverage Report video selection through enrichment job, job detail, editor save, reviewed artifact validation, and continue-review latest reload:

- `/tmp/forge-subtitle-smoke/review-fixes-editor-after-save.png`
- `/tmp/forge-subtitle-smoke/review-fixes-job-reviewed.png`
- `/tmp/forge-subtitle-smoke/review-fixes-continue-loads-latest.png`

## Prevention

1. Treat popup fallback as a user-gesture problem. Open a placeholder synchronously, then navigate it after async work. If the placeholder is blocked, use current-tab navigation or render a fresh user-clickable link.
2. Keep browser-sensitive launch code in a small helper with injectable `openWindow` and `currentTab` dependencies so blocked-popup behavior can be unit tested.
3. For tokenized editor sessions, do not assume the token's base artifact is still latest. Resolve latest state from current job artifacts during bootstrap and conflict checks.
4. Make optional feature configuration explicit with one helper shared by UI, API routes, and CORS preflight behavior.
5. Require browser smoke for cross-app flows involving popup behavior, CORS, token exchange, editor bootstrap, artifact save, and Manager readback.

## Related References

- [Manager subtitle review recovery/config plan](../../plans/2026-04-13-fix-subtitle-review-recovery-config-plan.md)
- [Manager subtitle review editor plan](../../plans/2026-04-13-feat-manager-subtitle-review-editor-plan.md)
- [Roadmap: Manager subtitle review editor](../../roadmap/media-generation/feat-081-manager-subtitle-review-editor.md)
- [Manager Mux subtitle override recovery](../integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md)
- [Manager job read model source-language metadata](../integration-issues/manager-job-read-model-source-language-metadata-20260409.md)
- [Strapi EnrichmentJob content type](../cms/strapi-enrichment-job-content-type.md)
- [Manager job artifact links plan](../../plans/2026-04-02-fix-manager-job-artifact-links-plan.md)
- [Mux subtitle sync plan](../../plans/2026-04-09-feat-mux-sync-for-enrichment-outputs-plan.md)
- [Mux clone environment gating plan](../../plans/2026-04-09-feat-gate-mux-clone-enrichment-by-environment-plan.md)
- [New app CI and deployment patterns](../platform/new-app-ci-and-deployment-patterns.md)
