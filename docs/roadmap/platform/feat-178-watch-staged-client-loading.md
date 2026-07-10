---
id: "feat-178"
title: "Watch staged client interaction loading"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 2
depends_on:
  - "feat-177"
  - "feat-169"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "performance"
  - "seo"
---

## Problem

The Watch page now server-renders metadata and content correctly, uses the
optimized poster-first hero path, and avoids serializing full language picker
rows into the initial page payload. Live mobile-sized browser timing still
shows a large first-load client surface: about 31 script/chunk resources and
roughly 730 KB encoded script on the Life of Jesus page.

The next app-owned performance win is to keep the first page functional and
SEO-safe while delaying heavier interaction code until after the page has
loaded, or immediately when the user asks for that interaction.

## Entry Points - Read These First

1. `docs/plans/2026-06-11-002-perf-watch-staged-client-loading-plan.md` -
   implementation plan for this slice.
2. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - current global
   `FloatingSearchProvider` placement.
3. `apps/web/src/components/FloatingSearchProvider.tsx` - search state,
   search actions, language filters, header controls, and overlay portal.
4. `apps/web/src/components/SearchOverlay.tsx` - heavy search overlay UI.
5. `apps/web/src/components/watch/WatchPageClient.tsx` - watch modal
   orchestration and language/download/share interaction boundaries.
6. `apps/web/src/components/watch/LanguagePickerModal.tsx` - highest-priority
   watch interaction to warm after load.
7. `docs/solutions/performance-issues/watch-non-cloudflare-performance-hardening-20260611.md`
   - prior app-owned performance hardening evidence.

## Grep These

- `FloatingSearchProvider`
- `SearchOverlay`
- `useFloatingSearch`
- `loadWatchLanguageOptions`
- `DownloadModal`
- `LanguagePickerModal`
- `ShareModal`
- `resolveDownloadSessionAccess`
- `requestIdleCallback`

## What To Build

1. Keep the initial watch route server-rendered and functional while moving
   heavy interaction code off the first client path.
2. Load interaction code immediately on user intent, or after `window.load`
   and idle time when there is no intent.
3. Warm interactions in priority order: language switching first, search
   second, share third, download fourth.
4. Cache loaded interaction chunks and on-open data across watch-page
   navigations within the browser session.
5. Preserve current behavior for direct search URLs, language switching,
   share links, download gating, modal pause/resume, and keyboard access.

## Constraints

- Do not move SEO-critical title, metadata, localized page copy, study
  questions, Bible quotes, transcript text, or hreflang discovery behind
  client-only loading.
- Do not add Cloudflare cache rules in this slice.
- Do not change public watch URL, canonical, Open Graph, or Twitter URL
  ownership.
- Do not expose admin, Algolia, or auth secrets to the browser.
- Do not make hidden modals load before the first page becomes usable.

## Verification

- Focused web tests cover staged interaction loading, user-intent loading,
  cached preload reuse, search URL hydration, modal behavior, and
  language-option cache reuse.
- `@forge/web` typecheck and lint pass.
- Helium smoke on deployed or local watch pages confirms the page renders
  content immediately, language opens fast, search opens on click, and
  share/download still work.
- Browser resource timing shows lower initial script transfer or fewer
  first-load chunks on the Life of Jesus watch page.

## Plan

Implementation plan:
`docs/plans/2026-06-11-002-perf-watch-staged-client-loading-plan.md`

## Completion Notes

Implemented in the Watch staged client-loading slice:

- Added `watch-interaction-loader` to dedupe interaction imports, cache
  language options by `videoSlug`, and warm language/search/share/download
  after load in priority order.
- Split floating search into a light provider shell and lazy search
  controller.
- Routed language, share, and download opens through the staged loader while
  keeping download session checks click-only.
- Recorded browser proof and resource-timing order in
  `docs/solutions/performance-issues/watch-staged-client-loading-20260611.md`.
