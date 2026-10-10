---
title: "fix: Watch localized title fallback"
type: "fix"
status: "completed"
date: "2026-08-05"
---

# fix: Watch localized title fallback

## Summary

Make Watch titles resolve field by field in this order: a trimmed nonblank
requested-language title, a trimmed nonblank published English title, then a
humanized slug. Apply the same rule to language inventory cards and linked
Watch detail content while preserving all other localized copy.

## Problem Frame

Admin inventory SQL selects one locale row before checking whether its title
contains text. A published Arabic row with an empty title therefore wins over
English and falls directly to the raw slug. Web route snapshots have the same
row-level assumption: an existing locale array blocks English even when its
title is blank, leaving linked collection headings empty. This contradicts the
existing field-level localized-copy policy and makes the card and destination
disagree.

## Requirements

- R1. A trimmed nonblank requested-language title wins over every fallback.
- R2. When the requested-language title is absent or whitespace-only, use a
  trimmed nonblank published English title.
- R3. When neither title exists, render a humanized slug that splits repeated
  hyphens or underscores and title-cases each word.
- R4. Apply the title ladder to inventory item and parent titles plus Watch
  detail root, parent, and child titles.
- R5. Preserve requested-language description, snippet, image alt,
  search/social copy, questions, route identity, and playable language when
  only the title falls back.
- R6. Preserve inventory eligibility, counts, ordering semantics, per-bucket
  limits, SQL timeouts, public URLs, and the GraphQL response contract.

## Acceptance Examples

- AE1. Given an Arabic title and an English title, the Arabic title appears on
  the inventory card and linked page.
- AE2. Given an Arabic title containing only whitespace and a published English
  title, the English title appears while the Arabic description remains.
- AE3. Given no nonblank Arabic or published English title, the slug
  `lumo-the-gospel-of-john` renders as `Lumo The Gospel Of John`.
- AE4. Given only an unrelated published locale title, Watch uses the humanized
  slug rather than the unrelated language.
- AE5. Parent and child titles follow the same ladder as the root title, so an
  inventory card, collection heading, and episode rail do not diverge.

## Key Technical Decisions

- **Fallback titles independently:** Locale rows may contain useful localized
  descriptions even when their titles are blank, so replacing the row would
  discard valid requested-language copy.
- **Treat whitespace as absence:** Normalize with trimming before selection and
  return trimmed authored titles to avoid invisible headings and unstable sort
  values.
- **Limit title candidates to the requested language and English:** An
  unrelated locale is not a valid user-facing fallback. Inventory treats the
  requested language as language ID, then language slug, then its BCP-47 locale
  before English, matching the detail page's exact-to-broad behavior.
- **Keep inventory title resolution inside the candidate-reduced Admin read
  model:**
  Materialize one bounded title set after `prelimited_candidates` and before
  final title ranking to preserve the candidate-first performance topology,
  avoid per-card title lookups, and avoid Web fan-out.
- **Keep the existing exact-to-broad requested-language order on detail
  pages:** Exact language-slug copy remains preferred, followed by its BCP-47
  locale layer, then English.
- **Humanize at each owning boundary:** Admin SQL owns inventory display and
  Web normalization owns route-snapshot display; no schema expansion or extra
  network request is needed.

## Implementation Units

### U1. Inventory title selection

- **Goal:** Make Admin return card-ready titles with the requested, English,
  and humanized-slug ladder for both inventory items and parent references.
- **Requirements:** R1, R2, R3, R4, R5, R6
- **Files:**
  - Modify `apps/admin/src/services/video.service.ts`.
  - Modify `apps/admin/src/services/video.service.test.ts`.
- **Approach:** Include BCP-47 in `inventory_language`, then materialize a
  title-specific published-locale set for the prelimited candidates that
  rejects blank values before ordering language ID, language slug, BCP-47
  locale, and English. Leave the existing localized description/image
  projection independent. Apply the same precedence to parent references
  within the candidate-reduced final stage. Normalize the humanized result and
  retain the existing internal identity guard only for corrupt slugs that
  cannot produce nonblank display text.
- **Test scenarios:** Assert SQL rejects whitespace, excludes unrelated
  locales, prefers language ID/slug and broad BCP-47 copy over English,
  humanizes repeated slug separators, keeps a nonblank corruption guard for an
  empty humanized result, applies the same rule to parent titles, and preserves
  the candidate-first stage ordering.
- **Verification:** Run the focused Admin service suite, Admin typecheck, and
  scoped lint.

### U2. Route-snapshot field-level fallback

- **Goal:** Keep root, parent, and child titles readable without replacing
  other requested-language fields.
- **Requirements:** R1, R2, R3, R4, R5
- **Files:**
  - Modify `apps/web/src/lib/content.ts`.
  - Modify `apps/web/src/lib/content.test.ts`.
- **Approach:** Merge the title field across exact, broad, and English locale
  layers even when a requested locale row exists. Treat blank values as absent,
  keep the requested locale row as the source for all other fields, and apply a
  deterministic slug humanizer during root/parent/child normalization.
- **Test scenarios:** Cover a nonblank exact title, blank and whitespace-only
  exact/broad titles with English fallback, localized description retention,
  unrelated-locale exclusion, root slug fallback, and parent/child fallback.
- **Verification:** Run focused content tests, Web typecheck, and scoped lint.

### U3. Product and performance proof

- **Goal:** Verify the visible Arabic failure is fixed without degrading page
  loading or changing public behavior.
- **Requirements:** R4, R5, R6
- **Files:**
  - Update `docs/roadmap/content-discovery/feat-336-watch-localized-title-fallback.md`.
- **Approach:** Smoke the Arabic inventory route and a linked LUMO collection
  using a deterministic record whose requested-language title is blank and
  whose published English title is nonblank. Capture the matching English
  inventory-card and detail-heading title alongside retained Arabic UI/copy,
  plus a screenshot, page timing, and browser-console result. Keep the
  humanized-slug branch in focused tests unless a deterministic browser fixture
  already exists. Against an available representative database, execute or
  explain the inventory query with a tied-timestamp candidate fixture and
  require direct Admin response below two seconds warm and five seconds cold;
  either threshold blocks completion. Mark the roadmap ticket complete after
  tests, review, and browser verification pass.
- **Test scenarios:** Arabic UI and available Arabic description remain; cards
  and the linked heading show requested or English titles rather than raw slugs
  or blanks; links and section ordering remain unchanged.
- **Verification:** Record the focused validation and browser proof in the
  completion note without claiming production deployment.

## Completion Proof

- Admin inventory service tests: 68 passed.
- Web content normalization tests: 20 passed.
- Full Web suite: 2,484 passed with one existing todo. Full Admin suite passed
  4,249 tests in the clean run; a later concurrent rerun had one unrelated
  five-second UI-test timeout that passed 43/43 when rerun in isolation.
- Admin and Web typechecks and lint passed; final Admin SQL-shape changes were
  rechecked with the focused suite, typecheck, lint, Prettier, and
  `git diff --check`.
- Representative Arabic inventory: 659 items, zero blank titles, zero titles
  equal to their raw slug. `lumo-the-gospel-of-mark` resolves to
  `LUMO - The Gospel of Mark` while retaining its Arabic description.
- Performance on the isolated representative database: first resolver request
  after restart 0.96 seconds, warm request 0.175 seconds, direct SQL execution
  77 milliseconds.
- In-app browser smoke: the Arabic RTL inventory and linked Mark collection
  both show the fallback title, retain Arabic copy, expose no blank headings,
  and emit no browser console warnings or errors.
- Visual proof:
  `output/playwright/watch-arabic-localized-title-fallback.jpg` and
  `output/playwright/watch-arabic-lumo-mark-detail.jpg`.

## Scope Boundaries

- Do not change Core sync data, author translations, or backfill production.
- Do not change GraphQL SDL or generated client artifacts.
- Do not alter Watch URL shapes, language selection, subtitles, playback, or
  inventory grouping.
- Do not add bidi markup or redesign the mixed-script cards unless browser
  verification exposes a separate legibility defect.
- Do not deploy local work directly to production.

## Risks & Dependencies

- Raw SQL tests characterize query shape rather than executing PostgreSQL
  selection; browser proof and existing database-backed inventory coverage
  remain important complements.
- Moving title lookup ahead of candidate pre-limiting, or assuming timestamp
  ties make that stage strictly bounded, could regress the public route's
  restored performance; retain topology assertions and use representative
  data-backed timing.
- A broad field merge could replace localized descriptions with English;
  regression tests must assert title-only fallback explicitly.

## Sources & Research

- `docs/plans/2026-06-01-002-feat-watch-language-rendering-plan.md` defines
  independent English fallback for localized content parts.
- `docs/solutions/performance-issues/watch-language-inventory-candidate-first-sql-20260713.md`
  defines the protected candidate-first inventory topology.
- `docs/solutions/architecture-patterns/watch-localized-index-flat-admin-read-model-20260616.md`
  keeps inventory card hydration Admin-owned.
- `docs/plans/2026-07-21-003-fix-watch-media-collection-linked-titles-plan.md`
  establishes that blank and whitespace-only Watch titles are absent.
- `apps/admin/src/services/video.service.ts` contains inventory title and
  parent-title selection.
- `apps/web/src/lib/content.ts` contains exact, broad, and English snapshot
  fallback plus root/parent/child normalization.
