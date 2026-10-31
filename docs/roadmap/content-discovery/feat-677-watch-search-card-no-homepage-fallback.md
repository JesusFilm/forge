---
id: "feat-677"
title: "Watch search cards never fall back to the Watch homepage"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-09"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "search"
---

## Problem

Linear FGE-2. Search cards whose targets cannot be represented by the client
route parser silently returned the homepage. A browser-origin anonymous Admin
query confirmed `tümlükden-nura` and `çoğu-çay-mostly-tea` have valid English
`TARGET_AUDIO` actions: these are canonical Unicode slugs, not unpublished
records. PR #2662 (feat-650) is merged on current main and admits these reviewed
canonical Latin Unicode slugs. Both must remain playable links. Missing
subtitle/requested-language intent still has the homepage fallback on main;
malformed explicit result languages silently default to English instead.

This ticket is the narrow guard only: `defaultHrefBuilder` must never emit the
homepage. Unicode slug acceptance remains owned by the merged PR #2662,
feat-650; reuse its current route dependency without duplicating its grammar.

## Entry Points — Read These First

1. `apps/web/src/components/search/VideoCard.tsx` — `defaultHrefBuilder` and the
   disabled-card branch of `VideoCard`.
2. `apps/web/src/components/search/VideoCard.test.tsx` — `defaultHrefBuilder`
   and `VideoCard with no valid destination` suites.
3. `apps/web/src/lib/routes.ts` — `tryAsContentSlug`, `tryAsLocaleSlug`,
   `watchVideoPath`, `watchUnavailableLanguagePath`.

## Grep These

- `defaultHrefBuilder`
- `search-card-disabled`
- `hrefBuilder` in `apps/web/src/components/search/`

## What To Build

- `defaultHrefBuilder(result, requestedLanguageSlug): Route | null` returns
  `null` for: invalid slug; malformed explicit `languageSlug`; `target_subtitle`
  missing or malformed either language; `unavailable` with no valid requested
  language. An absent `languageSlug` still defaults to English; an unavailable
  result with a valid requested language still routes to the recovery path.
- `VideoCard` renders a `null` href as a non-link `div` with
  `aria-disabled="true"`: no hover, play icon, preview, or progress bar. It shows
  the existing generic `LanguagePickerModal.notAvailable` badge with no language
  name (no new catalog keys). Titles and count pills stay, so result counts and
  empty-result semantics are unchanged.
- Custom `hrefBuilder` callers keep working; a builder may now also return `null`.

## Constraints

- Do not change `routes.ts` slug patterns (Unicode support landed in PR #2662).
- Do not filter results out of `SearchResults` or `SearchOverlay`; counts stay.
- The disabled card's badge must stay generic: never show a language name.

## Verification

- From `apps/web` on Node 24.22.1, run the scoped `VideoCard`,
  `FloatingSearchProvider`, browser search client, search actions, routes, and
  unavailable-recovery suites with at most two workers. Run full Web typecheck,
  touched root/package lint and format, and applicable roadmap/CI checks.
- Require concrete canonical hrefs and linked playable DOM for
  `tümlükden-nura` and `çoğu-çay-mostly-tea`. An inert result is a regression for
  these valid `target_audio` controls. Preserve ordinary English, lowercase
  underscores, language-home collisions, explicit non-English audio, subtitle
  intent, unavailable-language recovery, custom builders and global modal search.
- Prove red against actual main's pre-guard `VideoCard.tsx`: malformed slugs,
  unavailable rows without requested language and incomplete subtitle intent
  incorrectly anchor the homepage. Restore the authored guard and run the same
  assertions green. Keep source hashes, test sources and logs with the handoff.
- Inert DOM must retain visible title/count/status without focusable descendants,
  keyboard/click callbacks, recovery writes, preview/media, progress or play
  affordances. Real `SearchResults` must retain all rows in its result grid.
- Actual global modal click/Back/focus, touch/native and same-data request/media,
  byte, DOM/CLS and handler-cost comparisons remain runtime acceptance. Inert DOM
  tests and the historical component 80.1 → 46.6 ms observation do not establish
  current page-loading performance.
- Keep this ticket in progress while independent review, candidate CI and runtime
  acceptance remain open. Broader FGE-2 title/publication/playback and historical
  `La_Busqueda_La Recherche` acceptance remain separate.

## Reconciliation — 2026-10-31

Compose offered head `ea2a6e373f982f903cc15e2804328dded91115ca` with exact main
`a3a8f8796a8c25749c4cd02432397772dbf93cef`, preserving the offered lineage in an
uncommitted merge. The concrete currency reason is the ASCII-to-canonical-Latin-
Unicode change in `apps/web/src/lib/routes.ts` since graph base
`07d5aaf74bb60a9c65922f4b4ffbcb07dd3296a0`. Main's `VideoCard.tsx` and its tests
are byte-identical to that base; age alone does not justify integration.

The authored runtime guard is reused unchanged. Replace permissive
`if (href !== null)` Unicode assertions with required href/anchor/affordance
controls, and add inert keyboard/click/storage and real-grid row preservation
checks. Do not reinterpret every null Admin action; FGE-26 remains separate.

Initial validation was deferred under the parent's resource reservation. After
the #2647 browser worker completed, the parent resumed the scoped checks on Node
24.22.1: four inert-card regressions fail against exact main's runtime; all 390
focused tests in seven files pass with the authored guard restored. Full Web
typecheck, package/root lint, owned formatting and UI locale drift checks pass.
The Unicode DOM controls pin the exact percent-encoded destination and click
href; direct builder controls still require canonical Unicode links. The first
test attempt's raw DOM URL expectations were corrected without changing runtime
or weakening the linked/playable controls. Missing local Admin dependency links
were restored from the proven compatible install before typecheck passed; no
install or source workaround was needed.

Main advanced externally to `c2e4bd3` through #2822's History sign-in repair,
test and ticket, disjoint from the card, route and search paths. No age-only main
update was made. Independent review, normal hooks/publication, candidate CI and
actual modal/device/loading acceptance remain pending. The initial frozen
candidate and receipts live under
`/home/lado/.t3/userdata/forge-orchestrator/resume-20261031-pr2685-reconciliation-r1`.
Parent validation and the refreshed freeze are in
`/home/lado/.t3/userdata/forge-orchestrator/resume-20261031-pr2685-parent-validation-r1`.
No new roadmap ID was allocated: feat-677 retains this identity and feat-918
remains reserved for PR #2647.
