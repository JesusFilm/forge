---
id: "feat-702"
title: "Disclose unavailable audio on Watch collection cards"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-14"
duration: 1
depends_on: []
blocks: []
tags: ["web", "watch", "i18n", "accessibility"]
linear_issue: "FGE-277"
---

## Problem and reproduction

On 14 October 2026, `/watch/christmas.html/spanish-latin-american.html`
presented Make Way for the King as an ordinary playable card with a 3:09
runtime. Its contextual child URL returned HTTP 200 with Página no encontrada. The same
video's standalone Spanish URL correctly rendered the unavailable-language
recovery page; its English contextual and standalone routes rendered normal
watch pages.
The neighboring Considering Christmas Spanish card worked.

PR #2609 changes an unavailable whole collection's language fallback. It does
not change direct-child cards inside a valid-language collection and cannot
resolve this reproduction. This replacement has a separately allocated roadmap
record; the original PR stays open for its owner's separate disposition.

## Entry points and contract

- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`: collection branch
  checks nested container admission but passes every direct video child.
- `apps/web/src/lib/watch-route-manifest.ts`:
  `proveWatchContentAudioLanguageByManifest` proves an exact known-missing dub.
- `apps/web/src/components/watch/SeriesEpisodeCard.tsx`: synthesizes a
  contextual playback link and primary-dub playback cues without availability.
- `docs/plans/2026-08-22-0533-fix-unavailable-watch-cards-plan.md`: shipped
  FGE-25 contract retains distinct unavailable recovery links and suppresses
  playback affordances; do not filter cards or silently change audio language.

## Implementation and constraints

- Classify only direct video children with exact known-missing manifest proof.
- Retain static artwork, title, order, selected language, dimensions and focus.
- Link unavailable cards through `watchUnavailableLanguagePath`, label the
  requested language and localized unavailable status, and suppress Mux media,
  progress, play/runtime cues, zoom and speculative prefetch.
- Keep exposure hrefs aligned with rendered recovery destinations.
- Preserve admitted/unknown children, nested containers, missing-manifest
  degradation, route sentinels, valid dialects, analytics and content policy.
- Add no request, effect, dub-list projection or generated GraphQL edit.

## Verification

Prove red then green with collection route and card tests, including mixed
Spanish missing-dub/available rows, English control, stale primary Mux/runtime
metadata and incomplete manifest degradation. Verify exposure href parity,
focused type/lint/format checks and page-loading behavior. Browser verification
belongs to the authorized browser worker; production remains unchanged.

## Allocation evidence

Current main `f08fc89428` and all 129 open PR file lists were audited on
14 October 2026. Existing IDs reached 701; 702 was the next unused ID.

## Results

- Route and card regressions failed before implementation; all 248 affected
  route, card, collection-client and exposure tests pass after simplification.
- Web typecheck, targeted ESLint and touched Prettier pass. Focused source
  review with a separately dispatched adversarial reviewer found no defects.
- Dedicated browser worker verified four mounted cases with current app CSS:
  Spanish recovery link and label, no stale playback cues, opaque white title,
  retained authored artwork/focus geometry, and the available English control.
  Native screenshots failed; this is computed-style and DOM evidence, not a
  screenshot, Next SSR/hydration, actual Next prefetch or full-page load proof.
- No new fetch/effect/dub projection. Existing manifest indexing is reused;
  a synthetic 10,010-content/2,329-language benchmark using the actual collection
  slugs measured nine-child cached p95 0.001837 ms and cold index 16.20 ms.
  Indexable collection metadata already builds that index; noIndex may newly
  pay one cold build. These are bounded server-cost figures, not page timings.

## PR #2746 conflict repair — 16 October 2026

- Source head: `dad94b9c12982dbdc45ba9158988aebcdab2ceaa`.
- Fetched main: `d6a5a3ba21e74106253b3a0ea3829d6e77efa137`.
- Merge base: `f08fc89428cbf2611c900882fa04d79eead41b75`.
- Bounded scope: merge main without rewriting the source branch; resolve the
  adjacent feat-702/feat-711 roadmap index conflict by retaining both records
  and regenerating the index. No application code conflict or behavior change
  is required. Preserve main's URL-only Watch language policy and the approved
  exact-known-missing child-card contract.
- Local verification: existing routing/card/manifest and collection-client
  regressions, URL-only proxy regressions, Web types, touched lint/format and
  generated/roadmap drift checks. Independent review, reconciled-head browser
  and page-load performance evidence, and CI remain coordinator-owned gates.
  Historical browser acceptance and original-report evidence do not prove the
  reconciled head. Original individual reporter remains unknown.

### Owned local verification

- `behavior_changed: false` for this repair. The eight original PR code/test
  files are byte-for-byte preserved; main's URL-only proxy, locale and layout
  files are unchanged from fetched main. Only the generated index and this
  dated repair record require authored conflict-resolution changes.
- Existing route, card, grid, collection-client, exposure, recovery, manifest,
  proxy and message-parity tests were inspected and used unchanged. No new red
  test is appropriate for an index-only conflict. The actual failure observed
  was Git's adjacent roadmap-row conflict; merged-tree characterization passed
  544 tests, followed by 1,004 tests in 13 files on repository-pinned Node 24.
  The second run corrected the initial shell's Node 26 runtime and included
  message parity; no broad suite was repeated after those checks passed.
- Web typecheck passes on Node 24. Its first attempt exposed missing links for
  Admin's existing type-only `zod`/URL-policy imports after the filtered install;
  reusing those exact already-installed dependencies fixed the local setup
  without source or lockfile edits. Touched ESLint and UI-locale drift pass.
- Hidden-roadmap-lane checks and ten roadmap/baseline script tests pass. The
  loader's existing incomplete-frontmatter skips remain outside this repair.
- Browser, screenshots, actual Next prefetch, hydration, page timings and
  reconciled-head CI are not established here. This merge adds no application
  change, but source equality and mocked tests are not page-load proof. The
  coordinator owns fresh review, desktop/mobile recovery and available-control
  acceptance, network/resource timing, and CI before any readiness claim.
