---
title: "fix: Preserve custom language across Watch navigation"
type: fix
status: completed
date: 2026-07-23
---

# fix: Preserve custom language across Watch navigation

## Summary

Keep the active public audio-language slug in Watch-local navigation from localized video and episode pages. Repair the shared header home link and the language modal’s catalog link while preserving existing content, canonical, share, and external-link behavior.

## Problem Frame

The production route `/watch/jesus.html/women-disciples/hindi.html` renders chapter links with `/hindi.html`, but the compact floating-header logo links to bare `/watch`. Following that link returns the viewer to the default English Watch home and forces another language selection.

The same source-level audit found that the page language modal’s “See all languages” action links to the unlocalized `/watch/languages` route even though `localizedLanguagesPath` already supports `/{language}.html/languages`. Watch treats the public URL as the sole locale carrier, so Watch-local links must carry the current public audio-language slug rather than relying on cookies or internal message-catalog locale keys.

## Requirements

**Language continuity**

- R1. On a non-English Watch video, episode, or other inner route, the compact floating-header logo links to that language’s Watch home at `/{language}.html`.
- R2. The page language modal’s “See all languages” action keeps the currently applied non-English route language at `/{language}.html/languages`.
- R3. Existing video, episode, search-result, and home-card destinations continue to carry their public audio-language slug and contextual collection shape.
- R4. Default-English routes retain their current canonical aliases rather than introducing unnecessary English-localized duplicates.

**Routing boundaries**

- R5. Link construction uses the route builders in `apps/web/src/lib/routes.ts`; internal `next-intl` catalog keys never appear in public Watch URLs.
- R6. Canonical metadata, share URLs, outbound ministry links, footer links, and download URLs remain unchanged.
- R7. Malformed route language values fall back to the existing default destination instead of emitting a malformed localized URL.

**Verification**

- R8. Focused component tests cover Hindi and English/default link behavior without adding data fetching or eager client initialization.
- R9. Browser validation starts from the reported Hindi contextual episode, follows repaired Watch-local links, and confirms both the destination URL and retained Hindi page context.

## Assumptions

- “All other links” means links whose destination remains inside the Watch application; links that intentionally leave Watch are outside this change.
- The currently applied route language, not an unsubmitted language-picker draft, owns the “See all languages” destination.
- The existing URL-carried language model remains authoritative; this fix does not add cookie-based redirects or global click interception.

## Key Technical Decisions

- **Repair emitters, not navigation globally:** Build the correct href where the shared header and modal render it. Global interception would obscure bad URLs, weaken normal browser link semantics, and duplicate the existing route-builder contract.
- **Preserve only well-formed route language:** The admitted public route already establishes language membership, so use the client-safe slug constructor before calling localized builders. The default and malformed cases keep their established safe destinations without importing the broader locale map into the shared header bundle.
- **Keep contextual content routing unchanged:** `watchEpisodePath` continues to preserve collection membership and `watchVideoPath` remains the standalone canonical/share shape.
- **Avoid new runtime work:** Derive destinations from the pathname and props already available to the client components. Do not load language catalogs, read cookies, or add effects for link generation.

## Acceptance Examples

- AE1. Given `/watch/jesus.html/women-disciples/hindi.html`, when the viewer follows the compact logo, then the destination is `/watch/hindi.html` and Hindi remains the selected Watch language.
- AE2. Given the same Hindi page, when the viewer opens the page language modal and follows “See all languages,” then the destination is `/watch/hindi.html/languages`.
- AE3. Given `/watch/jesus.html/women-disciples/english.html`, when the viewer follows the compact logo, then the existing default Watch-home destination remains unchanged.
- AE4. Given a Hindi contextual episode, when the viewer follows a chapter card, then the existing `/{collection}.html/{episode}/hindi.html` destination remains unchanged.

## Implementation Units

### U1. Record the language-continuity fix

- **Goal:** Create the required platform roadmap record and mark it in progress before changing application behavior.
- **Requirements:** R1-R9
- **Dependencies:** None
- **Files:**
  - `docs/roadmap/platform/feat-300-watch-language-preserving-navigation.md`
- **Approach:** Capture the reported production route, the URL-as-language contract, exact emitters, scope boundaries, and verification expectations in the next platform feature record.
- **Patterns to follow:** `docs/roadmap/platform/feat-260-watch-global-language-switcher.md` and `docs/roadmap/platform/feat-179-watch-contextual-video-canonical.md`.
- **Test scenarios:** Test expectation: none -- this unit records implementation scope and status only.
- **Verification:** The roadmap entry uses the next sequential ID, begins with `status: "in-progress"`, and links back to this plan.

### U2. Preserve the applied language in shared Watch-local links

- **Goal:** Make the shared header home link and language-modal catalog link language-bearing for valid non-English routes.
- **Requirements:** R1-R7
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/components/FloatingSearchProvider.tsx`
  - `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
  - `apps/web/src/components/watch/LanguagePickerModal.tsx`
  - `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- **Approach:** Reuse `parseWatchPath`, `tryAsLocaleSlug`, `localizedHomePath`, and `localizedLanguagesPath` at the two emitting components. Preserve the current default-English destinations and safe fallback behavior. Do not change content-card, canonical, share, download, or outbound-link builders.
- **Execution note:** Add the Hindi regression expectations before changing the href construction.
- **Patterns to follow:** `apps/web/src/lib/watch-language-switcher.ts` for validated public-language utility routing and `apps/web/src/lib/routes.ts` for URL construction.
- **Test scenarios:**
  1. Covers AE1. Render the shared provider on a Hindi contextual episode path and assert the compact logo href is `/hindi.html`.
  2. Covers AE3. Render the shared provider on an English inner route and assert the compact logo keeps the existing default-home href.
  3. Render the shared provider on a malformed inner route language and assert it does not emit a malformed localized home href.
  4. Covers AE2. Render the page language modal with Hindi applied and assert “See all languages” links to `/hindi.html/languages`.
  5. Render the modal with English applied and assert the existing all-languages destination remains unchanged.
  6. Covers AE4. Keep existing contextual navigation tests green so chapter links retain their collection and language segments.
- **Verification:** Focused provider and language-modal suites pass, and the diff introduces no new data dependency or client effect.

### U3. Prove end-to-end language continuity

- **Goal:** Verify the repaired navigation on the reported production-shaped route and finish the roadmap record.
- **Requirements:** R8-R9
- **Dependencies:** U2
- **Files:**
  - `docs/roadmap/platform/feat-300-watch-language-preserving-navigation.md`
- **Approach:** Run focused component tests, type checking, lint/format checks for the touched surface, and a real-browser smoke from the Hindi contextual episode. Capture visual proof on the Hindi destination and confirm the inspected Watch-local hrefs retain the public language slug. Mark the roadmap entry complete with bounded validation evidence.
- **Patterns to follow:** `docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md` and `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`.
- **Test scenarios:** Test expectation: none -- browser scenarios and component regressions are defined in U2 and the verification outcome is recorded here.
- **Verification:** The reported flow reaches `/watch/hindi.html`, the language-modal catalog link reaches `/watch/hindi.html/languages`, Hindi remains active after navigation, page-loading behavior is unchanged, and the roadmap record is complete.

## Risks and Dependencies

- The floating provider treats home routes differently because the full ministry logo intentionally leaves Watch. The repair must affect only the compact inner-route logo.
- A malformed public slug must not reach throwing route constructors.
- The language modal has draft and applied language state. Using the draft for “See all languages” could change context before the user applies a selection.
- Local Watch browser validation depends on the existing Web environment and Admin GraphQL credentials; if unavailable, production HTML evidence plus focused tests must be reported with the limitation.

## Sources and Research

- The reported production page returned HTTP 200 on 2026-07-23. Its rendered chapter hrefs retained `/hindi.html`, while `data-testid="floating-header-logo"` emitted bare `/watch`.
- `apps/web/AGENTS.md` requires every user-visible Watch link to use the public audio-language slug and the builders in `apps/web/src/lib/routes.ts`.
- `apps/web/src/components/FloatingSearchProvider.tsx` already derives `currentLanguageSlug` from `parseWatchPath`, so the repair needs no new state or request.
- `apps/web/src/components/watch/LanguagePickerModal.tsx` currently emits `languagesIndexPath()` for “See all languages” while `localizedLanguagesPath()` already supports the language-bearing route family.
- `docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md` and `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md` preserve existing standalone and contextual Watch URL shapes.
