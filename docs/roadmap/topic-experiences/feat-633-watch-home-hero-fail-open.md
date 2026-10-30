---
id: "feat-633"
title: "Keep Watch Home Content Available When the Hero Query Fails"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "resilience"
---

## Problem

A transient failure in the Watch home hero query currently replaces the whole
page with an error state, even when the independently fetched authored homepage
body is available. This affects the root homepage and localized language-home
routes.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/page.tsx` - root Watch homepage data
   loading and error handling.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - localized
   language-home data loading and error handling.
3. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - authored body
   and hero rendering.
4. `apps/web/src/app/[locale]/[htmlLang]/page.test.tsx` and
   `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
   - root and localized route coverage.

## What To Build

- Render available authored homepage blocks when the hero query fails.
- Supply an empty hero model so the page renderer can omit unavailable hero
  media while preserving the authored body and footer.
- Show the hero error only when no authored body can be rendered. Show the empty
  state only when both successful data sources contain no content.
- Cover root and localized homepage routes.

## Verification

- Run focused root and localized route tests.
- Run Web typecheck and scoped lint/format checks.
- Run `git diff --check` and regenerate the roadmap README.

## Resolution

- Integrated the two route branches with main on 2026-10-30, preserving audience
  configuration, locale/chrome wrappers, visible-content and structured-data
  projection, public pathnames, missing-home redirects and schema compatibility.
- Hero and authored-body queries remain in `Promise.all`. A resolved hero error
  supplies an empty hero model when independent body content remains. This does
  not isolate a slow or hung hero through streaming/Suspense.
- `apps/web/src/lib/watch-home-visible-content.ts` now excludes hero placeholders
  and known empty static rails/containers from the failure fallback decision.
  A legacy category compatibility rail remains available. Other authored blocks,
  including dynamic rails, retain their normal rendering; this classifier cannot
  predict asynchronous section failures. Healthy-response semantics are unchanged.
- Real-component route SSR tests exercise the actual renderer's hero hoisting,
  empty carousel, authored rail, footer, chrome and single-main behavior. The
  offered array-length check failed ten discriminating edge cases before repair.
- Current integrated focused validation: 263 tests across nine route, layout,
  preview, renderer, metadata and structured-data files. The original 106-test
  report belongs to the historical published head, not this integration.
- Paired local Next development runs with disposable Admin responses reproduce
  lost body/footer on main and retention on the candidate. Local SSR/browser
  timing and screenshots are retained outside the repository. These are fixture
  evidence; production builds, real Admin acceptance, physical devices and
  independent review remain separate requirements before publication/acceptance.

## Durable Learning

A nonempty authored block array is not proof of independent fallback content:
`WatchHomeExperiencePage` hoists a leading `WatchHomeHeroBlock`, and the carousel
returns null when its model has no slides. Exercise the real renderer, including
empty static rails, rather than replacing it with a mock that always renders.

## Reopened acceptance: header clearance

Independent review R1-2628-001 confirmed the restored first heading/action
overlaps the fixed header on both supplied desktop routes. The repair threads
an explicit resolved-hero-error flag into the shared renderer and adds only
responsive header clearance; healthy hero pinning and request parallelism remain
unchanged. Current changed-source browser geometry, pointer/keyboard checks,
loading comparison, independent review and published-candidate CI remain open.

A null carousel does not supply layout clearance: content-presence SSR tests
cannot establish that restored headings/actions are visible or clickable. Check
actual header/heading/action rectangles at desktop/mobile widths and use
`elementFromPoint` plus visible keyboard focus, with a healthy-hero control.
