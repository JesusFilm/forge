# Admin-Core Consumer Migration — Query & Shape Inventory

<!--
  This file is the single canonical inventory of every consumer-side GraphQL
  operation that the admin-core consumer migration (apps/web, apps/mobile,
  apps/tv) must replace, adapt, or preserve. It is hand-maintained, not
  generated — but it should mirror the codebase exactly. Treat it like a
  schema-drift artifact: when a consumer adds, removes, or alters a
  `graphql()` (or raw `gql`) callsite, this file MUST be updated in the same
  change.

  HOW TO REGENERATE / RECONCILE:
    From the repo root:
      rg "graphql\(" apps/web/src apps/mobile/src apps/tv/src
      rg "= gql\`"   apps/web/src apps/mobile/src apps/tv/src

    Every line in the combined output MUST have a corresponding
    `### {app}:{ConstantName}` subsection below. The second pattern catches
    raw Apollo `gql` template literals (notably `SCENE_RECOMMENDATIONS` in
    apps/web/src/lib/recommendations.ts) which the gql.tada-only sweep
    silently skips.

  OPERATION KEY FORMAT:
    `{app}:{ConstantName}` — e.g. `web:GET_WATCH_EXPERIENCE`,
    `mobile:LIST_EXPERIENCES`, `tv:SEMANTIC_SEARCH`. The constant name is the
    exact JavaScript identifier from the consumer source so a global rg
    locates the definition without ambiguity.

  SCOPE:
    - U1 populates `## apps/web Operations`.
    - U2 populates `## apps/mobile Operations`.
    - U3 populates `## apps/tv Operations`.
    - U4 populates `## Block __typename → Admin Discriminator Mapping`.
    - U5 populates `## PUBLIC Access Classification`.
    - All units append to `## Verification Log`.
-->

## Scope & Conventions

### Operation key format

`{app}:{ConstantName}` — the JavaScript identifier of the `graphql()` (or raw
`gql`) constant in the consumer source, prefixed by app slug. Examples:

- `web:GET_WATCH_EXPERIENCE`
- `mobile:LIST_EXPERIENCES`
- `tv:SEMANTIC_SEARCH`

This format is grep-friendly: a global `rg "{ConstantName}"` from the repo
root locates the definition and every callsite.

### Field-tagging legend

Each consumer-selected field carries exactly one parity tag:

| Tag                        | Meaning                                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direct-admin-parity`      | Admin schema exposes this field with the same name + type. Migration is a literal rename of the operation source.                                                                   |
| `adapter-required`         | Admin exposes the data, but the field name, container shape, or nullability differs. Unit 5's adapter handles the renaming.                                                         |
| `missing`                  | Admin does NOT expose this field today. Either admin schema must widen (Unit 2/3 of the parent migration plan), or the consumer drops the field.                                    |
| `intentionally-deprecated` | Field is still selected today but the consumer's renderer no longer reads it. Drop on migration.                                                                                    |
| `?`                        | Parity status genuinely unknown until U4 reconciles against `apps/admin/src/domain/blocks.ts` and the admin GraphQL schema. Default for U1 — every web row uses `?` until U4 lands. |

### PUBLIC-classification legend

Each operation will be classified by U5 as one of:

| Classification                   | Meaning                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC-current`                 | Admin already exposes this operation under `authScopes: { public: true }`. No widening needed.                                                                    |
| `PUBLIC-eligible-needs-widening` | Operation is safe to expose publicly (no PII, no preview-only fields) but admin currently requires auth. Unit 2 of the parent plan widens.                        |
| `MUST-stay-authenticated`        | Operation exposes preview-mode data, draft content, or operator-only state and MUST NOT become public. Consumer either keeps an auth path or drops the operation. |

The 4 admin queries currently exposed publicly (per the parent migration
plan) are: `experienceBySlug`, `searchExperiences`, `search` (note: admin's
field is `search`, NOT `hybridSearch`), and `sceneRecommendations`. The
PUBLIC tier is enforced per-field via `authScopes: { public: true }` on
each Pothos field definition in `apps/admin/src/graphql/queries/*.ts` and
`apps/admin/src/graphql/types/experience.ts` — there is no central PUBLIC
allowlist. U5 inspects every operation row below and assigns one
classification.

### Forward-reference: how operations get rewritten

Unit 5/6 of the parent migration rewrites each `web:*`, `mobile:*`, and
`tv:*` operation below to use the `adminGraphql()` factory exported from
`packages/graphql/src/admin.ts` instead of the Strapi-bound `graphql()` from
`@forge/graphql`. Each rewrite either renames fields directly
(`direct-admin-parity`) or routes through a small adapter shim
(`adapter-required`). The synthetic web `WatchBlock` synthesis layer
(documented below) survives the rewrite — admin returns Experience blocks
the same way Strapi does; the watch-route's auto-template merge stays in
the consumer.

---

## apps/web Operations

Ten operations total: eight gql.tada-typed via `graphql()` from
`@forge/graphql`, plus one raw-Apollo `gql` callsite for the custom
`sceneRecommendations` extension type, plus one fragment-co-located
operation pair imported by `content.ts`. Per-block fragments
(`bibleQuotesCarouselFragment`, `videoHeroFragment`, etc.) are NOT
standalone operations — they are supporting selection sets composed into
the operations below, listed inline under the operation that pulls them in.

### web:GET_EXPERIENCE

- **Source:** `apps/web/src/lib/content.ts:19-25`
- **Variables:** `$slug: String!`, `$locale: I18NLocaleCode!`
- **Access expectation (best guess; final in U5):** PUBLIC — slug-keyed
  lookup, no auth header in this code path.
- **Cache behavior:** `client.query(...)` with no explicit `fetchPolicy`
  override. Apollo `InMemoryCache` (default) applies. Caller
  `readPublishedContent` is invoked only for "is this slug published" probe
  and is not wrapped in `unstable_cache`.
- **Renderer/resolver dependency:** `readPublishedContent(slug, locale)` in
  the same file (line ~175). Used by build-time / runtime existence checks.
- **Composed fragments:** none.
- **Selected fields & parity tags:**

| Type.field                           | Parity tag |
| ------------------------------------ | ---------- |
| `Query.experiences(filters, locale)` | `?`        |
| `Experience.documentId`              | `?`        |

### web:GET_WATCH_EXPERIENCE

- **Source:** `apps/web/src/lib/content.ts:27-39`
- **Variables:** `$locale: I18NLocaleCode!`, `$filters: ExperienceFiltersInput!`
- **Access expectation (best guess; final in U5):** PUBLIC — drives the
  primary watch-page render for unauthenticated visitors.
- **Cache behavior:** `client.query(...)` with `fetchPolicy: "no-cache"`
  (forces a fresh server fetch each invocation). The result is then wrapped
  by an outer `unstable_cache(..., ["watch-page"], { revalidate: 60 })` in
  `fetchResolvedWatchPage` (line ~410), so Next.js memoizes the resolved
  output for 60 s.
- **Renderer/resolver dependency:** `getExperienceByFilters(...)` →
  `resolveSlugPage` / `resolveHomepage` → `resolveWatchPage` (the exported
  watch-page resolver consumed by every `apps/web/src/app/[slug]/...` route).
- **Composed fragments:** `WatchExperience` (the composite watch fragment)
  which itself composes 15 per-block fragments — see fragment list below.
- **Selected fields & parity tags:**

| Type.field                           | Parity tag               |
| ------------------------------------ | ------------------------ |
| `Query.experiences(filters, locale)` | `?`                      |
| (delegates to `...WatchExperience`)  | see fragment table below |

#### Fragment: `WatchExperience` (apps/web/src/lib/fragments/watch-experience.ts)

| Type.field                                                            | Parity tag |
| --------------------------------------------------------------------- | ---------- |
| `Experience.documentId`                                               | `?`        |
| `Experience.slug`                                                     | `?`        |
| `Experience.isTemplate`                                               | `?`        |
| `Experience.title`                                                    | `?`        |
| `Experience.metaDescription`                                          | `?`        |
| `Experience.ogTitle`                                                  | `?`        |
| `Experience.ogDescription`                                            | `?`        |
| `Experience.pathSegment`                                              | `?`        |
| `Experience.ogImage.{url,width,height,alternativeText}`               | `?`        |
| `Experience.blocks.__typename`                                        | `?`        |
| `ComponentSectionsMediaCollection` (via `...MediaCollection`)         | `?`        |
| `ComponentSectionsPromoBanner` (via `...PromoBanner`)                 | `?`        |
| `ComponentSectionsInfoBlocks` (via `...InfoBlocks`)                   | `?`        |
| `ComponentSectionsCta` (via `...CTASection`)                          | `?`        |
| `ComponentSectionsVideoHero` (via `...VideoHero`)                     | `?`        |
| `ComponentSectionsBibleQuotesCarousel` (via `...BibleQuotesCarousel`) | `?`        |
| `ComponentSectionsText` (via `...TextSection`)                        | `?`        |
| `ComponentSectionsEasterDates` (via `...EasterDates`)                 | `?`        |
| `ComponentSectionsAdventCountdown` (via `...AdventCountdown`)         | `?`        |
| `ComponentSectionsContainer` (via `...Container`)                     | `?`        |
| `ComponentSectionsVideo` (via `...VideoSection`)                      | `?`        |
| `ComponentSectionsSection` (via `...Section`)                         | `?`        |
| `ComponentSectionsRelatedQuestions` (via `...RelatedQuestions`)       | `?`        |
| `ComponentSectionsVideoCarousel` (via `...VideoCarousel`)             | `?`        |
| `ComponentSectionsNavigationCarousel` (via `...NavigationCarousel`)   | `?`        |

The 15 per-block fragments live at `apps/web/src/lib/fragments/*.ts`. Each
is re-exported from `apps/web/src/lib/fragments/index.ts`. The `Section`
fragment further nests a 16th fragment (`QuizButtonSection`) inline via
`ComponentSectionsQuizButton` — not via `...QuizButtonSection` because the
exported `quizButtonSectionFragment` is currently UNUSED outside its own
file. U4 reconciles each of these 16 Strapi `__typename`s against admin's
`apps/admin/src/domain/blocks.ts` discriminator union.

### web:GET_WATCH_SETTINGS

- **Source:** `apps/web/src/lib/content.ts:41-56`
- **Variables:** `$locale: I18NLocaleCode!`
- **Access expectation (best guess; final in U5):** PUBLIC — exposes the
  watch site's homepage + default-template Experience pointers; drives
  unauthenticated `/` and slug-not-found fallback flows.
- **Cache behavior:** `client.query(...)` with `fetchPolicy: "no-cache"`,
  same outer `unstable_cache(..., ["watch-page"], { revalidate: 60 })`
  wrapper as `web:GET_WATCH_EXPERIENCE` (both flow through
  `fetchResolvedWatchPage`).
- **Renderer/resolver dependency:** `getWatchSettings(locale)` → consumed
  by `resolveHomepage` and `resolveSlugPage` (template fallback).
- **Composed fragments:** `WatchExperience` (composed twice — once for
  `homepageExperience`, once for `defaultTemplateExperience`).
- **Selected fields & parity tags:**

| Type.field                                                          | Parity tag |
| ------------------------------------------------------------------- | ---------- |
| `Query.watchSetting(locale)`                                        | `?`        |
| `WatchSetting.documentId`                                           | `?`        |
| `WatchSetting.homepageExperience` (via `...WatchExperience`)        | `?`        |
| `WatchSetting.defaultTemplateExperience` (via `...WatchExperience`) | `?`        |

### web:GET_ROUTE_VIDEO

- **Source:** `apps/web/src/lib/content.ts:58-93`
- **Variables:** `$slug: String!`, `$locale: I18NLocaleCode!`
- **Access expectation (best guess; final in U5):** PUBLIC — drives the
  video-template fallback when a slug doesn't resolve to an Experience.
- **Cache behavior:** `client.query(...)` with `fetchPolicy: "no-cache"`,
  wrapped by the same `unstable_cache(..., ["watch-page"], { revalidate: 60 })`
  outer in `fetchResolvedWatchPage`.
- **Renderer/resolver dependency:** `getVideoBySlug(locale, slug)` →
  `resolveSlugPage` (used after Experience-by-slug returns null and a
  default template is configured).
- **Composed fragments:** none — projection is inline.
- **Selected fields & parity tags:**

| Type.field                                                                   | Parity tag |
| ---------------------------------------------------------------------------- | ---------- |
| `Query.videos(filters, locale)`                                              | `?`        |
| `Video.documentId`                                                           | `?`        |
| `Video.slug`                                                                 | `?`        |
| `Video.title`                                                                | `?`        |
| `Video.snippet`                                                              | `?`        |
| `Video.description`                                                          | `?`        |
| `Video.imageAlt`                                                             | `?`        |
| `Video.noIndex`                                                              | `?`        |
| `Video.images.url`                                                           | `?`        |
| `Video.primaryLanguage.coreId`                                               | `?`        |
| `Video.variants(pagination: { limit: -1 }).{documentId, hls, published}`     | `?`        |
| `Video.variants.language.coreId`                                             | `?`        |
| `Video.children(pagination: { limit: 24 }).{documentId, slug, title, label}` | `?`        |
| `Video.children.images.url`                                                  | `?`        |

### web:getWatchVideoOperation

- **Source:** `apps/web/src/lib/fragments/watch-video.ts:109-128` (defined),
  `apps/web/src/lib/content.ts:9-13` (imported), `content.ts:537` (callsite).
  Note: lives in `lib/fragments/` for co-location with `watchVideoFragment`,
  but counts as an operation, not a fragment.
- **Variables:** `$i18nLocale: I18NLocaleCode!`, `$collectionSlug: String!`,
  `$videoSlug: String!`. (All three required to dodge codegen's
  optional-stripping bug — see the source comment and
  `docs/solutions/cms/codegen-strips-optional-graphql-variables.md`.)
- **Access expectation (best guess; final in U5):** PUBLIC — powers the
  3-segment `/watch/[collection]/[video]/[locale]` route for unauthenticated
  visitors.
- **Cache behavior:** `client.query(...)` with `fetchPolicy: "no-cache"` in
  `fetchWatchVideoRecord` (line ~536), wrapped by
  `unstable_cache(tryResolveWatchVideo, ["watch-video"], { revalidate: 60 })`
  in `fetchResolvedWatchVideo` (line ~663).
- **Renderer/resolver dependency:** `fetchWatchVideoRecord` →
  `tryResolveWatchVideo` → `fetchResolvedWatchVideo` → `resolveWatchVideo`
  (the exported watch-video resolver consumed by
  `apps/web/src/app/[slug]/[video]/[locale]/page.tsx`).
- **Composed fragments:** `WatchVideo` (defined in the same file).
- **Selected fields & parity tags:**

| Type.field                                                                                                | Parity tag               |
| --------------------------------------------------------------------------------------------------------- | ------------------------ |
| `Query.videos(filters: { slug: { eq: $videoSlug }, parents: { slug: { eq: $collectionSlug } } }, locale)` | `?`                      |
| (delegates to `...WatchVideo`)                                                                            | see fragment table below |

#### Fragment: `WatchVideo` (apps/web/src/lib/fragments/watch-video.ts)

| Type.field                                                                                                              | Parity tag |
| ----------------------------------------------------------------------------------------------------------------------- | ---------- |
| `Video.documentId`                                                                                                      | `?`        |
| `Video.slug`                                                                                                            | `?`        |
| `Video.title`                                                                                                           | `?`        |
| `Video.snippet`                                                                                                         | `?`        |
| `Video.description`                                                                                                     | `?`        |
| `Video.noIndex`                                                                                                         | `?`        |
| `Video.label`                                                                                                           | `?`        |
| `Video.imageAlt`                                                                                                        | `?`        |
| `Video.images.{url, thumbnail, mobileCinematicHigh, mobileCinematicLow}`                                                | `?`        |
| `Video.primaryLanguage.{coreId, bcp47}`                                                                                 | `?`        |
| `Video.parents.{documentId, slug, title}`                                                                               | `?`        |
| `Video.parents.children(pagination: { limit: -1 }).{documentId, slug, title, label}`                                    | `?`        |
| `Video.parents.children.images.{url, thumbnail, mobileCinematicHigh, mobileCinematicLow}`                               | `?`        |
| `Video.children(pagination: { limit: -1 }).{documentId, slug, title, label}`                                            | `?`        |
| `Video.children.images.{url, thumbnail, mobileCinematicHigh, mobileCinematicLow}`                                       | `?`        |
| `Video.variants(pagination: { limit: -1 }).{documentId, slug, published, hls, duration}`                                | `?`        |
| `Video.variants.language.{coreId, bcp47, slug, name}`                                                                   | `?`        |
| `Video.variants.downloads.{documentId, quality, size, url}`                                                             | `?`        |
| `Video.variants.muxVideo.playbackId`                                                                                    | `?`        |
| `Video.studyQuestions(sort: ["order:asc"]).{documentId, value, order}`                                                  | `?`        |
| `Video.bibleCitations(sort: ["order:asc"]).{documentId, chapterStart, chapterEnd, verseStart, verseEnd, order, osisId}` | `?`        |
| `Video.bibleCitations.bibleBook.{documentId, name}`                                                                     | `?`        |

### web:getWatchVideoBySlugOperation

- **Source:** `apps/web/src/lib/fragments/watch-video.ts:132-144` (defined),
  `apps/web/src/lib/content.ts:9-13` (imported), `content.ts:698` (callsite).
- **Variables:** `$i18nLocale: I18NLocaleCode!`, `$videoSlug: String!`.
- **Access expectation (best guess; final in U5):** PUBLIC — powers the
  2-segment `/watch/[video]/[locale]` route (no collection in URL).
- **Cache behavior:** `client.query(...)` with `fetchPolicy: "no-cache"` in
  `fetchWatchVideoBySlug` (line ~694), wrapped by
  `unstable_cache(tryResolveWatchVideoBySlug, ["watch-video-by-slug"], { revalidate: 60 })`
  in `fetchResolvedWatchVideoBySlug` (line ~772). Cache wraps only the
  success path; the `WATCH_VIDEO_BY_SLUG_NOT_FOUND` sentinel error bypasses
  cache so missing slugs aren't pinned for 60 s.
- **Renderer/resolver dependency:** `fetchWatchVideoBySlug` →
  `tryResolveWatchVideoBySlug` → `fetchResolvedWatchVideoBySlug` →
  `resolveWatchVideoBySlug` (exported, consumed by the 2-segment watch
  route's slug-resolution path with locale fallback ladder).
- **Composed fragments:** `WatchVideo` (same fragment as above).
- **Selected fields & parity tags:** identical to `web:getWatchVideoOperation`'s
  `WatchVideo` fragment table — variable difference only at the operation
  level (no `parents.slug` filter).

### web:SEMANTIC_SEARCH

- **Source:** `apps/web/src/lib/search.ts:4-35`
- **Variables:** `$query: String!`, `$locale: String!`, `$limit: Int`,
  `$offset: Int`, `$type: String`.
- **Access expectation (best guess; final in U5):** PUBLIC — drives the
  unauthenticated `/search` page.
- **Cache behavior:** `client.query(...)` with `fetchPolicy: "no-cache"`.
  No outer `unstable_cache` — search is intentionally uncached so freshly
  indexed videos surface immediately. Latency is captured per-call via
  `performance.now()` deltas.
- **Renderer/resolver dependency:** `searchVideos(query, limit, offset, type)`
  in the same file — exported and consumed by the `/search` route.
- **Composed fragments:** none.
- **Selected fields & parity tags:**

| Type.field                                                                                                 | Parity tag                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Query.semanticSearch(query, locale, limit, offset, type)`                                                 | `?`                                                                                                        |
| `SemanticSearchResult.query`                                                                               | `?`                                                                                                        |
| `SemanticSearchResult.hasMore`                                                                             | `?`                                                                                                        |
| `SemanticSearchResult.searchMode`                                                                          | `?` (NOTE: TV's `tv:SEMANTIC_SEARCH` also selects this; mobile does NOT — see U2/U3. Web matches TV here.) |
| `SemanticSearchResult.results.{type, id, slug, title, imageUrl, snippet, startSeconds, playbackId, score}` | `?`                                                                                                        |

### web:GET_DEMO_VIDEO

- **Source:** `apps/web/src/lib/demo-search.ts:9-33`
- **Variables:** `$slug: String!`, `$locale: I18NLocaleCode!`.
- **Access expectation (best guess; final in U5):** PUBLIC — minimal fetch
  for the `/demo-search` watch page; intentionally decoupled from
  `lib/content.ts`'s richer resolver tree.
- **Cache behavior:** `client.query(...)` with `fetchPolicy: "no-cache"`,
  wrapped by `unstable_cache(fetchDemoVideo, ["demo-search-video"], { revalidate: 60 })`
  exported as `getDemoPlayableVideo` (with redundant React `cache()` removed
  per source comment).
- **Renderer/resolver dependency:** `fetchDemoVideo` →
  `getDemoPlayableVideo` (exported, consumed by the `/demo-search` route).
- **Composed fragments:** none.
- **Selected fields & parity tags:**

| Type.field                                    | Parity tag |
| --------------------------------------------- | ---------- |
| `Query.videos(filters, locale)`               | `?`        |
| `Video.documentId`                            | `?`        |
| `Video.slug`                                  | `?`        |
| `Video.title`                                 | `?`        |
| `Video.description`                           | `?`        |
| `Video.images.{url, mobileCinematicHigh}`     | `?`        |
| `Video.primaryLanguage.coreId`                | `?`        |
| `Video.variants.{documentId, hls, published}` | `?`        |
| `Video.variants.language.coreId`              | `?`        |

### web:GET_VIDEO_BY_SLUG

- **Source:** `apps/web/src/lib/recommendations.ts:53-67` (gql.tada `graphql()`).
- **Variables:** `$slug: String!`, `$locale: I18NLocaleCode!`.
- **Access expectation (best guess; final in U5):** PUBLIC — surfaces a
  thin video metadata projection alongside the scene-recommendation list.
- **Cache behavior:** `client.query(...)` with `fetchPolicy: "no-cache"`,
  wrapped by `unstable_cache(fetchVideoBySlug, ["video-by-slug"], { revalidate: 60 })`,
  re-exported as `getVideoBySlug` via React `cache()`.
- **Renderer/resolver dependency:** `fetchVideoBySlug` → `getVideoBySlug`
  (exported, consumed by the recommendations / scene-search surface).
- **Composed fragments:** none.
- **Selected fields & parity tags:**

| Type.field                                           | Parity tag |
| ---------------------------------------------------- | ---------- |
| `Query.videos(filters, locale)`                      | `?`        |
| `Video.documentId`                                   | `?`        |
| `Video.title`                                        | `?`        |
| `Video.slug`                                         | `?`        |
| `Video.description`                                  | `?`        |
| `Video.images.{url, thumbnail, mobileCinematicHigh}` | `?`        |

### web:SCENE_RECOMMENDATIONS

- **Source:** `apps/web/src/lib/recommendations.ts:27-45` (raw Apollo
  `gql` template literal — invisible to `rg "graphql\("`; captured via the
  ``rg "= gql\`"`` sweep). The custom `sceneRecommendations` extension type
  is NOT present in Strapi's auto-generated introspection schema, hence the
  raw-gql escape hatch.
- **Variables:** `$slug: String!`, `$locale: String!`, `$limit: Int`.
- **Access expectation (best guess; final in U5):** PUBLIC — listed in the
  parent migration plan as one of the 4 PUBLIC admin queries
  (`sceneRecommendations`).
- **Cache behavior:** `client.query<SceneRecommendationsResult>(...)` with
  `fetchPolicy: "no-cache"`, wrapped by
  `unstable_cache(fetchRecommendations, ["scene-recommendations"], { revalidate: 60 })`,
  re-exported as `getSceneRecommendations` via React `cache()`.
- **Renderer/resolver dependency:** `fetchRecommendations` →
  `getSceneRecommendations` (exported).
- **Composed fragments:** none.
- **Selected fields & parity tags:**

| Type.field                                        | Parity tag |
| ------------------------------------------------- | ---------- |
| `Query.sceneRecommendations(slug, locale, limit)` | `?`        |
| `SceneRecommendation.videoId`                     | `?`        |
| `SceneRecommendation.videoSlug`                   | `?`        |
| `SceneRecommendation.videoTitle`                  | `?`        |
| `SceneRecommendation.imageUrl`                    | `?`        |
| `SceneRecommendation.sceneIndex`                  | `?`        |
| `SceneRecommendation.description`                 | `?`        |
| `SceneRecommendation.startSeconds`                | `?`        |
| `SceneRecommendation.endSeconds`                  | `?`        |
| `SceneRecommendation.similarity`                  | `?`        |
| `SceneRecommendation.themes`                      | `?`        |
| `SceneRecommendation.demographics`                | `?`        |
| `SceneRecommendation.spiritualContext`            | `?`        |
| `SceneRecommendation.playbackId`                  | `?`        |

### web — Synthetic WatchBlock discriminants (NOT Strapi typenames)

`apps/web/src/lib/content.ts:868-874` defines a 6-kind discriminated union
that the watch route uses INTERNALLY to dispatch render. These are NOT
Strapi `__typename` values — they exist purely so `WatchSectionRenderer`
can mount watch-only React components (HeroPlayer, SiblingCarousel,
WatchBody, StudyQuestions, BibleQuotes, Share) alongside Strapi-typed
blocks coming out of an optional Experience. The 6 `kind` literals:

1. `HeroPlayer`
2. `SiblingCarousel`
3. `WatchBody`
4. `StudyQuestions`
5. `BibleQuotes`
6. `Share`

These do NOT belong in the U4 `## Block __typename → Admin Discriminator
Mapping` table — they are watch-route-only synthesis with no Strapi or
admin counterpart. Unit 5's web-side adapter MUST preserve this synthesis
layer when rewriting to admin: admin returns `Experience.blocks` the same
way Strapi does, and the `mergeWatchExperience` auto-template merge
(`content.ts:1088-1143`) stays exactly where it is. Only the upstream data
source changes; the synthesis is consumer-owned.

---

## apps/mobile Operations

> Populated in U2.

---

## apps/tv Operations

> Populated in U3.

---

## Block `__typename` → Admin Discriminator Mapping

> Populated in U4.

---

## PUBLIC Access Classification

> Populated in U5.

---

## Verification Log

> Populated in U2/U3/U4/U5. Each unit appends its own verification record
> (rg outputs, cross-check pass results, divergence findings).

### U1 (apps/web)

- `rg "graphql\(" apps/web/src` → 27 matches. Breakdown:
  - 9 operation definitions (one `### web:{ConstantName}` subsection each):
    `GET_EXPERIENCE`, `GET_WATCH_EXPERIENCE`, `GET_WATCH_SETTINGS`,
    `GET_ROUTE_VIDEO` (all in `lib/content.ts`); `getWatchVideoOperation`,
    `getWatchVideoBySlugOperation` (in `lib/fragments/watch-video.ts`,
    co-located with the `watchVideoFragment` they compose);
    `SEMANTIC_SEARCH` (in `lib/search.ts`); `GET_DEMO_VIDEO` (in
    `lib/demo-search.ts`); `GET_VIDEO_BY_SLUG` (in `lib/recommendations.ts`).
  - 18 fragment definitions across `lib/fragments/`: 15 per-block fragments
    composed by `watchExperienceFragment` (`mediaCollectionFragment`,
    `promoBannerFragment`, `infoBlocksFragment`, `ctaSectionFragment`,
    `videoHeroFragment`, `bibleQuotesCarouselFragment`,
    `textSectionFragment`, `easterDatesFragment`, `adventCountdownFragment`,
    `containerFragment`, `videoSectionFragment`, `sectionFragment`,
    `relatedQuestionsFragment`, `videoCarouselFragment`,
    `navigationCarouselFragment`); the composite `watchExperienceFragment`
    itself; `watchVideoFragment` (composed by both watch-video operations);
    and `quizButtonSectionFragment` (currently unused — `Section` inlines
    its fields inside `ComponentSectionsQuizButton` rather than spreading
    the fragment, so this export is dead-but-tracked).
- ``rg "= gql\`" apps/web/src`` → 1 match (`SCENE_RECOMMENDATIONS` in
  `lib/recommendations.ts:27`). Captured as `web:SCENE_RECOMMENDATIONS` —
  invisible to the gql.tada-only sweep, hence the dual-rg requirement.
- Total web operations inventoried: **10** (9 gql.tada + 1 raw Apollo).
- Synthetic WatchBlock 6-kind union explicitly recorded as NOT a Strapi
  `__typename` set, NOT a row in the future U4 mapping table.
