---
title: "Video Display Title Fallback - Plan"
type: fix
date: 2026-08-10
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
deepened: 2026-08-10
---

# Video Display Title Fallback

## Goal Capsule

Prevent raw Video slugs, IDs, and whitespace-only titles from appearing as
viewer-facing title placeholders anywhere Forge renders public Watch content.
Every participating producer and client must use one field-level fallback
policy: a trimmed nonblank requested-language title, then a trimmed nonblank
published English title, then a humanized Video slug.

This is the cross-platform follow-up to PR #1870 and `feat-336`. That change
fixed Admin language inventory and Web route snapshots, but left home feeds,
search, history, downloads, recommendations, media-collection resolution,
mobile, and TV with independent raw-slug fallbacks.

---

## Product Contract

### Problem

The visible title in `/watch/jula.html` is assembled by the Watch home model,
not the route-snapshot normalization fixed in PR #1870. Its requested locale
row can contain an empty title; the model then falls directly to
`video.slug`, rendering `miraculous-catch-of-fish`. Equivalent shortcuts exist
in public Web, mobile, TV, search-index, and generated-content paths. Fixing
only the carousel would preserve inconsistent and user-visible failures.

### Actors

- **A1 — Viewer:** browses Watch home, detail, search, history, series,
  downloads, recommendations, and authored experiences on Web, mobile, or TV.
- **A2 — Content author:** expects authored card overrides to retain precedence
  and intentionally titleless Experience cards to remain titleless.
- **A3 — Maintainer:** needs one reusable policy and regression inventory so a
  new surface cannot silently reintroduce raw identifiers.

### Requirements

- **R1 — Field-level ladder:** A displayed Video title resolves from the first
  trimmed nonblank requested-language candidate, then the first trimmed
  nonblank published English candidate, then a humanized Video slug. Callers
  with exact and broad requested layers retain that order before English.
- **R2 — Whitespace and candidate order:** Empty and whitespace-only values are
  absent; a later valid candidate at the same precedence level may win.
- **R3 — No identifier placeholders:** `coreId`, `documentId`, database IDs,
  and raw slugs must never be viewer-facing title fallbacks. When neither a
  title nor a usable slug exists, an existing neutral product label may remain.
- **R4 — Localized-field independence:** Title fallback must not replace the
  requested-language description, snippet, image alt, questions, promotional
  metadata overlays, playable language, or other localized fields.
- **R5 — Cross-platform parity:** Public Web, mobile, and TV title producers,
  normalizers, cached models, search mappers, and defensive render boundaries
  must apply the same semantics.
- **R6 — Authored-title semantics:** Authored Experience/media-collection title
  overrides keep precedence. An intentionally absent authored card title must
  not become visible merely because a linked Video has a fallback title.
- **R7 — Identity stability:** Raw slugs remain unchanged for URLs, route
  matching, GraphQL variables, storage/cache keys, analytics, filenames where
  the filename is machine identity, and diagnostics.
- **R8 — Published and bounded data:** English fallback from Admin-backed public
  data must use visible/published locale rows and existing batched loading or
  bounded query shapes. No per-card network fan-out or mobile/TV payload
  expansion to unrelated media fields is permitted.

### Key Flows

- **F1 — Requested title succeeds:** A localized title renders, while its
  associated localized metadata stays unchanged.
- **F2 — Requested title is blank:** A published English title renders on home,
  detail, search, history, downloads, recommendations, series, and linked
  public cards; requested-language non-title copy remains.
- **F3 — Requested and English Video titles are unavailable:** A
  repeated-separator slug such as
  `miraculous--catch_of-fish` renders as readable words, never as the raw slug.
- **F4 — Cached or legacy data arrives:** Defensive client normalization rejects
  whitespace and, only in an identified legacy field whose historical producer
  stored the slug as fallback text, humanizes a title equal to the raw Video
  slug before caches/indexes turn over. Authoritative locale titles and
  authored overrides are never rewritten by equality alone.
- **F5 — Navigation continues:** The viewer follows a card or search result and
  the destination URL retains the exact original language and Video slugs.

### Acceptance Examples

- **AE1:** Given a nonblank Arabic title and an English title, Arabic wins on
  every participating surface whose current product flow requests Arabic.
- **AE2:** Given a whitespace-only Arabic title, a published English title, and
  an Arabic description, English is displayed as the title and Arabic remains
  the description.
- **AE3:** Given no requested or English title and slug
  `miraculous-catch-of-fish`, the display title is `Miraculous Catch Of Fish`.
- **AE4:** Given only an unrelated published locale, it is not selected; the
  slug is humanized.
- **AE5:** Given a second requested-language row with a nonblank title, that
  title wins before English.
- **AE6:** Given an intentionally titleless authored Experience card, the card
  remains titleless; a linked Video fallback may still be used by accessibility
  copy where the existing product contract calls for it.
- **AE7:** Given a fallback title on a card, its href, cache identity, progress
  lookup, playback selection, and analytics slug remain byte-for-byte stable.

### Success Criteria

- The reported `/watch/jula.html` carousel no longer displays
  `miraculous-catch-of-fish` or another raw Video slug.
- Automated coverage proves R1–R8 at the shared policy, upstream producer, and
  representative Web/mobile/TV consumer boundaries.
- A dual-pattern GraphQL inventory finds no remaining public Video display
  path that falls directly from missing localized title to a raw identifier.
- Web browser QA confirms visible parity, stable navigation, no new console
  errors, and no material cold/warm Watch home loading regression.

### Scope Boundaries and Assumptions

- “Everywhere” means customer-facing Video display-title placeholders across
  public Web, mobile, TV, search/index production, and Admin resolvers that feed
  public cards. Internal editor/operator identity labels remain raw when their
  purpose is record disambiguation rather than content display.
- Language names, route slugs, download identifiers, and diagnostic values are
  distinct domains and are not rewritten by this title policy.
- Search/social promotional overrides remain independent from the canonical
  Video title. The fallback may supply their canonical base title but does not
  collapse override precedence.
- No production backfill or direct deployment is part of this change. Search
  producers and defensive consumers are both fixed so correctness does not
  depend on immediate reindexing.

### Product Key Decision

- **KTD-P1 — Fix all public title boundaries, not only the carousel.**
  `session-settled:user-directed`; rejected alternative: patching the reported
  Watch home component alone. The user explicitly requested the PR #1870 rule
  everywhere a placeholder-format title can render.

---

## Planning Contract

### Context and Research

- PR #1870 (`1710db1e`) implemented the correct rule in
  `apps/admin/src/services/video.service.ts` and
  `apps/web/src/lib/content.ts`, but its Web helper is private to route
  snapshots.
- `docs/solutions/ui-bugs/watch-blank-localized-title-fallback.md` establishes
  field-level fallback and warns against replacing an entire locale row.
- `CONCEPTS.md` and the public Watch URL solution separate presentation from
  stable slug identity.
- `docs/solutions/architecture-patterns/tv-sdui-mediacollection-card-image-title-resolution.md`
  preserves intentionally titleless authored cards.
- `docs/solutions/architecture-patterns/watch-video-search-social-metadata-overlay.md`
  keeps promotional metadata overlays separate from visible canonical titles.
- `docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md`
  requires auditing both gql.tada `graphql(...)` and Apollo `gql` call sites.

### Key Technical Decisions

- **KTD1 — Own the pure policy in `@forge/content-display`.** Create a small,
  framework-free package modeled on `@forge/watch-url-policy` for trimming,
  slug humanization, and ordered title resolution. Web, Admin, mobile, and TV
  use the same semantics without creating a dependency from Admin to a typed
  GraphQL consumer package. Rejected alternatives: four app-local helpers and
  adding presentation policy to the URL-policy package.
- **KTD2 — Add fallback data only at existing producer boundaries.** Public Web
  operations with exact and broad localization add separate title-only exact,
  broad, and published-English aliases, then normalize once; the locale
  resolver's conjunctive filters must not be treated as the precedence ladder.
  English-only native operations retain their current product behavior.
  Requested and English DataLoader work is scheduled together so batching
  remains per argument group rather than sequentially fragmenting into
  per-Video loads.
  Admin Typesense and publishable Experience-AI Video-title outputs resolve
  titles before publishing their models; the intentionally titleless
  media-collection resolver remains unchanged. A new public
  `watchVideosByIds(ids)` query batches existing `Video` projections for Watch
  history and native linked-video hydration; it does not own title selection.
  Rejected alternative: a computed display-title field that still would not
  cover flattened search results, direct service output, or persisted data.
  Query aliases follow the repository's existing locale-field pattern. Deploy
  Admin before clients begin using the additive batch query; Web keeps its
  prior single-video query as a rolling-deploy fallback.
- **KTD3 — Keep producer correctness plus defensive consumers.** Producer
  boundaries create canonical display values; client mappers still reject
  whitespace and humanize legacy raw slugs. This covers stale Web caches,
  search indexes, persisted progress, and native snapshots without requiring a
  synchronized cache flush. Title-equals-slug repair is allowlisted to legacy
  cache, index, progress, or snapshot fields whose historical producer used
  slug fallback; authoritative locale and authored titles are preserved.
- **KTD4 — Treat fallback as a title-field operation.** The selected title may
  come from English while description/image alt remain requested-language.
  Whole-row replacement is forbidden because it erases useful localization.
- **KTD5 — Invalidate only normalized caches whose output semantics changed.**
  Bump Watch home and affected demo/recommendation cache versions/keys. Native
  snapshots that store raw records and rebuild models need no version bump
  unless implementation changes the persisted query shape.

### High-Level Technical Design

The exact file-level design may adapt during implementation, but the data flow
and ownership boundaries are fixed:

```text
requested title candidates ─┐
published English titles ───┼─> shared display policy ─> normalized title
Video slug ─────────────────┘             │
                                          ├─> Web public models/render guards
                                          ├─> mobile/TV models/render guards
                                          ├─> Typesense display document
                                          └─> publishable Experience-AI output

requested locale row ───────────────────────> description/imageAlt/etc.
raw Video slug ─────────────────────────────> URL/key/storage/analytics identity
```

### Implementation Units

#### U1. Establish roadmap scope and shared display policy

- **Goal:** Create the durable title ladder and declare the broader follow-up
  scope before app changes.
- **Requirements:** R1, R2, R3, R7
- **Files:** Create
  `docs/roadmap/content-discovery/feat-344-watch-cross-platform-display-title-fallback.md`;
  create `packages/content-display/package.json`, package configuration, source,
  and focused tests; update workspace lockfile and app dependencies.
- **Approach:** Mark `feat-344` in progress and link it as a follow-up to
  `feat-336`. Export pure helpers that accept ordered requested/English string
  candidates and an optional slug, return trimmed authored text, humanize
  repeated hyphen/underscore separators, and never accept an ID fallback.
- **Test scenarios:** Requested title; whitespace then later requested title;
  English fallback; unrelated locale excluded by caller; repeated separators;
  absent/blank slug; invariant that raw identifiers are not accepted.
- **Verification:** Shared package tests, typecheck, lint, and consumer import
  resolution pass.

#### U2. Fix Admin public title producers

- **Goal:** Prevent upstream linked-card and search data from publishing blank
  or raw-slug display titles.
- **Requirements:** R1–R4, R6, R8
- **Files:** Modify `apps/admin/src/services/typesense-watch-search-locales.ts`,
  `apps/admin/src/services/typesense-watch-search-indexer.ts`,
  `apps/admin/src/services/typesense-watch-search.service.ts`, and focused
  tests; modify public Experience-AI Video context/title producers only where
  their output becomes viewer-visible authored content. Retain
  `apps/admin/src/graphql/types/blocks.ts` as an explicit titleless-card
  exception and preserve its regression tests.
- **Approach:** Index published locale metadata even when its title is blank so
  new documents preserve requested descriptions independently. Because legacy
  catalog documents omitted those rows, hydrate the bounded result-page Video
  IDs with one Prisma locale projection and resolve requested/broad title and
  metadata plus English title without per-result queries or a required
  production reindex. Remove arbitrary unrelated locale fallback. Public
  Experience-AI outputs fetch only published requested and English candidates
  through existing bounded service queries. Keep search document slug and
  authored override semantics unchanged.
- **Test scenarios:** AE1–AE6; an indexed blank-title locale retains localized
  description; a legacy index document receives one bounded result-page locale
  hydration; broad requested title; unrelated locale; draft/deleted English
  excluded; humanized search-document slug; intentionally titleless
  MediaCollection resolver remains null; query count does not grow per result.
- **Verification:** Focused Admin locale-selector/search/Experience-AI tests,
  retained block titleless tests, Admin typecheck, and scoped lint pass without
  an SDL or index-schema change.

#### U3. Fix Web title-producing queries and normalized caches

- **Goal:** Correct home, history, demo search, and recommendation models before
  their values reach components.
- **Requirements:** R1–R5, R7, R8; flows F1–F5
- **Files:** Modify `apps/web/src/lib/fragments/watch-home.ts`,
  `apps/web/src/lib/watch-home.ts`, `apps/web/src/lib/watch-home-config.ts`,
  `apps/web/src/lib/watch-history.ts`, `apps/web/src/lib/demo-search.ts`,
  `apps/web/src/lib/recommendations.ts`, related route metadata, and focused
  tests/query guards.
- **Approach:** Add separate title-only exact-language, broad-locale, and
  published-English aliases to bounded Web GraphQL responses; resolve titles
  with the shared policy while preserving requested metadata. Home parent and
  child selections each carry that fixed three-tier title shape; history uses
  `watchVideosByIds` once per requested language and keeps its former
  single-video query only as a rolling-deploy fallback. Remove
  `coreId` and raw route-slug display fallbacks. Bump only
  `WATCH_HOME_CACHE_VERSION`, `demo-search-video`, and `video-by-slug` when their
  normalized outputs change.
- **Test scenarios:** AE1–AE5 and AE7 for parent/child home records, home hero
  and rails, history, demo results, recommendations, metadata, and cache-version
  assertions. Ensure query guards do not add dubs or unrelated payloads.
- **Verification:** Focused Web producer/query/cache tests, Web typecheck, and
  scoped lint pass. Printed-query guards assert all three locale aliases at
  every relevant nested level and prohibit broad/English description/image
  fields.

#### U4. Harden remaining Web display boundaries

- **Goal:** Ensure malformed, legacy, or partially hydrated values cannot leak
  raw identifiers in search, Experience metadata, downloads, or generated
  sections.
- **Requirements:** R2–R7; flows F3–F5
- **Files:** Classify before editing; confirmed candidates are
  `apps/web/src/components/watch/collection-download-options.ts`,
  `CollectionDownloadModal.tsx`, the demo recommendation page,
  `AiExperienceGeneratorDemo.tsx`, and `GeneratedSections.tsx`. Inspect
  `enrichment.ts`, `experience-metadata.ts`, `search.ts`, and
  `watch-search-client.ts` but change them only when they independently choose
  a visible placeholder rather than validate already-produced content.
- **Approach:** Apply the shared helper only where an existing UI contract
  chooses a Video display placeholder. Preserve authored title absence,
  metadata overlay precedence, machine identifiers, and href construction.
  Use an existing neutral label only when neither title nor usable slug exists.
- **Test scenarios:** Whitespace API title; humanized legacy slug; absent title
  and slug; authored override; intentionally titleless card; accessible label;
  visible download label/filename; unchanged href and identity keys.
- **Verification:** Focused mapper/component tests plus a dual-pattern GraphQL
  and raw fallback inventory find no unclassified public Web title sinks.

#### U5. Bring mobile display models to parity

- **Goal:** Apply the same title semantics to mobile home, Watch detail/series,
  SDUI media collections, search, and offline downloads.
- **Requirements:** R1–R8; flows F1, F3–F5
- **Files:** Modify mobile Watch home model/Experience adapter,
  `apps/mobile/src/lib/queries.ts`, `apps/mobile/src/lib/normalizeVideo.ts`,
  `apps/mobile/src/lib/watchSearch.ts`, thumbnail/media-collection hydration,
  `DownloadRow.tsx`, and their focused tests.
- **Approach:** Add title-only `locale: "en"` and
  `languageSlug: "english"` aliases to detail, series, home, and linked-video
  operations. Use `watchVideosByIds` for typed linked-video thumbnail
  hydration, preserve authored overrides and localized field ownership, and
  avoid adding dubs or other heavy fields.
- **Test scenarios:** Root, parent, sibling, episode, home hero/rails, search,
  SDUI override/titleless behavior, legacy snapshot, and offline records whose
  stored title equals the slug; no `coreId` display; unchanged routes and
  snapshot identity.
- **Verification:** Focused mobile Jest suites, query guards, mobile typecheck,
  and scoped lint pass.

#### U6. Bring TV display models to parity

- **Goal:** Apply the same semantics to TV home, detail/series, search,
  hydration, continue watching, up-next, episodes, and showcase mode.
- **Requirements:** R1–R8; flows F1, F3–F5
- **Files:** Modify TV Watch home model, `apps/tv/src/lib/normalizeVideo.ts`,
  `apps/tv/src/lib/videoQueries.ts`,
  `apps/tv/src/lib/watchHome/homeQueries.ts`, `apps/tv/src/lib/watchSearch.ts`,
  `experienceHydration.ts`, continue-watching, episode/up-next rails, showcase
  source resolution, and focused tests.
- **Approach:** Normalize at model boundaries and retain component defenses for
  persisted legacy data. Preserve authored overrides and existing neutral copy
  only when neither title nor slug exists; never display a raw slug.
- **Test scenarios:** Root/parent/sibling/children; home; search whitespace;
  hydration; legacy snapshot; stale continue-watching title equal to its slug;
  episode/up-next; showcase source; absent slug/title; stable route and storage
  identity.
- **Verification:** Focused TV Jest suites, query guards, TV typecheck, and
  scoped lint pass.

#### U7. Prove coverage, performance, and visible behavior

- **Goal:** Demonstrate the reported bug and its sibling paths are fixed without
  a loading regression, then record completion.
- **Requirements:** R1–R8; AE1–AE7
- **Files:** Update the roadmap ticket and the existing localized-title
  solution with the newly generalized policy and audited boundary inventory.
- **Approach:** Run cross-app focused and CI-sensitive checks, audit both GraphQL
  call styles and direct fallback expressions, then exercise RTL Watch home and
  a linked destination in a real browser. Inspect browser errors and compare
  cold/warm home timing with the bounded-query expectation. Record the fallback
  inventory as a table of changed display sinks and intentional identity or
  internal matches. Test additional
  search/history/download paths when deterministic data is available; do not
  claim native visual proof unless a simulator/device is available.
- **Test scenarios:** Reported Jula card, linked destination, search/history
  result, title fallback with localized non-title copy, navigation identity,
  intentionally titleless authored card, console health, cold/warm load.
- **Verification:** Relevant tests/typechecks/lint/format/diff checks pass; no
  unclassified public raw identifier fallback remains; `feat-344` is marked
  complete with local proof and no production-deploy claim.

### System-Wide Impact

- **Data flow:** Additional English title aliases increase only small locale
  title selections. Admin DataLoaders and the bounded `watchVideosByIds`
  GraphQL request remain the loading boundary.
- **Caching:** Web normalized Watch home, demo search, and recommendation cache
  identities must change. Typesense and native persisted data can be stale, so
  defensive normalization remains required.
- **Contracts:** URL, analytics, storage, and playback contracts do not change.
  GraphQL adds the backward-compatible public
  `watchVideosByIds(ids: [ID!]!): [Video!]!` query and regenerates Admin SDL plus
  `@forge/admin-graphql` introspection output.
- **Localization:** Only title selection crosses from requested language to
  English. Other localized fields retain their current row and precedence.
- **Accessibility:** Existing accessibility fallbacks may gain readable
  humanized titles; intentionally invisible authored titles remain invisible.
- **Performance:** Watch home query payload and locale-loader work must remain
  bounded to the fixed exact/broad/English selections at each relevant Web
  query level; query guards and loading proof are required because
  rendering/query initialization is touched. Against the same local fixture,
  median warm response/model timing may not regress by more than 10% with a
  100 ms noise allowance, and cold load must remain under five seconds; either
  failure blocks completion.

### Risks and Mitigations

- **Scope drift:** A text search finds many slug uses that are valid identity.
  Mitigation: classify every changed call site as a display-title boundary and
  leave URLs, keys, filenames, analytics, and diagnostics unchanged.
- **Localization regression:** Whole-row English fallback could erase localized
  descriptions. Mitigation: resolve arrays of title strings only and assert
  requested non-title fields in tests.
- **Authored Experience regression:** Hydration could make titleless cards
  visible. Mitigation: preserve authored override/absence semantics and cover
  them explicitly.
- **Performance regression:** Per-card English loads or broad native query
  additions could restore prior payload problems. Mitigation: use aliases and
  batching, title-only fields, query guards, and cold/warm timing.
- **Stale content:** Search/native/Web caches may retain malformed values.
  Mitigation: version normalized Web caches and keep defensive client policy;
  do not require a production backfill for correctness.
- **Rolling deploy mismatch:** New clients can query an older Admin deployment.
  Mitigation: deploy Admin first; Web retains its former per-video history
  query only as an error fallback, and native releases follow backend rollout.

### Open Questions

#### Resolved During Planning

- **Q1:** Should the fix be carousel-only? **No**; KTD-P1 records the explicit
  user direction.
- **Q2:** Should humanization rewrite canonical slugs? **No**; R7 limits it to
  display text.
- **Q3:** Should an unrelated locale title beat the slug? **No**; R1 permits
  only requested language and published English.
- **Q4:** Should the policy become a new GraphQL schema field? **No** for this
  change; KTD2 covers all producer types with less contract churn while the
  shared package prevents semantic drift.

#### Deferred to Implementation

- **Q5:** Which Experience-AI Admin outputs are directly publishable versus
  internal preview-only? Classify the two identified Video-title fallbacks
  before editing; public output is in scope, diagnostics are not.
- **Q6:** Which browser fixtures expose deterministic history, search, and
  download fallbacks? Use automated producer/consumer tests when live fixture
  data is unavailable and state the proof boundary.

### Documentation and Operational Notes

- Update `docs/solutions/ui-bugs/watch-blank-localized-title-fallback.md` rather
  than creating a competing solution document.
- Record the full audited public boundary list and the shared-package ownership
  so future features know where to apply the policy.
- Production release remains normal PR-to-main deployment. Do not trigger a
  direct Railway deployment or production reindex from this task.

---

## Verification Contract

- **Shared semantics:** Unit tests cover all precedence, trimming, separator,
  missing-data, and identity invariants.
- **Admin producers:** Focused GraphQL block and Typesense locale/service tests
  prove visible-only English fallback and requested-metadata preservation.
- **Web:** Producer, mapper, cache/query-guard, component, and route metadata
  tests cover representative home/history/search/download/recommendation paths.
- **Mobile/TV:** Focused model/normalizer/search/hydration/persisted-entry suites
  prove parity without prohibited payload growth.
- **Static quality:** Touched package/app typechecks, lint, formatting, generated
  contract checks where applicable, and `git diff --check` pass.
- **Audit:** Both GraphQL syntaxes and direct `title || slug`, `title ?? slug`,
  `title || coreId`, `title ?? coreId`, and equivalent fallback shapes are
  searched and every remaining match is documented as identity/internal-only.
- **Browser:** `/watch/jula.html` shows readable title text, a linked route keeps
  its slug identity, RTL/localized copy remains, client controls work, console
  errors are inspected, and cold/warm loading is recorded.

---

## Implementation Results

- Added `@forge/content-display` as the single runtime-neutral owner of the
  requested title -> published English title -> humanized slug ladder.
- Applied the policy at Admin Typesense/Experience-AI producers and at Web,
  mobile, TV, generated-content, search, history, download, recommendation,
  detail, series, and home model boundaries.
- Added the bounded public `watchVideosByIds` transport, regenerated Admin SDL
  and `@forge/admin-graphql` introspection, and retained a Web old-schema
  compatibility fallback for rolling deployment.
- Focused validation passed: 231 Admin tests, 75 Web tests, 98 Mobile tests, 90
  TV tests, and 14 shared-policy tests, including query/search guards, plus
  typechecks and lint across every touched package.
- Browser QA returned HTTP 200, exercised Search open/close, observed no browser
  errors or raw slug, and measured an 815 ms cold load with 737/705/661 ms warm
  reloads. The CI-safe local environment could not load upstream Experience
  data, so exact Jula copy is fixture-proven rather than claimed as live-data
  browser proof.

---

## Definition of Done

- R1–R8 and AE1–AE7 are traceable to passing implementation and verification.
- The screenshot’s raw `miraculous-catch-of-fish` title is no longer rendered.
- No known public Web/mobile/TV/search/generated-content Video title boundary
  falls directly from missing localized title to a raw slug or ID.
- Shared policy ownership and all intentional exceptions are documented.
- `feat-344` is complete, the branch is reviewed, CI-sensitive validation is
  green, and a pull request is open and watched until merge-ready.
