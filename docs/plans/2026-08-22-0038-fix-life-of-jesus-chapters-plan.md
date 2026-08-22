---
title: "Life of Jesus Chapter Context - Plan"
type: "fix"
date: "2026-08-22"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
roadmap: "docs/roadmap/platform/feat-416-watch-life-of-jesus-chapter-context.md"
---

# Life of Jesus Chapter Context - Plan

## Goal Capsule

- **Objective:** Viewers can continue the 49-Chapter _Life of Jesus (Gospel of John)_ curriculum from the playable full-film Watch page without losing the film's identity or its existing collection contexts.
- **Means:** Append the film's own manifest-admitted Chapters to the standalone page's existing selectable carousel contexts (KTD1, KTD2).
- **Authority:** The user-directed scope and durable FGE-75 evidence govern product behavior; this plan governs implementation; repository and package instructions govern execution details.
- **Execution profile:** One Web-only behavioral change with characterization-first coverage, followed by browser and page-load proof.
- **Stop conditions:** Stop if the result requires an Admin/schema change, a publication or rights-gate relaxation, a film reclassification or redirect, or an inference about the unresolved Acts case.
- **Tail ownership:** The LFG caller owns review, compounding, commit, PR, and CI resolution. It must not deploy production or send a Help Scout reply.

---

## Product Contract

### Summary

The standalone _Life of Jesus (Gospel of John)_ Watch page will retain its eligible parent collections and add the film's own ordered Chapters as another selectable context. Selecting that context reveals the established short-clip curriculum while the page remains the same playable 183-minute feature film.

### Problem Frame

The film still owns 49 ordered Chapter relations, and Chapter pages such as _Triumphal Entry and Results_ remain playable, downloadable, and discoverable. The standalone film page currently supplies eligible parent collections to the sibling-carousel merge, and that list takes precedence over the film's own children. Production therefore defaults to JFM's 10-film context and gives the viewer no way to select the film-owned 49-Chapter context.

This is a Web composition defect, not evidence that the film or its Chapters need new catalog identity. FGE-75 retains the original 73-clip Acts report as a separate unresolved residual because its authoritative catalog state and root cause are not established.

### Key Decisions

- **Add the film-owned Chapters as a selectable standalone context.** (session-settled: user-directed — chosen over replacing eligible parent collections or reclassifying and redirecting the film: the additional context restores the curriculum without changing the feature film's identity.) Governs R1-R6.
- **Keep the fix Web-only.** (session-settled: user-directed — chosen over Admin, schema, and catalog mutation: current data already contains the ordered relationships and Web's merge masks them.) Governs R2-R7.
- **Leave the Acts case unresolved in FGE-75.** (session-settled: user-directed — chosen over generalizing one catalog diagnosis to both reports: current evidence does not prove the same cause.) Governs R8.

### Requirements

**Selectable Chapter context**

- R1. On a standalone playable-video route with eligible parent contexts, append a selectable context for the current Video's own Chapters when at least two exact current-language Chapter routes are admitted.
- R2. Build the own-Chapter context from the current Watch snapshot children intersected with Watch Route Manifest admission, without deriving rendering data from the manifest alone.
- R3. Preserve relation-owned Chapter order and the existing eligible-parent order.
- R4. Keep the first eligible parent as the initial selection and append the film-owned context after all eligible parents.

**Identity and navigation**

- R5. Changing the selector must update only the sibling rail and its accessible context while the standalone film URL, hero playback, full-film downloads, language state, canonical, Share, and media metadata remain unchanged.
- R6. Chapter cards in the film-owned context must use the existing contextual Watch route for the selected audio language, including _Triumphal Entry and Results_ at its relation-owned position.

**Safety and compatibility**

- R7. Preserve current publication, deletion, Watch restriction, playability, slug, and route-admission gates without adding an Admin operation, schema change, browser data request, or dependency.
- R8. Do not change contextual routes, LUMO content, the unresolved 73-clip Acts behavior, or unrelated Watch content that does not satisfy the same eligible-parent plus admitted-own-Chapters contract.
- R9. When the manifest is unavailable, fewer than two own Chapter routes remain admitted, or no eligible parent context exists, preserve the current fallback behavior.

**Delivery quality**

- R10. Add focused automated coverage for ordering, fallback, selector behavior, navigation, and standalone identity invariants.
- R11. Prove the production-shaped Life of Jesus flow at desktop and compact widths, including the 49-Chapter context and _Triumphal Entry and Results_ at clip 30 of 49 when current catalog data remains unchanged.
- R12. Demonstrate no new initial browser request, no eager loading of the alternate context's full thumbnail set, and no material page-load or hydration regression against `origin/main`.

### Acceptance Examples

- AE1. Covers R1, R3-R6, R11. Given the English standalone Life of Jesus film with its current eligible parents and 49 admitted Chapters, when the viewer selects the Life of Jesus context, then the rail reports 49 Chapters and _Triumphal Entry and Results_ is the 30th item while the browser remains on the full-film route.
- AE2. Covers R4-R5, R8. Given the same page before any selection, when it renders, then the first eligible parent remains selected and its existing rail, related-item JSON-LD, hero, Share, download, and canonical behavior are unchanged.
- AE3. Covers R2, R7, R9. Given an unavailable manifest or fewer than two admitted own Chapters, when the standalone page renders, then it exposes no new own-Chapter selector choice and retains the existing safe fallback.
- AE4. Covers R6, R8. Given the viewer chooses _Triumphal Entry and Results_ from the film-owned rail, when navigation completes, then the existing contextual Chapter route plays and downloads that Chapter without routing to LUMO or another collection.

### Scope Boundaries

#### In Scope

- Standalone Web route composition for the film-owned selectable Chapter context.
- Focused route, merge, carousel, navigation, identity, browser, and performance proof.
- A new `feat-416` platform roadmap ticket linked to FGE-75 and this plan.

#### Deferred to Follow-Up Work

- The original 73-clip Acts discovery and routing diagnosis remains in FGE-75.
- Any stale solution-document corrections discovered during planning should be handled only if compounding finds they materially affect this work.

#### Outside This Product's Identity

- Reclassifying a playable film as a Series-Shaped container because it owns Chapters.
- Recreating, republishing, relabeling, or changing rights for catalog content.
- Replacing the established curriculum with LUMO or unrelated content.
- Production deployment and Help Scout communication.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Compose the own-Chapter choice from the admission-filtered Watch snapshot.** (session-settled: user-directed — chosen over an Admin/schema change or manifest-only projection: the existing snapshot owns rendering and restriction truth while the manifest proves the exact public route.) Build the virtual context from the already filtered `WatchVideoRecord.children` used by the standalone carousel. Implements R1-R3 and R7.
- KTD2. **Append without changing the default context.** (session-settled: user-directed — chosen over giving the film's own children merge precedence: an additional choice restores access while preserving today's parent order, initial rail, and structured data.) Keep eligible parents first and add the virtual current-Video parent last. Implements R3-R5.
- KTD3. **Reuse the existing compact selector contract.** The current `CarouselParent`, `WatchSiblingCarouselBlock`, `SiblingCarousel`, and pending-navigation paths already support multiple contexts and a virtual parent whose children do not contain the current Video. Limit production edits to standalone route composition unless characterization exposes a concrete gap. Implements R5-R7 and R10.
- KTD4. **Measure serialized payload cost instead of adding runtime loading.** The added context can increase HTML/RSC bytes, but it must not add a GraphQL/browser fetch or make alternate-context thumbnails eager. Implements R7 and R12.

### Assumptions

- Production and the current Admin snapshot continue to expose 49 ordered Life of Jesus Chapter relations during execution. If that count changes, the implementation must preserve the live admitted order and record the drift instead of hard-coding 49.
- The production film page continues to use the synthetic sibling-carousel slot. If an Experience override begins owning the slot, stop and reassess rather than bypassing the override contract.
- `feat-416` remains the next unreserved global roadmap ID after accounting for `feat-413` on the active FGE-30 recovery branch and `feat-414`/`feat-415` on the active playlist branch. Recheck before creating the ticket.

### Risks & Dependencies

- **Payload growth:** Serializing the additional Chapter context can enlarge HTML/RSC output. Keep the compact existing model and validate raw and compressed transfer, warmed response timing, hydration, and LCP.
- **Gate drift:** The Watch Route Manifest is an admission contract, not a rendering or complete rights payload. Intersect it with restriction-filtered snapshot children and do not enumerate Chapter data from the manifest.
- **Identity leakage:** Making the virtual parent the default would change default related-item JSON-LD and rail semantics. Preserve the first eligible parent as `canonicalParent`.
- **Concurrent Watch work:** Open PR #2003 and older Watch PRs touch adjacent client/navigation files. Keep the minimal change out of those files unless tests prove it necessary, and rebase before shipping.

### Sources & Research

- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — standalone parent selection, manifest admission, and parallel route loading.
- `apps/web/src/lib/content.ts` — carousel merge precedence and virtual own-children parent behavior.
- `apps/web/src/components/watch/SiblingCarousel.tsx` — existing multi-context selection and parent-mode rendering.
- `apps/web/src/components/watch/WatchPageClient.tsx` — pending navigation across selectable contexts.
- `docs/plans/2026-07-22-001-feat-watch-standalone-collection-episodes-plan.md` — design and performance contract for the existing standalone selector.
- `docs/solutions/logic-errors/tv-childcount-not-a-series-container-signal.md` — Chapters do not make a playable film Series-Shaped.
- `docs/solutions/architecture-patterns/admin-owned-watch-route-manifest-20260530.md` — manifest admission boundaries.
- `docs/solutions/design-patterns/relation-specific-order-in-aggregated-read-models-20260616.md` — relation-owned ordering after filtering.
- `docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md` — standalone identity versus contextual navigation.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — required frontend load evidence.
- [Linear FGE-75](https://linear.app/jesus-film-project/issue/FGE-75/watchbug-route-the-73-clip-acts-study-to-its-intended-collection) — durable support evidence and residual boundary.
- [Production Life of Jesus film](https://www.jesusfilm.org/watch/life-of-jesus-gospel-of-john.html) — current full-film surface and masked JFM default.

---

## Implementation Units

### U1. Create the roadmap execution contract

- **Goal:** Allocate and start the roadmap ticket before product edits.
- **Requirements:** R8, R10-R12.
- **Dependencies:** None.
- **Files:**
  - `docs/roadmap/platform/feat-416-watch-life-of-jesus-chapter-context.md`
  - `docs/roadmap/README.md`
- **Approach:** Recheck `origin/main` and open PR roadmap reservations, then create the next sequential platform ticket with `status: "in-progress"`, FGE-75 and plan links, exact entry points, constraints, and verification. Update the generated roadmap index if the repository workflow requires it.
- **Patterns to follow:** `docs/roadmap/platform/feat-412-watch-share-usage-guidance.md` and the roadmap format in `CLAUDE.md`.
- **Test scenarios:** Test expectation: none — this unit creates the repository execution contract and contains no runtime behavior.
- **Verification:** The ticket is globally unique, linked to this plan and FGE-75, agent-optimized, and in progress before U2 edits product code.

### U2. Append the admitted own-Chapter context

- **Goal:** Make the film-owned Chapter rail selectable without changing the existing default or standalone identity.
- **Requirements:** R1-R10; covers AE1-AE4.
- **Dependencies:** U1.
- **Files:**
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
  - `apps/web/src/lib/__tests__/content-watch-merge.test.ts`
  - `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`
  - `apps/web/src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`
- **Approach:**
  1. Characterize the current eligible-parent precedence and own-children fallback before changing composition.
  2. Before settling the implementation, serialize the production-shaped 49-Chapter context against a pinned `origin/main` merge-base and the same Admin snapshot/runtime configuration. Measure compressed initial HTML/RSC transfer and throttled compact-width loading; stop and reopen KTD4 if the existing 10% non-regression budget cannot be met without a different loading architecture.
  3. Build the standalone own-Chapter virtual parent from the admission-filtered current Video and append it only when eligible parents exist and at least two own Chapters remain.
  4. Preserve the original first parent as the block's default `canonicalParent`; keep the existing fixed own-children fallback when no eligible parent exists.
  5. Avoid component or navigation production edits unless a focused characterization test demonstrates a missing contract.
- **Execution note:** Start with the failing production-shaped route characterization so the diff proves the masked-context defect before changing the composition.
- **Patterns to follow:** `selectableParentsForStandaloneVideo`, `withAdmittedVideoChildren`, `buildSiblingCarouselBlock`, the selector tests beside `SiblingCarousel`, and KTD1-KTD3.
- **Test scenarios:**
  1. Covers AE1. A standalone video with ordered eligible parents and 49 admitted own Chapters keeps all parent choices in order and appends one virtual own-Chapter context containing the unchanged ordered Chapters.
  2. Covers AE2. The first eligible parent remains the default `canonicalParent`, and default related-item JSON-LD, hero progression, standalone Share identity, full-film download sequence, and canonical metadata remain unchanged.
  3. Covers AE1. Selecting the virtual context enters parent mode, reports 49 Chapters without a false active card, and keeps _Triumphal Entry and Results_ at zero-based index 29.
  4. Covers AE4. A Chapter card in the virtual context produces the existing contextual route and remains accepted by pending-navigation validation and route warming.
  5. Covers AE3. A null manifest or fewer than two admitted own Chapters adds no selectable own context and preserves current fallback behavior.
  6. A standalone video with admitted own Chapters but no eligible external parent keeps the existing fixed own-children carousel instead of gaining a one-option selectable shape.
  7. Unpublished, restricted, unavailable-language, invalid-slug, or non-admitted children never appear in the virtual context.
  8. Contextual Chapter routes and unrelated standalone video fixtures that do not meet the eligible-parent plus admitted-own-Chapters contract receive no new selector choice or identity change.
  9. Switching from the own context back to an eligible parent restores the current-film active position and accessible selection announcement.
- **Verification:** Focused route, merge, carousel, and navigation suites pass with no product diff outside the standalone route seam unless a documented failing test requires it.

### U3. Prove the production-shaped flow and load posture

- **Goal:** Demonstrate the restored curriculum and absence of behavioral or page-load regression.
- **Requirements:** R5-R12; covers AE1-AE4.
- **Dependencies:** U2.
- **Files:**
  - `docs/roadmap/platform/feat-416-watch-life-of-jesus-chapter-context.md`
- **Approach:** After the final rebase, record the exact merge-base SHA and Admin snapshot version, then compare that pinned baseline build and the branch build using the same snapshot and runtime configuration on the Life of Jesus standalone route and a contextual Chapter control. Capture behavior at desktop and compact widths, record transfer and request evidence, then update the ticket with exact outcomes and mark it complete only after all gates pass.
- **Patterns to follow:** `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` and the completion evidence in `docs/roadmap/platform/feat-287-watch-standalone-collection-episodes.md`.
- **Test scenarios:**
  1. Covers AE1. The standalone film initially shows the existing first eligible parent, then exposes all currently admitted own Chapters after selecting the Life of Jesus context.
  2. Covers AE4. _Triumphal Entry and Results_ appears at clip 30 of 49 under unchanged catalog data, navigates to the contextual Chapter route, and remains playable and downloadable.
  3. Covers AE2. Merely switching context does not change the URL, hero playback, full-film download action, canonical, Share identity, or media metadata.
  4. Desktop and compact layouts keep the selector keyboard-operable, labeled, focus-visible, announced, and free of document-level horizontal overflow.
  5. The branch adds no browser GraphQL/API request, does not eager-load all alternate Chapter thumbnails before selection, and retains one hero-critical image preload.
  6. Initial HTML/RSC raw and compressed growth is attributable only to the compact context payload; warmed response timing, hydration, LCP, and console output show no material regression against the baseline.
  7. The contextual Chapter control renders its fixed rail with no standalone selector regression.
- **Verification:** Browser, server-response, resource-timing, and transfer evidence is recorded in the completed roadmap ticket, with limitations named instead of claimed as passes.

---

## Verification Contract

| Gate                  | Scope                                                                                                                                                           | Done signal                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused behavior      | Catch-all page routing, merge, carousel, and pending-navigation tests                                                                                           | All production-shaped ordering, fallback, identity, and navigation scenarios pass.                                                                                                  |
| Web static checks     | `@forge/web` typecheck, lint, and formatting for every changed file                                                                                             | No TypeScript, lint, generated-catalog, formatting, or diff-check failure.                                                                                                          |
| Broader regression    | PR-focused Web tests and CI-sensitive checks for the touched route                                                                                              | No unrelated Watch route or component regression.                                                                                                                                   |
| Production build      | `@forge/web` production build against the repository's supported local Admin setup                                                                              | Build succeeds without generated GraphQL drift or client/server boundary errors.                                                                                                    |
| Browser behavior      | Life of Jesus standalone route plus contextual Chapter control at desktop and compact widths                                                                    | Selector, 49-Chapter flow, clip position, playback/download, identity, accessibility, and responsive behavior match R5-R11.                                                         |
| Page-load performance | Pinned final merge-base versus branch request, transfer, timing, hydration, LCP, and console evidence against the same Admin snapshot and runtime configuration | No new browser data request or eager alternate rail; warmed response and user-visible loading remain within the existing 10% non-regression budget, with payload growth quantified. |
| Roadmap closeout      | `feat-416` ticket                                                                                                                                               | Status is complete with exact validation and performance evidence plus the PR link when available.                                                                                  |

---

## Definition of Done

- U1 is complete before product edits, and `feat-416` is the verified next sequential ID.
- U2 satisfies R1-R10 and AE1-AE4 with focused automated coverage.
- U3 satisfies R5-R12 with recorded browser and page-load evidence against `origin/main`.
- The diff remains Web-only except for the plan, roadmap ticket, generated roadmap index, and durable learning produced by the required workflow.
- The film remains a playable standalone feature film with unchanged full-film playback, download, canonical, Share, language, and media identity.
- Publication, rights, and route-admission gates are no weaker than `origin/main`.
- The Acts residual remains in FGE-75 without inferred implementation.
- All dead-end or experimental code is removed from the final diff.
- Review, simplification, compounding, PR creation, and CI resolution complete without a production deploy or Help Scout reply.
