---
title: "feat: Add YouVersion Bible Quotes Embed"
type: feat
status: active
date: 2026-05-27
---

# feat: Add YouVersion Bible Quotes Embed

## Summary

Add a compact official YouVersion passage embed below the watch-page Bible Quotes carousel. The embed follows the active citation card, stays absent when no citation or YouVersion config is available, and preserves the existing carousel, promo card, Share button, jsDelivr verse preview, and BibleGateway "Read more..." behavior.

---

## Problem Frame

The watch page already presents Bible quote cards with visual polish, but the scripture interaction below the carousel still relies on an unofficial jsDelivr verse preview and outbound BibleGateway links. The requested improvement is to place an official YouVersion-powered scripture panel under the carousel so the Bible Quotes section feels more complete without turning the watch page into a full reader.

---

## Requirements

- R1. Render a compact official YouVersion passage embed under the watch-page Bible Quotes carousel.
- R2. The embed must track the active Bible citation card and default to the first citation.
- R3. The embed must not render when there is no citation, the citation cannot be converted to a YouVersion reference, or YouVersion public config is absent.
- R4. Preserve existing Bible Quotes behavior: always-on promo card, Share button, citation card styling, jsDelivr verse preview, BibleGateway "Read more..." links, visible carousel arrows, and accessibility labels.
- R5. Use YouVersion's official React SDK path for the new embed, not a hand-rolled iframe or unofficial Bible API endpoint.
- R6. Keep YouVersion integration opt-in and non-blocking for local, preview, and production boot.
- R7. Execute feature-bearing work with Red/Green TDD: write failing tests first, then implement until they pass.
- R8. Require a real user-facing smoke test before completion: a watch page with at least two Bible citations must be opened in browser at mobile and desktop widths with a real YouVersion app key configured, the carousel must remain usable, the YouVersion panel must be visible/update correctly, and hydration/console/network failures must be checked.
- R9. Orchestrate implementation with mandatory subagent lanes for bounded research, at least one implementation or test-authoring lane, browser verification, and review; when write sets cannot be safely split, keep code edits local but assign a subagent to write the Red test plan or review the implementation before Green is claimed.

---

## Scope Boundaries

- Applies only to the synthetic watch-page `BibleQuotes` section rendered by `apps/web/src/components/watch/BibleQuotesSection.tsx`.
- Does not add YouVersion to CMS-authored `ComponentSectionsBibleQuotesCarousel` experience blocks in this PR.
- Does not replace the existing card-level jsDelivr verse preview or BibleGateway "Read more..." link.
- Does not add YouVersion sign-in, highlights, notes, plans, Verse of the Day, or full Bible reader navigation.
- Does not introduce server-side admin GraphQL changes, CMS schema changes, or generated GraphQL changes.

### Deferred to Follow-Up Work

- Locale-specific YouVersion version discovery and persistence: use YouVersion version APIs once product chooses supported translations per locale.
- Experience-page Bible Quotes parity: evaluate separately if CMS-authored Bible quote sections should also get a YouVersion panel.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/components/watch/BibleQuotesSection.tsx` is already a client component and is the insertion point for a below-carousel embed.
- `apps/web/src/components/watch/__tests__/BibleQuotesSection.test.tsx` already covers quote-card visibility, promo behavior, share behavior, verse preview fetching, locale mapping, unsafe book names, and external-link handling.
- `apps/web/src/components/ui/carousel.tsx` exposes `setApi`, `select`, carousel arrows, and Embla API access needed to track the selected slide.
- `apps/web/src/components/watch/SiblingCarousel.tsx` is the closest local pattern for tracking an active carousel index from Embla state.
- `apps/web/src/env.ts` uses `@t3-oss/env-nextjs`; new public YouVersion config belongs in the client env block and must be optional/defaulted.
- `apps/web/CLAUDE.md` warns that server-only admin credentials must not cross into client components; the YouVersion app key is public client config, not `WEB_ADMIN_API_KEYS`.

### Institutional Learnings

- `docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md`: preserve the Embla bleed/spacing recipe and keep non-slide content outside `CarouselContent`.
- `docs/solutions/design-patterns/always-render-cta-section-with-placeholder-row-20260505.md`: the Bible Quotes section stays visible because the promo card is always-on; YouVersion embed visibility is a separate decision.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`: new env vars must not become surprise deploy blockers.
- `docs/solutions/developer-experience/env-matrix-drift-from-runtime-requirements-20260421.md`: env requirements should follow runtime use, not planning intent.
- `docs/solutions/runtime-errors/nextjs-alloweddevorigins-hydration-dead-127-0-0-1-20260520.md` and `docs/qa/web-polish-pass-2026-05-20.md`: browser smoke must verify hydration and visible behavior, not just static DOM expectations.
- `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`: run the appropriate review tier before push when external API/UI triggers are present.

### External References

- YouVersion Platform overview: `https://developers.youversion.com/`
- YouVersion React SDK intro: `https://developers.youversion.com/sdks/introduction`
- YouVersion React SDK quickstart: `https://www.mintlify.com/youversion/platform-sdk-react/quickstart`
- `BibleTextView` API: `https://youversion-platform-sdk-react.mintlify.app/api/ui/bible-text-view`
- YouVersion authentication/app key docs: `https://developers.youversion.com/authentication`
- YouVersion attribution guidance: `https://developers.youversion.com/sdks/javascript/guides/copyright-and-attribution`

---

## Key Technical Decisions

- Use `@youversion/platform-react-ui` with `YouVersionProvider` and `BibleTextView`: this follows the official SDK and avoids inventing an iframe contract the repo does not already have.
- Add public optional config as `NEXT_PUBLIC_YOUVERSION_APP_KEY` and `NEXT_PUBLIC_YOUVERSION_DEFAULT_VERSION_ID`: the provider runs client-side, so the key is browser-exposed public app configuration; it must not be treated like a server secret.
- Default version ID to `111` only as a configurable starting point: YouVersion examples identify `111` as NIV, but long-term locale/version mapping is deferred until product chooses translations.
- Keep the provider as low in the tree as practical: wrap only the compact embed subtree, not the whole watch page, unless the SDK requires a broader boundary during implementation.
- Track active citation via Embla API state, not layout measurements: jsdom does not faithfully compute Embla snap layout, so tests should assert controlled state/DOM behavior rather than real scroll geometry.
- Render the compact panel below the carousel wrapper, not as a carousel slide: this preserves card scroll behavior and keeps the embed visually subordinate to the carousel.
- Preserve third-party attribution: show or verify YouVersion/Bible version copyright attribution unless `BibleTextView` renders it automatically.

---

## Open Questions

### Resolved During Planning

- Embed shape: compact passage panel, not a full reader or Verse of the Day.
- Surface: synthetic watch-page Bible Quotes section only.
- Execution posture: Red/Green TDD and user-facing smoke test are required.

### Deferred to Implementation

- Exact SDK peer dependency behavior with Forge's current React package range: verify during dependency installation/typecheck, because the docs mention React 19.1+ while `apps/web/package.json` currently declares React 19.
- Exact `BibleTextView` attribution rendering: verify in browser and add local attribution copy if the component does not display required version/copyright text.
- Exact test mocking shape for `@youversion/platform-react-ui`: decide while writing the first red tests so mocks match the installed package exports.

---

## Execution Orchestration

- Spawn a repo-pattern subagent before edits to re-check current `apps/web` conventions if the branch has moved.
- Spawn one implementation-adjacent lane before Green is claimed: either a worker owning converter/env tests, a worker owning component tests, or a reviewer validating the locally written Red tests before implementation proceeds.
- Spawn a verification lane after implementation to run browser smoke checks and report screenshots/console findings; this lane must receive the test watch URL, viewport sizes, and whether `NEXT_PUBLIC_YOUVERSION_APP_KEY` is configured.
- Spawn review lanes before push: correctness/testing review for all changes, plus external API/security review because the change introduces YouVersion public config and third-party scripture rendering.
- The orchestrator owns final integration, conflict resolution, and the final decision that Red/Green evidence plus browser smoke evidence are sufficient.

---

## Implementation Units

### U1. YouVersion Config and Dependency

**Goal:** Add the official YouVersion React SDK dependency and optional public config without changing default watch-page boot.

**Requirements:** R5, R6, R7, R9

**Dependencies:** None

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/env.ts`
- Modify: `apps/web/.env.example`
- Test: `apps/web/src/components/watch/__tests__/BibleQuotesSection.test.tsx`

**Approach:**

- Add `@youversion/platform-react-ui` to `apps/web`.
- Add optional `NEXT_PUBLIC_YOUVERSION_APP_KEY`.
- Add optional numeric/coerced `NEXT_PUBLIC_YOUVERSION_DEFAULT_VERSION_ID`, defaulting to `111`.
- Ensure missing app key means "no embed", not env validation failure.
- Check whether React 19.1+ is required in practice and record any dependency adjustment in the PR.

**Execution note:** Start Red: add a failing test proving the Bible Quotes section renders without a YouVersion app key and does not crash or render the embed.

**Patterns to follow:**

- `apps/web/src/env.ts` optional client env handling.
- `apps/web/vitest.setup.ts` existing test env defaults.

**Test scenarios:**

- Happy path: with public app key and default version ID mocked, component can render the YouVersion embed host.
- Edge case: missing app key renders no embed and preserves existing promo/card behavior.
- Edge case: invalid or missing default version ID falls back to the configured default behavior without throwing.

**Verification:**

- Web app boot does not require YouVersion config.
- Typecheck accepts the new env shape.

### U2. Citation to YouVersion Reference Mapping

**Goal:** Convert Forge `BibleCitation` data into the USFM reference strings required by YouVersion `BibleTextView`.

**Requirements:** R1, R2, R3, R7

**Dependencies:** U1

**Files:**

- Create: `apps/web/src/lib/youversion-reference.ts`
- Test: `apps/web/src/lib/__tests__/youversion-reference.test.ts`
- Modify: `apps/web/src/components/watch/BibleQuotesSection.tsx`
- Test: `apps/web/src/components/watch/__tests__/BibleQuotesSection.test.tsx`

**Approach:**

- Prefer citation `osisId` when it can be safely converted from OSIS-style book IDs to YouVersion USFM-style references.
- Support single verse, same-chapter ranges, and whole-chapter citations using existing `chapterStart`, `chapterEnd`, `verseStart`, and `verseEnd`.
- For cross-chapter ranges in v1, map to the starting verse only (for example, `GAL.2.20`) and rely on the existing card-level "Read more..." link for the full range. Do not invent an unverified YouVersion cross-chapter range string.
- Return `null` for unknown book IDs, missing chapter data, malformed ranges, or unsafe values so the UI can omit the embed.
- Keep formatting helper separate from `formatCitation()` because display labels and YouVersion machine references have different rules.

**Execution note:** Start Red: write failing unit tests for every supported reference shape before implementing the converter.

**Patterns to follow:**

- `apps/web/src/lib/citation-format.ts`
- `apps/web/src/lib/__tests__/citation-format.test.ts`

**Test scenarios:**

- Happy path: `osisId: "John.3.16"` or equivalent citation data maps to `JHN.3.16`.
- Happy path: same-chapter range maps to `JHN.3.16-17`.
- Happy path: cross-chapter range `Galatians 2:20-3:5` maps to the starting verse reference `GAL.2.20`.
- Happy path: chapter-only citation maps to `GEN.3`.
- Edge case: unknown book abbreviation returns `null`.
- Edge case: missing `chapterStart` returns `null`.
- Error path: hostile or malformed book/reference input never produces a URL-like or path-like string.

**Verification:**

- Converter tests prove all supported reference forms.
- Existing citation display tests still pass unchanged.

### U3. Compact Embed Rendering Below Carousel

**Goal:** Render the compact YouVersion passage panel below the carousel and keep it synchronized with the active citation.

**Requirements:** R1, R2, R3, R4, R5, R7

**Dependencies:** U1, U2

**Files:**

- Modify: `apps/web/src/components/watch/BibleQuotesSection.tsx`
- Test: `apps/web/src/components/watch/__tests__/BibleQuotesSection.test.tsx`

**Approach:**

- Use `Carousel setApi` to capture the Embla API.
- Track `activeIndex` from `selectedScrollSnap()` on `select` and `reInit`; initialize to `0`.
- Derive `activeCitation` only from `bibleCitations`, excluding the promo and end spacer slides.
- Render a compact panel below the carousel bleed wrapper only when app key and a valid active YouVersion reference exist.
- Use `YouVersionProvider` and `BibleTextView` with dark styling, compact typography, `renderNotes={false}` unless visual validation shows footnotes are essential, and no auth.
- Preserve the current card-level jsDelivr fetch and BibleGateway links; the new panel is additive.
- Include a visible reference/translation/copyright line if the SDK component does not supply it.

**Execution note:** Start Red: mock `@youversion/platform-react-ui` and add failing component tests for embed placement, default citation, active citation change, and no-render fallbacks before implementation.

**Patterns to follow:**

- `apps/web/src/components/ui/carousel.tsx`
- `apps/web/src/components/watch/SiblingCarousel.tsx`
- `apps/web/src/components/watch/watch-section-styles.ts`

**Test scenarios:**

- Happy path: first citation renders a compact YouVersion panel below `watch-bible-quotes-carousel-bleed`.
- Happy path: changing the selected carousel snap updates the mocked `BibleTextView reference`.
- Happy path: promo slide selection hides the YouVersion panel because the active slide is not a citation.
- Edge case: empty `bibleCitations` still renders the promo card but no YouVersion panel.
- Edge case: invalid citation renders no YouVersion panel and does not crash.
- Integration: Share button, promo CTA, carousel arrows, quote images, and existing verse preview still render after the embed is added.

**Verification:**

- Component tests demonstrate active-reference behavior and fallback behavior.
- Existing Bible Quotes tests remain green.

### U4. Watch Renderer and Configuration Safety

**Goal:** Ensure the watch route passes the right data into the embed path without widening the external contract or leaking server-only data.

**Requirements:** R3, R4, R6, R7

**Dependencies:** U3

**Files:**

- Modify: `apps/web/src/components/watch/WatchSectionRenderer.tsx` only if props need adjustment
- Test: `apps/web/src/components/watch/__tests__/WatchSectionRenderer.test.tsx` only if props need adjustment
- Test: `apps/web/src/components/watch/__tests__/BibleQuotesSection.test.tsx`

**Approach:**

- Prefer keeping `WatchSectionRenderer` unchanged because it already passes `bibleCitations` and `locale`.
- Do not pass server-only admin config or bearer values into the client tree.
- Keep Experience override behavior unchanged: if the synthetic `BibleQuotes` block is replaced by `ComponentSectionsBibleQuotesCarousel`, this plan does not add a YouVersion embed there.

**Execution note:** If `WatchSectionRenderer` changes, add Red tests before implementation; otherwise explicitly note no renderer test change is needed in the PR.

**Patterns to follow:**

- `apps/web/src/components/watch/WatchSectionRenderer.tsx`
- `apps/web/src/lib/__tests__/content-watch-merge.test.ts`

**Test scenarios:**

- Happy path: existing renderer test still proves `BibleQuotesSection` receives `bibleCitations` and locale.
- Edge case: Experience override tests remain unchanged and do not accidentally imply a YouVersion embed on CMS-authored quote sections.
- Error path: missing YouVersion config does not affect watch block rendering.

**Verification:**

- No server-only env var appears in the browser-facing YouVersion code path.
- Existing watch merge tests remain green.

### U5. Browser Smoke and Review Gate

**Goal:** Prove the user-visible experience works after implementation and before shipping.

**Requirements:** R4, R8, R9

**Dependencies:** U1, U2, U3, U4

**Files:**

- Modify: `docs/roadmap/topic-experiences/feat-061-watch-platform-upgrade-bible-verse-visuals.md`
- Optional Create: `docs/qa/youversion-bible-quotes-embed-2026-05-27.md`

**Approach:**

- Mark `feat-061` in progress when execution starts and complete when validated, or create a follow-up ticket if only part of the roadmap item is completed.
- Run focused tests first, then full `@forge/web` test/typecheck/lint validation.
- Obtain a real YouVersion app key from the YouVersion Platform portal or the team's approved secret store and set it locally as `NEXT_PUBLIC_YOUVERSION_APP_KEY`; if no key is available, stop before marking the feature complete and record the blocker.
- Open a real watch URL in browser with YouVersion config present. The smoke URL must use a video whose `bibleCitations` payload contains at least two citation cards so active-slide update behavior can be proven.
- Smoke at mobile and desktop widths: carousel scroll/arrows, active quote changes, compact embed placement below the carousel, no text overlap, no hydration failure, no console errors attributable to the integration, and acceptable third-party network behavior.
- Run subagent review lanes before push: correctness/testing plus external API/security.

**Execution note:** User smoke test is required. Do not mark this work complete from unit tests alone.

**Patterns to follow:**

- `docs/qa/web-polish-pass-2026-05-20.md`
- `docs/solutions/runtime-errors/nextjs-alloweddevorigins-hydration-dead-127-0-0-1-20260520.md`
- `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`

**Test scenarios:**

- Integration: mobile viewport shows the carousel followed by a compact YouVersion panel without overlapping controls or text.
- Integration: desktop viewport shows visible carousel arrows and the compact panel below the carousel.
- Integration: selecting another quote updates the panel to the selected citation.
- Error path: with app key absent, the watch page still renders the current Bible Quotes carousel and promo card cleanly.

**Verification:**

- Browser smoke evidence exists in the PR notes or QA doc.
- Review findings are addressed or explicitly deferred.
- Roadmap ticket status reflects actual completion state.

---

## System-Wide Impact

- **Interaction graph:** `WatchSectionRenderer` renders `BibleQuotesSection`; `BibleQuotesSection` owns Embla active state and YouVersion embed rendering; existing card fetches remain client-side.
- **Error propagation:** YouVersion config absence and invalid citations degrade by hiding the embed, not by throwing.
- **State lifecycle risks:** Active carousel index must not drift onto promo/end-spacer slides and produce invalid references.
- **API surface parity:** CMS-authored `BibleQuotesCarousel` remains unchanged; only synthetic watch Bible Quotes receives the embed.
- **Integration coverage:** Browser smoke is required because jsdom cannot prove Embla layout, third-party SDK rendering, hydration, or network behavior.
- **Unchanged invariants:** Existing quote-card display, Share modal trigger, promo CTA, BibleGateway links, and current verse preview fetch stay intact.

---

## Risks & Dependencies

| Risk                                                                                           | Mitigation                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| YouVersion SDK peer dependencies may require React 19.1+ while Forge declares React 19.0 range | Verify during dependency install/typecheck; adjust package versions only if required and keep the change scoped to `apps/web`     |
| YouVersion app key is exposed in the browser                                                   | Treat it as public app configuration, confirm YouVersion portal restrictions/rate limits, and never use server-only Forge secrets |
| Missing YouVersion env bricks deploy                                                           | Keep env optional and render no embed when absent                                                                                 |
| Third-party SDK renders attribution differently than expected                                  | Browser-smoke the rendered panel and add local attribution text if required                                                       |
| Carousel active state is hard to prove in jsdom                                                | Unit-test state wiring with mocked Embla/API behavior and require browser smoke for real interaction                              |
| Adding below-fold third-party content hurts page performance                                   | Keep the embed compact, avoid image/player priority hints, and do not load it when no valid citation/config exists                |

---

## Documentation / Operational Notes

- Add YouVersion env vars to `apps/web/.env.example`.
- PR notes must name the smoke-test watch URL, confirm it had at least two Bible citation cards, and state whether the app key came from the YouVersion Platform portal or the team's approved secret store.
- PR notes must include Red/Green TDD evidence and user smoke test evidence.
- If the YouVersion provider cannot be validated because credentials are unavailable, do not mark the feature fully complete; leave `feat-061` incomplete or create a follow-up ticket.

---

## Sources & References

- Related roadmap: `docs/roadmap/topic-experiences/feat-061-watch-platform-upgrade-bible-verse-visuals.md`
- Related code: `apps/web/src/components/watch/BibleQuotesSection.tsx`
- Related tests: `apps/web/src/components/watch/__tests__/BibleQuotesSection.test.tsx`
- Related formatter: `apps/web/src/lib/citation-format.ts`
- Related carousel: `apps/web/src/components/ui/carousel.tsx`
- External docs: `https://youversion-platform-sdk-react.mintlify.app/api/ui/bible-text-view`
- External docs: `https://developers.youversion.com/authentication`
