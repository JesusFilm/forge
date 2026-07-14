---
id: "feat-252"
title: "Watch global beta tester CTA modal"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-13"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
---

## Problem

Watch currently promotes beta testing only from home-page content, and those
links leave Watch for the Mailchimp landing page. Viewers on video, series,
language-inventory, and history pages have no equivalent invitation. The beta
signup should be reachable from every Watch page and should keep the viewer in
context by opening the existing Mailchimp form in an accessible modal.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - shared layout for every
   public Watch route after proxy rewriting.
2. `apps/web/src/components/ui/dialog.tsx` - Base UI dialog primitives and
   focus/escape behavior.
3. `apps/web/src/components/watch/WatchModalViewportCloseButton.tsx` - shared
   Watch modal close control.
4. `apps/web/src/components/sections/QuizButton.tsx` - existing responsive
   cross-origin iframe modal and sandbox policy.
5. `apps/web/src/components/home/WatchHomePromo.tsx` and
   `apps/web/src/components/sections/CTASection.tsx` - existing beta tester
   links that should use the shared modal action.
6. `docs/solutions/performance-issues/watch-staged-client-loading-20260611.md`
   - keep user-triggered modal code and network work off the initial load.

## Grep These

- `mailchi.mp/jesusfilm/beta`
- `WatchModalViewportCloseButton`
- `DialogContent`
- `loadWatchInteraction`
- `WatchQuestionPanel`

## What To Build

1. Add one shared Watch beta-tester modal owner under the locale/html-language
   layout, with a compact CTA visible across Watch routes.
2. Open `https://mailchi.mp/jesusfilm/beta` in a responsive, scrollable iframe
   modal with an accessible title, close behavior, and external-link fallback.
3. Mount the iframe and load its modal chunk only after user activation so no
   Mailchimp request or tracking work occurs during initial page load.
4. Route the legacy home promo and builder-authored CTA using the exact beta URL
   through the same modal action instead of opening a contradictory new tab.
5. Keep the CTA clear of the mobile safe area and optional question-panel rail,
   and suppress its interaction while the global search modal is active.

## Constraints

- Do not copy or proxy Mailchimp form fields into Forge; the supplied URL is
  the form authority.
- Do not add Mailchimp preconnects, eager iframes, or initial-load requests.
- Do not add a new dependency or expose server-only data to the client.
- Keep the existing English CTA copy; broad translation-catalog expansion is
  outside this slice.

## Verification

- Focused Vitest coverage for initial absence, open/close/focus behavior, exact
  iframe contract, fallback link, and reuse from existing beta CTA surfaces.
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on `/watch`, a video page, and `/watch/videos` at mobile and
  desktop widths, with screenshots and resource timing proving no Mailchimp
  request occurs before activation.
- Verify the change does not regress initial page-load timing or add a
  render-blocking resource.

## Resolution

Completed on 2026-07-14. The shared Watch layout now owns one global beta CTA
and one intent-loaded Mailchimp modal. Existing exact-URL promo/section links
reuse the same action; search, question-panel, route, focus, safe-area, and
player coordination are covered by focused tests and browser proof.

Validation passed with 173 affected tests (2 existing todos), Web lint,
typecheck, and a production build. Cold production HTML includes the lightweight
provider chunk but neither the 16.8 kB modal chunk nor a Mailchimp resource;
desktop, 390 px mobile, and 800 px browser checks showed no horizontal overflow.
