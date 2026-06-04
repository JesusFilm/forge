---
id: "feat-158"
title: "Admin loading feedback and slow route UX"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-04"
duration: 2
depends_on:
  - "feat-153"
  - "feat-155"
blocks: []
tags:
  - "platform"
  - "admin"
  - "ui"
  - "ux"
  - "performance"
---

## Problem

Admin dashboard routes such as `/dashboard/videos` and `/dashboard/languages`
can take long enough to server-render that the current browser view appears
still after a user click. Operators need immediate confirmation that navigation
or filtering was accepted, and the slowest screens should show page-shaped
loading states while safe route-level performance wins are applied.

## Entry Points — Read These First

1. `docs/brainstorms/2026-06-04-admin-loading-feedback-requirements.md` -
   product scope, accepted staged approach, and acceptance examples.
2. `docs/plans/2026-06-04-002-feat-admin-loading-feedback-plan.md` -
   implementation plan and validation strategy.
3. `apps/admin/src/components/admin-shell.tsx` - persistent dashboard shell,
   sidebar links, command palette, and content wrapper.
4. `apps/admin/src/app/dashboard/videos/page.tsx` - server-rendered video
   library route and row/pagination links.
5. `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx` - existing
   URL-backed filter pending feedback for videos.
6. `apps/admin/src/app/dashboard/languages/page.tsx` - server-rendered language
   diagnostics route.
7. `apps/admin/src/app/dashboard/ops-data.ts` and
   `apps/admin/src/app/dashboard/live-data.ts` - route data loaders for
   languages and videos.

## Grep These

- `AdminShell|ShellSidebarContent|Command palette|visibleNavItems` in
  `apps/admin/src/components/admin-shell.tsx`
- `loading.tsx|Suspense|role="status"|aria-live` in `apps/admin/src/app`
- `loadVideoLibraryPage|loadVideoLibraryLanguageOptions|includeVisitorUrls` in
  `apps/admin/src/app/dashboard/live-data.ts`
- `loadLanguagesData|diagnosticRows|LanguageDiagnostics` in
  `apps/admin/src/app/dashboard/ops-data.ts` and
  `apps/admin/src/app/dashboard/languages/`
- `dashboard-ui.test|admin-shell.test|language-diagnostics.test` in
  `apps/admin/src`

## What To Build

1. Add shared admin navigation feedback that activates immediately for internal
   dashboard route clicks and route-changing submissions, then clears when the
   destination pathname or query state is rendered.
2. Add dashboard loading fallbacks that preserve the shell and show
   Forge Editorial skeletons, with route-shaped states for videos and
   languages.
3. Improve the safest confirmed heavy route behavior for videos/languages
   without changing their product contracts.
4. Add focused tests proving feedback semantics, loading surfaces, and preserved
   existing behavior.
5. Verify with local browser smoke using the configured admin dev setup and the
   available Helium/in-app browser surface.

## Constraints

- Keep scope inside `apps/admin` plus roadmap/brainstorm/plan docs.
- Do not change Prisma schema, Pothos schema, GraphQL SDL, generated clients,
  auth/session behavior, or public consumer app contracts.
- Do not build video editing, video creation, language editing, bulk actions,
  advanced search syntax, or saved views.
- Keep the existing Forge Editorial visual language and dense operator layout.
- Use Helium browser when browser testing is needed, falling back only if the
  current Codex environment exposes a different local browser surface.

## Verification

- `pnpm --filter @forge/admin test -- src/components/admin-shell.test.tsx src/app/dashboard/dashboard-ui.test.tsx src/app/dashboard/languages/language-diagnostics.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- Local browser smoke for `/dashboard`, `/dashboard/videos`, video filter or
  pagination transition, and `/dashboard/languages`.
