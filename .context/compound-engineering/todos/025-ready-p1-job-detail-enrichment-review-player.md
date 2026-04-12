---
status: done
priority: p1
issue_id: "025"
tags: [manager, web, mux, subtitles, ui, video-player]
dependencies: []
---

# Build the job detail enrichment review player

Add the new review card on the manager job detail page so operators can inspect
Before/After enrichment state in one place, with a shared video-player core
reused from the web app boundary.

## Problem Statement

The manager job detail page exposes enrichment state as disconnected pieces:
header, workflow rows, artifacts, and error log. Operators currently have to
reconstruct what changed across subtitles, metadata, and chapters instead of
reviewing a single player-centered surface.

This feature needs to add that review surface below the existing error log,
default to `After`, switch both player and details when tabs change, and reuse
the web player behavior without violating the repo’s no cross-app import rule.

## Findings

- The current job page ends at `Error Log` in
  `apps/manager/src/app/dashboard/jobs/[id]/page.tsx`.
- `LiveJobDetailHeader` owns local job state today, while the page-level error
  card remains server-rendered. A new bottom review card needs one shared
  screen-level state owner.
- `apps/web/src/components/sections/Video.tsx` and
  `apps/web/src/components/sections/CarouselVideo.tsx` duplicate the core
  `video.js` lifecycle and controls logic.
- `JobRecord` already carries generated-artifact and compare-report state, but
  live review context still needs explicit loading for current CMS title /
  description and current subtitle tracks.
- CMS `Video` exposes `documentId`, `title`, `description`, and `subtitles`.
  No chapter relation exists on `Video` in the current schema, so live
  chapters need an explicit unavailable state in v1.
- `buildMuxTextTrackUrl(...)` in `apps/manager/src/services/transcription.ts`
  already knows how to produce playable Mux text-track URLs from playback +
  track ids.

## Proposed Solutions

### Option 1: Shared `video.js` core package + manager review context loader

**Approach:** Extract the player lifecycle/track-management logic into
`packages/video-player`, then add a manager review context loader/presenter and
new review card below the error log.

**Pros:**

- Matches the approved plan
- Reuses the web player honestly
- Keeps manager UI data logic testable

**Cons:**

- Touches both `apps/web` and `apps/manager`
- Requires careful verification so the web player does not regress

**Effort:** Medium

**Risk:** Medium

---

### Option 2: Manager-only player

**Approach:** Build a fresh manager player and leave web untouched.

**Pros:**

- Smaller immediate change set

**Cons:**

- Violates the requested reuse goal
- Bakes in a third player implementation

**Effort:** Medium

**Risk:** High

## Recommended Action

Implement Option 1. Work red/green in this order:

1. Add presenter/selection-rule tests and the manager review-context loader
   tests.
2. Extract the reusable player core into `packages/video-player` and adapt the
   web wrappers.
3. Add the manager review card and hoist job-detail live state to one screen
   owner.
4. Run manager/web tests, lint, typecheck, and a browser smoke test with
   screenshots on the job detail page.

## Technical Details

**Likely files:**

- `apps/manager/src/app/dashboard/jobs/[id]/page.tsx`
- `apps/manager/src/features/jobs/live-job-detail-header.tsx`
- `apps/manager/src/features/jobs/live-job-steps-table.tsx`
- `apps/manager/src/lib/state.ts`
- `apps/manager/src/types/job.ts`
- `apps/manager/src/services/mux.ts`
- `apps/manager/src/services/transcription.ts`
- `apps/web/src/components/sections/Video.tsx`
- `apps/web/src/components/sections/CarouselVideo.tsx`
- `packages/video-player/*`

**Related docs:**

- `docs/plans/2026-04-12-feat-job-detail-enrichment-review-player-plan.md`
- `docs/brainstorms/2026-04-12-job-detail-enrichment-review-player-brainstorm.md`
- `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
- `docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md`
- `docs/solutions/platform/videoforge-manager-integration.md`

## Resources

- Plan:
  `docs/plans/2026-04-12-feat-job-detail-enrichment-review-player-plan.md`
- Roadmap:
  `docs/roadmap/media-generation/feat-082-job-detail-enrichment-review-player.md`
- Dependency:
  `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`

## Acceptance Criteria

- [x] Manager job detail page shows a new review card below `Error Log`
- [x] `After` tab is selected by default
- [x] Switching tabs updates both the player state and surrounding detail state
- [x] Shared player core is reused by web and manager without cross-app imports
- [x] Manager handles unavailable live/generated domains explicitly
- [x] Automated tests pass for touched packages/apps
- [x] Browser smoke test and screenshots confirm the feature works

## Work Log

### 2026-04-12 - Implementation kickoff

**By:** Codex

**Actions:**

- Read the brainstorm, plan, roadmap ticket, and related compound docs
- Verified repo workflow rules and moved the worktree onto
  `feat/job-detail-enrichment-review-player`
- Mapped current manager page, job-state, Mux helpers, and web player code
- Created this durable work item before starting red/green implementation

**Learnings:**

- Live chapters are not available from the current CMS `Video` contract
- Existing `buildMuxTextTrackUrl(...)` likely covers the live Mux subtitle URL
  need for the review player
- The safest UI path is a pure presenter + server loader + manager-local review
  card using a shared player core

### 2026-04-12 - Feature complete

**By:** Codex

**Actions:**

- Added `packages/video-player` and moved the shared `video.js` lifecycle,
  control wiring, and text-track registration there
- Updated `apps/web` wrappers to use the shared player core
- Added manager review-context loader, presenter, route, and bottom-of-page
  review card below `Error Log`
- Hoisted live job-detail state into `LiveJobDetailScreen` so the header,
  steps table, error log, and review card all read the same live job snapshot
- Ran focused + full test/typecheck/lint validation for touched scopes
- Ran a local browser smoke test against seeded QA job
  `l4y3dh2gq9xc4rjjrpjv0riv` and captured screenshots at:
  - `output/playwright/job-review-after.png`
  - `output/playwright/job-review-before.png`

**Learnings:**

- The manager app must declare `video.js` directly when it imports
  `video.js/dist/video-js.css`, even if the shared player package already
  depends on `video.js`
- Local smoke coverage was easiest to prove by seeding one completed job and
  local artifact files under `apps/manager/.tmp/artifacts/<muxAssetId>/`
- Using a fresh Mux asset from the current env avoided the restored-data
  environment mismatch on `listMuxSubtitleTracks(...)`

## Notes

- If browser validation surfaces environment or auth blockers, record them here
  and create a follow-up todo only if they are truly separate from this feature.
