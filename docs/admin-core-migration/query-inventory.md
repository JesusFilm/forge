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

Three standalone operations, all defined in `apps/mobile/src/lib/queries.ts`:
`GET_WATCH_EXPERIENCE` (the rich watch query that composes 12 fragments),
`LIST_EXPERIENCES` (lightweight homepage/listing query, no `blocks`), and
`SEMANTIC_SEARCH` (paginated search). The other 15 `graphql()` callsites in
`queries.ts` are fragments — 10 leaf fragments and 2 composite fragments
(`ContainerFragment`, `SectionFragment`) that compose other leaf fragments.
Fragments are listed inline under the operation that pulls them in, NOT as
standalone operation rows. Mobile uses `@apollo/client/react` `useQuery`
with `InMemoryCache` (default) — no normalized typePolicies, no cache
hydration, and a per-call `fetchPolicy` override on every callsite. Mobile
does NOT use Apollo's `gql` template literal anywhere; all callsites are
gql.tada `graphql()` (verified by the `rg "= gql\`"` sweep returning zero
matches).

### mobile:GET_WATCH_EXPERIENCE

- **Source:** `apps/mobile/src/lib/queries.ts:352-422`
- **Variables:** `$locale: I18NLocaleCode!`, `$filters: ExperienceFiltersInput!`
- **Access expectation (best guess; final in U5):** PUBLIC — drives the
  unauthenticated mobile watch shell for every selected experience slug.
  Mobile bearer token is set via `getApiToken()` in `apolloClient.ts` but
  the admin endpoint must support either a user-less token or treat this
  query as `authScopes: { public: true }` for the consumer migration.
- **Cache behavior:** `useQuery(..., { fetchPolicy: "cache-and-network" })`
  in `apps/mobile/src/hooks/useExperience.ts:28-34`. Renders cached data
  immediately while issuing a background refetch; the hook exposes
  `loading: loading && experience === null` so the in-flight network leg
  doesn't trigger a spinner once a cached result is on screen. Apollo
  `InMemoryCache` is the default, lazy-initialized once via the
  `getApolloClient()` singleton (`apps/mobile/src/lib/apolloClient.ts`).
  No normalized type policies, no `keyFields` overrides — Apollo's default
  identity-by-`id` keying applies.
- **Renderer/resolver dependency:** `useExperience({ slug, locale })` →
  `normalizeExperience(...)` → `ExperienceShellInner` → `ExperienceProvider`
  → every mobile screen under `apps/mobile/app/`. `normalizer.ts`'s
  `TYPENAME_TO_KIND` map dispatches each `__typename` in `Experience.blocks`
  to a `kind` literal consumed by `apps/mobile/src/components/sections/*`
  renderers. The 17-entry `TYPENAME_TO_KIND` map covers every block
  `__typename` selected by this query (plus `Card`, `PromoBanner`,
  `InfoBlocks` reserved for future expansion — they appear in the map but
  not in the current selection set).
- **Composed fragments:** 12 fragments composed at the operation level —
  `VideoHeroFragment`, `SectionFragment`, `VideoCarouselFragment`,
  `MediaCollectionFragment`, `NavigationCarouselFragment`,
  `TextSectionFragment`, `EasterDatesFragment`, `AdventCountdownFragment`,
  `BibleQuotesCarouselFragment`, `CTASectionFragment`,
  `RelatedQuestionsFragment`, `ContainerFragment`, `VideoSectionFragment`.
  `SectionFragment` and `ContainerFragment` further compose 10 and 8 leaf
  fragments respectively — see fragment tables below. `QuizButtonFragment`
  is reachable only via `SectionFragment` (Section's
  `ComponentSectionsQuizButton` arm spreads `...QuizButtonFields`); it
  never appears at the operation top level.
- **Selected fields & parity tags:**

| Type.field                                                                  | Parity tag               |
| --------------------------------------------------------------------------- | ------------------------ |
| `Query.experiences(filters, locale)`                                        | `?`                      |
| `Experience.documentId`                                                     | `?`                      |
| `Experience.slug`                                                           | `?`                      |
| `Experience.title`                                                          | `?`                      |
| `Experience.blocks.__typename`                                              | `?`                      |
| `ComponentSectionsVideoHero` (via `...VideoHeroFields`)                     | see fragment table below |
| `ComponentSectionsSection` (via `...SectionFields`)                         | see fragment table below |
| `ComponentSectionsVideoCarousel` (via `...VideoCarouselFields`)             | see fragment table below |
| `ComponentSectionsMediaCollection` (via `...MediaCollectionFields`)         | see fragment table below |
| `ComponentSectionsNavigationCarousel` (via `...NavigationCarouselFields`)   | see fragment table below |
| `ComponentSectionsText` (via `...TextSectionFields`)                        | see fragment table below |
| `ComponentSectionsEasterDates` (via `...EasterDatesFields`)                 | see fragment table below |
| `ComponentSectionsAdventCountdown` (via `...AdventCountdownFields`)         | see fragment table below |
| `ComponentSectionsBibleQuotesCarousel` (via `...BibleQuotesCarouselFields`) | see fragment table below |
| `ComponentSectionsCta` (via `...CTASectionFields`)                          | see fragment table below |
| `ComponentSectionsRelatedQuestions` (via `...RelatedQuestionsFields`)       | see fragment table below |
| `ComponentSectionsContainer` (via `...ContainerFields`)                     | see fragment table below |
| `ComponentSectionsVideo` (via `...VideoSectionFields`)                      | see fragment table below |

#### Fragment: `VideoHeroFragment` (queries.ts:13-33)

| Type.field                                                                       | Parity tag |
| -------------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsVideoHero.id`                                                  | `?`        |
| `ComponentSectionsVideoHero.sectionKey`                                          | `?`        |
| `ComponentSectionsVideoHero.heading`                                             | `?`        |
| `ComponentSectionsVideoHero.subheading`                                          | `?`        |
| `ComponentSectionsVideoHero.ctaLabel`                                            | `?`        |
| `ComponentSectionsVideoHero.ctaLink`                                             | `?`        |
| `ComponentSectionsVideoHero.streamingUrl`                                        | `?`        |
| `ComponentSectionsVideoHero.video.{documentId, title, slug}`                     | `?`        |
| `ComponentSectionsVideoHero.video.images.{url, mobileCinematicHigh, videoStill}` | `?`        |

#### Fragment: `TextSectionFragment` (queries.ts:35-45)

| Type.field                                              | Parity tag |
| ------------------------------------------------------- | ---------- |
| `ComponentSectionsText.id`                              | `?`        |
| `ComponentSectionsText.sectionKey`                      | `?`        |
| `ComponentSectionsText.heading` (aliased `textHeading`) | `?`        |
| `ComponentSectionsText.headingLevel`                    | `?`        |
| `ComponentSectionsText.subtitle`                        | `?`        |
| `ComponentSectionsText.contentParagraphs`               | `?`        |
| `ComponentSectionsText.variant` (aliased `textVariant`) | `?`        |

#### Fragment: `RelatedQuestionsFragment` (queries.ts:47-61)

| Type.field                                                           | Parity tag |
| -------------------------------------------------------------------- | ---------- |
| `ComponentSectionsRelatedQuestions.id`                               | `?`        |
| `ComponentSectionsRelatedQuestions.sectionKey`                       | `?`        |
| `ComponentSectionsRelatedQuestions.heading` (aliased `rqHeading`)    | `?`        |
| `ComponentSectionsRelatedQuestions.ctaLabel`                         | `?`        |
| `ComponentSectionsRelatedQuestions.ctaLink`                          | `?`        |
| `ComponentSectionsRelatedQuestions.questions.{id, question, answer}` | `?`        |

#### Fragment: `BibleQuotesCarouselFragment` (queries.ts:63-80)

| Type.field                                                                                                                     | Parity tag |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `ComponentSectionsBibleQuotesCarousel.id`                                                                                      | `?`        |
| `ComponentSectionsBibleQuotesCarousel.sectionKey`                                                                              | `?`        |
| `ComponentSectionsBibleQuotesCarousel.heading` (aliased `bqcHeading`)                                                          | `?`        |
| `ComponentSectionsBibleQuotesCarousel.quotes.{id, reference, text, attribution, imageUrl, backgroundColor, ctaLabel, ctaLink}` | `?`        |

#### Fragment: `EasterDatesFragment` (queries.ts:82-92)

| Type.field                                         | Parity tag |
| -------------------------------------------------- | ---------- |
| `ComponentSectionsEasterDates.id`                  | `?`        |
| `ComponentSectionsEasterDates.sectionKey`          | `?`        |
| `ComponentSectionsEasterDates.easterDatesTitle`    | `?`        |
| `ComponentSectionsEasterDates.westernEasterLabel`  | `?`        |
| `ComponentSectionsEasterDates.orthodoxEasterLabel` | `?`        |
| `ComponentSectionsEasterDates.passoverLabel`       | `?`        |
| `ComponentSectionsEasterDates.locale`              | `?`        |

#### Fragment: `AdventCountdownFragment` (queries.ts:94-103)

| Type.field                                                       | Parity tag |
| ---------------------------------------------------------------- | ---------- |
| `ComponentSectionsAdventCountdown.id`                            | `?`        |
| `ComponentSectionsAdventCountdown.sectionKey`                    | `?`        |
| `ComponentSectionsAdventCountdown.title` (aliased `adventTitle`) | `?`        |
| `ComponentSectionsAdventCountdown.scripture`                     | `?`        |
| `ComponentSectionsAdventCountdown.scriptureReference`            | `?`        |
| `ComponentSectionsAdventCountdown.locale`                        | `?`        |

#### Fragment: `CTASectionFragment` (queries.ts:105-115)

| Type.field                                            | Parity tag |
| ----------------------------------------------------- | ---------- |
| `ComponentSectionsCta.id`                             | `?`        |
| `ComponentSectionsCta.sectionKey`                     | `?`        |
| `ComponentSectionsCta.heading` (aliased `ctaHeading`) | `?`        |
| `ComponentSectionsCta.body`                           | `?`        |
| `ComponentSectionsCta.buttonLabel`                    | `?`        |
| `ComponentSectionsCta.buttonLink`                     | `?`        |
| `ComponentSectionsCta.variant` (aliased `ctaVariant`) | `?`        |

#### Fragment: `VideoSectionFragment` (queries.ts:117-139)

| Type.field                                                                              | Parity tag |
| --------------------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsVideo.id`                                                             | `?`        |
| `ComponentSectionsVideo.sectionKey`                                                     | `?`        |
| `ComponentSectionsVideo.streamingUrl`                                                   | `?`        |
| `ComponentSectionsVideo.title` (aliased `videoTitle`)                                   | `?`        |
| `ComponentSectionsVideo.subtitle` (aliased `videoSubtitle`)                             | `?`        |
| `ComponentSectionsVideo.media.url`                                                      | `?`        |
| `ComponentSectionsVideo.video` (aliased `videoRef`).{documentId, title, slug, imageAlt} | `?`        |
| `ComponentSectionsVideo.video.images.{url, mobileCinematicHigh, videoStill}`            | `?`        |

#### Fragment: `NavigationCarouselFragment` (queries.ts:141-155)

| Type.field                                                                                              | Parity tag |
| ------------------------------------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsNavigationCarousel.id`                                                                | `?`        |
| `ComponentSectionsNavigationCarousel.sectionKey`                                                        | `?`        |
| `ComponentSectionsNavigationCarousel.items.{id, contentId, title, category, imageUrl, backgroundColor}` | `?`        |

#### Fragment: `MediaCollectionFragment` (queries.ts:157-191)

| Type.field                                                                                                                                | Parity tag |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsMediaCollection.id`                                                                                                     | `?`        |
| `ComponentSectionsMediaCollection.sectionKey`                                                                                             | `?`        |
| `ComponentSectionsMediaCollection.title` (aliased `mcTitle`)                                                                              | `?`        |
| `ComponentSectionsMediaCollection.subtitle` (aliased `mcSubtitle`)                                                                        | `?`        |
| `ComponentSectionsMediaCollection.description` (aliased `mcDescription`)                                                                  | `?`        |
| `ComponentSectionsMediaCollection.categoryLabel`                                                                                          | `?`        |
| `ComponentSectionsMediaCollection.ctaLink` (aliased `mcCtaLink`)                                                                          | `?`        |
| `ComponentSectionsMediaCollection.ctaLabel` (aliased `mcCtaLabel`)                                                                        | `?`        |
| `ComponentSectionsMediaCollection.showItemNumbers`                                                                                        | `?`        |
| `ComponentSectionsMediaCollection.variant` (aliased `mcVariant`)                                                                          | `?`        |
| `ComponentSectionsMediaCollection.footerText`                                                                                             | `?`        |
| `ComponentSectionsMediaCollection.items.{id, titleOverride, subtitleOverride, labelOverride, collectionSize, imageUrl, linkToSectionKey}` | `?`        |
| `ComponentSectionsMediaCollection.items.video.{documentId, title, slug, imageAlt}`                                                        | `?`        |
| `ComponentSectionsMediaCollection.items.video.images.{url, mobileCinematicHigh, videoStill}`                                              | `?`        |

#### Fragment: `VideoCarouselFragment` (queries.ts:193-219)

| Type.field                                                                                          | Parity tag |
| --------------------------------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsVideoCarousel.id`                                                                 | `?`        |
| `ComponentSectionsVideoCarousel.sectionKey`                                                         | `?`        |
| `ComponentSectionsVideoCarousel.title` (aliased `vcTitle`)                                          | `?`        |
| `ComponentSectionsVideoCarousel.subtitle` (aliased `vcSubtitle`)                                    | `?`        |
| `ComponentSectionsVideoCarousel.description` (aliased `vcDescription`)                              | `?`        |
| `ComponentSectionsVideoCarousel.items.{id, streamingUrl, imageUrl, titleOverride, backgroundColor}` | `?`        |
| `ComponentSectionsVideoCarousel.items.video.{documentId, title, slug, imageAlt}`                    | `?`        |
| `ComponentSectionsVideoCarousel.items.video.images.{url, mobileCinematicHigh, videoStill}`          | `?`        |

#### Fragment: `QuizButtonFragment` (queries.ts:221-227, reachable only via SectionFragment)

| Type.field                               | Parity tag |
| ---------------------------------------- | ---------- |
| `ComponentSectionsQuizButton.id`         | `?`        |
| `ComponentSectionsQuizButton.buttonText` | `?`        |
| `ComponentSectionsQuizButton.iframeSrc`  | `?`        |

#### Fragment: `ContainerFragment` (queries.ts:235-284, composite)

`ContainerFields` selects `id`, `sectionKey`, and a `slots` collection
where each slot has `id`, `gridSpan`, `spans`, and a polymorphic
`content` (aliased `slotContent`) constrained to the
`ContainerSlotContentDynamicZone` union (per source comment, members:
`AdventCountdown`, `BibleQuotesCarousel`, `Card`, `Cta`, `EasterDates`,
`MediaCollection`, `RelatedQuestions`, `Text`, `Video` — note `Container`,
`NavigationCarousel`, `VideoCarousel`, `QuizButton` are NOT in this
union). The Container fragment composes 8 leaf fragments via inline-spread
(only the union members the fragment actually projects):

| Composed via                                                                   | Composed fragment             |
| ------------------------------------------------------------------------------ | ----------------------------- |
| `... on ComponentSectionsText { ...TextSectionFields }`                        | `TextSectionFragment`         |
| `... on ComponentSectionsEasterDates { ...EasterDatesFields }`                 | `EasterDatesFragment`         |
| `... on ComponentSectionsAdventCountdown { ...AdventCountdownFields }`         | `AdventCountdownFragment`     |
| `... on ComponentSectionsCta { ...CTASectionFields }`                          | `CTASectionFragment`          |
| `... on ComponentSectionsVideo { ...VideoSectionFields }`                      | `VideoSectionFragment`        |
| `... on ComponentSectionsRelatedQuestions { ...RelatedQuestionsFields }`       | `RelatedQuestionsFragment`    |
| `... on ComponentSectionsBibleQuotesCarousel { ...BibleQuotesCarouselFields }` | `BibleQuotesCarouselFragment` |
| `... on ComponentSectionsMediaCollection { ...MediaCollectionFields }`         | `MediaCollectionFragment`     |

Container's own scalars:

| Type.field                                                                    | Parity tag |
| ----------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsContainer.id`                                               | `?`        |
| `ComponentSectionsContainer.sectionKey`                                       | `?`        |
| `ComponentSectionsContainer.slots.{id, gridSpan, spans}`                      | `?`        |
| `ComponentSectionsContainer.slots.content.__typename` (aliased `slotContent`) | `?`        |

#### Fragment: `SectionFragment` (queries.ts:290-348, composite)

`SectionFields` selects `id`, `sectionKey`, background-related scalars,
and a polymorphic `content` (aliased `sectionContent`) constrained to
`SectionContentDynamicZone` (per source comment, members:
`BibleQuotesCarousel`, `Card`, `Container`, `Cta`, `InfoBlocks`,
`MediaCollection`, `NavigationCarousel`, `PromoBanner`, `QuizButton`,
`RelatedQuestions`, `Text`, `Video`, `VideoCarousel` — note `EasterDates`
and `AdventCountdown` are NOT in this union; they live only in
`ContainerSlotContentDynamicZone`). Section composes 10 fragments via
inline-spread:

| Composed via                                                                   | Composed fragment             |
| ------------------------------------------------------------------------------ | ----------------------------- |
| `... on ComponentSectionsContainer { ...ContainerFields }`                     | `ContainerFragment`           |
| `... on ComponentSectionsVideo { ...VideoSectionFields }`                      | `VideoSectionFragment`        |
| `... on ComponentSectionsRelatedQuestions { ...RelatedQuestionsFields }`       | `RelatedQuestionsFragment`    |
| `... on ComponentSectionsBibleQuotesCarousel { ...BibleQuotesCarouselFields }` | `BibleQuotesCarouselFragment` |
| `... on ComponentSectionsMediaCollection { ...MediaCollectionFields }`         | `MediaCollectionFragment`     |
| `... on ComponentSectionsQuizButton { ...QuizButtonFields }`                   | `QuizButtonFragment`          |
| `... on ComponentSectionsVideoCarousel { ...VideoCarouselFields }`             | `VideoCarouselFragment`       |
| `... on ComponentSectionsNavigationCarousel { ...NavigationCarouselFields }`   | `NavigationCarouselFragment`  |
| `... on ComponentSectionsText { ...TextSectionFields }`                        | `TextSectionFragment`         |
| `... on ComponentSectionsCta { ...CTASectionFields }`                          | `CTASectionFragment`          |

Section's own scalars:

| Type.field                                                               | Parity tag |
| ------------------------------------------------------------------------ | ---------- |
| `ComponentSectionsSection.id`                                            | `?`        |
| `ComponentSectionsSection.sectionKey`                                    | `?`        |
| `ComponentSectionsSection.backgroundColor`                               | `?`        |
| `ComponentSectionsSection.backgroundImageUrl`                            | `?`        |
| `ComponentSectionsSection.backgroundOpacity`                             | `?`        |
| `ComponentSectionsSection.dynamicBackgroundImage`                        | `?`        |
| `ComponentSectionsSection.staticOverlay`                                 | `?`        |
| `ComponentSectionsSection.blurHash`                                      | `?`        |
| `ComponentSectionsSection.content.__typename` (aliased `sectionContent`) | `?`        |

### mobile:LIST_EXPERIENCES

- **Source:** `apps/mobile/src/lib/queries.ts:426-442`
- **Variables:** `$locale: I18NLocaleCode!`
- **Access expectation (best guess; final in U5):** PUBLIC — invoked on
  first launch when no slug is persisted, before any user has authenticated.
  Mobile may pass a bearer token if `getApiToken()` returns one, but the
  call must succeed without auth in PR-flow / fresh-install scenarios.
- **Cache behavior:** `useQuery(LIST_EXPERIENCES, { variables: { locale: "en" }, skip: !needsDefault, fetchPolicy: "cache-and-network" })`
  in `apps/mobile/src/contexts/ExperienceShell.tsx:35-39`. The query is
  conditionally `skip`-gated until the persisted-slug check resolves to
  `null`, and then re-runs cache-first with a parallel network refetch.
  Apollo `InMemoryCache` (default) — no normalized typePolicies, no
  query-level cache eviction.
- **Renderer/resolver dependency:** `ExperienceShell` (root layout wrapper)
  consumes the result to find `experiences.find((e) => e.isHomepage)` (or
  `experiences[0]` as fallback) and persists the slug via
  `selectExperience(resolved.slug)` from
  `ExperienceSelectionProvider` — bootstrapping the
  `ExperienceShellInner → useExperience({ slug }) → GET_WATCH_EXPERIENCE`
  pipeline.
- **Composed fragments:** none — projection is inline (intentionally
  lightweight: NO `blocks` selection, just the metadata needed to pick a
  default experience).
- **Cross-app divergence:** TV's `LIST_EXPERIENCES` (U3) selects an
  additional per-experience `ComponentSectionsVideoHero` block to power
  the focus-driven home hero. Mobile's listing query does NOT — it only
  needs metadata for the picker.
- **Selected fields & parity tags:**

| Type.field                                                 | Parity tag |
| ---------------------------------------------------------- | ---------- |
| `Query.experiences(locale)`                                | `?`        |
| `Experience.documentId`                                    | `?`        |
| `Experience.slug`                                          | `?`        |
| `Experience.title`                                         | `?`        |
| `Experience.metaDescription`                               | `?`        |
| `Experience.isHomepage`                                    | `?`        |
| `Experience.ogImage.{url, alternativeText, width, height}` | `?`        |

### mobile:SEMANTIC_SEARCH

- **Source:** `apps/mobile/src/lib/queries.ts:448-476`
- **Variables:** `$query: String!`, `$locale: String!`, `$limit: Int`,
  `$offset: Int`. (NOTE: no `$type` argument, unlike web's
  `web:SEMANTIC_SEARCH` which accepts `$type: String`.)
- **Access expectation (best guess; final in U5):** PUBLIC — drives the
  Watch tab's search field for unauthenticated mobile users.
- **Cache behavior:** `getApolloClient().query({ query: SEMANTIC_SEARCH, variables, fetchPolicy: "no-cache" })`
  in `apps/mobile/app/(tabs)/watch.tsx:150-159` (initial search) and
  `apps/mobile/app/(tabs)/watch.tsx:212-221` (paginated load-more). The
  Apollo `InMemoryCache` is bypassed entirely — every keystroke-debounced
  search is a fresh network call. Pagination is offset-based: the
  load-more callsite uses `offset: results.length` against `PAGE_SIZE`.
  The initial search additionally guards staleness with
  `requestIdRef.current !== thisRequest` to drop superseded results.
- **Renderer/resolver dependency:** `apps/mobile/app/(tabs)/watch.tsx`
  (the Watch tab screen) — defines a `search(text)` callback bound to a
  debounced text input plus a `loadMore()` callback bound to the result
  list's end-reached event. Result rows render via
  `apps/mobile/src/components/search/SearchResultCard.tsx` which consumes
  the `SearchResult` type alias exported from `queries.ts:478-480`
  (`ResultOf<typeof SEMANTIC_SEARCH>["semanticSearch"]["results"][number]`).
- **Composed fragments:** none.
- **Cross-app divergence:** TV's `SEMANTIC_SEARCH` (U3) selects an
  additional `searchMode` field on `SemanticSearchResult` that exposes
  degraded-backend status to the client. Mobile's `SEMANTIC_SEARCH` does
  NOT select `searchMode` — see explicit field list below. This divergence
  is flagged for U5's PUBLIC-classification pass: `searchMode` is an
  operator-facing field whose public exposure is a deliberate decision
  admin must replicate or decline. Web's `web:SEMANTIC_SEARCH` matches
  TV (also selects `searchMode`).
- **Selected fields & parity tags:**

| Type.field                                                                                                 | Parity tag |
| ---------------------------------------------------------------------------------------------------------- | ---------- |
| `Query.semanticSearch(query, locale, limit, offset)`                                                       | `?`        |
| `SemanticSearchResult.query`                                                                               | `?`        |
| `SemanticSearchResult.hasMore`                                                                             | `?`        |
| `SemanticSearchResult.results.{type, id, slug, title, imageUrl, snippet, startSeconds, playbackId, score}` | `?`        |

---

## apps/tv Operations

Three standalone operations, all defined in `apps/tv/src/lib/queries.ts`:
`GET_WATCH_EXPERIENCE` (rich watch query composing 13 fragments — same
shape as mobile's), `LIST_EXPERIENCES` (TV home-screen listing — DIVERGES
from mobile by selecting an inline `ComponentSectionsVideoHero` block per
experience to power the focus-driven hero), and `SEMANTIC_SEARCH`
(paginated search — DIVERGES from mobile by selecting `searchMode`). The
remaining 15 `graphql()` callsites in `queries.ts` are fragments — 11 leaf
fragments and 2 composite fragments (`ContainerFragment`, `SectionFragment`)
that compose other leaves. Fragments are listed inline under the operation
that pulls them in, NOT as standalone operation rows. TV uses
`@apollo/client/react` `useQuery` for `GET_WATCH_EXPERIENCE` /
`LIST_EXPERIENCES`, and `getApolloClient().query()` for `SEMANTIC_SEARCH`.
TV does NOT use Apollo's `gql` template literal anywhere (verified by the
`rg "= gql\`"` sweep returning zero matches).

**Apollo client cache divergence (TV vs mobile):** TV's
`getApolloClient()` (`apps/tv/src/lib/apolloClient.ts:45-53`) sets
`defaultOptions.watchQuery.fetchPolicy: "cache-and-network"` GLOBALLY for
every `useQuery`, whereas mobile sets per-call `fetchPolicy` and has no
global default. Per-operation overrides recorded below still win, but TV's
`useQuery` callsites that omit `fetchPolicy` (notably the home `index.tsx`
`LIST_EXPERIENCES` consumer) inherit `cache-and-network` from this default
rather than mobile's "no default → falls through to Apollo's
`cache-first`" semantics.

### tv:GET_WATCH_EXPERIENCE

- **Source:** `apps/tv/src/lib/queries.ts:361-431`
- **Variables:** `$locale: I18NLocaleCode!`, `$filters: ExperienceFiltersInput!`
- **Access expectation (best guess; final in U5):** PUBLIC — drives the
  unauthenticated TV experience-detail screen. TV bearer token is set via
  `getApiToken()` in `apolloClient.ts` but the admin endpoint must support
  either a user-less token or treat this query as
  `authScopes: { public: true }` for the consumer migration (parity with
  `mobile:GET_WATCH_EXPERIENCE`).
- **Cache behavior:** `useQuery(GET_WATCH_EXPERIENCE, { variables, skip: !decodedSlug })`
  in `apps/tv/app/experience/[slug].tsx:27-33`. No per-call `fetchPolicy`
  override — inherits the client-wide
  `defaultOptions.watchQuery.fetchPolicy: "cache-and-network"` set in
  `apolloClient.ts:48-52`. Renders cached data immediately while issuing
  a background refetch; the screen exposes a `refetch` button bound to
  Apollo's `refetch()`. Apollo `InMemoryCache` is the default, lazy-
  initialized once via the `getApolloClient()` singleton. No normalized
  type policies, no `keyFields` overrides — Apollo's default
  identity-by-`id` keying applies.
- **Renderer/resolver dependency:**
  `apps/tv/app/experience/[slug].tsx:23-34` (route screen) →
  `normalizeExperience(...)` (`apps/tv/src/lib/normalizer.ts`) →
  `ExperienceProvider` → `SectionDispatcher` →
  `apps/tv/src/components/sections/*` renderers. `normalizer.ts`'s
  17-entry `TYPENAME_TO_KIND` map dispatches each `__typename` in
  `Experience.blocks` to a `kind` literal (the map is byte-identical to
  mobile's; see "Normalizer" note in the Verification Log).
- **Composed fragments:** 13 fragments composed at the operation level —
  `VideoHeroFragment`, `SectionFragment`, `VideoCarouselFragment`,
  `MediaCollectionFragment`, `NavigationCarouselFragment`,
  `TextSectionFragment`, `EasterDatesFragment`, `AdventCountdownFragment`,
  `BibleQuotesCarouselFragment`, `CTASectionFragment`,
  `RelatedQuestionsFragment`, `ContainerFragment`, `VideoSectionFragment`.
  `SectionFragment` and `ContainerFragment` further compose 10 and 8 leaf
  fragments respectively — see fragment tables below. `QuizButtonFragment`
  is reachable only via `SectionFragment` (Section's
  `ComponentSectionsQuizButton` arm spreads `...QuizButtonFields`); it
  never appears at the operation top level.
- **Cross-app parity:** Selection set is byte-equivalent to
  `mobile:GET_WATCH_EXPERIENCE` (same 13 top-level arms, same fragment
  bodies). No divergence at this operation.
- **Selected fields & parity tags:**

| Type.field                                                                  | Parity tag               |
| --------------------------------------------------------------------------- | ------------------------ |
| `Query.experiences(filters, locale)`                                        | `?`                      |
| `Experience.documentId`                                                     | `?`                      |
| `Experience.slug`                                                           | `?`                      |
| `Experience.title`                                                          | `?`                      |
| `Experience.blocks.__typename`                                              | `?`                      |
| `ComponentSectionsVideoHero` (via `...VideoHeroFields`)                     | see fragment table below |
| `ComponentSectionsSection` (via `...SectionFields`)                         | see fragment table below |
| `ComponentSectionsVideoCarousel` (via `...VideoCarouselFields`)             | see fragment table below |
| `ComponentSectionsMediaCollection` (via `...MediaCollectionFields`)         | see fragment table below |
| `ComponentSectionsNavigationCarousel` (via `...NavigationCarouselFields`)   | see fragment table below |
| `ComponentSectionsText` (via `...TextSectionFields`)                        | see fragment table below |
| `ComponentSectionsEasterDates` (via `...EasterDatesFields`)                 | see fragment table below |
| `ComponentSectionsAdventCountdown` (via `...AdventCountdownFields`)         | see fragment table below |
| `ComponentSectionsBibleQuotesCarousel` (via `...BibleQuotesCarouselFields`) | see fragment table below |
| `ComponentSectionsCta` (via `...CTASectionFields`)                          | see fragment table below |
| `ComponentSectionsRelatedQuestions` (via `...RelatedQuestionsFields`)       | see fragment table below |
| `ComponentSectionsContainer` (via `...ContainerFields`)                     | see fragment table below |
| `ComponentSectionsVideo` (via `...VideoSectionFields`)                      | see fragment table below |

#### Fragment: `VideoHeroFragment` (queries.ts:22-42)

| Type.field                                                                       | Parity tag |
| -------------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsVideoHero.id`                                                  | `?`        |
| `ComponentSectionsVideoHero.sectionKey`                                          | `?`        |
| `ComponentSectionsVideoHero.heading`                                             | `?`        |
| `ComponentSectionsVideoHero.subheading`                                          | `?`        |
| `ComponentSectionsVideoHero.ctaLabel`                                            | `?`        |
| `ComponentSectionsVideoHero.ctaLink`                                             | `?`        |
| `ComponentSectionsVideoHero.streamingUrl`                                        | `?`        |
| `ComponentSectionsVideoHero.video.{documentId, title, slug}`                     | `?`        |
| `ComponentSectionsVideoHero.video.images.{url, mobileCinematicHigh, videoStill}` | `?`        |

#### Fragment: `TextSectionFragment` (queries.ts:44-54)

| Type.field                                              | Parity tag |
| ------------------------------------------------------- | ---------- |
| `ComponentSectionsText.id`                              | `?`        |
| `ComponentSectionsText.sectionKey`                      | `?`        |
| `ComponentSectionsText.heading` (aliased `textHeading`) | `?`        |
| `ComponentSectionsText.headingLevel`                    | `?`        |
| `ComponentSectionsText.subtitle`                        | `?`        |
| `ComponentSectionsText.contentParagraphs`               | `?`        |
| `ComponentSectionsText.variant` (aliased `textVariant`) | `?`        |

#### Fragment: `RelatedQuestionsFragment` (queries.ts:56-70)

| Type.field                                                           | Parity tag |
| -------------------------------------------------------------------- | ---------- |
| `ComponentSectionsRelatedQuestions.id`                               | `?`        |
| `ComponentSectionsRelatedQuestions.sectionKey`                       | `?`        |
| `ComponentSectionsRelatedQuestions.heading` (aliased `rqHeading`)    | `?`        |
| `ComponentSectionsRelatedQuestions.ctaLabel`                         | `?`        |
| `ComponentSectionsRelatedQuestions.ctaLink`                          | `?`        |
| `ComponentSectionsRelatedQuestions.questions.{id, question, answer}` | `?`        |

#### Fragment: `BibleQuotesCarouselFragment` (queries.ts:72-89)

| Type.field                                                                                                                     | Parity tag |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `ComponentSectionsBibleQuotesCarousel.id`                                                                                      | `?`        |
| `ComponentSectionsBibleQuotesCarousel.sectionKey`                                                                              | `?`        |
| `ComponentSectionsBibleQuotesCarousel.heading` (aliased `bqcHeading`)                                                          | `?`        |
| `ComponentSectionsBibleQuotesCarousel.quotes.{id, reference, text, attribution, imageUrl, backgroundColor, ctaLabel, ctaLink}` | `?`        |

#### Fragment: `EasterDatesFragment` (queries.ts:91-101)

| Type.field                                         | Parity tag |
| -------------------------------------------------- | ---------- |
| `ComponentSectionsEasterDates.id`                  | `?`        |
| `ComponentSectionsEasterDates.sectionKey`          | `?`        |
| `ComponentSectionsEasterDates.easterDatesTitle`    | `?`        |
| `ComponentSectionsEasterDates.westernEasterLabel`  | `?`        |
| `ComponentSectionsEasterDates.orthodoxEasterLabel` | `?`        |
| `ComponentSectionsEasterDates.passoverLabel`       | `?`        |
| `ComponentSectionsEasterDates.locale`              | `?`        |

#### Fragment: `AdventCountdownFragment` (queries.ts:103-112)

| Type.field                                                       | Parity tag |
| ---------------------------------------------------------------- | ---------- |
| `ComponentSectionsAdventCountdown.id`                            | `?`        |
| `ComponentSectionsAdventCountdown.sectionKey`                    | `?`        |
| `ComponentSectionsAdventCountdown.title` (aliased `adventTitle`) | `?`        |
| `ComponentSectionsAdventCountdown.scripture`                     | `?`        |
| `ComponentSectionsAdventCountdown.scriptureReference`            | `?`        |
| `ComponentSectionsAdventCountdown.locale`                        | `?`        |

#### Fragment: `CTASectionFragment` (queries.ts:114-124)

| Type.field                                            | Parity tag |
| ----------------------------------------------------- | ---------- |
| `ComponentSectionsCta.id`                             | `?`        |
| `ComponentSectionsCta.sectionKey`                     | `?`        |
| `ComponentSectionsCta.heading` (aliased `ctaHeading`) | `?`        |
| `ComponentSectionsCta.body`                           | `?`        |
| `ComponentSectionsCta.buttonLabel`                    | `?`        |
| `ComponentSectionsCta.buttonLink`                     | `?`        |
| `ComponentSectionsCta.variant` (aliased `ctaVariant`) | `?`        |

#### Fragment: `VideoSectionFragment` (queries.ts:126-148)

| Type.field                                                                              | Parity tag |
| --------------------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsVideo.id`                                                             | `?`        |
| `ComponentSectionsVideo.sectionKey`                                                     | `?`        |
| `ComponentSectionsVideo.streamingUrl`                                                   | `?`        |
| `ComponentSectionsVideo.title` (aliased `videoTitle`)                                   | `?`        |
| `ComponentSectionsVideo.subtitle` (aliased `videoSubtitle`)                             | `?`        |
| `ComponentSectionsVideo.media.url`                                                      | `?`        |
| `ComponentSectionsVideo.video` (aliased `videoRef`).{documentId, title, slug, imageAlt} | `?`        |
| `ComponentSectionsVideo.video.images.{url, mobileCinematicHigh, videoStill}`            | `?`        |

#### Fragment: `NavigationCarouselFragment` (queries.ts:150-164)

| Type.field                                                                                              | Parity tag |
| ------------------------------------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsNavigationCarousel.id`                                                                | `?`        |
| `ComponentSectionsNavigationCarousel.sectionKey`                                                        | `?`        |
| `ComponentSectionsNavigationCarousel.items.{id, contentId, title, category, imageUrl, backgroundColor}` | `?`        |

#### Fragment: `MediaCollectionFragment` (queries.ts:166-200)

| Type.field                                                                                                                                | Parity tag |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsMediaCollection.id`                                                                                                     | `?`        |
| `ComponentSectionsMediaCollection.sectionKey`                                                                                             | `?`        |
| `ComponentSectionsMediaCollection.title` (aliased `mcTitle`)                                                                              | `?`        |
| `ComponentSectionsMediaCollection.subtitle` (aliased `mcSubtitle`)                                                                        | `?`        |
| `ComponentSectionsMediaCollection.description` (aliased `mcDescription`)                                                                  | `?`        |
| `ComponentSectionsMediaCollection.categoryLabel`                                                                                          | `?`        |
| `ComponentSectionsMediaCollection.ctaLink` (aliased `mcCtaLink`)                                                                          | `?`        |
| `ComponentSectionsMediaCollection.ctaLabel` (aliased `mcCtaLabel`)                                                                        | `?`        |
| `ComponentSectionsMediaCollection.showItemNumbers`                                                                                        | `?`        |
| `ComponentSectionsMediaCollection.variant` (aliased `mcVariant`)                                                                          | `?`        |
| `ComponentSectionsMediaCollection.footerText`                                                                                             | `?`        |
| `ComponentSectionsMediaCollection.items.{id, titleOverride, subtitleOverride, labelOverride, collectionSize, imageUrl, linkToSectionKey}` | `?`        |
| `ComponentSectionsMediaCollection.items.video.{documentId, title, slug, imageAlt}`                                                        | `?`        |
| `ComponentSectionsMediaCollection.items.video.images.{url, mobileCinematicHigh, videoStill}`                                              | `?`        |

#### Fragment: `VideoCarouselFragment` (queries.ts:202-228)

| Type.field                                                                                          | Parity tag |
| --------------------------------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsVideoCarousel.id`                                                                 | `?`        |
| `ComponentSectionsVideoCarousel.sectionKey`                                                         | `?`        |
| `ComponentSectionsVideoCarousel.title` (aliased `vcTitle`)                                          | `?`        |
| `ComponentSectionsVideoCarousel.subtitle` (aliased `vcSubtitle`)                                    | `?`        |
| `ComponentSectionsVideoCarousel.description` (aliased `vcDescription`)                              | `?`        |
| `ComponentSectionsVideoCarousel.items.{id, streamingUrl, imageUrl, titleOverride, backgroundColor}` | `?`        |
| `ComponentSectionsVideoCarousel.items.video.{documentId, title, slug, imageAlt}`                    | `?`        |
| `ComponentSectionsVideoCarousel.items.video.images.{url, mobileCinematicHigh, videoStill}`          | `?`        |

#### Fragment: `QuizButtonFragment` (queries.ts:230-236, reachable only via SectionFragment)

| Type.field                               | Parity tag |
| ---------------------------------------- | ---------- |
| `ComponentSectionsQuizButton.id`         | `?`        |
| `ComponentSectionsQuizButton.buttonText` | `?`        |
| `ComponentSectionsQuizButton.iframeSrc`  | `?`        |

#### Fragment: `ContainerFragment` (queries.ts:244-293, composite)

`ContainerFields` selects `id`, `sectionKey`, and a `slots` collection
where each slot has `id`, `gridSpan`, `spans`, and a polymorphic
`content` (aliased `slotContent`) constrained to the
`ContainerSlotContentDynamicZone` union (per source comment, members:
`AdventCountdown`, `BibleQuotesCarousel`, `Card`, `Cta`, `EasterDates`,
`MediaCollection`, `RelatedQuestions`, `Text`, `Video` — note `Container`,
`NavigationCarousel`, `VideoCarousel`, `QuizButton` are NOT in this
union). The Container fragment composes 8 leaf fragments via inline-spread
(only the union members the fragment actually projects):

| Composed via                                                                   | Composed fragment             |
| ------------------------------------------------------------------------------ | ----------------------------- |
| `... on ComponentSectionsText { ...TextSectionFields }`                        | `TextSectionFragment`         |
| `... on ComponentSectionsEasterDates { ...EasterDatesFields }`                 | `EasterDatesFragment`         |
| `... on ComponentSectionsAdventCountdown { ...AdventCountdownFields }`         | `AdventCountdownFragment`     |
| `... on ComponentSectionsCta { ...CTASectionFields }`                          | `CTASectionFragment`          |
| `... on ComponentSectionsVideo { ...VideoSectionFields }`                      | `VideoSectionFragment`        |
| `... on ComponentSectionsRelatedQuestions { ...RelatedQuestionsFields }`       | `RelatedQuestionsFragment`    |
| `... on ComponentSectionsBibleQuotesCarousel { ...BibleQuotesCarouselFields }` | `BibleQuotesCarouselFragment` |
| `... on ComponentSectionsMediaCollection { ...MediaCollectionFields }`         | `MediaCollectionFragment`     |

Container's own scalars:

| Type.field                                                                    | Parity tag |
| ----------------------------------------------------------------------------- | ---------- |
| `ComponentSectionsContainer.id`                                               | `?`        |
| `ComponentSectionsContainer.sectionKey`                                       | `?`        |
| `ComponentSectionsContainer.slots.{id, gridSpan, spans}`                      | `?`        |
| `ComponentSectionsContainer.slots.content.__typename` (aliased `slotContent`) | `?`        |

#### Fragment: `SectionFragment` (queries.ts:299-357, composite)

`SectionFields` selects `id`, `sectionKey`, background-related scalars,
and a polymorphic `content` (aliased `sectionContent`) constrained to
`SectionContentDynamicZone` (per source comment, members:
`BibleQuotesCarousel`, `Card`, `Container`, `Cta`, `InfoBlocks`,
`MediaCollection`, `NavigationCarousel`, `PromoBanner`, `QuizButton`,
`RelatedQuestions`, `Text`, `Video`, `VideoCarousel` — note `EasterDates`
and `AdventCountdown` are NOT in this union; they live only in
`ContainerSlotContentDynamicZone`). Section composes 10 fragments via
inline-spread:

| Composed via                                                                   | Composed fragment             |
| ------------------------------------------------------------------------------ | ----------------------------- |
| `... on ComponentSectionsContainer { ...ContainerFields }`                     | `ContainerFragment`           |
| `... on ComponentSectionsVideo { ...VideoSectionFields }`                      | `VideoSectionFragment`        |
| `... on ComponentSectionsRelatedQuestions { ...RelatedQuestionsFields }`       | `RelatedQuestionsFragment`    |
| `... on ComponentSectionsBibleQuotesCarousel { ...BibleQuotesCarouselFields }` | `BibleQuotesCarouselFragment` |
| `... on ComponentSectionsMediaCollection { ...MediaCollectionFields }`         | `MediaCollectionFragment`     |
| `... on ComponentSectionsQuizButton { ...QuizButtonFields }`                   | `QuizButtonFragment`          |
| `... on ComponentSectionsVideoCarousel { ...VideoCarouselFields }`             | `VideoCarouselFragment`       |
| `... on ComponentSectionsNavigationCarousel { ...NavigationCarouselFields }`   | `NavigationCarouselFragment`  |
| `... on ComponentSectionsText { ...TextSectionFields }`                        | `TextSectionFragment`         |
| `... on ComponentSectionsCta { ...CTASectionFields }`                          | `CTASectionFragment`          |

Section's own scalars:

| Type.field                                                               | Parity tag |
| ------------------------------------------------------------------------ | ---------- |
| `ComponentSectionsSection.id`                                            | `?`        |
| `ComponentSectionsSection.sectionKey`                                    | `?`        |
| `ComponentSectionsSection.backgroundColor`                               | `?`        |
| `ComponentSectionsSection.backgroundImageUrl`                            | `?`        |
| `ComponentSectionsSection.backgroundOpacity`                             | `?`        |
| `ComponentSectionsSection.dynamicBackgroundImage`                        | `?`        |
| `ComponentSectionsSection.staticOverlay`                                 | `?`        |
| `ComponentSectionsSection.blurHash`                                      | `?`        |
| `ComponentSectionsSection.content.__typename` (aliased `sectionContent`) | `?`        |

### tv:LIST_EXPERIENCES

- **Source:** `apps/tv/src/lib/queries.ts:450-475`
- **Variables:** `$locale: I18NLocaleCode!`
- **Access expectation (best guess; final in U5):** PUBLIC — invoked on
  TV home-screen mount before any user interaction. Drives both the
  experience rail and the focus-driven hero (see divergence note below).
- **Cache behavior:**
  - Home-screen consumer (`apps/tv/app/index.tsx:139-144`):
    `useQuery(LIST_EXPERIENCES, { variables: { locale: "en" } })` — no
    per-call `fetchPolicy` override, so it inherits the client-wide
    `defaultOptions.watchQuery.fetchPolicy: "cache-and-network"` from
    `apolloClient.ts:48-52`.
  - Search-browse consumer (`apps/tv/src/components/search/SearchBrowse.tsx:42-45`):
    `useQuery(LIST_EXPERIENCES, { variables: { locale: "en" }, fetchPolicy: "cache-first" })`
    — explicit override. SearchBrowse intentionally only mounts when
    `/search` has an empty query, so it instantly renders whatever the
    home screen already populated and only network-fetches on cold cache
    (deep-link case).
  - Apollo `InMemoryCache` (default) — no normalized typePolicies, no
    query-level cache eviction. The two consumers share the same cache
    entry by `(query, variables)` key.
- **Renderer/resolver dependency:**
  1. `apps/tv/app/index.tsx:139-155` (TV home screen) — picks
     `experiences.find((e) => e.isHomepage) ?? experiences[0] ?? null`
     as the homepage anchor, drives the focus-debounced hero state
     machine off the `VideoHero` block per experience (see source lines
     157-169 of `index.tsx`), and renders the experience rail of cards.
  2. `apps/tv/src/components/search/SearchBrowse.tsx:42-52` — slices
     the first `POPULAR_COUNT` (8) experiences as a "popular" rail in
     the empty-query state of `/search`.
- **Composed fragments:** 1 fragment composed inline —
  `VideoHeroFragment`, applied to the first
  `ComponentSectionsVideoHero` arm of `Experience.blocks`. Per the
  source comment (queries.ts:435-448), non-`VideoHero` blocks are still
  returned over the wire with only `__typename` (cheap; ~30 bytes per
  block); for the current experience count (<20) the total payload
  stays small.
- **Cross-app divergence (closes the loop with U2):** Mobile's
  `mobile:LIST_EXPERIENCES` (queries.ts:426-442) selects metadata only
  (`documentId`, `slug`, `title`, `metaDescription`, `isHomepage`,
  `ogImage.{url, alternativeText, width, height}`). TV's
  `LIST_EXPERIENCES` selects ALL of those PLUS an inline
  `Experience.blocks { __typename ... on ComponentSectionsVideoHero { ...VideoHeroFields } }`
  selection set. This is the focus-driven home-hero divergence U2's
  `mobile:LIST_EXPERIENCES` "Cross-app divergence" note flagged for
  pickup here. The TV-side rationale (per source comment lines 435-448)
  is that swapping the hero on focus must require zero extra round-trips.
- **Selected fields & parity tags:**

| Type.field                                                 | Parity tag                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Query.experiences(locale)`                                | `?`                                                                                                                         |
| `Experience.documentId`                                    | `?`                                                                                                                         |
| `Experience.slug`                                          | `?`                                                                                                                         |
| `Experience.title`                                         | `?`                                                                                                                         |
| `Experience.metaDescription`                               | `?`                                                                                                                         |
| `Experience.isHomepage`                                    | `?`                                                                                                                         |
| `Experience.ogImage.{url, alternativeText, width, height}` | `?`                                                                                                                         |
| `Experience.blocks.__typename`                             | `?` (TV-specific selection — mobile does NOT select `blocks` here)                                                          |
| `ComponentSectionsVideoHero` (via `...VideoHeroFields`)    | `?` (TV-specific selection — see fragment table under `tv:GET_WATCH_EXPERIENCE` for the body; same fragment, single-spread) |

### tv:SEMANTIC_SEARCH

- **Source:** `apps/tv/src/lib/queries.ts:490-519`
- **Variables:** `$query: String!`, `$locale: String!`, `$limit: Int`,
  `$offset: Int`. (Same shape as mobile's `mobile:SEMANTIC_SEARCH`; no
  `$type` argument unlike web's `web:SEMANTIC_SEARCH`. Per source comment
  lines 485-488: `$locale` is `String!` not `I18NLocaleCode!` because
  `semanticSearch` is a CMS custom resolver, not a Strapi-generated query.)
- **Access expectation (best guess; final in U5):** PUBLIC — drives the
  TV `/search` screen's debounced semantic-search field for
  unauthenticated viewers.
- **Cache behavior:** `getApolloClient().query({ query: SEMANTIC_SEARCH, variables, fetchPolicy: "no-cache" })`
  in `apps/tv/src/lib/search.ts:198-209` (sole callsite — the TV
  search hook centralizes both initial search and load-more through
  this one function with `offset`/`limit` parameter changes). The
  Apollo `InMemoryCache` is bypassed entirely — every debounced search
  is a fresh network call. The hook adds two TV-specific protections
  beyond mobile's: a 15s safety timeout (`SEARCH_SAFETY_TIMEOUT_MS`,
  search.ts:179-196) that forces the UI out of `loading` if Apollo's
  promise neither resolves nor rejects, and a `requestIdRef`
  staleness guard (search.ts:181, 233-234) that drops superseded
  responses. The `keyword-only` branch on `searchMode` (search.ts:236-241)
  routes to a distinct `degraded` UI state.
- **Renderer/resolver dependency:** `apps/tv/src/lib/search.ts`
  (the `useSearch` hook) — exports a `search(text)` callback bound
  to a debounced text input on the TV `/search` screen. Result rows
  consume `SearchResult = ResultOf<typeof SEMANTIC_SEARCH>["semanticSearch"]["results"][number]`
  (queries.ts:521-523) and the `searchMode` literal drives the
  three-way state machine (`hybrid` → `ready`, `keyword-only` →
  `degraded`, no results → `empty`).
- **Composed fragments:** none.
- **Cross-app divergence (closes the loop with U2):** TV selects
  `searchMode` on `SemanticSearchResult`, mobile does NOT. Web (per U1)
  also selects `searchMode`. The TV-side rationale (per source comment
  lines 479-483): TV consumes the degraded-backend signal to render a
  distinct "temporarily unavailable" UX (see search.ts:236-241,
  `mode === "keyword-only"` branch); mobile does not consume the
  signal today.
- **U5 disposition note for `searchMode`:** `searchMode` is **already
  PUBLIC on both Strapi (today) and admin** (admin's Pothos field
  defined at `apps/admin/src/graphql/queries/hybrid-search.ts:86` —
  the response-envelope `searchMode` reports the embedding-degradation
  signal `'hybrid' | 'keyword-only'`; not to be confused with the
  ORTHOGONAL request-arg `searchMode` on the input that selects the
  retrieval pipeline, see hybrid-search.ts:115). This is a
  CONFIRMATION of intentional public exposure on both sides — NOT a
  pending decision for Unit 2 of the parent migration plan. U5
  classification is `PUBLIC-current` (not `PUBLIC-eligible-needs-widening`).
- **Selected fields & parity tags:**

| Type.field                                                                                                 | Parity tag                                                              |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Query.semanticSearch(query, locale, limit, offset)`                                                       | `?`                                                                     |
| `SemanticSearchResult.query`                                                                               | `?`                                                                     |
| `SemanticSearchResult.hasMore`                                                                             | `?`                                                                     |
| `SemanticSearchResult.searchMode`                                                                          | `?` (TV-specific selection — mobile does NOT select; web DOES — see U1) |
| `SemanticSearchResult.results.{type, id, slug, title, imageUrl, snippet, startSeconds, playbackId, score}` | `?`                                                                     |

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

### U2 (apps/mobile)

- `rg "graphql\(" apps/mobile/src` → 18 matches, all in
  `apps/mobile/src/lib/queries.ts`. Breakdown:
  - 3 standalone operations (one `### mobile:{ConstantName}` subsection
    each): `GET_WATCH_EXPERIENCE` (queries.ts:352), `LIST_EXPERIENCES`
    (queries.ts:426), `SEMANTIC_SEARCH` (queries.ts:448).
  - 12 leaf fragments composed into `GET_WATCH_EXPERIENCE` (one of which —
    `QuizButtonFragment` — is reachable only via `SectionFragment`):
    `VideoHeroFragment`, `TextSectionFragment`, `RelatedQuestionsFragment`,
    `BibleQuotesCarouselFragment`, `EasterDatesFragment`,
    `AdventCountdownFragment`, `CTASectionFragment`, `VideoSectionFragment`,
    `NavigationCarouselFragment`, `MediaCollectionFragment`,
    `VideoCarouselFragment`, `QuizButtonFragment`.
  - 2 composite fragments composed into `GET_WATCH_EXPERIENCE`:
    `ContainerFragment` (queries.ts:235), `SectionFragment` (queries.ts:290).
  - 1 banner-comment match (`queries.ts:4`: `"Operations are defined in apps using graphql() from this package."`)
    — a JSDoc string, NOT a `graphql()` callsite. Excluded from the
    inventory by inspection.
  - Reconciled count: 3 operations + 12 leaf fragments + 2 composite
    fragments + 1 comment = 18 rg matches accounted for.
- ``rg "= gql\`" apps/mobile/src`` → **0 matches**. Mobile uses ONLY
  gql.tada `graphql()`; no raw Apollo `gql` template literals exist
  anywhere under `apps/mobile/src`. (Web's dual-rg need does not apply to
  mobile; the sweep is still mandatory per regeneration discipline.)
- Total mobile standalone operations inventoried: **3** (12 fragments
  composed inline, 2 of them composite).
- Mobile↔TV `SEMANTIC_SEARCH` divergence captured: mobile selects only
  `query`, `hasMore`, and `results.{type, id, slug, title, imageUrl, snippet, startSeconds, playbackId, score}`.
  Mobile does NOT select `searchMode`; TV (per U3) and web (per U1) DO.
  Cross-referenced inline in `mobile:SEMANTIC_SEARCH`'s "Cross-app
  divergence" note for U3/U5 pickup.
- Mobile↔TV `LIST_EXPERIENCES` divergence captured: mobile's listing query
  selects metadata only (no `blocks`); TV (per U3) selects an additional
  per-experience `ComponentSectionsVideoHero` block to power its
  focus-driven home hero. Cross-referenced inline in
  `mobile:LIST_EXPERIENCES`'s "Cross-app divergence" note.
- Anomaly: `QuizButtonFragment` is exported from `queries.ts` but
  unreachable at the operation top level — it is composed only by
  `SectionFragment` (Section's `ComponentSectionsQuizButton` arm). This
  matches web's `quizButtonSectionFragment` pattern (per U1's note: the
  exported fragment is composed by Section, not directly by the operation).
  Recorded as a `Reachable only via SectionFragment` annotation in the
  fragment heading rather than a separate reachability finding.
- No anomalies in cache-behavior or renderer-dependency sourcing — all
  three operations have a single Apollo callsite each: `useExperience.ts`
  for `GET_WATCH_EXPERIENCE`, `ExperienceShell.tsx` for `LIST_EXPERIENCES`,
  `app/(tabs)/watch.tsx` for `SEMANTIC_SEARCH` (twice — initial search +
  load-more).

### U3 (apps/tv)

- `rg "graphql\(" apps/tv/src` → 18 matches, all in
  `apps/tv/src/lib/queries.ts`. Breakdown:
  - 3 standalone operations (one `### tv:{ConstantName}` subsection
    each): `GET_WATCH_EXPERIENCE` (queries.ts:361), `LIST_EXPERIENCES`
    (queries.ts:450), `SEMANTIC_SEARCH` (queries.ts:490).
  - 12 leaf fragments composed into `GET_WATCH_EXPERIENCE` (one of which —
    `QuizButtonFragment` — is reachable only via `SectionFragment`):
    `VideoHeroFragment`, `TextSectionFragment`, `RelatedQuestionsFragment`,
    `BibleQuotesCarouselFragment`, `EasterDatesFragment`,
    `AdventCountdownFragment`, `CTASectionFragment`, `VideoSectionFragment`,
    `NavigationCarouselFragment`, `MediaCollectionFragment`,
    `VideoCarouselFragment`, `QuizButtonFragment`. `VideoHeroFragment`
    is additionally re-composed inline by `LIST_EXPERIENCES` (TV-specific
    divergence — see below).
  - 2 composite fragments composed into `GET_WATCH_EXPERIENCE`:
    `ContainerFragment` (queries.ts:244), `SectionFragment` (queries.ts:299).
  - 1 banner-comment match (`queries.ts:14`: `"Operations are defined in apps using graphql() from this package."`)
    — a JSDoc string, NOT a `graphql()` callsite. Excluded from the
    inventory by inspection.
  - Reconciled count: 3 operations + 12 leaf fragments + 2 composite
    fragments + 1 comment = 18 rg matches accounted for. (Identical
    structural composition to mobile.)
- ``rg "= gql\`" apps/tv/src`` → **0 matches**. TV uses ONLY gql.tada
  `graphql()`; no raw Apollo `gql` template literals exist anywhere
  under `apps/tv/src`. (Web's dual-rg need does not apply to TV; the
  sweep is still mandatory per regeneration discipline.)
- Total TV standalone operations inventoried: **3** (12 fragments
  composed inline, 2 of them composite).
- **Mobile↔TV `LIST_EXPERIENCES` divergence captured** (closes the loop
  with U2): TV's `LIST_EXPERIENCES` selects an inline
  `Experience.blocks { __typename ... on ComponentSectionsVideoHero { ...VideoHeroFields } }`
  to power the focus-driven home hero (queries.ts:465-470 + source
  comment 435-448). Mobile's `LIST_EXPERIENCES` does NOT select
  `blocks` at all. Cross-references: forward note in
  `mobile:LIST_EXPERIENCES` "Cross-app divergence" (U2), backward note
  in `tv:LIST_EXPERIENCES` "Cross-app divergence" (this unit).
- **Mobile↔TV `SEMANTIC_SEARCH` divergence captured** (closes the loop
  with U2): TV selects `searchMode` on `SemanticSearchResult`
  (queries.ts:505) to drive the degraded-backend `keyword-only` UX
  branch in `search.ts:236-241`. Mobile does NOT select `searchMode`.
  Web (per U1) also selects `searchMode`. Cross-references: forward
  note in `mobile:SEMANTIC_SEARCH` "Cross-app divergence" (U2),
  backward note in `tv:SEMANTIC_SEARCH` "Cross-app divergence" (this
  unit). U5 disposition note recorded inline in `tv:SEMANTIC_SEARCH`:
  `searchMode` is **already PUBLIC** on Strapi (today) AND admin (per
  `apps/admin/src/graphql/queries/hybrid-search.ts:86`). This is a
  CONFIRMATION of intentional public exposure, NOT a pending decision
  for Unit 2 of the parent migration plan. (Note: admin's
  `hybrid-search.ts:115` documents an ORTHOGONAL request-arg
  `searchMode` selecting the retrieval pipeline — not to be confused
  with the response-envelope `searchMode` selected here.)
- **Normalizer drift check:** No drift; TV normalizer
  (`apps/tv/src/lib/normalizer.ts`) mirrors mobile normalizer
  (`apps/mobile/src/lib/normalizer.ts`) byte-for-byte except for the
  `// SYNC: keep in sync with apps/mobile/src/lib/normalizer.ts`
  header comment on TV line 1. The 17-entry `TYPENAME_TO_KIND` map is
  byte-identical to mobile's (verified via
  `diff apps/mobile/src/lib/normalizer.ts apps/tv/src/lib/normalizer.ts`,
  output: 1 added line — the SYNC header — and zero map-entry
  differences). No U4 mapping-table concern.
- Anomaly: `QuizButtonFragment` is exported from `queries.ts` but
  unreachable at the operation top level — composed only by
  `SectionFragment` (Section's `ComponentSectionsQuizButton` arm).
  Same pattern as mobile (per U2) and web (per U1).
- **Cache-behavior anomaly (vs mobile):** TV's `getApolloClient()` sets
  `defaultOptions.watchQuery.fetchPolicy: "cache-and-network"` GLOBALLY
  (`apolloClient.ts:48-52`); mobile does not set a global default.
  Recorded inline at the top of the `## apps/tv Operations` section so
  Unit 5 / 6 reviewers don't read the per-op cache notes in isolation.
  TV's `tv:GET_WATCH_EXPERIENCE` and `tv:LIST_EXPERIENCES` (home-screen
  consumer) inherit this default; the SearchBrowse `LIST_EXPERIENCES`
  consumer overrides with `cache-first`; `tv:SEMANTIC_SEARCH` uses
  `getApolloClient().query(..., { fetchPolicy: "no-cache" })` which is
  an explicit per-call override that ignores `defaultOptions`.
- Renderer-dependency sourcing: 4 Apollo callsites total —
  `app/experience/[slug].tsx` for `GET_WATCH_EXPERIENCE` (1 callsite);
  `app/index.tsx` AND `src/components/search/SearchBrowse.tsx` for
  `LIST_EXPERIENCES` (2 callsites — same query, two consumers sharing
  the cache entry); `src/lib/search.ts` for `SEMANTIC_SEARCH` (1
  callsite — initial search and load-more both flow through the same
  hook, parameterized on `offset`/`limit`).
