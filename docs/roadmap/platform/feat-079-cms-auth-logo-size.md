---
id: "feat-079"
title: "CMS Auth Logo Size"
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

The Jesus Film logo on Strapi CMS unauthenticated pages is too large for the login layout. It should be 25% smaller while preserving the existing CMS branding and layout.

## Entry Points - Read These First

1. `apps/cms/src/admin/styles/admin.css` — existing CMS admin styling overrides
2. `apps/cms/src/admin/app.tsx` — current Strapi admin auth logo configuration
3. `@strapi/admin` `UnauthenticatedLogo` component — renders the auth logo at `7.2rem` high

## What To Build

1. Add a targeted CSS override for the Strapi unauthenticated auth logo.
2. Reduce the logo height from `7.2rem` to `5.4rem`, making it 25% smaller.
3. Keep the menu/sidebar logo size unchanged.

## Constraints

- Do NOT replace logo assets.
- Do NOT change CMS content types, GraphQL schema, or editor workflows.
- Do NOT redesign the login form or surrounding auth layout.

## Verification

- `cd apps/cms && pnpm build`
- `cd apps/cms && pnpm lint`
- Verify `/admin/auth/login` shows the auth logo 25% smaller and the CMS menu logo remains unchanged.
