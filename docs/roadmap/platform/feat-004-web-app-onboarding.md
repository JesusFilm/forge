---
id: "feat-004"
title: "Web App Onboarding"
owner: "urim"
priority: "P0"
status: "not-started"
start_date: "2026-04-01"
duration: 14
depends_on: []
blocks: []
tags:
  - "web"
---

## Entry Points — Read These First (In This Order)

1. `apps/web/CLAUDE.md` — web-specific conventions and patterns
2. `apps/web/package.json` — dependencies, scripts (`pnpm dev`, `pnpm build`)
3. `apps/web/src/app/layout.tsx` — root layout (fonts, metadata, providers)
4. `apps/web/src/app/page.tsx` — home page (how it fetches Experience data)
5. `apps/web/src/app/[slug]/[locale]/page.tsx` — dynamic Experience pages
6. `apps/web/src/lib/content.ts` — ALL GraphQL operations live here. This is the data layer.
7. `apps/web/src/components/sections/` — list this directory. Each file renders one section block type.
8. `packages/graphql/` — `graphql()` function and generated types from Strapi schema

## Grep These

- `'use client'` in `apps/web/src/` — which components are client-side (should be few)
- `graphql(` in `apps/web/src/lib/content.ts` — how typed queries are defined
- `revalidatePath|revalidateTag` in `apps/web/src/` — ISR revalidation pattern
- `SectionRenderer|renderSection|switch.*__typename` in `apps/web/src/` — how dynamic zone blocks dispatch to section components

## What To Do

1. Run the web app locally:

   ```bash
   cd apps/web && pnpm dev
   ```

   If CMS isn't running locally, check if there's a staging/dev CMS URL in `.env.local` or `.env.example`.

2. Read every file in `apps/web/src/components/sections/` — understand each section renderer.

3. Compare with your mobile section renderers in `apps/mobile/src/components/sections/` — note which exist on mobile but not web (and vice versa).

4. Pick one small task to build familiarity:
   - Fix a visual bug on the web app
   - Add a missing section renderer that exists on mobile but not web
   - Improve responsive behavior on an existing component

## Constraints

- Do NOT refactor the existing web code during onboarding. Understand first, change later.
- Do NOT install new dependencies without checking if an existing one covers the need.

## Verification

- `cd apps/web && pnpm dev` → app runs, home page loads, Experience pages render sections
- `cd apps/web && pnpm build` → builds without errors
- Can explain: how does a request for `/easter/en` turn into a rendered page? (route → page.tsx → GraphQL query → Experience → section components)
