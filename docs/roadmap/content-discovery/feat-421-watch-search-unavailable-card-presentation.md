---
id: "feat-421"
title: "Present unavailable Watch search results as recovery cards"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-08-22"
duration: 2
depends_on: []
blocks: []
tags:
  - "watch"
  - "search"
  - "i18n"
  - "web"
  - "accessibility"
linear_issue: "FGE-25"
---

## Problem

Watch search can intentionally retain an Admin-classified `unavailable` row so
that a viewer can reach the localized unavailable-language recovery flow. The
current `VideoCard` still presents that row like ordinary playable media: stale
playback metadata can produce a Mux poster and animated preview, progress and
runtime/count affordances remain eligible, the empty-art fallback is a play
icon, and the card has no visible or announced unavailable state.

Production evidence revalidated for Linear FGE-25 includes the Spanish query
`Jesús`, where unavailable-language results can appear alongside playable
results. The existing FGE-72 recovery implementation is valid and must remain
the destination; this feature closes only the presentation gap.

## Entry Points - Read These First

1. `docs/plans/2026-08-22-0533-fix-unavailable-watch-cards-plan.md` — FGE-25 product, scope, and acceptance contract.
2. `apps/web/src/components/search/VideoCard.tsx` — the presentation seam and existing recovery-link behavior.
3. `apps/web/src/components/search/VideoCard.test.tsx` — focused presentation, routing, and recovery regressions.
4. `apps/web/src/components/search/SearchOverlay.tsx` — completed-language props and retained-row integration; regression-only.
5. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` — completed versus draft language binding; regression-only.
6. `apps/web/src/lib/watch-unavailable-recovery-context.ts` — bounded recovery context contract; do not broaden it.
7. `docs/solutions/logic-errors/watch-search-unavailable-evidence-playback-identity.md` — unavailable evidence must not become playback identity.
8. `docs/solutions/logic-errors/watch-search-subtitle-playback-contract.md` — preserve actionable subtitle-only results.

## Grep These

- `availabilityKind === "unavailable"`
- `search-card-availability-badge`
- `LanguagePickerModal.notAvailable`
- `MuxHoverPreview`
- `WatchProgressBar`
- `pickCardPill`
- `requestedLanguageSlug`
- `writeWatchUnavailableRecoveryContext`
- `target_subtitle`

## What To Build

1. Branch presentation only on the explicit `unavailable` availability kind.
2. Retain unavailable rows as localized recovery links, using the completed
   search language for the href and bounded context while leaving playable
   language identity null.
3. Reuse `LanguagePickerModal.notAvailable` as visible text so unavailable
   status is communicated without relying on color and takes badge priority.
4. Preserve Admin static artwork, title, snippet, dimensions, entry animation,
   link focus affordance, and the existing unavailable prefetch opt-out.
5. Suppress Mux poster fallback, animated preview, watch progress, duration or
   child-count pill, play glyphs, generic play placeholder, and media zoom for
   unavailable rows even when stale media fields are present.
6. Fail closed to the Watch search surface for malformed requested-language
   context and do not write recovery context on that navigation.

## Constraints

- Do not filter rows after Admin pagination or change result order, offsets,
  visible-result analytics, click analytics, or search telemetry.
- Do not change Admin GraphQL, ranking, eligibility classification, result
  mapping, route admission, or FGE-72 recovery behavior.
- Do not synthesize the completed search language into `languageSlug` or any
  playable action identity.
- Keep `target_audio`, `target_subtitle`, `related_language`, and experience
  presentation and destinations unchanged.
- Add no effects, client fetches, media probes, or hydration-sensitive state;
  the classification is already synchronously available in props.
- Do not overlap FGE-24, FGE-26, FGE-27, FGE-5, FGE-68, FGE-70, FGE-79,
  FGE-85, or active FGE-92 player/subtitle work.

## Verification

- A focused `VideoCard.test.tsx` regression proves localized unavailable text,
  retained static content and recovery navigation, stale-field suppression,
  malformed-language fail-closed behavior, and unchanged playable kinds.
- The `FloatingSearchProvider.test.tsx` completed-versus-draft language
  regression covers a mixed playable/unavailable window, localized status,
  unchanged order, recovery context, and analytics identity.
- Focused Web typecheck, lint, formatting, and tests pass.
- SSR/hydration review confirms no new effect, fetch, or client-only decision.
- Page-loading and browser evidence confirms unavailable rows request no Mux
  poster or animated preview and ordinary playable cards remain unchanged.

## Ownership Evidence

Immediately before creation, active worktrees were audited through `feat-420`
and open PR file lists through a maximum of `feat-416`; `feat-421` was the
lowest unclaimed sequential feature ID. `feat-418` remains owned by active
FGE-92 work and is not reused here.

## Automated Integration Evidence

- The real `FloatingSearchProvider` flow renders the existing localized
  `LanguagePickerModal.notAvailable` message inside only the unavailable card.
- A mixed target-audio, unavailable, and target-subtitle window retains server
  order and the same visible-result identifier list; changing the draft
  language leaves the unavailable href and recovery context bound to the
  completed Spanish search.
- Clicking the unavailable result preserves its original second position and
  full visible-result list in click analytics. No search controller, mapping,
  routing, catalog, effect, or fetch behavior changed for this proof.
- Automated verification completed on 2026-08-23:
  - `./node_modules/.bin/vitest run src/components/__tests__/FloatingSearchProvider.test.tsx -t "keeps an unavailable recovery card in the completed mixed result window"`
    passed 1 test (119 skipped).
  - `./node_modules/.bin/vitest run src/components/search/VideoCard.test.tsx src/components/__tests__/FloatingSearchProvider.test.tsx src/i18n/client-messages.test.ts`
    passed 170 tests. The run retained the suite's existing jsdom
    `navigation (except hash changes)` diagnostic in the unrelated double-click
    analytics case; Vitest exited successfully.
  - The focused recovery page, action, and storage suites passed 14 tests.
  - The route, manifest, Watch search client, and unavailable-language
    component regression suites passed another 87 tests.

## Resolution

`VideoCard` now treats explicit `unavailable` Search Watchability as the
authority for presentation. Retained recovery cards keep Admin static artwork,
title, snippet, aspect ratio, focus semantics, the completed-language recovery
href, and the FGE-72 prefetch/context behavior. They no longer resolve or mount
Mux poster/preview media, progress, duration/count/type pills, play glyphs,
generic play placeholders, or hover zoom, even when stale playback-shaped
fields are present. The existing localized
`LanguagePickerModal.notAvailable` status is delivered through the global
client message projection.

The implementation does not filter or reorder the Search Candidate Window and
does not change Admin eligibility, ranking, GraphQL, routing, recovery, or any
playable Watchability kind. Mixed-window integration coverage pins the original
visible-result IDs and one-based click position.

## Final Verification

- Ten selected Web suites pass 271 tests after simplification and review.
- Web TypeScript, full Web ESLint, locale generation, production build, and
  `git diff --check` pass.
- The implementation reuses the already-global
  `LanguagePickerModal.notAvailable` namespace, so it adds no client-message
  projection and no fetch, effect, media probe, or hydration-time
  reclassification.
- Current production was revalidated with the exact Simplified Chinese search
  for `Tümlükden Nura`; the unavailable Turkish-title result still appears with
  ordinary playable styling before this change.
- The host-native browser rendered the final real `VideoCard` at desktop and
  390×844 compact viewports beside playable controls. Computed evidence pins a
  focusable anchor to the completed-language recovery path, the localized
  `Not available · Chinese` status, bidirectional isolation, 45% caption
  opacity, strong grayscale/darkening, and absence of preview, progress, pill,
  type, and video elements. Activating the link issued the existing recovery
  route request. No hydration mismatch was observed.
- Compound Engineering review found one actionable localization-projection
  test gap; the direct selector regression was added and passes. Correctness,
  standards, maintainability, performance, and adversarial follow-up found no
  remaining actionable issue.
