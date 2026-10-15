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
