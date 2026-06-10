---
id: "feat-163"
title: "Admin Experience Watch Revalidation"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-05-11"
duration: 1
depends_on:
  - "feat-101"
blocks:
  - "feat-172"
tags:
  - "platform"
  - "admin"
  - "experience"
  - "revalidation"
---

## Problem

When an editor saves a published Experience locale in Admin and immediately
opens the watch preview, apps/web can still serve the previous ISR payload for
up to 60 seconds. The Admin row is already updated, but the published watch page
does not show newly added sections until the web cache revalidates.

## Entry Points

1. `apps/admin/src/services/experience.service.ts`
2. `apps/admin/src/services/experience-watch-revalidation.ts`
3. `apps/admin/src/config/env.ts`
4. `apps/web/src/app/api/revalidate/route.ts`
5. `apps/web/src/lib/content.ts`

## What Changed

1. Admin Experience locale mutations now notify apps/web's revalidation endpoint
   after successful updates, publishes, restores, and chat-driven mutations.
2. Revalidation is optional-env guarded with `WATCH_REVALIDATION_URL` and
   `WATCH_REVALIDATION_SECRET`, so saves still succeed when the hook is not
   configured or the web app is temporarily unavailable.
3. Slug changes revalidate both the old and new watch paths.

## Verification

- Saving a published Experience locale with a newly added section revalidates the
  matching watch page.
- The watch page shows the newly added section immediately after revalidation.
- Admin saves still complete when watch revalidation fails.
