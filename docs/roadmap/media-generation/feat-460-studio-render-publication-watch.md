---
id: "feat-460"
title: "Studio render and immutable Watch publication"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-09-07"
duration: 5
depends_on:
  - "feat-456"
  - "feat-458"
  - "feat-459"
blocks:
  - "feat-461"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

Rendered media must become an approved immutable catalog item visible on Watch, with no stale-render or alternate-mutation path around publication rules.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `apps/shorts-worker/src/`
3. `apps/manager/src/workflows/shortsStudio.ts`
4. `apps/admin/src/services/studio-authoring/ (proposed)`
5. `apps/admin/src/services/revalidate-webhook.ts`
6. `apps/web/src/`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `propsHash|renderMedia|mux_processing|publishedAt|restrictViewPlatforms|revalidate`

## What To Build

1. Render an immutable input snapshot with versioned code, exact asset dependencies, verified bytes and retryable job identity; reconcile Mux processing separately from MP4 completion.
2. Stage hidden catalog records and use a durable publication intent plus atomic Admin revision/approval/readiness checks to publish once. Do not hold DB transactions during external calls.
3. Allow all pre-publication edits and invalidate stale release approvals/results. Permanently deny edits, correction clones, replacements and republishing after first publication, including generic Admin routes.
4. Implement unpublish-only post-release behavior and update Watch/cache/search/route-manifest visibility and source-related reads. Add a usable Watch destination, not only a database row.
5. Keep draft playback/download authorized and prove generated-output playback policy respects unpublication; never persist expiring signed playback URLs as canonical identifiers.

6. Revalidate referenced source access/platform restrictions at publication so generated Video identities cannot make restricted source material publicly watchable.

## Constraints

- No direct social posting or mobile UI work in this release.
- Job completed, Mux ready and published are distinct states.
- Do not revive the legacy date-keyed Workspace workflow as the new product authority.

## Verification

- Real worker container render -> verified storage -> Mux readiness -> Forge -> Watch smoke with matching source metadata and audio/subtitles.
- Race edit versus publish; duplicate callbacks/retries; restart recovery; cross-route immutable edits and unpublish public access checks.
- Watch production build, visual playback smoke and page-load performance measurements.
