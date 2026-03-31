---
id: "feat-019"
title: "Scaffolding Support for Urim"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-04-07"
duration: 21
depends_on:
  - "feat-001"
blocks: []
tags:
  - "web"
  - "infrastructure"
---

## What This Means

If Urim is struggling to ramp up on the web app, scaffold the routes and data fetching for him so he can focus on UI.

## What You Might Build

1. Scaffold `apps/web/src/app/search/page.tsx` with server-side data fetching wired up
2. Scaffold `apps/web/src/app/topics/page.tsx` and `apps/web/src/app/topics/[slug]/page.tsx`
3. Set up ISR config and `generateMetadata` for topic pages
4. Wire up the GraphQL operations in `apps/web/src/lib/content.ts`

## Constraints

- Only do this if Urim actually needs it. Don't pre-build things he can figure out.
- Scaffold = data fetching + route structure. Leave the UI components for him.
- Pair with him when possible — teach, don't just write code.

## Verification

- Urim can `pnpm dev` and see routes loading data
- He focuses on components, not plumbing
