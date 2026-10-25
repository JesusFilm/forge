---
id: "feat-142"
title: "Auth login watch film collage background"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-05-26"
duration: 1
depends_on: []
blocks: []
tags:
  - web
  - design
---

## Problem

The team wants a Netflix-style login screen background in the auth app using real JesusFilm.org watch artwork instead of generic placeholder media.

## Entry Points — Read These First

1. `apps/auth/src/app/login/login-page-client.tsx` — login UI shell and form behavior.
2. `apps/auth/src/app/login/watch-film-collage-background.tsx` — decorative film collage built from live watch-page imagery.
3. `apps/auth/src/app/globals.css` — login layout, collage styling, and row animation keyframes.

## Grep These

1. `WatchFilmCollageBackground`
2. `film-collage`
3. `imagedelivery.net/tMY86qEHFACTO8_0kAeRFA`

## What To Build

1. Use real image URLs from `https://www.jesusfilm.org/watch` card artwork.
2. Render multiple skewed rows with black gutters, rounded poster frames, and a dark scrim suitable for foreground auth UI.
3. Keep the existing OAuth login behavior intact.
4. Keep all imagery decorative because the page's functional content is the foreground panel.

## Constraints

1. Do not touch the web watch app for this work.
2. Do not hand-edit generated GraphQL outputs.
3. Do not introduce a new design system; reuse the auth app's CSS conventions.
4. Keep the implementation data-static so login does not require admin GraphQL at runtime.

## Verification

1. `pnpm --filter @forge/auth lint`
2. `pnpm --filter @forge/auth typecheck`
3. `pnpm --filter @forge/auth test`
4. Run the local auth dev server and visually inspect a valid OAuth login URL on `http://127.0.0.1:3004/login`.
