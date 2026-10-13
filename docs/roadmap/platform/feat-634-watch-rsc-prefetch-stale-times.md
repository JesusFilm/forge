---
id: "feat-634"
title: "Bound Watch RSC prefetch fan-out with staleTimes"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "performance"
---

## Problem

Linear FGE-209 (Watch listing audit item W-024, 2026-09-13). An instrumented
35 s Watch session made 128 `?_rsc=` requests for only 13 distinct paths:
7,785,582 B decoded and 789,413 B transferred, with 43 exact-URL duplicates.
One page (`/watch/student-resources.html`) was fetched 7 times.

`apps/web/next.config.mjs` set no `experimental.staleTimes`. In Next 16.3.8
the client router's `dynamic` stale time defaults to `0`
(`next/dist/server/config-shared.js`), so dynamically fetched route data is
dropped at once and fetched again on the next visit. The `static` default is
already 300 s.

The audit also asked for one `<Link>` per href. An audit of the Watch card
renderers found no card that renders two links to one href: every card is
already a single whole-card link. The one repeat that always happens is on
the Watch home page. Each `WatchHomeSection` "Watch" CTA uses the first linked
card's href, so every section has two prefetching Links to the same page.

## Entry Points — Read These First

1. `apps/web/next.config.mjs`: `experimental.staleTimes`.
2. `apps/web/src/components/home/WatchHomeSection.tsx`: `sectionHref` /
   `ctaHref` and the CTA `<Link>`.
3. `apps/web/src/components/home/WatchHomePage.tsx`: the exposure manifest
   lists the CTA href before the card hrefs. It is analytics input, not a
   rendered link. Leave it alone.
4. `node_modules/next/dist/build/define-env.js`: how `staleTimes` becomes
   `__NEXT_CLIENT_ROUTER_DYNAMIC_STALETIME` / `__NEXT_CLIENT_ROUTER_STATIC_STALETIME`.
5. `node_modules/next/dist/esm/client/app-dir/link.js`: `prefetch={false}`
   turns off both viewport and hover prefetch but keeps soft navigation.
6. `docs/solutions/best-practices/next-link-props-unobservable-three-vacuous-test-traps.md`:
   why the test mocks `next/link` to read `prefetch`.

## Grep These

- `staleTimes` in `apps/web/next.config.mjs`
- `ctaHref` and `sectionHref` in `apps/web/src/components/home/`
- `prefetch=` in `apps/web/src/components/` (current per-surface posture)

## What To Build

```js
// apps/web/next.config.mjs
experimental: {
  staleTimes: { dynamic: 30, static: 300 },
}
```

- `static: 300` repeats the Next default on purpose, so both values are set
  in one place. The schema needs `static >= 30`.
- `WatchHomeSection`'s CTA keeps its `<Link>` and its href, with
  `prefetch={false}`. The first card owns the prefetch for that page.
- Tests:
  - `apps/web/scripts/next-config.test.mjs` pins the `staleTimes` pair.
  - `apps/web/src/components/home/__tests__/WatchHomeSection.prefetch.test.tsx`
    pins the same visible link order and one prefetching Link per href.

## Constraints

- Do not change visible content, order, accessible names or focus order.
  The CTA stays a focusable link with the same text.
- Do not turn the CTA into a raw `<a>`. That would make every CTA click a
  full page load.
- Do not remove repeated items from editor-authored lists
  (`MediaCollection`, home section cards). That changes visible content and
  needs a product decision.
- `dynamic: 30` means a page revisited within 30 s can show route data up to
  30 s old on a soft navigation. Watch pages are ISR (`revalidate = 3600`),
  so this is well inside current freshness.
- Do not use `aria-hidden` + `tabIndex={-1}` to hide a duplicate link. It
  still prefetches.

## Verification

```bash
pnpm --filter @forge/web exec vitest run \
  scripts/next-config.test.mjs \
  src/components/home/__tests__/WatchHomeSection.prefetch.test.tsx
pnpm --filter @forge/web exec vitest run src/components/home
pnpm --filter @forge/web exec tsc --noEmit
```

- Falsify once: set the CTA back to the default `prefetch`. The prefetch test
  must fail.
- After deploy, repeat the audit session on `/watch` and a collection page
  under `next build` + `next start` (or production). Count `?_rsc=` requests
  and exact-URL duplicates in DevTools Network. Expect far fewer than 43
  duplicates, and no repeat fetch of one path within 30 s.

## Residual Limitations

- Repeated items inside an authored list (`MediaCollection`,
  `WatchHomeSection` cards) still render one card each. Prefetch is
  hover/focus-gated in `MediaCollection`. Deduping them is a product call.
- When a section has no linked cards, its CTA falls back to
  `languagesIndexPath()`. That CTA no longer prefetches.
- The before/after request counts have not been measured in a browser yet. A local `next build` compiled and completed TypeScript, but page-data collection requires the absent `REVALIDATION_SECRET`, `ADMIN_GRAPHQL_URL`, and `WEB_ADMIN_API_KEYS`.
