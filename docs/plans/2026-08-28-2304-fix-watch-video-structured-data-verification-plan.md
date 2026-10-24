---
title: "Watch video structured-data verification"
type: fix
date: 2026-08-28
topic: watch-video-structured-data-verification
issue: FGE-114
roadmap: docs/roadmap/topic-experiences/feat-441-watch-video-structured-data-verification.md
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Watch video structured-data verification

## Goal Capsule

**Objective:** Search operators can explain and resolve the 995 invalid Video enhancement items with URL-level evidence, while every emitted Watch `VideoObject` is truthful, complete, and canonical; playable templates with complete authoritative source data emit exactly one, and source-incomplete cases remain fail-closed.

**Means:** Export and classify the real Search Console examples before changing runtime metadata; strengthen the existing production probe and representative route tests; make a narrowly traced runtime fix only when a current affected URL reproduces the defect (KTD1–KTD3).

**Authority order:** current Google documentation and current Search Console examples; current production HTML; FGE-114 and this Product Contract; prior FGE-8/PRs #1727 and #1738; repository conventions.

**Stop conditions:** Do not invent metadata, use a watch page as `embedUrl`, weaken the stable-public-media rule, or treat the separate “No video indexed”/thumbnail problem as this issue. Do not mark the 995 items stale without inspecting affected examples and their crawl dates. No production deployment outside the normal PR-to-main flow.

**Execution profile:** One evidence-gated implementation PR, followed when live validation depends on newly deployed output by a docs-only evidence PR. The probe/test/QA work is unconditional; runtime code is conditional on a reproduced current defect. The implementer owns the post-deploy Search Console validation record until the validation passes or a follow-up ticket has an explicit owner.

## Product Contract

### Summary

FGE-114 verifies whether Search Console's 995 invalid Video enhancement items reflect pre-fix crawls or a still-active Watch template/data defect. The work produces a reproducible URL classification, closes the automated-detection gap, and applies only a source-truthful fix supported by a current failing example.

### Problem Frame

PR #1727 introduced server-rendered Watch `VideoObject` markup. PR #1738 then added a structured-data-specific description and localized publish-date fallback. The Search Console alert was opened before #1738 merged and still reports 995 invalid items for missing `uploadDate`, `description`, and `contentUrl`/`embedUrl`. Current spot checks and a 112-fixture production sample do not reproduce those missing fields, but the affected Search Console example inventory was not exported. Staleness is therefore plausible, not established.

Google currently requires `name`, `thumbnailUrl`, and `uploadDate` for a Video rich result and recommends `description` plus `contentUrl` or a real-player `embedUrl`. This project deliberately holds emitted video entities to the stricter complete set. Video enhancement validity is not proof that Google selected a page's video for indexing.

### Key Decisions

- **Evidence before serializer changes.** The affected URL export and live comparison decide whether runtime code enters scope. Governs R1, R2, R8.
- **Strengthen the existing Watch probe.** Keep one route inventory and one structured-data validator instead of creating a parallel audit script. Governs R4, R5.
- **Preserve truthful identity.** Page/social campaign overlays must not replace a video's real title, description, thumbnail, or media identity. Governs R6, R7.
- **Keep video indexing separate.** Thumbnail reachability and “No video indexed” belong to FGE-61/feat-440 unless they directly cause a field failure on an exported FGE-114 URL. Governs R9.

### Requirements

- **R1 — Capture the authoritative failure set.** Export representative example URLs from each Search Console Videos issue (`uploadDate`, `description`, `contentUrl`/`embedUrl`) together with item name, issue state, validation state, and available last-crawl/first-detected dates. Preserve the unredacted URLs in the QA artifact unless they contain sensitive query data; strip tracking parameters before committing.
- **R2 — Classify every exported sample.** For each sampled URL record status/final URL, canonical, robots/indexability, JSON-LD entity count/type, literal `name`, `description`, `thumbnailUrl`, `uploadDate`, `duration`, `contentUrl`/`embedUrl`, and whether referenced media is publicly fetchable. Label it `current defect`, `fixed since crawl`, `canonical/redirect alias`, `non-playable template`, or `inconclusive`, with evidence.
- **R3 — Cover the route matrix.** Verification must include English and localized films, English and localized standalone segments, English and localized contextual episodes, English and localized series/collection pages, and a curated collection. Playable routes expect exactly one complete `VideoObject`; collection routes expect `CollectionPage` items and no top-level page video claim.
- **R4 — Enforce the complete entity contract in the existing probe.** The probe must parse and validate `name`, `description`, `thumbnailUrl`, `uploadDate`, `duration`, `url`, and at least one valid media locator. For Watch's current policy, `contentUrl` is required; an `embedUrl` only counts if it is a genuine embeddable player URL and is introduced by separately reviewed runtime behavior.
- **R5 — Make regressions actionable.** Probe failures must name the route, entity, and missing/invalid field, while preserving existing duplicate-entity, canonical-identity, route-response, and parity checks.
- **R6 — Preserve truth and fail-closed behavior.** Values must come from the selected video/dub and stable public assets. Preserve `noIndex` suppression, HTTPS checks, signed/query-bearing HLS rejection, ISO dates, positive duration, BCP-47 language values, and the separation between social overlays and `VideoObject` identity.
- **R7 — Preserve canonical semantics.** Contextual episode pages may render the entity but its `url` remains the canonical standalone watch URL. Localized playable pages retain localized canonical identity. Rewrites and redirects must not create duplicate entities.
- **R8 — Gate runtime edits on reproduction.** If an exported URL still fails in current initial HTML, trace the field from route data through `buildExperienceMetadataModel` into `watchVideoStructuredDataJson` and correct the narrowest truthful source. If no current URL reproduces, do not churn runtime metadata; ship probe/tests/QA evidence and start Search Console validation.
- **R9 — Separate enhancement validity from video indexing.** Do not claim that this work fixes “No video indexed,” thumbnail fetchability, watch-page prominence, or video-page eligibility. Cross-link confirmed overlap to feat-440 rather than broadening this PR.
- **R10 — Validate through Google's workflow.** Run Rich Results Test on a small representative set, deploy via the normal PR flow, request recrawl/URL Inspection for representative pages, start Validate Fix for each applicable issue, and record the start time and baseline. Monitor until Passed/0 invalid or open an evidence-backed follow-up.
- **R11 — Avoid page-performance regressions.** Structured data remains server-rendered in the initial HTML with no client fetch, hydration dependency, or new runtime request. Any conditional runtime change must not materially inflate HTML or delay page rendering.

### Acceptance Examples

- **AE1 — Stale inventory:** An exported Romanian film URL shows an older crawl date, current HTML has one complete entity, Rich Results Test passes, and Search Console validation is started. The result is documented as `fixed since crawl`; no serializer rewrite is made.
- **AE2 — Current localized defect:** An exported localized segment still omits `uploadDate`; tracing proves both publish-date candidates are absent or dropped. The fix uses an authoritative date or suppresses the invalid entity—never a fabricated current date—and regression tests cover that exact data shape.
- **AE3 — Contextual episode:** The page emits one entity with all complete fields and a standalone canonical `url`; the probe does not flag the contextual browser URL as a duplicate identity.
- **AE4 — Collection:** A series or curated route emits a `CollectionPage`/`ItemList`, not a page-level `VideoObject`; it is recorded as not applicable to the failing playable-template issue.
- **AE5 — Separate indexing issue:** All schema fields pass while URL Inspection says “No video indexed.” FGE-114 records schema validity and hands thumbnail/prominence investigation to feat-440 without claiming resolution.

### Success Criteria

- Every exported example in the working sample has a reproducible classification and evidence link or capture.
- The representative matrix and production probe report zero incomplete emitted `VideoObject` entities.
- A future omission of any required project field produces a focused unit/probe failure.
- Search Console validation is started only after representative live output passes, with the 995 baseline and start date recorded.

### Scope Boundaries

In scope: server-rendered Watch JSON-LD, metadata source selection, the Watch URL probe, focused tests, an FGE-114 QA record, and Search Console validation. Out of scope: redesigning Watch pages, promotional metadata strategy, client analytics, sitemap changes, general organic traffic, thumbnail/index-selection remediation owned by feat-440, and manual Railway deployment.

### Dependencies and Outstanding Questions

- **Operational dependency:** an authenticated Search Console owner must export affected examples and start validation. This is the first execution step, not a reason to guess.
- **Deferred:** Search Console may expose only a capped sample. Use every exported example plus the representative matrix and record the sampling limit.
- **Deferred:** If Google reports only historical URLs that now redirect, record both reported and final canonical URLs before choosing whether an alias-specific code change is warranted.
- There is no launch-blocking product or architecture question; KTD1 supplies the branch gate for currently unavailable evidence.

### Sources

- `docs/roadmap/topic-experiences/feat-441-watch-video-structured-data-verification.md`
- `docs/plans/2026-07-23-002-feat-watch-structured-data-plan.md`
- `docs/plans/2026-07-24-001-fix-watch-video-structured-data-plan.md`
- `docs/qa/watch-structured-data-2026-07-23.md`
- `docs/solutions/architecture-patterns/watch-video-search-social-metadata-overlay.md`
- [Google Video structured data](https://developers.google.com/search/docs/appearance/structured-data/video)
- [Google video SEO guidance](https://developers.google.com/search/docs/appearance/video)
- [Search Console rich result report validation](https://support.google.com/webmasters/answer/9495631)

## Planning Contract

### Current Diagnosis

- `watchVideoStructuredDataJson` currently refuses to emit when name, description, canonical URL, stable HTTPS HLS URL, thumbnail, upload date, or positive duration is missing.
- `buildExperienceMetadataModel` sources identity from the actual video, uses authored description/snippet/title-specific fallback, uses media/poster thumbnails, and falls back from `publishedAt` to `localePublishedAt`.
- Both standalone and contextual playable route branches call the same serializer; series and curated routes intentionally emit collection markup.
- Existing unit tests cover many serializer failure modes. The remaining detection gap is `watch-url-probe.ts`, whose parsed identity currently includes only `name`, `url`, and `contentUrl`.
- A 2026-08-29 production audit of 112 repository fixture paths found 60 emitted `VideoObject` entities and zero missing `name`, `description`, `uploadDate`, `thumbnailUrl`, or `contentUrl`/`embedUrl`. Nine focused film/segment/contextual/collection routes, including localized cases, also passed. Five fixture paths returned 404. This is evidence against a broad current serializer defect, not proof that the 995 Search Console examples are stale.
- PR #1727 merged 2026-07-23; PR #1738 merged 2026-07-24 after the FGE-114 alert was created. The timeline supports, but does not prove, the stale-inventory hypothesis.

### Key Technical Decisions

- **KTD1 — Evidence-gated branch:** U1 ends with a current/stale decision. U2 and U3 proceed in either branch. U4 runs only for at least one `current defect`; otherwise it is explicitly recorded as not applicable.
- **KTD2 — Extend, do not fork, the probe:** expand `VideoObjectIdentity` and `validateStructuredDataContract` in `watch-url-probe.ts`; keep the CLI's current production/preview comparison and route inventory.
- **KTD3 — Test behavior at two levels:** pure parser/validator tests prove precise field diagnostics; route rendering tests prove representative templates place the complete entity in initial HTML.
- **KTD4 — Current production policy is `contentUrl`:** keep the stable public HLS locator. Do not add `embedUrl` merely to silence the report; Google accepts `contentUrl`, and a watch-page URL is not an embed URL.
- **KTD5 — QA evidence is durable:** create a new dated FGE-114 record rather than rewriting the 2026-07-23 pre-release QA baseline.

### Representative Fixture Matrix

| Class              | Locale   | Representative route                                                 | Expected page schema                                    |
| ------------------ | -------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Film               | English  | `/watch/jesus.html`                                                  | one complete `VideoObject`                              |
| Film               | Romanian | `/watch/jesus.html/romanian.html`                                    | one complete localized `VideoObject`                    |
| Standalone segment | English  | `/watch/lumo-john-1-1-34.html`                                       | one complete `VideoObject`                              |
| Standalone segment | Spanish  | `/watch/the-beginning.html/spanish-castilian.html`                   | one complete localized `VideoObject`                    |
| Contextual episode | English  | `/watch/lumo-the-gospel-of-john.html/lumo-john-1-1-34.html`          | one entity with standalone canonical identity           |
| Contextual episode | Romanian | `/watch/lumo-the-gospel-of-john.html/lumo-john-1-1-34/romanian.html` | one localized entity with standalone canonical identity |
| Series             | English  | `/watch/lumo-the-gospel-of-john.html`                                | `CollectionPage`, no page-level video claim             |
| Series             | Russian  | `/watch/lumo-the-gospel-of-john.html/russian.html`                   | localized `CollectionPage`                              |
| Curated collection | English  | `/watch/easter.html`                                                 | `CollectionPage`                                        |

Use exported Search Console URLs in addition to, not instead of, this stable matrix. If a representative slug changes, replace it with a fixture from the existing `WATCH_URL_FIXTURES` inventory and record the substitution.

### Sequencing

1. Export and classify Search Console examples (U1).
2. Harden the parser/contract and fixture inventory (U2).
3. Add the route-level matrix and run focused/local verification (U3).
4. If and only if U1 reproduced a current defect, implement its traced correction (U4).
5. Validate preview output, merge/deploy normally, then start Google validation and record ownership (U5).
6. If the live evidence could not exist before merge, land the finalized QA record and roadmap disposition in a docs-only evidence PR (U5).

## Implementation Units

### U1. Export and classify Search Console evidence

**Goal:** Establish whether the reported inventory is historical or currently reproducible.

**Requirements:** R1, R2, R8, R9.

**Files:** Create `docs/qa/watch-video-structured-data-fge-114-2026-08-28.md`; reference but do not rewrite `docs/qa/watch-structured-data-2026-07-23.md`.

**Approach:** Export samples from all three issue rows before pressing Validate Fix. Capture available dates and item names. Fetch each URL as ordinary and Googlebot-like clients, preserve final URL/canonical/robots, extract literal initial-HTML JSON-LD, and test media/thumbnail reachability without logged-in cookies. Compare crawl time with merges `3b9285a18` (#1727) and `031f8bde6` (#1738). End with the KTD1 classification table and the exact runtime branch decision.

**Test scenarios:** an old crawl now valid; a still-invalid localized page; a redirect/canonical alias; a non-playable collection; an inaccessible asset despite complete markup.

**Verification:** Every sample has one classification and evidence; uncertain cases say why. The QA file records export limits and the 995 baseline.

### U2. Expand the production Watch structured-data probe

**Goal:** Make the current missing-field classes fail automatically and diagnostically.

**Requirements:** R3–R7.

**Files:** Modify `apps/web/src/lib/watch-url-probe.ts`, `apps/web/src/lib/watch-url-probe.test.ts`, and only if output formatting needs it, `apps/web/scripts/probe-watch-urls.ts`.

**Approach:** Add parsed identity for `description`, `thumbnailUrl`, `uploadDate`, `duration`, and `embedUrl`; normalize scalar/array thumbnail values without accepting empty/non-HTTPS values. Extend `validateStructuredDataContract` so each expected video entity must contain the project-complete field set and a stable `contentUrl`. Preserve existing entity-count, duplicate, canonical, response, and production/preview parity checks. Add at least one explicit localized playable contract; keep collection expectations distinct.

**Test scenarios:** complete entity; each field omitted individually; blank field; invalid date/duration/URL; `thumbnailUrl` string and array; only watch-page `embedUrl`; two entities; contextual route with standalone canonical identity; collection without a page-level video.

**Verification:** Focused probe tests pass, and a deliberately incomplete fixture yields a route- and field-specific violation.

### U3. Add the server-rendered route matrix

**Goal:** Prove all material template/localization branches emit the expected initial-HTML schema.

**Requirements:** R3, R6, R7, R11.

**Files:** Modify `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`; extend `apps/web/src/lib/experience-metadata.test.ts` or `apps/web/src/lib/watch-structured-data.test.ts` only for uncovered source-model branches.

**Approach:** Build table-driven assertions for the Representative Fixture Matrix. Parse rendered scripts rather than substring matching. For playable pages assert exactly one `VideoObject`, all complete fields, canonical identity, and localized language where applicable. For series/curated pages assert collection markup and no top-level page-video claim. Reuse existing route fixtures/factories.

**Test scenarios:** all nine rows in the matrix, plus sparse data that correctly suppresses an invalid entity rather than emitting partial markup.

**Verification:** Focused route/model/serializer suites pass; assertions inspect server output without client hydration.

### U4. Correct a reproduced current defect (conditional)

**Goal:** Remove only the demonstrated source of an active Search Console field failure.

**Requirements:** R6–R8, R11.

**Files:** Depending on trace evidence, the narrow set of `apps/web/src/lib/experience-metadata.ts`, `apps/web/src/lib/watch-structured-data.ts`, and/or `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`, with colocated tests. If authoritative content data is absent, document/suppress the entity or open a separately scoped admin/data ticket; do not hand-edit generated GraphQL outputs.

**Approach:** Reproduce the exact exported URL/data shape as a failing test, trace the loss boundary, then fix that boundary. Prefer existing authoritative fallback fields. If no truthful required value exists, preserve fail-closed behavior. Do not add a second serializer or route-specific JSON-LD copy.

**Test scenarios:** exact failing example; English/localized sibling; contextual/standalone sibling; sparse-data suppression; signed or unstable media rejection.

**Verification:** The new regression test fails before and passes after the patch; the full matrix remains green. If U1 finds no current defect, record U4 as `not applicable—no current reproduction` in the QA artifact and touch no runtime file.

### U5. Preview, rollout, and Search Console validation

**Goal:** Confirm public output and hand Search Console a clean recrawl cohort with durable follow-through.

**Requirements:** R10, R11.

**Files:** Finalize `docs/qa/watch-video-structured-data-fge-114-2026-08-28.md`; update `docs/roadmap/topic-experiences/feat-441-watch-video-structured-data-verification.md` when its completion rule is met. Add a feat-440 cross-link only for separately confirmed indexing/thumbnail evidence.

**Approach:** Run the production/preview probe with a public preview URL, inspect the representative pages in Rich Results Test, and record results. Merge/deploy normally. On live output, use URL Inspection/request recrawl for a small cohort, then start Validate Fix for each issue that still offers validation. Record validation IDs/state, start timestamp, baseline, owner, and expected review window. Recheck at 24–48 hours and through Google's stated validation window (often up to about two weeks). When those live observations depend on the implementation PR already being deployed, preserve them in a docs-only evidence PR rather than treating them as a pre-merge gate on that implementation PR.

**Test scenarios:** preview/live parity; Google fetch succeeds for markup and stable media; validation starts; counts fall/pass; a residual URL supplies evidence for a follow-up.

**Verification:** QA record contains preview/live evidence, Rich Results Test outcomes, validation start, baseline/owner, and final result or linked follow-up. Do not call the roadmap complete merely because a PR merged if validation has neither passed nor been explicitly handed off.

## Verification Contract

Run from the repository root, adjusting only the public preview URL placeholder:

```bash
pnpm --filter @forge/web test -- src/lib/watch-url-probe.test.ts src/lib/watch-structured-data.test.ts src/lib/experience-metadata.test.ts 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
pnpm --filter @forge/web probe:watch-urls --production https://www.jesusfilm.org --preview https://<public-preview-host>
pnpm prettier --check apps/web/src/lib/watch-url-probe.ts apps/web/src/lib/watch-url-probe.test.ts 'apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' docs/qa/watch-video-structured-data-fge-114-2026-08-28.md
git diff --check
```

Quality gates:

- Tests prove both acceptance and rejection for every project-complete field, not merely JSON parseability.
- The public preview matrix passes with a Googlebot-like fetch and literal initial-HTML inspection.
- Rich Results Test passes representative English/localized film, segment, and contextual episode URLs.
- No new client request/hydration work is introduced. If U4 changes runtime output, compare rendered HTML size for the matrix before/after and explain any material increase.
- Search Console validation begins only after the deployed representative cohort passes; report the baseline and do not equate enhancement validity with video indexing.

## Definition of Done

- U1: Actual Search Console examples and crawl context are captured and every sample is classified; “stale” is a demonstrated conclusion or remains explicitly unproven.
- U2: The existing probe rejects missing/invalid `description`, `thumbnailUrl`, `uploadDate`, `duration`, and media locator values with focused diagnostics, including a localized playable fixture.
- U3: The film/segment/contextual/collection and English/localized route matrix is covered in server-rendered tests.
- U4: A reproduced current defect has the narrowest truthful regression-tested fix, or the QA record explicitly proves this unit was not applicable and runtime files remain untouched.
- U5: Preview/live and Rich Results Test evidence is recorded; Search Console validation has a baseline, start date, owner, and passed result or linked follow-up.
- All verification commands pass, generated GraphQL outputs were not hand-edited, unrelated worktree changes are untouched, and abandoned experimental code is absent from the diff.
- The roadmap ticket is completed only under its stated acceptance criteria, and any remaining thumbnail/index-selection work is tracked separately.
