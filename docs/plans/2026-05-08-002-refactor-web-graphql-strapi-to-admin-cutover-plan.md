---
title: "refactor: apps/web GraphQL big-bang cutover from Strapi to admin"
type: refactor
status: completed
date: 2026-05-08
---

# refactor: apps/web GraphQL big-bang cutover from Strapi to admin

## Summary

Migrate `apps/web` off Strapi and onto admin's Pothos GraphQL API in a single big-bang PR. Admin gets 4 narrow Pothos additions first (homepage/template query, `videoBySlug` widening, `Video.parents`/`Video.children` relations); web then retargets Apollo, rewrites 9 named operations to `adminGraphql()`, deletes the 17 Strapi block fragments, and rebuilds 17 section components to consume Zod-typed admin block shapes inferred from `apps/admin/src/domain/blocks.ts`. Mobile preserved on Strapi via the existing dual-client `packages/graphql` infrastructure; Strapi enters maintenance mode after cutover.

---

## Problem Frame

Editor staff publish content through `apps/admin` (chat-driven AI drafting + manual editing) into the `forge_admin` Postgres database. Public visitors visit `apps/web` (e.g., `/watch/forgiveness/en`), which today reads from Strapi at `localhost:1337` — a separate datastore that knows nothing about admin's published content. The boundary surfaces today as: AI-published experiences are invisible on the public site. The brainstorm decided to cross the R8 boundary in a single PR rather than wait for a phased migration.

---

## Requirements

- R1. `apps/web` reads zero data from Strapi — every GraphQL operation in `apps/web/src/lib/` consumes admin's Pothos schema via `adminGraphql()`.
- R2. Admin's Pothos schema exposes everything web's existing public surfaces need to render: `experienceBySlug`, homepage/template queries, `videoBySlug(locale)`, `Video.parents`/`children` relations, `search`, `sceneRecommendations`. New types/queries land in admin's `src/graphql/types/` and `src/graphql/queries/` and are PUBLIC-scoped where web reads them anonymously.
- R3. `apps/mobile` is untouched — its existing Strapi-shaped imports (`@forge/graphql`'s `graphql()` factory) remain functional.
- R4. Section renderer dispatch flips from `__typename` (Strapi component union) to `t` (admin block discriminator). All 17 web section components rewrite to consume `z.infer<typeof XBlockSchema>` from `apps/admin/src/domain/blocks.ts`.
- R5. Block `videoId` references resolve via `ExperienceLocale.referencedVideos` (already exposed) — synchronous render, no client-side `video(id)` hydration round-trips.
- R6. Apollo client drops the Strapi `Authorization: Bearer ${STRAPI_API_TOKEN}` header path; web queries admin anonymously.
- R7. Env vars rename cleanly (`NEXT_PUBLIC_GRAPHQL_URL`/`INTERNAL_GRAPHQL_URL` → `NEXT_PUBLIC_ADMIN_GRAPHQL_URL`/`INTERNAL_ADMIN_GRAPHQL_URL`) — no backward-compat shims.
- R8. Strapi enters maintenance mode after merge (no admin-side edits encouraged); the apps/cms service stays running for `apps/mobile` only.
- R9. Manual smoke test of top 5–10 web surfaces gates the merge: `/`, `/watch/forgiveness/en` (chat-published experience), `/[slug]`, `/[slug]/[locale]`, `/demo-search`, `/demo-search/[slug]/[locale]`, `/demo-recommendations/[slug]/[locale]`.

---

## Scope Boundaries

- Mobile (`apps/mobile`) is NOT migrated. Stays on Strapi via the same `packages/graphql` `graphql()` factory.
- Strapi shutdown is NOT in this PR. apps/cms keeps running for mobile until a separate mobile cutover.
- Strapi → admin data migration is NOT in scope. Admin already syncs canonical Core content; experiences authored only in Strapi (legacy) are not migrated.
- Anti-corruption / translation GraphQL gateway — explicitly rejected at brainstorm. Web rewrites to admin's shape, not the inverse.
- Performance regression analysis — out of scope. Cutover is performance-neutral assumption; if Cloudflare-front admin response times prove materially worse than Strapi, that's a follow-up.
- New web pages, routes, or features — only existing surfaces migrate.
- Apollo Client major-version upgrade — current Apollo setup is preserved.
- Web search index repopulation — admin's R4 hybrid-search index already covers the corpus.
- Codegen automation changes — `packages/graphql`'s existing dual-factory setup (`graphql()` + `adminGraphql()`) is unchanged.

### Deferred to Follow-Up Work

- Mobile (`apps/mobile`) Strapi → admin cutover: separate PR, undated.
- Strapi service shutdown + decommissioning: separate PR, after mobile cutover.
- Removing the `STRAPI_API_TOKEN` / `STRAPI_PREVIEW_SECRET` / `REVALIDATION_SECRET` env vars from infrastructure: cleanup PR after mobile cutover.
- Apollo client refactor (single client → fetcher pattern, etc.): only if the post-cutover surface motivates it.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/lib/client.ts` — single Apollo client; SSR/CSR URL split via env; conditional `Authorization: Bearer` for server-side Strapi requests; 10s `AbortSignal.timeout`. Cutover retargets the URL and drops the auth-header branch.
- `apps/web/src/lib/content.ts` — defines `GetExperience`, `GetWatchExperience`, `GetWatchSettings`, `GetRouteVideo`, plus `resolveWatchPage`, `resolveWatchVideoBySlug`, `mergeWatchExperience`, the `WatchBlock` synthetic union, and `PLAYER_BEARING_STRAPI_TYPES`.
- `apps/web/src/lib/fragments/` — 17 files, all Strapi-shape. Deleted wholesale in U3.
- `apps/web/src/components/sections/index.tsx` — `ExperienceSectionRenderer` switches on `section.__typename === "ComponentSections*"`. Becomes a `switch (block.t)` over admin block discriminators.
- `apps/web/src/components/sections/*.tsx` — 17 components, each consuming `FragmentOf<typeof xFragment>`. Each rewrites to `z.infer<typeof XBlockSchema>`.
- `apps/admin/src/graphql/types/experience.ts` — `Experience`, `ExperienceLocale` Pothos types. `experienceBySlug(locale, slug)` query exists. `ExperienceLocale.referencedVideos` exists (from `feat/admin-experience-preview`). `ExperienceLocale.blocks` is `JSON` scalar.
- `apps/admin/src/graphql/types/video.ts` — `Video`, `VideoLocale`, `VideoDub`, `VideoEdition`, `VideoSubtitle`, `VideoStudyQuestion`, `VideoImage`. `videoBySlug(slug)` query exists but gated `read:videos`, no `locale` arg, no `parents`/`children` relations.
- `apps/admin/src/graphql/queries/hybrid-search.ts` — R4 `search` query, parity-tested against cms `semanticSearch`.
- `apps/admin/src/graphql/queries/scene-recommendations.ts` — R5 `sceneRecommendations` query, parity-tested.
- `apps/admin/src/domain/blocks.ts` — canonical `BlocksSchema` Zod discriminated union. Web's section components consume `z.infer<typeof XBlockSchema>` types from here.
- `apps/admin/schema.graphql` — admin's wire SDL.
- `packages/graphql/src/index.ts` — exports `graphql()` (Strapi factory) and `adminGraphql()` (admin factory). Dual-client infra is already wired.
- `apps/admin/CLAUDE.md` — R4 hybrid-search and R5 scene-recommendations contracts; pothos-add-a-type three-step recipe; `experienceBySlug` is PUBLIC.
- `packages/graphql/CLAUDE.md` — dual-factory documentation; videoBySlug widening on Unit 2 brief.

### Institutional Learnings

- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md` — when porting one stack to another, every SQL/GraphQL invariant must be re-derived from the new source's schema. Applies here: web's queries cannot be mechanically translated; per-query parity must be verified against admin's actual Pothos types.
- `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md` — locale enumeration is data-derived. Web's `I18NLocaleCode` Strapi scalar collapses to plain `String` admin-side; locale args become regular strings, no fixed enum.
- `apps/admin/CLAUDE.md` "Adding a new Pothos type" three-step recipe — applies to U1's homepage/template additions: file in `src/graphql/types/`, side-effect import in `src/graphql/schema.ts`, `reference.ts` imported first.
- Hybrid search R4 cms-parity contract (`apps/admin/CLAUDE.md` "Hybrid search (R4 …)" section) — `search` field name + arg shape verified parity-tested. Web's `semanticSearch` rename is mechanical.
- Scene recommendations R5 identity delta (`apps/admin/CLAUDE.md` "Scene recommendations (R5 …)") — `videoId: Int → ID!` change documented in plan §Key Technical Decisions #2; web treats `videoId` as React key only, so no behavioral change.

### External References

- Apollo Client v3 docs — `HttpLink` + `AbortSignal` + SSR/CSR conditional-link patterns are well-established; no new external references needed for the cutover.
- gql.tada multi-schema codegen pattern (already referenced by `packages/graphql/CLAUDE.md`) — admin schema flipping in `adminGraphql()` is the existing path web newly consumes.

---

## Key Technical Decisions

- **Admin Pothos additions land first in the same PR.** Web's rewrite cannot type-check until admin exposes the missing surfaces (homepage/template query, `videoBySlug` PUBLIC + locale arg, `Video.parents`/`children`). U1 commits land before U2–U7. Same PR keeps the cutover as a single mergeable unit; merge order keeps the tree green.
- **Web imports Zod schemas from `apps/admin/src/domain/blocks.ts`.** Workspace import via `@forge/admin` (or a new shared types entry — see Open Question §OQ1). Block-shape source of truth is admin; web never duplicates the discriminated-union definition. Type drift is impossible at compile time.
- **Block `videoId` references resolved via `ExperienceLocale.referencedVideos`.** Each page query loads referenced videos in one round-trip (the field already does the JOIN-on-block-JSON-walk on admin's resolver). Renderer receives a `Map<string, Video>` keyed by id; section components look up `video = videoMap.get(block.videoId)`. Synchronous render, no async hydration in section components.
- **Apollo client drops the Strapi auth-header branch.** Web queries admin anonymously. Every read web needs is PUBLIC: `experienceBySlug` (existing), `homepageExperienceLocale` / `defaultTemplateExperienceLocale` (new, declared PUBLIC), `videoBySlug` (widened to PUBLIC in U1), `search` / `sceneRecommendations` (existing PUBLIC).
- **`packages/graphql` factory choice: `adminGraphql()`.** All web queries flip to `adminGraphql()`. The `graphql()` Strapi factory remains exported for `apps/mobile` to keep using.
- **Env var rename, not aliasing.** `NEXT_PUBLIC_GRAPHQL_URL` / `INTERNAL_GRAPHQL_URL` / `STRAPI_API_TOKEN` removed from `apps/web`'s env shape; `NEXT_PUBLIC_ADMIN_GRAPHQL_URL` / `INTERNAL_ADMIN_GRAPHQL_URL` added. Updates the Doppler `forge-web` config; deployment docs updated. No backward-compat shims.
- **Locale-pick happens server-side in admin's resolvers.** `videoBySlug(slug, locale)` returns a Video with locales filtered/picked server-side, matching Strapi's `videos(filters, locale)` ergonomics. Web doesn't iterate `video.locales` to pick the right `VideoLocale`; admin returns the right one.
- **`StrapiWatchBlock` rename.** The synthetic union in `lib/content.ts` renames to `AdminWatchBlock` (or unprefixed `WatchBlock` since Strapi is gone). `PLAYER_BEARING_STRAPI_TYPES` set converts to `t`-literal set: `new Set(["videoHero", "video", "videoCarousel"])`.
- **`fragments/` deletion is wholesale in U3.** Don't keep stub files; web's typed shapes come exclusively from Zod inference + the SDL-typed query result types.
- **No new automated test suite for the cutover.** Manual smoke covers acceptance per R9. Existing component-level tests in `apps/web` are updated minimally to compile against the new types.
- **Per-query rewrite preserves operation names.** `GetWatchExperience` keeps that name on the admin query; only the body and variable types change. This eases git-blame review of the cutover diff.

---

## Open Questions

### Resolved During Planning

- **Block-shape source of truth**: `apps/admin/src/domain/blocks.ts` — admin Zod is canonical; web imports via workspace.
- **Block `videoId` resolution path**: page-level `referencedVideos` map; renderer picks by id.
- **Apollo client architecture**: same single-client shape, just retargeted. No multi-client / fetcher refactor in this PR.
- **Field rename strategy**: rename in callers; no shim wrapper. `semanticSearch` → `search`; `__typename` → `t`.
- **Auth model**: anonymous reads from web; `videoBySlug` widens to PUBLIC.

### Deferred to Implementation

- **OQ1: workspace-import path for `BlocksSchema` types.** Web could import via `@forge/admin/domain/blocks` (direct), or admin could re-export from a slimmer `@forge/admin/types` package boundary, or a new `@forge/blocks` package could be carved. Decision deferred to implementation; the cheapest path (`@forge/admin/domain/blocks` direct via workspace dep) is the default unless implementation hits a circular-dep snag.
- **OQ2: exact admin homepage query shape.** Either `experienceLocaleBy({ isHomepage: true, locale })` (filter pattern) or two named queries `homepageExperienceLocale(locale)` + `defaultTemplateExperienceLocale(locale)`. The two named queries are cleaner; defer final naming to U1.
- **OQ3: `Video.parents` / `Video.children` exposure semantics.** Admin's `VideoRelation` table backs the relation; question is whether to expose `Video.parents: [Video!]` and `Video.children: [Video!]` directly, or a single `Video.relations: [VideoRelation!]` typed list. Default to direct `parents`/`children` to match Strapi's wire shape and keep web's existing tree-walk logic simple.
- **OQ4: Apollo cache shape after URL flip.** Apollo InMemoryCache normalizes by `__typename` + `id`; admin's types use cuid `id` strings. Behavior is functionally equivalent but Apollo's request-deduplication may behave subtly differently. Verify by smoke; revisit only if a real issue appears.
- **OQ5: Cloudflare 524 timeouts on web → admin requests.** Admin is fronted by Cloudflare in prod; some queries (e.g., the search query) can be longer than Strapi's. Outbound timeout discipline applies — web's 10s `AbortSignal` ceiling stays, admin's per-query response should fit. Defer to smoke testing; if any query consistently approaches 10s, lift the ceiling.
- **OQ6: Doppler config update timing.** Updating `forge-web/dev` Doppler env removes Strapi vars and adds admin vars. Deploy ordering for Railway is: admin must respond at the new URL BEFORE web's new build that reads it; effectively the same release. Defer specifics to operational runbook in the merge step.
- **OQ7: Mobile post-cutover compatibility.** mobile reads `@forge/graphql`'s `graphql()` factory which is generated from Strapi's SDL. Cutover doesn't change that codegen, but the Strapi service stays running so codegen still works against it. Confirm during smoke that mobile dev still boots; not a blocker.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Data flow before vs after

```
BEFORE                                          AFTER

Browser --> apps/web (Apollo)                   Browser --> apps/web (Apollo)
              |                                               |
              v INTERNAL_GRAPHQL_URL                          v INTERNAL_ADMIN_GRAPHQL_URL
        Strapi /graphql                                 Admin /api/graphql
              |                                               |
              v                                               v
        Strapi DB (forge_cms)                           Admin DB (forge_admin)
                                                              ^
        apps/admin --> Admin API <-- (authoring)              | (chat-published content
                                                              |  appears here, served live
                                                              |  to public via web)

apps/mobile --> Apollo --> Strapi /graphql --> Strapi DB     [unchanged]
```

### Section-renderer dispatch shape

```
BEFORE (Strapi):                              AFTER (admin):
  switch (section.__typename) {                 switch (block.t) {
    case "ComponentSectionsVideoHero": ...        case "videoHero": ...
    case "ComponentSectionsCta": ...              case "cta": ...
    ...                                           ...
  }                                             }

  type SectionProps = FragmentOf<typeof          type SectionProps = z.infer<
    videoHeroFragment>                             typeof VideoHeroBlockSchema
                                                  >
```

### Admin Pothos additions sketch

```
// apps/admin/src/graphql/queries/homepage.ts (new)
builder.queryField("homepageExperienceLocale", (t) =>
  t.prismaField({
    type: "ExperienceLocale",
    nullable: true,
    args: { locale: t.arg.string({ required: true }) },
    authScopes: { public: true },
    resolve: ...
  })
)

// apps/admin/src/graphql/types/video.ts (modify)
videoBySlug:
  - widen authScopes: { public: true }
  - add args.locale: t.arg.string({ required: false })
  - server-side filter video.locales for the requested locale

Video Pothos type additions:
  - t.relation("parents") via VideoRelation table (parent_video_id)
  - t.relation("children") via VideoRelation table (child_video_id)
```

---

## Implementation Units

### U1. Admin Pothos additions (homepage/template + video gaps)

**Goal:** Expose every admin field that web's rewrite needs, before any web changes land.

**Requirements:** R2

**Dependencies:** None

**Files:**
- Create: `apps/admin/src/graphql/queries/homepage.ts`
- Create: `apps/admin/src/graphql/queries/homepage.test.ts`
- Modify: `apps/admin/src/graphql/types/video.ts` (widen `videoBySlug` to PUBLIC, add `locale` arg, add `parents`/`children` relations)
- Modify: `apps/admin/src/graphql/types/video.test.ts` (extend coverage)
- Modify: `apps/admin/src/graphql/schema.ts` (side-effect import for new homepage query file)
- Modify: `apps/admin/src/graphql/schema.test.ts` (PUBLIC scope assertion for new fields; no `embed/vector/similarit` leak invariants still hold)
- Test: `apps/admin/src/graphql/types/video.test.ts`, `apps/admin/src/graphql/queries/homepage.test.ts`

**Approach:**
- Add `homepageExperienceLocale(locale: String!)` and `defaultTemplateExperienceLocale(locale: String!)` queries returning `ExperienceLocale` (nullable). Resolvers select by `(locale, isHomepage = true)` and `(locale, experience.isTemplate = true)`. Both PUBLIC. Backed by existing `ExperienceLocale.isHomepage` + `Experience.isTemplate` columns.
- Widen `videoBySlug(slug)` resolver `authScopes` to `{ public: true }`. Add optional `locale: String` arg; when supplied, the resolver returns the Video with `video.locales` filtered to the requested locale (single-element list with fallback to `primaryLanguage` when missing). Update existing tests for the new shape.
- Add `Video.parents: [Video!]` and `Video.children: [Video!]` Pothos relations backed by the `VideoRelation` table. Resolver follows `parent_video_id` / `child_video_id` columns. Default to PUBLIC scope (matching the parent type's `read:videos` widening).
- (Optional, defer if expensive) Expose `ExperienceLocale.ogImageWidth` / `ogImageHeight` / `ogImageAlt`. If admin's Postgres doesn't carry these, leave them off and accept web's metadata simplification.
- All three additions follow the admin three-step recipe: file in `src/graphql/types/` (or `queries/`), side-effect import in `src/graphql/schema.ts`, `reference.ts` imported first.

**Patterns to follow:**
- `apps/admin/src/graphql/types/experience.ts::ExperienceLocale.referencedVideos` (PUBLIC scope, prismaField shape, resolver returning Prisma rows).
- `apps/admin/src/graphql/queries/hybrid-search.ts` (PUBLIC top-level query shape).
- `apps/admin/src/graphql/types/video.ts` (existing `videoBySlug` → modify in place; existing `Video` Pothos relations like `dubs` → mirror the pattern for `parents`/`children`).

**Test scenarios:**
- Happy path: `homepageExperienceLocale(locale: "en")` returns the experience locale with `isHomepage = true` for en; returns null when none exists.
- Happy path: `defaultTemplateExperienceLocale(locale: "en")` returns the locale tied to the experience marked `isTemplate = true`.
- Edge case: locale with no homepage → null (not error).
- Edge case: multiple experiences flagged `isHomepage` for same locale (shouldn't happen but verify the resolver picks deterministically — most-recent or first-by-id, document the choice).
- Happy path: `videoBySlug(slug: "x", locale: "en")` returns the Video with `locales` filtered to en. Without `locale`, returns all locales.
- Edge case: `videoBySlug` when the Video has no locale matching — returns the Video with empty `locales` array (or fallback to primaryLanguage; document and test the choice).
- Happy path: `Video.parents` returns the parent Videos via `VideoRelation` JOIN; `Video.children` returns the children.
- Integration: anonymous (PUBLIC) caller can hit all four — `homepageExperienceLocale`, `defaultTemplateExperienceLocale`, `videoBySlug`, `Video.parents`/`children` — without a session.
- Schema invariants (in `schema.test.ts`): no `embed|vector|similarit` field leaks on the new types; `videoBySlug` is PUBLIC; no admin-only ABAC fields exposed via the public surface.

**Verification:**
- `pnpm --filter @forge/admin build` succeeds.
- `apps/admin/schema.graphql` regenerates with the new fields/queries.
- `pnpm --filter @forge/admin test` passes; `schema.test.ts` invariants hold.

---

### U2. Web Apollo client retarget + env vars

**Goal:** Flip web's GraphQL endpoint from Strapi to admin and remove the Strapi auth path.

**Requirements:** R6, R7

**Dependencies:** U1 (admin must be PUBLIC where web reads)

**Files:**
- Modify: `apps/web/src/lib/client.ts` (retarget URL, drop `Authorization` header branch, drop `STRAPI_API_TOKEN` reference)
- Modify: `apps/web/src/env.ts` (or wherever env vars are declared) — add `NEXT_PUBLIC_ADMIN_GRAPHQL_URL`, `INTERNAL_ADMIN_GRAPHQL_URL`; remove `NEXT_PUBLIC_GRAPHQL_URL`, `INTERNAL_GRAPHQL_URL`, `STRAPI_API_TOKEN`
- Modify: `apps/web/.env.example`
- Modify: `apps/web/.env.ci` (remove Strapi vars; add admin vars pointing at a CI-mock URL or the dev admin)

**Approach:**
- Single Apollo client. URL split (server-side via `INTERNAL_ADMIN_GRAPHQL_URL`, client-side via `NEXT_PUBLIC_ADMIN_GRAPHQL_URL`) preserved.
- Drop the conditional `Authorization: Bearer ${STRAPI_API_TOKEN}` for server requests — anonymous queries only.
- Keep the 10s `AbortSignal.timeout` ceiling. Revisit only if smoke shows admin responses flirting with the limit (see OQ5).
- Doppler `forge-web/dev` config update is operational (out-of-scope for the code change but flagged in Documentation Plan).

**Patterns to follow:**
- Existing `apps/web/src/lib/client.ts` shape — preserve the SSR/CSR URL split.

**Test scenarios:**
- Happy path: web boots locally with `INTERNAL_ADMIN_GRAPHQL_URL=http://localhost:3003/api/graphql` and successfully fires a query against admin.
- Edge case: missing env var — startup fails with a clear error referencing the new variable name (not the old one).
- Integration: the Apollo client never sets an `Authorization` header in any request path (asserted by the existing client unit tests, updated to match).

**Verification:**
- `pnpm --filter @forge/web typecheck` passes.
- `apps/web/.env.example` lists only admin-side env vars; no Strapi residue.

---

### U3. Web fragments deletion + section-component shape rewrites

**Goal:** Replace the 17 Strapi-shaped block fragments with Zod-typed admin shapes; rewrite all 17 section components to consume them; pivot the dispatcher from `__typename` to `t`.

**Requirements:** R4, R5

**Dependencies:** U1, U2

**Files:**
- Delete: `apps/web/src/lib/fragments/index.ts`
- Delete: `apps/web/src/lib/fragments/blocks.ts` (or however the 15 block fragments are organized)
- Delete: `apps/web/src/lib/fragments/watch-experience.ts`, `apps/web/src/lib/fragments/watch-video.ts` — replaced in U4
- Modify: `apps/web/src/components/sections/index.tsx` (`ExperienceSectionRenderer`: dispatch on `block.t`; remove `ComponentBlocksVideoRecommendations`/`ComponentSections*` literals)
- Modify: each of the 17 section components (`VideoHero.tsx`, `Video.tsx`, `CarouselVideo.tsx`, `MediaCollection.tsx`, `PromoBanner.tsx`, `InfoBlocks.tsx`, `CTASection.tsx`, `BibleQuotesCarousel.tsx`, `Text.tsx`, `AdventCountdown.tsx`, `EasterDates.tsx`, `RelatedQuestions.tsx`, `NavigationCarousel.tsx`, `Container.tsx`, `Section.tsx`, `QuizButton.tsx`, `VideoRecommendations.tsx`)
- Modify: `apps/web/src/components/watch/WatchSectionRenderer.tsx` (the synthetic-block dispatcher; flip from `__typename` to `t`)
- Test: per-component tests in `apps/web/src/components/sections/*.test.tsx` (only those that exist) — update fixtures to admin-shape blocks
- New shared workspace import target: `@forge/admin` (or a re-export point) exposing the Zod schemas — see OQ1

**Approach:**
- Type strategy: each component's prop becomes `block: z.infer<typeof XBlockSchema>` where `XBlockSchema` comes from `apps/admin/src/domain/blocks.ts`. Workspace-resolved import; package boundary defaults to `@forge/admin/domain/blocks` (default per OQ1).
- Dispatcher (`index.tsx`): switch on `block.t`. `default` case logs unrecognized block kind (defensive — admin's strict Zod prevents this but JSON-loaded blocks could be malformed).
- React keys flip from `block.id || block.__typename + index` to `block.sectionKey ?? index` — `sectionKey` is a stable optional string on every block in `BlocksSchema`.
- Block `videoId` references inside the renderer use a `videoMap` prop (`Map<string, Video>`) passed down from the page-level query result. Components like `VideoHero`, `CarouselVideo`, `MediaCollection` look up `videoMap.get(block.videoId)`; missing → render the empty/skeleton state.
- Container/Section recursion: both have `content: BlockSchema[]` arrays (admin's narrower scope per the schema). Recurse the dispatcher.
- Field renames absorbed in components (no shim layer): `mediaCtaLink` → `ctaLink`, `videoRef` → `videoId` (via `videoMap.get`), `sectionContent` → `content`, etc. Per the BLOCK_KIND_REFERENCE shape audit captured during the chat-panel work, the canonical Zod shape is the source of truth.

**Execution note:** Start with the dispatcher (`index.tsx`) compiling against admin types before rewriting individual components. Each component's compilation surfaces its own field-name drift; iterate component-by-component within this single unit.

**Patterns to follow:**
- `apps/admin/src/domain/blocks.ts` — canonical schemas.
- `apps/web/src/components/sections/index.tsx` (current) — dispatch shape; preserve the recursion pattern, just flip the discriminator.
- The chat-panel work's `BLOCK_KIND_REFERENCE` (in `apps/admin/src/services/experience-ai/experience-ai-chat-prompts.ts`) — reference for which fields each block kind actually carries.

**Test scenarios:**
- Happy path (per component): each section component renders correctly for a hand-crafted block fixture matching its Zod schema.
- Edge case: `videoMap` missing the referenced video for `videoHero`/`videoCarousel`/`mediaCollection` → renders skeleton/empty state, doesn't throw.
- Edge case: `Container` and `Section` with empty `content` arrays render without crashing.
- Edge case: `Section` containing a block kind not allowed at section scope (defense-in-depth) → dispatcher logs + skips.
- Edge case: unknown `t` discriminator (block JSON drift) → dispatcher renders nothing + console warning, doesn't crash the page.
- Integration: a full experience tree with all 17 block kinds renders end-to-end (uses an admin fixture or dev DB seed).

**Verification:**
- `pnpm --filter @forge/web typecheck` succeeds with zero `Component.tsx` errors.
- All existing component tests pass against admin-shape fixtures; no test imports remain from the deleted fragments.
- `apps/web/src/lib/fragments/` directory is empty (or the parent rule removes it).

---

### U4. Web `lib/content.ts` rewrite — experience + watch queries

**Goal:** Replace the 4 experience/watch queries (`GetExperience`, `GetWatchExperience`, `GetWatchSettings`, `GetRouteVideo`) with admin equivalents using `adminGraphql()`. Adjust `resolveWatchPage`, `resolveWatchVideoBySlug`, and `mergeWatchExperience` to consume the new shape.

**Requirements:** R1, R5

**Dependencies:** U1, U3

**Files:**
- Modify: `apps/web/src/lib/content.ts`
- Modify: `apps/web/src/lib/fragments/watch-experience.ts` (replace fragment-based shape with admin types if any structure remains; otherwise delete in U3)
- Modify: `apps/web/src/lib/fragments/watch-video.ts` (same — used by U5)
- Test: `apps/web/src/lib/content.test.ts` (update fixtures to admin shape)

**Approach:**
- `GetExperience` (existence check) → `experienceBySlug(slug, locale) { id }`. Returns null when the slug doesn't exist; null check replaces "array length 0" check.
- `GetWatchExperience` (full tree) → `experienceBySlug(slug, locale) { id title metaDescription ogImageUrl blocks referencedVideos { id slug locales { ... } images { ... } } }`. The `blocks: JSON` scalar is post-typed via `z.array(BlockSchema).parse(result.experienceBySlug.blocks)` (or pass-through if Apollo's typed-document-node already narrows). Page renderer receives `experienceLocale, videoMap = new Map(experienceLocale.referencedVideos.map(v => [v.id, v]))`.
- `GetWatchSettings` → two queries: `homepageExperienceLocale(locale)` + `defaultTemplateExperienceLocale(locale)`. Combine into one call site that fires both in parallel.
- `GetRouteVideo` → `videoBySlug(slug, locale) { id slug primaryLanguage { ... } locales { ... } images { ... } parents { id slug } children { id slug ... } dubs { id muxVideo { playbackId } downloads { ... } language { ... } } }`. Match the field set the route consumer reads.
- `mergeWatchExperience` survives — only the input shape changes. The `WatchBlock` synthetic-union type renames its `StrapiWatchBlock` arm to consume admin's `BlocksSchema` types.
- `PLAYER_BEARING_STRAPI_TYPES` set converts: `new Set(["ComponentSectionsVideoHero", "ComponentSectionsVideo", "ComponentSectionsVideoCarousel"])` → `new Set(["videoHero", "video", "videoCarousel"])`.
- Operation names preserved (`GetWatchExperience` etc.) for git-blame readability.

**Patterns to follow:**
- `apps/admin/schema.graphql` — wire shape for new queries.
- `apps/admin/src/graphql/types/experience.ts::referencedVideos` resolver pattern — admin already returns the JOIN result inline.

**Test scenarios:**
- Happy path: `resolveWatchPage("forgiveness", "en")` against a seeded admin DB returns `{ experience, blocks, videoMap }` with the chat-published "Welcome / Forgiveness begins here." block.
- Edge case: slug not found → returns the `isWatchPageMissingError` shape unchanged from caller's perspective.
- Edge case: experience has no blocks (chat hasn't run yet) → returns empty `blocks` array, page renders the empty-canvas state.
- Edge case: `referencedVideos` is empty (text-only experience) → `videoMap.size === 0`; renderer doesn't crash on `videoMap.get(undefined)`.
- Happy path: `resolveWatchPage("/", "en")` (homepage) calls `homepageExperienceLocale("en")`, returns the homepage experience.
- Happy path: `GetRouteVideo("forgiveness-video-slug", "en")` returns a Video with the right localized title + parents + children + dubs.
- Edge case: video has no parents/children → empty arrays, no error.
- Integration: full mergeWatchExperience round-trip — admin response shape goes in, web's synthetic `WatchBlock[]` comes out, dispatcher renders correctly.

**Verification:**
- `pnpm --filter @forge/web typecheck` succeeds for `content.ts` and consumers.
- Routes wired in U6 render a chat-published experience end-to-end.

---

### U5. Web search + recommendations + demo queries

**Goal:** Migrate the 5 remaining web operations to admin: `SemanticSearch`, `SceneRecommendations`, `GetDemoVideo`, `GetVideoBySlug`, `GetWatchVideo`/`GetWatchVideoBySlug`.

**Requirements:** R1

**Dependencies:** U1, U3

**Files:**
- Modify: `apps/web/src/lib/search.ts`
- Modify: `apps/web/src/lib/recommendations.ts`
- Modify: `apps/web/src/lib/demo-search.ts`
- Modify: `apps/web/src/lib/fragments/watch-video.ts` (or delete + inline)
- Test: `apps/web/src/lib/search.test.ts`, `apps/web/src/lib/recommendations.test.ts`, `apps/web/src/lib/demo-search.test.ts` (update fixtures)

**Approach:**
- `SemanticSearch` → `search(q, locale, type, limit, offset)` via `adminGraphql()`. Field rename. Type arg: web passes `string` ("video"|"experience") → admin enum; cast via `as HybridSearchContentType` or upgrade the call site to use admin's enum directly.
- `SceneRecommendations` → drop the raw `gql` tag, use `adminGraphql()`. `videoId: number` callsite type narrows to `string` (cuid). Web treats this as React key only, so behavior unchanged.
- `GetDemoVideo` → `videoBySlug(slug, locale)` against admin. Same as `GetRouteVideo` shape.
- `GetVideoBySlug` (recommendations sibling) → same.
- `GetWatchVideo` / `GetWatchVideoBySlug` (route-prepared but no route wiring) → migrate the operations even though they aren't dispatched today, so the cutover is clean.
- All operations use `adminGraphql()`.

**Patterns to follow:**
- `apps/admin/schema.graphql` for query shapes.
- The U4 query patterns (locale-pick server-side, `videoMap`-style hydration where blocks reference videos).

**Test scenarios:**
- Happy path (search): `searchVideos("Jesus", "en")` returns admin's hybrid-search results in the existing client-shape (top-level array of `{ id, title, ... }` mapped from admin's `HybridSearchResult`).
- Edge case (search): empty results → empty array, no error.
- Happy path (recommendations): `getSceneRecommendations("forgiveness", "en")` returns 10 results with `videoId: string` (cuid).
- Edge case (recommendations): video not found → empty array (admin's R5 swallows `VideoNotFoundError` to `[]`).
- Happy path (demo-search): demo search query returns the admin search shape; renderer displays correctly.
- Integration: the `/demo-recommendations/[slug]/[locale]` route renders end-to-end against admin.

**Verification:**
- `pnpm --filter @forge/web typecheck` clean.
- All five operations dispatch against admin in dev.

---

### U6. Web routes — single-row shape adjustments

**Goal:** Update the 4 page.tsx files that consume the rewritten queries — adjust array-vs-single, prop shapes, and React keys.

**Requirements:** R1, R5

**Dependencies:** U4, U5

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/[slug]/page.tsx`
- Modify: `apps/web/src/app/[slug]/[locale]/page.tsx`
- Modify: `apps/web/src/app/demo-search/[slug]/[locale]/page.tsx`
- Modify: `apps/web/src/app/demo-recommendations/[slug]/[locale]/page.tsx`
- Test: route-level integration tests if any (likely none in `apps/web`); rely on smoke

**Approach:**
- `experiences[]` → `experienceBySlug` single result. Drop the array-take-first pattern; replace with null-check.
- React keys: section list keys become `block.sectionKey ?? `block-${index}` ` (sectionKey is admin's stable identifier; not always present).
- `WatchPageProps` (or whatever the route's props shape is) receives `videoMap` from `lib/content.ts` and threads it to `<ExperienceSectionRenderer videoMap={videoMap} blocks={...} />`.
- Demo-recommendations page: `videoId: number` references downstream become `videoId: string` (single line change; React key only).

**Patterns to follow:**
- Existing `apps/web/src/app/[slug]/[locale]/page.tsx` — keep the resolver flow shape (try video by slug, fallback to experience by slug); only the data shape changes.

**Test scenarios:**
- Happy path: `/forgiveness/en` renders the chat-published experience with the "Welcome" text block.
- Happy path: `/` renders the homepage experience via the new `homepageExperienceLocale` query.
- Edge case: 404 on missing slug — same behavior as before, just driven by `null` instead of empty array.
- Edge case: video-template fallback path (`isVideoTemplate`) on `[slug]/[locale]` still works via the new GetRouteVideo.
- Integration smoke (per R9): each of the 5–10 surfaces listed in R9 renders correctly.

**Verification:**
- `pnpm --filter @forge/web build` succeeds.
- Manual smoke per R9 against local admin (`localhost:3003`) and local web (`localhost:3000`).

---

### U7. Cleanup + smoke + docs

**Goal:** Remove leftover Strapi-related code, run smoke, update CLAUDE.md and runbook docs.

**Requirements:** R8, R9

**Dependencies:** U2, U3, U4, U5, U6

**Files:**
- Delete: `apps/web/src/lib/fragments/` (if any files remain after U3/U4/U5)
- Modify: `apps/web/CLAUDE.md` (remove Strapi references; document the admin endpoint, env vars, dual-client mobile-only Strapi fallback)
- Modify: `CLAUDE.md` (root) — update the Architecture diagram and "Strapi" prose to reflect web-on-admin
- Modify: `apps/admin/CLAUDE.md` — note the new homepage/template queries + videoBySlug PUBLIC widening + `Video.parents`/`children` exposure
- Modify: `packages/graphql/CLAUDE.md` — note that web now uses `adminGraphql()`; mobile remains on `graphql()`; check off any "Unit 2 brief" items the cutover satisfies
- Test: nothing new — smoke is manual

**Approach:**
- Sweep for residual `STRAPI_API_TOKEN`, `INTERNAL_GRAPHQL_URL`, `NEXT_PUBLIC_GRAPHQL_URL` references in `apps/web` and remove. Keep them in `apps/mobile` (untouched).
- Run `pnpm --filter @forge/web typecheck && pnpm --filter @forge/web build && pnpm --filter @forge/web test` to confirm green.
- Operational runbook line: when this PR lands in prod, Doppler `forge-web/dev` and `forge-web/stg` and `forge-web/prd` configs need the new env vars; admin's prod URL must respond before web's new build deploys (single coordinated release).
- CLAUDE.md updates should be terse — point at this plan and the brainstorm for context.

**Patterns to follow:**
- `apps/admin/CLAUDE.md` Migration runbook section — the deployment-coordination prose pattern (env first, deploy after).

**Test scenarios:**
- Smoke per R9 — list each surface, capture screenshot or curl response, confirm the chat-published experience renders.

Test expectation: behavioral coverage delivered by U1–U6 unit tests; this unit is documentation + cleanup.

**Verification:**
- All references to Strapi env vars in `apps/web` removed.
- CLAUDE.md updates merged cleanly.
- Smoke checklist passes against local stack (admin + web running on the feature branch).

---

## System-Wide Impact

- **Interaction graph:** apps/web shifts every GraphQL outbound from Strapi to admin; admin's GraphQL receives all anonymous public read traffic that previously went to Strapi (homepage hits, watch-page hits, search, recommendations, demo surfaces). Cloudflare is in front of admin in prod. apps/mobile is unaffected.
- **Error propagation:** admin's GraphQL errors come back as Apollo errors; web's existing error.tsx boundaries pick them up. Strapi-specific error messages (e.g., `Forbidden access`) no longer happen; replace with admin's typed errors. New failure mode: anonymous request to a non-PUBLIC admin field returns 401-shape error rather than rendering — caught at the Apollo layer.
- **State lifecycle risks:** Apollo cache normalization shifts (cuid `id` strings instead of integer ids). Most pages are SSR; the in-memory cache isn't long-lived. Browser navigation between routes could surface a normalization quirk; verify in smoke.
- **API surface parity:** `apps/web` is the only consumer migrated. apps/admin's existing consumers (admin editor) are unaffected. apps/mobile reads Strapi unchanged.
- **Integration coverage:** smoke per R9. Mocked unit tests prove component-shape compatibility; full-stack render proves the page-level data flow.
- **Unchanged invariants:** admin's existing GraphQL type classification + ABAC matrix (no new ABAC paths). Strapi `apps/cms` continues running for mobile. Doppler `forge-cms` config unchanged. Codegen pipeline (`packages/graphql`) emits both factories as before — only web's choice of factory flips.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Single-PR big bang produces a broken main if tests pass but a route fails at runtime | Manual smoke per R9 is mandatory before merge; preview deploy required; stage deploy as one coordinated release with admin's matching URL/Doppler config. |
| Admin's response time on `experienceBySlug` (with `referencedVideos` JOIN) exceeds web's 10s `AbortSignal` ceiling for content-heavy experiences | Profile during smoke; if any query approaches 10s, lift the ceiling on web (revisit OQ5). Fallback: `referencedVideos` is already memoized in admin — verify the resolver doesn't re-execute the block-walk per request. |
| `videoBySlug` widening to PUBLIC unintentionally exposes a `read:videos`-restricted field via the resolver's selection set | U1 schema-test invariants must include "no admin-only ABAC field reachable via a PUBLIC query". `schema.test.ts`'s existing `embed/vector/similarit` test pattern covers this; extend to cover any new sensitive fields. |
| `Video.parents` / `Video.children` create N+1 queries on watch pages with deep relation trees | Pothos Prisma plugin handles batched JOINs via `t.relation`; verify by counting Prisma queries during smoke (the U3 spike's "max 2 queries" pattern from the admin CLAUDE.md). |
| `BlocksSchema` workspace import from `apps/admin/src/domain/blocks.ts` creates a circular dep (admin imports web? no — but a strict tsconfig may flag the cross-app import) | Default to `@forge/admin/domain/blocks` direct import; if it surfaces a circular issue, carve a `@forge/blocks` package as a one-off (see OQ1). |
| Doppler env update lands in the wrong environment (dev vs stg vs prd ordering) | Operational runbook in U7 prescribes the order: admin available at the new URL → web's Doppler config updated → web deployed. Document in U7's CLAUDE.md update. |
| Mobile builds break because `packages/graphql` codegen flips schema source mid-cutover | Codegen pipeline already supports both factories independently; verify mobile dev still boots after the PR's new `pnpm install` (smoke step in U7). |
| Cloudflare 524 timeouts on web → admin requests in prod (admin-fronted) | OQ5 — defer to smoke; if it shows up, raise the inner outbound ceiling on web AND verify admin's per-query timeouts match. |
| Apollo SSR cache divergence (server hydration mismatch with client because `id` types changed) | OQ4 — defer to smoke; existing Apollo SSR setup should handle string ids identically to int ids. |
| Web fragments deletion masks subtle field-reference assumptions (component reads a field the new shape doesn't expose) | TypeScript catches all of these at compile time — the cutover is type-driven; if `pnpm typecheck` is green, every component is consuming a field that exists in admin's shape. |

---

## Documentation / Operational Notes

- `CLAUDE.md` (root): update Architecture diagram — apps/web reads admin, not Strapi. Note that mobile still reads Strapi.
- `apps/web/CLAUDE.md` (or create one): document admin endpoint URL, env vars, anonymous-query model, the dispatch-on-`t` block renderer convention.
- `apps/admin/CLAUDE.md`: add note in Pothos type list for the new homepage/template queries, `videoBySlug` PUBLIC widening, `Video.parents`/`children` relations.
- `packages/graphql/CLAUDE.md`: update consumer table — web → adminGraphql, mobile → graphql (Strapi). Note that the dual-factory window is now bounded (until mobile cuts over).
- Operational runbook (U7): coordinate Doppler updates with the deploy. Three-step:
  1. Verify admin prod URL responds at `https://admin.jesusfilm.org/api/graphql`
  2. Update Doppler `forge-web` config across dev/stg/prd: remove Strapi vars, add admin vars
  3. Deploy `apps/web` from the merged PR
- Strapi maintenance mode: post-merge, communicate to the team that direct edits in Strapi admin no longer reach public web (only mobile). Production-edit workflows should route through admin.
- Roll-back plan: if the cutover breaks production, the `apps/web` Railway service can be reverted to the previous build (admin's GraphQL stays running). Strapi still serves the previous content. Admin-published content disappears from public web until the rollback is itself rolled forward.
- Track `Video.parents`/`children` query-count behavior during smoke. If we spot N+1, follow up by adding DataLoader-style batching per the `apps/admin/CLAUDE.md` "When to add a new loader" guidance.

---

## Sources & References

- **Brainstorm (no doc written, scope captured in plan synthesis directly):** session conversation 2026-05-08 (web-strapi-removal scope alignment)
- **Existing roadmap reference:** `apps/admin/CLAUDE.md` "What this app does" → "strategic replacement for Strapi"; R3–R8 migration window
- **Related code:** `apps/web/src/lib/`, `apps/web/src/components/sections/`, `apps/admin/src/graphql/`, `packages/graphql/src/`, `apps/admin/src/domain/blocks.ts`, `apps/admin/schema.graphql`
- **Related plans:** `docs/plans/2026-05-08-001-feat-admin-experience-ai-chat-panel-plan.md` (chat panel — landed first; the publishable surface this cutover validates against)
- **Institutional learnings:** `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`, `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md`
- **Admin reference contracts:** `apps/admin/CLAUDE.md` "Hybrid search (R4)", "Scene recommendations (R5)", "Adding a new Pothos type" three-step recipe
