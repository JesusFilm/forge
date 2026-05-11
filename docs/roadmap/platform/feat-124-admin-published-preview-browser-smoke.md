---
id: "feat-124"
title: "Admin Published Preview Browser Smoke"
owner: "ekkasit"
priority: "P2"
status: "not-started"
start_date: "2026-05-11"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "experience"
---

## Problem

The admin experience editor's published `Preview` action depends on both the
admin app and the web/watch app. Recent debugging found two regressions that
unit tests alone did not catch: the preview popup can open a browser error page
when the watch app is not running, and AI-generated `videoId` media blocks can
render without playable streams if the web resolver does not hydrate referenced
video variants.

## Entry Points — Read These First

1. `docs/solutions/integration-issues/admin-preview-blank-tab-web-server-not-running-20260510.md`
2. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
3. `apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx`
4. `apps/web/src/lib/content.ts`
5. `apps/web/src/components/sections/Video.tsx`
6. `apps/web/src/components/sections/VideoHero.tsx`

## Grep These

- `buildPublishedWatchUrl` in `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- `inferWatchBaseUrl` in `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- `referencedVideos` in `apps/web/src/lib/content.ts`
- `Missing streaming URL` in `apps/web/src/components/sections/`
- `videoMap[videoId]` in `apps/web/src/components/sections/`

## What To Build

1. Add a browser smoke test or scripted Playwright check that starts admin on
   `localhost:3003` and web/watch on `localhost:3000`.
2. Open a published experience editor route in admin and click the published
   `Preview` action.
3. Assert the popup URL matches `/watch/<slug>/<locale>` and does not become
   `chrome-error://chromewebdata/`.
4. Use a fixture or seeded experience with at least one `VideoHero` or `Video`
   block that stores only `videoId`.
5. Assert the popup renders expected watch content and does not emit the
   `Missing streaming URL` warning.

## Constraints

- Do not add a second preview code path; this test should exercise the real
  admin button and the real web route.
- Keep the test focused on the published Preview flow, not the in-admin draft
  preview card.
- Do not require production data. Use local seed data, a deterministic fixture,
  or the existing test database pattern.
- Keep the watch route mounted through `apps/web` with `basePath: "/watch"`.

## Verification

- Browser smoke passes locally with both apps running.
- The smoke fails when `apps/web` is not listening on `localhost:3000`.
- The smoke fails if `apps/web` stops hydrating referenced-video
  `streamingUrl` values for `videoId` media blocks.
- Existing focused unit coverage still passes:
  - `pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor.test.tsx`
  - `pnpm --filter @forge/web test -- src/lib/content.test.ts src/components/sections/__tests__/Video.test.tsx src/components/sections/__tests__/VideoHero.test.tsx`
