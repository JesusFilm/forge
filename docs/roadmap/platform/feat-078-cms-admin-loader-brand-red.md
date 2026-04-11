---
id: "feat-078"
title: "CMS Admin Loader Brand Red"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-10"
duration: 1
depends_on:
  - "feat-047"
blocks: []
tags:
  - "cms"
  - "branding"
---

## Problem

The Strapi CMS admin loading indicator still renders in the default Strapi purple/blue even though the admin shell already uses Jesus Film brand tokens. Editors should see the same `#EF3340` brand red during CMS loading states.

## Entry Points — Read These First

1. `apps/cms/src/admin/styles/admin.css` — existing CMS admin CSS overrides for Strapi default visuals
2. `apps/cms/src/admin/app.tsx` — current Strapi admin theme configuration, already using `#EF3340` for primary tokens
3. `docs/roadmap/platform/feat-047-cms-admin-branding-refresh.md` — prior CMS admin branding work this follows

## Grep These

- `img[src*="%234945FF"]` in `apps/cms/src/admin/styles/admin.css` — existing image filter for Strapi purple assets
- `role="alert"` and `aria-live="assertive"` in Strapi design-system Loader markup — loader structure to target
- `primary500` in `apps/cms/src/admin/app.tsx` — existing brand red theme token override

## What To Build

1. Add a targeted CSS selector for the Strapi design-system Loader image in `apps/cms/src/admin/styles/admin.css`.
2. Reuse the existing red filter that maps Strapi purple assets to Jesus Film brand red.
3. Leave `apps/cms/src/admin/app.tsx` unchanged because the theme tokens already use `#EF3340`.

## Constraints

- Do NOT replace Strapi package assets.
- Do NOT change CMS content types, GraphQL schema, or editor workflows.
- Do NOT broaden this into a redesign of CMS admin chrome or layout.

## Verification

- `cd apps/cms && pnpm build`
- `cd apps/cms && pnpm lint`
- Manually verify the CMS admin loader is brand red `#EF3340`, not Strapi purple/blue.
