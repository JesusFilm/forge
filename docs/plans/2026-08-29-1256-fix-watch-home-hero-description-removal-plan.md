---
title: "Watch Home Hero Description Removal - Plan"
type: fix
date: "2026-08-29"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Home Hero Description Removal - Plan

## Goal Capsule

- **Objective:** A visitor landing on `/watch` reads the hero's identity — label and title — and reaches the Watch Now action without a block of catalog boilerplate in between.
- **Means:** Delete the secondary paragraph from the hero overlay, then drop the fields that only that paragraph read (KTD1, KTD3).
- **Authority:** Requirements win on behavior. KTDs win on mechanism inside those requirements. Units override neither.
- **Execution profile:** Small, localized UI removal plus a dead-field prune. Two units, sequenced so the visible change lands independently of the prune.
- **Stop conditions:** Stop and report if pruning the fields (U2) reveals a reader outside `apps/web`'s home path; if the R5 byte signal shows transferred document + RSC flight bytes _increasing_; or if the median LCP shift falls outside the baseline set's own run-to-run spread.
- **Tail ownership:** `ce-work` implements and verifies locally. Shipping is the calling pipeline's.

## Product Contract

### Summary

Remove the secondary paragraph from the `/watch` intro-video hero carousel, leaving eyebrow, title, and the Watch Now button. Then remove the `snippet` and `description` fields that only that paragraph read, down through the GraphQL selection.

### Problem Frame

The `/watch` hero renders a secondary paragraph under the title. That paragraph is not a single field: `apps/web/src/lib/watch-home.ts` resolves it as `locale?.snippet ?? locale?.description ?? null`, so an authored **snippet** wins whenever one exists and the raw catalog **description** is the fallback.

The fallback case is what motivates the change. For the vertical and LUMO catalog, `description` is not marketing copy — it is passage lists, production credits, bare URLs, and social handles. The reported case renders roughly ten lines of chapter references followed by `lumoproject.com`, a Facebook URL, a Twitter URL, and an Instagram URL, pushing the Watch Now button toward the bottom of the frame and burying the one thing the hero exists to sell.

Two facts bound how that reads. The paragraph already carries `sm:line-clamp-3` alongside `sm:block` in the same class string, so a three-line cap is declared — and the reported case shows about ten lines at a desktop width, meaning `sm:block`'s `display: block` is overriding line-clamp's `display: -webkit-box` and the cap is not in effect. And the paragraph is suppressed entirely below the `sm` breakpoint by `hidden sm:block`, so the surface was already judged not worth its space on mobile without the desktop case being revisited.

How much of the hero is boilerplate has not been measured. The hero draws from four hardcoded ids in `WATCH_HOME_HERO_SOURCE_IDS` plus a curated playlist sequence, and whether each of those records carries an authored snippet or falls through to the raw description needs a live admin response to answer. See Open Questions.

### Requirements

**Hero overlay**

- R1. The `/watch` home hero overlay renders the eyebrow label, the title, and the primary action, and no secondary paragraph, at every viewport width.
- R2. The remaining overlay items keep a contiguous stagger cadence on both enter and exit, with no dead beat where the paragraph used to sit.
- R3. No surface other than the `/watch` home hero loses its secondary copy — the watch video page, home section headers, search result cards, and `apps/tv`'s `HeroCopyBlock` are untouched.

**Dead data**

- R4. After R1, neither `snippet` nor `description` travels from admin to the browser on the `/watch` home path: both are absent from the card and carousel-slide models, from their mappings, and from the GraphQL locale selection that fed them.
- R5. `/watch` page-load performance is not degraded relative to the pre-change build, measured per the Verification Contract's pass/fail signal.

### Key Decisions

- **Remove the paragraph rather than clamp, shorten, or conditionally hide it.** The user asked for removal of the text. Governs R1, R2.
  - Rejected alternative: restore the declared three-line cap by dropping `sm:block` so line-clamp takes effect. This is a one-class change and would fix the overflow the reported case shows, but it keeps a paragraph the user asked to remove.
  - Rejected alternative: remove the paragraph only where it falls back to the raw `description`, keeping authored snippets. This preserves curated copy but leaves the hero's composition varying slide to slide.

  Provenance note: this arrived as an unexamined directive, not a settled decision — no alternative was surfaced to the user before they asked. It received its one planning challenge, recorded under KTD1, and stands. Both rejected alternatives above are live redirects if the user wants one; see Open Questions.

- **Prune `snippet` alongside `description`.** The two fields have one shared reader, so removing one and keeping the other would leave a fetched-but-unused field. Governs R4.

### Success Criteria

- The hero's Watch Now button sits directly under the title at desktop widths, with no reflow gap where the paragraph was.
- The `/watch` served HTML and RSC flight payload no longer contain any slide's snippet or description text.
- Transferred document + RSC flight bytes for `/watch` do not increase.

### Scope Boundaries

- The `description` field on `WatchHomeSection` (the authored section subtitle, e.g. "Explore the collection.") is a different field with a live reader in `WatchHomeSection.tsx`, and stays. Authored block-level fields (`mediaDescription`, `carouselDescription`) also stay.
- `apps/tv`'s `HeroCopyBlock` keeps its description. A 10-foot UI has different copy economics and the user scoped this to the web `/watch` page. `apps/mobile` and `apps/tv` each declare their own copy of the video fragment, so narrowing web's cannot reach them.
- The watch video detail page's description and search-result snippets are untouched.
- `/watch` **does** render `WatchStructuredData`, but its JSON-LD is unaffected — see KTD1 for why.
- `WatchHomeHero.tsx`'s rendering logic is not imported by any route and is not touched. Only its colocated fixture in `WatchHomeHero.test.tsx` is edited in U2, to strip the removed field for type-conformance with the narrowed model.

#### Deferred to Follow-Up Work

- Whether the hero should carry any secondary line at all (duration, chapter count, series name) in the space the paragraph vacates. This plan removes; it does not replace.
- Cleaning up the catalog records whose `description` is production boilerplate. That is an admin-side data problem, and it also feeds the watch video page that R3 preserves.

### Open Questions

All three are deferred, not blocking — U1 and U2 are executable as written. Each is a redirect the user may want after seeing the corrected framing.

- Deferred: now that the hero is known to render authored snippets in preference to raw descriptions, does the user still want removal on every slide, or only where it falls back to `description`? The Key Decisions provenance note flags the originating instruction as unexamined.
- Deferred: the declared `sm:line-clamp-3` is being defeated by `sm:block`. If the user's objection is the overflow rather than the paragraph, the one-class clamp fix is the smaller response.
- Deferred: how many of the four `WATCH_HOME_HERO_SOURCE_IDS` records and the playlist-sequence videos actually resolve to boilerplate. If it is one or two records, the deferred admin-copy cleanup is the more durable fix.

### Sources

- `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — `WatchHomeTvOverlayContent` holds the only render of `slide.description`; `watchHomeHeroSlidesToTvCarouselSlides` is the hero mapping. Verified: the only other occurrences in `apps/web` are the two mapping writes and the unrelated `WatchHomeSection.description`.
- `apps/web/src/lib/watch-home.ts` — `description: locale?.snippet ?? locale?.description ?? null` is the single read of both GraphQL fields; `cardToCarouselSlide` is the pool mapping.
- `apps/web/src/app/[locale]/[htmlLang]/page.tsx` — the `/watch` route. Declares `dynamic = "force-static"` with `revalidate = 3600`, so the served HTML carries one static render, and renders `WatchStructuredData` from `watchHomeCollectionStructuredDataJson`.
- `apps/web/src/lib/watch-home-visible-content.ts` — `WatchHomeVisibleDestination` is `{ name, url }`, the shape that feeds the home JSON-LD's ItemList.
- `apps/web/src/lib/admin-client.ts` — throws at module import unless `ADMIN_GRAPHQL_URL` and `WEB_ADMIN_API_KEYS` are set. This is the browser-proof prerequisite in the Verification Contract.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — governs the R5 evidence bar; it does not define a numeric tolerance, which is why the Verification Contract defines one here.
- `docs/plans/2026-08-28-2320-fix-watch-organic-search-recovery-plan.md` — its R13 requires every shipped change to declare a Search Console baseline, release date, and evaluation date.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Delete the paragraph block from `WatchHomeTvOverlayContent`; do not gate it behind a flag or a wider breakpoint.** The planning challenge against the directive asked whether the paragraph is load-bearing for SEO. It is not, but the reason needs stating precisely, because `/watch` does emit JSON-LD. The home route renders `<WatchStructuredData json={structuredData} />`, and `WatchStructuredData` is only the script-tag renderer — it takes a prebuilt JSON string. That string comes from `watchHomeCollectionStructuredDataJson`, whose ItemList entries are `WatchHomeVisibleDestination` values carrying `name` and `url` only, and whose page-level `description` is the `WATCH_HOME_DESCRIPTION` constant. No slide's snippet or description reaches the JSON-LD. Page metadata likewise comes from `WATCH_HOME_DESCRIPTION` / `WATCH_HOME_SOCIAL_DESCRIPTION`, not slide data. What is lost is indexable body text: because the route is `force-static`, that is the first slide's paragraph in the served HTML, plus whatever authored snippets the other slides carry in the flight payload. Governs R1.
- KTD2. **Re-slot the primary action from stagger index 3 to index 2, and trim both delay arrays to three entries.** The arrays are indexed per item, so leaving the action at index 3 keeps a dead beat where the paragraph used to animate — 140ms on enter, 70ms on exit. Note this is not purely a regression guard: the paragraph is already conditional, so slides carrying neither snippet nor description animate the action at index 3 today. The re-slot makes the cadence uniform for every slide rather than only restoring a prior state. Governs R2.
- KTD3. **Prune the fields end-to-end in a separate unit from the visual change.** After KTD1 the fields have no reader on the home path, and they are not free: they cross the RSC boundary for every hero slide and every pooled carousel video into two client components, on a route under active LCP work. Keeping the prune in its own unit means the user-visible change (U1) is reviewable and revertable on its own if the prune runs into an unexpected reader. Governs R4.
- KTD4. **Make transferred bytes the R5 pass/fail signal and treat timing as advisory.** The cited convention defers the tolerance question, and an LCP pair on a video-hero route differs by hundreds of milliseconds of ordinary noise, so a timing-only gate either halts a correct change or gets rubber-stamped. For a pure deletion, transferred document + RSC flight bytes can only fall, which makes it decidable. Governs R5.

### Assumptions

These are planning bets made without user confirmation.

- The user means the `/watch` home page hero specifically — the surface in the reported case — not secondary copy elsewhere on the site. R3 and Scope Boundaries encode that reading.
- Removing dead payload is welcome alongside the visual change rather than scope creep. U2 is separable if that is wrong.
- Nothing outside this repo consumes `apps/web`'s `WatchHomeCard` shape, so narrowing it is not a contract change. The type is not exported from a shared package.

### Sequencing

U1 lands the user-visible change and can ship alone, so it carries the R5 gate rather than deferring it to U2. U2 depends on U1 having removed the only reader.

---

## Implementation Units

### U1. Remove the hero paragraph

- **Goal:** The `/watch` hero overlay stops rendering the secondary paragraph, and the remaining items animate without a gap.
- **Requirements:** R1, R2, R3, R5. Applies KTD1, KTD2, KTD4.
- **Dependencies:** none
- **Files:**
  - `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — modify `WatchHomeTvOverlayContent`
  - `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — modify
- **Approach:** 0. Capture the `/watch` page-load baseline before editing anything — transferred document + RSC flight bytes, plus LCP/Web Vitals over at least three runs, from a `next build` + `next start` run on the unmodified tree, with the LCP element named. Recovering this after the edits costs a stash and a full rebuild.
  1. Delete the conditional paragraph `<p>` from `WatchHomeTvOverlayContent`. It is the only render of `slide.description`; both the entering and the leaving overlay instance go through this one component, so one deletion covers both.
  2. Move the `PrimaryAction` wrapper from `delayStyle(3)` to `delayStyle(2)`, and drop the fourth entry from `enterDelays` and `exitDelays` so array length matches the item count.
  3. Leave the eyebrow and title blocks, the `min-w-0` wrapper, and the outer `gap-3 sm:gap-4` spacing alone — the wrapper's own gap already separates the title from the action.
- **Patterns to follow:** The existing `itemClassName` + `delayStyle(index)` pairing on each overlay item; keep every remaining item on that same pairing.
- **Execution note:** This is above-the-fold layout. Prefer a real browser check at a desktop width as the first proof after the baseline is banked, then the unit assertions.
- **Test scenarios:**
  - Rendering the home page with a hero slide whose `description` is a non-empty string produces markup containing the title but not that text. This inverts the existing `expect(container.textContent).toContain("The story of Jesus")` assertion in `WatchHomePage.test.tsx`; the fixture string is shared with section cards, which never rendered it, so the assertion is meaningful only against the hero.
  - The primary action still renders, still links to the slide's watch destination, and still carries the translated "Watch Now" text as its accessible name. Match the existing `.textContent).toContain("Watch Now")` pattern already in that file — the link has no `aria-label`, and adding per-slide aria wiring is out of scope for this unit.
  - A hero slide with `description: null` renders identically to one with a populated description — same element count in the overlay. This scenario is retired in U2, which makes the two fixtures identical by construction.
  - The eyebrow label still renders its translated `SEGMENT`-style value above the title.
- **Verification:** `/watch` at a desktop viewport shows eyebrow, title, and Watch Now with no paragraph between the title and the button. Advance at least one slide transition and confirm the button follows the title without a dead beat on **both** the outgoing and the incoming overlay — R2 covers exit as well as enter, and a static screenshot proves only the enter half. `pnpm --filter @forge/web test` and `pnpm --filter @forge/web typecheck` pass. The R5 page-load comparison against the step-0 baseline passes.

### U2. Prune the now-dead `snippet` and `description` fields

- **Goal:** Neither field is fetched, mapped, nor serialized on the `/watch` home path.
- **Requirements:** R4. Applies KTD3.
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/lib/fragments/watch-home.ts` — modify (two `locales` selections)
  - `apps/web/src/lib/watch-home.ts` — modify (`WatchHomeCard` type, the card build, `cardToCarouselSlide`)
  - `apps/web/src/lib/watch-home-carousel-sequence.ts` — modify (`WatchHomeTvCarouselVideoSlide` type)
  - `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — modify (`watchHomeHeroSlidesToTvCarouselSlides`)
  - `apps/web/src/lib/__tests__/watch-home.test.ts` — modify
  - `apps/web/src/lib/watch-home-carousel-sequence.test.ts` — modify
  - `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — modify
  - `apps/web/src/components/home/__tests__/WatchHomeHero.test.tsx` — modify
  - `apps/web/src/components/home/__tests__/useWatchHomeTvCarousel.test.ts` — modify
  - `apps/web/src/app/[locale]/[htmlLang]/page.test.tsx` — modify
- **Approach:**
  1. Remove `description` from the `WatchHomeCard` type and from the object it is built into, dropping the `locale?.snippet ?? locale?.description ?? null` expression.
  2. Remove `description` from `WatchHomeTvCarouselVideoSlide` and from both mappings that populate it — `cardToCarouselSlide` and `watchHomeHeroSlidesToTvCarouselSlides`.
  3. Remove the `description` and `snippet` selection lines from both `locales` blocks in the `WatchHomeVideo` fragment. Leave `title` and `imageAlt` in place; they have live readers.
  4. Sweep for surviving fixtures by search, not by the compiler. TypeScript's excess-property check fires only on a fresh object literal in a typed slot, so annotated helpers are caught but two fixtures are not: `makeCard()` in `WatchHomePage.test.tsx` is declared `Record<string, unknown>` and loses freshness at the function boundary, and `resolveWatchHomeMock` in `page.test.tsx` is a bare `vi.fn()` whose resolved value is `any`. Grep the files listed above for `description` and strip the field from every model or slide fixture, leaving the admin-response `locales[].description` / `locales[].snippet` fixtures in `watch-home.test.ts` intact — those represent the upstream response, not the model.
  5. Delete the U1 test scenario asserting that a `description: null` hero slide renders identically to a populated one. The pruned type makes the two fixtures identical, so the assertion can no longer fail.
  6. Do not touch `WatchHomeSection.description` or the authored block-level `mediaDescription` / `carouselDescription` — all three have live readers.
- **Patterns to follow:** The fragment's existing field-per-line shape; the mapping functions' existing object-literal ordering.
- **Execution note:** Typecheck is necessary but not sufficient here — step 4 exists because two fixtures pass it with the field still set. Treat the grep sweep as the completeness gate and typecheck as the regression gate.
- **Test scenarios:**
  - The home model builder returns cards and hero slides with no `description` property, given an admin response whose locale carries only the still-selected `title` and `imageAlt`. Do not build the fixture from the removed fields — the narrowed derived result type no longer has them.
  - The carousel pool builder produces slides with no `description` property.
  - Section subtitles still render: a section with `description: "Explore the collection."` still shows that text in the section header.
  - Type-check passes with no leftover reader of the removed fields anywhere in `apps/web`.
- **Verification:** `pnpm --filter @forge/web typecheck`, `pnpm --filter @forge/web test`, and `pnpm --filter @forge/web build` pass. Searching a production-shaped `/watch` HTML response and RSC flight payload for a known slide's snippet or description text returns nothing. Expect authored strings to remain — `WatchHomeSection.description` and block-level `mediaDescription` / `carouselDescription` still render, so a hit on an authored subtitle is not a prune failure.

---

## Verification Contract

**Precondition for the browser and page-load gates.** `apps/web/src/lib/admin-client.ts` throws at module import unless `ADMIN_GRAPHQL_URL` and `WEB_ADMIN_API_KEYS` are set, and `resolveWatchHome` fetches every slide from admin with `fetchPolicy: "no-cache"`. Without those pointed at a reachable admin endpoint the route renders `ExperienceError` instead of a hero, and neither the browser proof nor the R5 capture can run. Provision them before starting U1.

| Gate                | Command or method                                                                                                                                                       | Applies to                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Unit tests          | `pnpm --filter @forge/web test`                                                                                                                                         | U1, U2                                                        |
| Type check          | `pnpm --filter @forge/web typecheck`                                                                                                                                    | U1, U2 — regression gate for U2                               |
| Fixture sweep       | `git grep -n description` over U2's listed files                                                                                                                        | U2 — completeness gate; typecheck cannot see two fixtures     |
| Lint                | `pnpm --filter @forge/web lint`                                                                                                                                         | U1, U2                                                        |
| Route build         | `pnpm --filter @forge/web build`                                                                                                                                        | U2 — proves the narrowed GraphQL selection compiles the route |
| Browser proof       | Render `/watch` at a desktop width, then advance one slide, confirming both the outgoing and incoming overlay composition and cadence                                   | U1                                                            |
| Page-load pass/fail | Transferred document + RSC flight bytes for `/watch` must not increase versus the U1 step-0 baseline                                                                    | R5                                                            |
| Page-load advisory  | LCP / Web Vitals median over at least three runs per build, with the LCP element named in each                                                                          | R5                                                            |
| Release marker      | Register this change with the Watch organic-search recovery workflow — declare the `/watch` Search Console baseline, release date, and evaluation date its R13 requires | R5, ship-time                                                 |

Bytes are the decidable signal; timing is context. A byte increase, or an LCP median outside the baseline set's own run-to-run spread, trips the Goal Capsule stop condition. Removing the paragraph also changes which element is the LCP candidate in the overlay, which is why the element is named in each run rather than only its timing.

The page-load gate is not optional: this change alters above-the-fold rendering, the trigger condition in `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`. It attaches to U1, not U2, because U1 is independently shippable.

Run the browser proof against `next build` + `next start`, not `next dev`.

## Definition of Done

- R1 through R5 hold.
- No secondary paragraph renders in the `/watch` hero at any viewport width.
- Neither `snippet` nor `description` has a reader, a mapping, or a GraphQL selection on the `/watch` home path.
- No other surface's secondary copy was removed or altered.
- Every gate in the Verification Contract passes, including the byte comparison for R5 and the release-marker registration.
- Model and slide fixtures that carried the removed fields are cleaned up rather than left setting them to `null`. Admin-response `locales[]` fixtures in `watch-home.test.ts` are deliberately kept.
- The U1 null-description equivalence scenario is retired, not left green-and-vacuous.
- No abandoned or commented-out code from either unit remains in the diff.
