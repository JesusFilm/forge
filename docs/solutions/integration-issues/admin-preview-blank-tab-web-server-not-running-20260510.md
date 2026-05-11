---
title: "Admin Preview Opens Blank Tab When the Watch App Is Not Running"
date: 2026-05-10
category: docs/solutions/integration-issues/
module: apps/admin
problem_type: integration_issue
component: development_workflow
symptoms:
  - "Clicking the experience editor Preview button opens a blank Chrome error tab"
  - "The Preview popup URL becomes chrome-error://chromewebdata/"
  - "The admin dev server is healthy on localhost:3003, but no watch app is serving localhost:3000"
  - "The Preview popup opens the correct /watch/<slug>/<locale> URL, but AI-generated media sections appear blank"
root_cause: incomplete_setup
resolution_type: environment_setup
severity: medium
tags:
  - admin
  - experience-editor
  - preview
  - watch-app
  - local-development
  - playwright
  - ai-chat
  - video-streams
related_components:
  - apps/admin/src/app/dashboard/experiences/experience-editor.tsx
  - apps/web/next.config.mjs
  - apps/web/src/app/[slug]/[locale]/page.tsx
  - apps/web/src/lib/content.ts
  - apps/web/src/components/sections/Video.tsx
  - apps/web/src/components/sections/VideoHero.tsx
---

# Admin Preview Opens Blank Tab When the Watch App Is Not Running

## Problem

In the admin experience editor, clicking the bottom `Preview` button on a
published experience opened a blank browser tab during local development. The
issue was not the in-editor AI draft preview; it was the published watch-page
preview, which opens a separate browser tab against `apps/web`.

## Symptoms

- Admin was reachable at `http://localhost:3003/login` and returned `200 OK`.
- Clicking the editor `Preview` button opened a popup, but the popup navigated
  to `chrome-error://chromewebdata/`.
- The popup title and body were empty, producing a blank white page.
- `ps` showed no `apps/web` dev server on port `3000`.
- After starting `apps/web`, the same Preview click opened
  `http://localhost:3000/watch/jesus/en` and rendered the watch page.

## What Didn't Work

Checking only that the admin server was running was insufficient. Admin can
render the editor and expose the `Preview` button on `3003` while the target
watch app on `3000` is not serving anything.

It was also easy to confuse this with the AI chat draft preview issue. The AI
draft preview is an editable card inside the admin editor. The broken button
here was the published watch `Preview` action, which opens a new browser tab.

Prior session history showed the same operational split: working preview setups
had admin on `localhost:3003` and web on `localhost:3000`; later cleanup stopped
all local servers, leaving ports `3000`, `3003`, and `1337` free (session
history).

## Solution

Run both local apps needed for the published preview flow.

Admin:

```bash
pnpm --filter @forge/admin dev
```

Web/watch app:

```bash
NEXT_PUBLIC_ADMIN_GRAPHQL_URL=http://localhost:3003/api/graphql \
INTERNAL_ADMIN_GRAPHQL_URL=http://localhost:3003/api/graphql \
STRAPI_PREVIEW_SECRET=local-preview \
REVALIDATION_SECRET=local-revalidate \
NEXT_PUBLIC_CANONICAL_ORIGIN=http://localhost:3000 \
pnpm --filter @forge/web dev
```

Then verify both sides before debugging editor state:

```bash
curl -I -sS http://localhost:3003/login
curl -I -sS http://localhost:3000/watch/jesus/en
```

The relevant admin code is
`apps/admin/src/app/dashboard/experiences/experience-editor.tsx`:

- `inferWatchBaseUrl()` uses `NEXT_PUBLIC_WATCH_URL` when set.
- On localhost, `inferWatchBaseUrl()` falls back to
  `http://localhost:3000`.
- `buildPublishedWatchUrl()` appends `/watch/${slug}/${locale}`.

The target URL is correct for `apps/web`, because `apps/web/next.config.mjs`
sets `basePath: "/watch"`.

## Why This Works

The admin editor does not render the published watch page itself. It constructs
a public watch URL and opens that URL in a new tab. In local development, the
admin app runs on `3003`, but the published watch surface runs from `apps/web`
on `3000`.

When only admin is running, the browser popup navigates to a server that is not
listening, so Chromium reports `chrome-error://chromewebdata/`. Starting
`apps/web` on `3000` satisfies the target URL, so the same popup renders the
watch page normally.

One separate issue surfaced during the browser test: the admin editor logged a
hydration mismatch where server HTML initially rendered `Publish` and the
client rendered `Preview`. That can cause noisy logs or UI flicker, but it was
not the cause of the blank preview tab.

## Addendum: Correct URL, Blank Media

A later preview check for an AI-generated `forgiveness` experience opened the
correct popup URL, `http://localhost:3000/watch/forgiveness/en`, but the watch
page still looked broken. This was a separate failure mode from a stopped web
server.

The browser showed the route returning `200 OK`, but the web console logged
missing video streams for video sections. The AI-generated experience blocks
stored `videoId` references, while the web watch-page query and renderers did
not hydrate those referenced videos with a playable `streamingUrl`.

The durable fix is to keep `videoId`-only blocks valid and hydrate playable
media at the web boundary:

- Query referenced video dubs/variants in `apps/web/src/lib/content.ts`.
- Normalize a referenced video's first playable/published HLS URL into
  `streamingUrl`.
- In `apps/web/src/components/sections/Video.tsx` and
  `apps/web/src/components/sections/VideoHero.tsx`, fall back from the block's
  inline `streamingUrl` to `videoMap[videoId].streamingUrl`.

Admin also had a Preview button hydration mismatch because the published watch
URL was inferred from `window` during render. Keep render-time gating stable on
server and client, and only build/open the URL inside the click handler.

Verification should cover both parts:

```bash
pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor.test.tsx
pnpm --filter @forge/web test -- src/lib/content.test.ts src/components/sections/__tests__/Video.test.tsx src/components/sections/__tests__/VideoHero.test.tsx
```

Then run both apps and use a browser check from the admin editor:

1. Open `/dashboard/experiences/<id>?locale=en` on admin.
2. Click the published `Preview` action.
3. Assert the popup URL is `/watch/<slug>/<locale>`.
4. Assert the popup contains the expected watch content and no
   `Missing streaming URL` console warning.

## Prevention

- Treat published preview as a two-service local workflow: admin on `3003` plus
  web/watch on `3000`.
- If using a different watch origin, set `NEXT_PUBLIC_WATCH_URL` for admin so
  `inferWatchBaseUrl()` opens the intended watch app.
- For AI-generated experiences, test at least one saved `videoId`-only
  `VideoHero` or `Video` block against the public watch route. Do not rely only
  on the admin editor preview state, because the public renderer needs the
  normalized referenced-video stream map.
- Add a browser test for the published `Preview` button that starts both apps,
  clicks `Preview`, waits for the popup, and asserts:
  - the popup URL matches `/watch/<slug>/<locale>`;
  - the popup URL does not start with `chrome-error://`;
  - the popup contains known watch page content.
- Add a local runbook note near admin preview setup that distinguishes AI draft
  preview from published watch Preview.
- For long-lived manual sessions, use a process manager or tmux so admin,
  web/watch, and any required CMS/admin data service stay visible and can be
  checked together (session history).

## Related Issues

- `apps/admin/docs/worktree-preview-setup.md` should mention that the published
  experience-editor `Preview` button depends on a running watch app, not just
  a healthy admin worktree.
- `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`
  covers the related `/watch/<slug>/<locale>` route-shape contract, but the
  root cause here was a missing dependent local server rather than URL-shape
  drift.
