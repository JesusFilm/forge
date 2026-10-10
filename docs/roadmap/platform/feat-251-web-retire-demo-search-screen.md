---
id: "feat-251"
title: "Web retire demo-search production screen"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "infrastructure"
---

## Problem

The stakeholder-only `/watch/demo-search` experience and its nested demo
player pages are compiled into the production Web application. These screens
must not be publicly routable in production.

## Entry Points — Read These First

1. `apps/web/src/app/(demo)/demo-search/page.tsx` — public demo-search screen.
2. `apps/web/src/app/(demo)/demo-search/[slug]/[locale]/page.tsx` — nested demo
   player screen reachable from demo-search results.
3. `apps/web/src/app/(demo)/layout.tsx` — shared layout that must remain for
   `demo-recommendations`.
4. `apps/web/src/proxy.ts` — excludes the demo route group from Watch locale
   rewrites so a removed route resolves through Next's standard not-found path.

## Grep These

- `app/(demo)/demo-search`
- `demo-recommendations`
- `/demo-search`

## What To Build

1. Delete the `/demo-search` page segment, including its loading and error UI.
2. Delete the nested `/demo-search/[slug]/[locale]` demo-player page.
3. Preserve the `(demo)` root layout and `demo-recommendations` routes.
4. Verify the production build no longer emits a `/demo-search` page route.

## Constraints

- Do not remove or change the independent `demo-recommendations` screen.
- Do not remove shared production search behavior used by the global search
  modal.
- Do not broaden this screen retirement into an API or library cleanup unless
  a remaining production call site requires it.

## Verification

- `pnpm --filter @forge/web test -- src/proxy.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web build` and inspect the route manifest/output for
  the absence of `/demo-search` page routes.
- Local browser smoke confirms `/watch/demo-search` returns the not-found UI
  while a remaining demo route still loads.
