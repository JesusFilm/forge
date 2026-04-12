---
id: "feat-083"
title: "Manager App Favicon Branding"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-12"
duration: 1
depends_on: []
blocks: []
tags:
  - "manager"
  - "branding"
---

## Problem

The manager app favicon should communicate language coverage more clearly. Browser tabs and bookmarks should show a compact language icon that stays fully within the brand red `#EF3340`.

## Entry Points — Read These First

1. `apps/manager/src/app/layout.tsx` — Next.js metadata entrypoint for favicon links
2. `apps/manager/public/favicon.svg` — manager-only favicon asset to replace
3. `/Users/o/Downloads/language-svgrepo-com.svg` — source artwork provided for the favicon

## Grep These

- `metadata:` or `export const metadata` in `apps/manager/src/app/` — existing app-level metadata
- `favicon|icon` in `apps/manager/` — current favicon state
- `language-svgrepo-com.svg` in `/Users/o/Downloads/` — source language icon

## What To Build

1. Add a square favicon asset for `apps/manager` that uses only the brand red `#EF3340`.
2. Replace the previous favicon artwork with the provided language icon shape.
3. Wire the favicon into `apps/manager/src/app/layout.tsx` via Next metadata.

## Constraints

- Do NOT introduce any new brand colors or gradients.
- Do NOT redesign the manager header, login screen, or dashboard chrome.
- Do NOT change unrelated public assets or app routing.

## Verification

- `pnpm --filter @forge/manager build`
- Open the manager app in a browser tab and confirm the favicon renders as the provided language icon in brand red `#EF3340`.
