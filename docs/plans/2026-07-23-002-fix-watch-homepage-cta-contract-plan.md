---
title: "fix: Repair Watch homepage section CTA contracts"
type: fix
status: completed
date: 2026-07-23
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "linear-fge-21"
execution: code
---

# fix: Repair Watch homepage section CTA contracts

## Summary

Make every currently published media and Related Questions CTA on the Watch
homepage lead somewhere other than the current homepage, expose a
destination-specific accessible name even when the visible authored label is
generic, and emit a bounded destination-click analytics action. Preserve valid
authored destinations, the existing inferred collection fallback, the Watch
route classifier and canonical rules, and intentional global navigation such
as the footer's Watch link.

---

## Problem Frame

The current production Watch homepage renders eleven media-section CTAs plus an
FAQ CTA. The “Films About Jesus” section authors `mediaCtaLink: "/"`, which the
Web app normalizes to `/watch`. Because any non-empty authored value outranks
the section's inferred collection destination, “See all” reloads the page even
though the same block already exposes `mediaDefaultCollectionSlug:
"jfm-collection"`. Its existing canonical destination,
`/watch/jfm-collection.html/english.html`, returns a direct 200.

The other homepage CTAs reach direct 200 destinations, but several use repeated
visible labels such as “Watch,” “See all,” and “Read more.” Those labels do not
identify the section destination to assistive technology, and automatic
interaction tracking alone does not establish a stable, low-cardinality
section-destination event contract.

The Admin Experience editor currently uses `/` as a placeholder when a media
CTA is created or re-enabled. Existing published values must remain safe
without a destructive content migration. This repair therefore treats a
homepage-equivalent or malformed Watch-local authored value as unusable only
at the Watch-home content boundary, then continues through the already-shipped
collection inference and supported language-index fallback.

---

## Requirements

**Destination contract**

- R1. A currently published Watch-home media or Related Questions CTA must not
  resolve to `/`, `/watch`, a localized Watch homepage, an equivalent
  same-origin absolute homepage URL, an unknown bare Watch slug, the deprecated
  inbound search shim, or another malformed/unsupported Watch route.
- R2. An explicitly authored canonical video, episode, languages, localized
  languages, language-videos, or history route remains authoritative, as does
  an intentional ministry-site path or external HTTP(S) destination.
- R3. An unusable media CTA override falls through to the current canonical,
  language-bearing collection inference; if no collection can be inferred, it
  falls through to `/watch/languages`.
- R4. The known “Films About Jesus” block resolves to
  `/watch/jfm-collection.html/{language}.html` using its existing
  `mediaDefaultCollectionSlug`.
- R5. Route construction and classification use `apps/web/src/lib/routes.ts`;
  this change does not mint unsupported paths or modify proxy, canonical,
  metadata, episode, or share behavior.

**Accessible-name and analytics contract**

- R6. Every visible section CTA receives a deterministic accessible name
  beginning with its visible label and followed by human-facing section
  context, using title, then subtitle, then category/heading as fallbacks.
- R7. Activating a Watch-home section CTA records one explicit
  `watch_home.section_cta_clicked` action with bounded section identity,
  normalized resolved pathname, content surface, and route-kind fields.
- R8. Analytics reporting remains best-effort and never prevents normal,
  keyboard, touch, or modifier-click navigation.
- R9. The separate footer/global Watch link remains `/watch` and is excluded
  from the content-CTA accessibility, routing, and analytics contract.

**Verification contract**

- R10. Focused tests cover homepage-equivalent, valid, malformed, external,
  inferred, and fallback destinations; contextual accessible names; analytics
  payloads; and the global-navigation boundary.
- R11. A rendered homepage fixture inventories content CTAs as section,
  destination, and accessible name, and rejects home/unknown Watch route kinds.
- R12. Desktop and mobile browser smoke confirms CTA hrefs and accessible
  names, direct navigation to a 200 canonical destination, and no CTA-specific
  fetch or added homepage initialization work.

---

## Assumptions

- “Every homepage CTA” means the primary actions in the currently published
  MediaCollection and RelatedQuestions blocks. Header, footer, logo, card,
  player, CTASection, PromoBanner, hero, and other global or item-level
  navigation remain outside this ticket because none is a primary CTA in the
  captured production inventory. A future published block kind must adopt the
  surface contract explicitly rather than being assumed covered.
- Generic visible labels may remain authored and localized; the ticket accepts
  an equivalent descriptive accessible name, which avoids inventing or
  bulk-translating replacement marketing copy.
- Existing Admin `/` values are treated as an implicit automatic-destination
  sentinel for media collections. This change does not rewrite published
  Experience JSON or introduce a new persisted CTA-state schema.
- External HTTP(S) destinations remain valid. Same-origin ministry paths
  outside `/watch` are treated as intentional site destinations rather than
  being passed through the Watch route classifier.
- Nested media collections rendered inside homepage Section or Container
  blocks are part of the homepage content surface and receive the same context.

---

## Key Technical Decisions

1. **Validate only at the Watch-home content boundary.** Thread an explicit
   Watch-home surface through `ExperienceSectionRenderer` and its nested
   Section/Container dispatch so the repair reaches current media and Related
   Questions blocks at either depth. Do not change `normalizeWatchRootHref`
   globally because other Experience contexts deliberately use it to stay
   inside the Watch base path.
2. **Resolve before normalizing.** Classify authored Watch-local hrefs after
   trimming, removing query/fragment details for comparison, and safely parsing
   same-origin absolute URLs. Reject home, localized-home, unknown, reserved,
   search, or malformed Watch destinations; allow supported non-home route
   kinds and external/site-global destinations. Before accepting a video or
   episode kind, validate the canonical segment grammar: `.html` suffixes on
   content and language segments, a bare safe episode segment, and stripped
   values accepted by `tryAsContentSlug` and `tryAsLocaleSlug`. Allow the named
   index routes explicitly. Then apply the established explicit → inferred
   collection → language-index precedence.
3. **Keep route ownership centralized.** Use the existing language and content
   slug constructors, `watchVideoPath`, `languagesIndexPath`, and
   `parseWatchPath`. Do not add route-manifest reads, existence fetches, or new
   canonicalization rules at render or click time.
4. **Preserve visible copy while strengthening semantics.** Build contextual
   accessible names from the visible label plus human-facing block copy. Never
   expose `sectionKey` as user-facing text; use it only as a bounded analytics
   identifier. If all human-facing context is absent, preserve the visible
   label as the runtime accessible name and warn in development; the rendered
   homepage inventory must reject that state so current authored content cannot
   silently ship a generic name.
5. **Instrument existing client renderers.** `MediaCollection` and
   `RelatedQuestions` are already client components, so attach best-effort
   reporting to their existing anchors rather than turning
   `WatchHomeExperiencePage` into a client component or installing global click
   interception.
6. **Keep analytics low-cardinality.** Record the resolved pathname without
   query/fragment or full external URL, a fixed surface value, the bounded
   section key, and a small route-kind enum. Do not send authored descriptions,
   question text, or other unbounded content.
7. **Defend existing content instead of mutating it.** The runtime repair makes
   current and future `/` placeholders safe immediately. A future explicit
   Admin model for disabled, automatic, and overridden CTA states is separate
   scope because changing the current blank-link toggle semantics would require
   a persisted contract and migration.
8. **Fail closed for non-media section CTAs.** Media collections have an
   established inferred/fallback destination. Other section actions such as
   RelatedQuestions do not. On the Watch-home content surface, omit a non-media
   CTA whose authored Watch-local destination is home-equivalent, malformed, or
   unsupported rather than inventing an unrelated fallback; preserve valid
   site-global and external destinations.

---

## Acceptance Examples

- AE1. Given the current “Films About Jesus” media block with
  `mediaCtaLink: "/"` and `mediaDefaultCollectionSlug: "jfm-collection"`, its
  CTA href is `/watch/jfm-collection.html/english.html`, not `/watch`.
- AE2. Given an authored `/watch`, `/watch/`, query/fragment variant,
  same-origin absolute Watch homepage, localized Watch homepage, unsupported
  bare Watch slug, or malformed Watch URL, the media CTA uses its inferred
  collection or `/watch/languages`.
- AE3. Given an authored canonical Watch collection/video/episode/languages
  route, intentional ministry path, or external HTTP(S) URL, the CTA preserves
  that destination.
- AE4. Given visible “See all” on a section titled “Films About Jesus,” the
  accessible name begins with “See all” and includes “Films About Jesus.”
- AE5. Given a titleless section, the accessible name uses the first non-empty
  subtitle, category label, or heading and never exposes its internal
  `sectionKey`.
- AE6. Given a CTA activation, the explicit analytics action contains the
  resolved destination rather than `/watch`; if analytics throws, the native
  link remains usable.
- AE7. Given the complete homepage render, no content-section CTA parses as a
  Watch home or unknown route, while the footer's intentional `/watch` link is
  unchanged and outside the inventory.
- AE8. Given an invalid RelatedQuestions destination, the primary CTA is
  omitted on the Watch homepage; valid external and ministry-site destinations
  remain unchanged.

---

## Implementation Units

### U1. Record the CTA contract and implementation scope

- **Goal:** Create the required Forge roadmap record and mark it in progress
  before application changes.
- **Requirements:** R1-R12
- **Dependencies:** None
- **Files:**
  - `docs/roadmap/platform/feat-304-watch-homepage-cta-contract.md`
- **Approach:** Record the Linear issue, production CTA inventory, root cause,
  exact content/global boundary, route and analytics constraints, and browser
  verification expectations. Mark it complete only after code and browser
  validation finish.
- **Patterns to follow:**
  `docs/roadmap/platform/feat-262-watch-home-collection-cta-destination.md`.
- **Test scenarios:** Test expectation: none — this unit records scope and
  status.
- **Verification:** The next sequential roadmap ID is used, status begins as
  `in-progress`, and the record points to this plan.

### U2. Resolve and describe Watch-home content CTAs safely

- **Goal:** Add one reusable Watch-home CTA contract and apply it to current
  homepage section actions without affecting other Experience surfaces.
- **Requirements:** R1-R9
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/lib/watch-home-cta.ts`
  - `apps/web/src/lib/watch-home-cta.test.ts`
  - `apps/web/src/components/sections/MediaCollection.tsx`
  - `apps/web/src/components/sections/MediaCollection.test.tsx`
  - `apps/web/src/components/sections/RelatedQuestions.tsx`
  - `apps/web/src/components/sections/RelatedQuestions.test.tsx`
  - `apps/web/src/components/sections/index.tsx`
  - `apps/web/src/components/sections/Section.tsx`
  - `apps/web/src/components/sections/Container.tsx`
  - `apps/web/src/components/home/WatchHomeExperiencePage.tsx`
- **Approach:** Introduce pure helpers that classify authored destinations,
  resolve media CTA precedence, derive contextual accessible names, and build a
  bounded analytics context. Pass an explicit Watch-home surface through the
  top-level and nested section renderers. On that surface, use the helper for
  MediaCollection routing and for validation, contextual naming, and reporting
  in both MediaCollection and RelatedQuestions. An invalid non-media CTA is not
  rendered because it has no truthful inferred fallback. Keep valid native
  anchors, styling, external-link behavior, and automatic RUM interaction
  capture.
- **Execution note:** First invert the existing `/` → `/watch` regression test
  and add the destination-classification table, then implement the resolver.
- **Patterns to follow:** `apps/web/src/lib/routes.ts`,
  `apps/web/src/lib/watch-paths.ts`,
  `apps/web/src/components/DatadogRum.tsx`, and
  `docs/solutions/design-patterns/watch-media-collection-default-cta-parent-inference-20260715.md`.
- **Test scenarios:**
  1. Covers AE1-AE2 with table cases for whitespace, root/base/trailing
     slash/query/fragment, same-origin absolute home, localized home,
     unsupported bare slug, malformed input, and missing input.
  2. Covers AE3 with canonical video, episode, languages, site-global, and
     cross-origin HTTP(S) destinations.
  3. Covers AE1 by proving an invalid explicit value falls through to
     `jfm-collection` in the active language.
  4. Proves an invalid explicit value without inference falls through to
     `/watch/languages`, while a valid explicit destination still wins.
  5. Covers AE4-AE5 by asserting the accessible name starts with the visible
     label and uses title, subtitle, then category/heading context; missing
     context preserves the visible label, warns in development, and fails the
     complete homepage inventory.
  6. Covers AE6 by asserting the fixed action name and bounded resolved
     destination payload, and by proving reporter failure does not cancel
     native link behavior.
  7. Renders a nested media collection through Section/Container context and
     proves it receives the same Watch-home resolution.
  8. Covers AE8 by omitting an invalid RelatedQuestions CTA while preserving a
     valid external FAQ destination.
- **Verification:** Focused helper, MediaCollection, RelatedQuestions, and
  renderer tests pass. The diff adds no request, route-manifest lookup, effect,
  or new page-level client boundary.

### U3. Inventory and verify the rendered homepage contract

- **Goal:** Prove the full content-CTA boundary in automated tests and real
  desktop/mobile rendering, then close the roadmap record.
- **Requirements:** R9-R12
- **Dependencies:** U2
- **Files:**
  - `apps/web/src/components/home/WatchHomeExperiencePage.test.tsx`
  - `docs/roadmap/platform/feat-304-watch-homepage-cta-contract.md`
- **Approach:** Add an Experience fixture containing all twelve currently
  observed content CTA instances: eleven media actions and the FAQ action.
  Query only content-section CTA markers before the separate footer and
  inventory each exact section, href, and accessible name.
  Assert internal destinations classify as supported non-home routes and the
  footer/global link is excluded. Run focused Web validation plus desktop and
  mobile browser smoke, follow the repaired collection CTA, and inspect the
  rendered href, accessible name, response, canonical, and network activity.
- **Patterns to follow:**
  `apps/web/src/components/home/WatchHomeExperiencePage.tsx`,
  `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`,
  and
  `docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md`.
- **Test scenarios:**
  1. Covers AE7 by enumerating content-section CTAs and rejecting home,
     localized-home, unknown, reserved, search, and malformed Watch
     destinations.
  2. Proves the inventory contains contextual accessible names and the expected
     `jfm-collection` destination.
  3. Proves the footer/global Watch link remains `/watch` but is not selected by
     the content-CTA inventory.
  4. Desktop browser smoke follows the repaired CTA to a direct 200 route whose
     canonical matches the destination.
  5. Mobile browser smoke exposes the same href and accessible name and
     completes the same navigation.
  6. Page-load inspection shows no CTA-specific fetch and no new homepage
     client boundary or initialization request.
- **Verification:** Focused Vitest suites, touched Web typecheck/lint/format,
  route-contract assertions, desktop/mobile browser proof, and page-load
  inspection pass. Record bounded evidence in the roadmap completion notes and
  set `status: "complete"`.

---

## Scope Boundaries

- No production Experience JSON mutation, direct database write, or auth
  bypass. The current published `/` value is repaired defensively at render.
- No new Admin GraphQL field, generated schema artifact, persisted CTA mode, or
  content migration.
- No route parser, proxy, canonicalizer, metadata, sitemap, contextual episode,
  sharing, search, or language-preference behavior change.
- No changes to header, footer, logo, card, player, or item-level navigation.
- No changes to CTASection, PromoBanner, or hero CTA behavior; those block
  types are absent from the captured production CTA inventory.
- No bulk visible-copy rewrite or new translation keys.
- No network validation or route-manifest fetch during rendering or click
  handling.

---

## Risks and Dependencies

- The Admin editor conflates blank media CTA links with disabled state while
  Web already renders an inferred CTA. This plan deliberately avoids changing
  that persisted model; the runtime resolver must continue to handle `/`
  placeholders safely.
- A route-shape check cannot prove arbitrary authored collection existence.
  The rendered inventory and browser direct-200/canonical checks provide the
  concrete evidence for current homepage content.
- Same-origin URLs outside `/watch` and true cross-origin HTTP(S) links must not
  be rejected merely because `parseWatchPath` does not recognize them.
- Nested block propagation can drift if Section/Container signatures are not
  updated together; focused nested-render tests make that boundary explicit.
- Local Watch browser verification depends on the Admin/Web environment and
  suitable Experience data. If the production-shaped fixture cannot be served
  locally, report the limitation and retain focused render-contract evidence
  without weakening auth safeguards.
- Explicit analytics coexists with Datadog automatic interaction tracking.
  Consumers should treat `watch_home.section_cta_clicked` as the canonical
  destination event to avoid double counting.
- The explicit analytics action follows the anchor's native `click` event,
  covering primary pointer/touch activation, Enter activation, and
  modifier-click without preventing navigation. Middle-click and context-menu
  navigation remain native but are intentionally outside the custom action.

---

## Sources and Research

- Linear issue `FGE-21` (linked as WAT-255) and its acceptance criteria; moved
  to In Progress on 2026-07-23.
- Production Watch homepage CTA inventory captured on 2026-07-23: eleven media
  CTAs and one FAQ CTA. The sole content self-link is “Films About Jesus” →
  `/watch`; its inferred `jfm-collection` route and all sampled non-self
  destinations returned direct 200 responses.
- `apps/web/src/components/sections/MediaCollection.tsx` contains the explicit
  → inferred → fallback precedence and existing `/` normalization path.
- `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
  and `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` create
  and restore `/` media CTA placeholders.
- `docs/roadmap/platform/feat-262-watch-home-collection-cta-destination.md` and
  `docs/solutions/design-patterns/watch-media-collection-default-cta-parent-inference-20260715.md`
  establish canonical collection inference and fallback behavior.
- `docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md`
  establishes supported public Watch route shapes.
