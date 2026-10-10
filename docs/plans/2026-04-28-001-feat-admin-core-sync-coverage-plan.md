---
title: Admin Core Sync Entity Coverage
type: feat
status: complete
date: 2026-04-28
origin: docs/brainstorms/2026-04-28-admin-core-sync-entity-coverage-requirements.md
---

# Admin Core Sync Entity Coverage

## Overview

Expand `apps/admin` Core sync from its current spine into a complete
admin-native projection of Core-sourced reference and video data. The work
starts with a field/entity inventory, then updates admin's model where Core
concepts are currently missing or too loosely represented, then expands sync
phases and adds a coverage audit that proves admin can ingest Core directly
without relying on Strapi.

The most important modeling direction is locale parity with Experiences:
localized user-facing Core content should be addressable as per-locale rows,
not collapsed into opaque JSON blobs when it affects rendering, search,
editorial review, or future embeddings.

## Problem Frame

Admin already has a Core sync orchestrator, watermarks, phase runners, and a
basic Core-to-admin video/reference mapping. It does not yet prove full Core
entity coverage. The previous Core sync captured more nested video/reference
data than admin currently imports, including country-language metadata, audio
previews, video origins, editions, images, subtitles, Bible citations, study
questions, keyword links, parent/child relations, Mux metadata, and dub
downloads.

This plan uses the historical sync only as coverage evidence. The target shape
is admin-native, direct-from-Core ingestion with freshness and ownership
boundaries preserved (see origin:
`docs/brainstorms/2026-04-28-admin-core-sync-entity-coverage-requirements.md`).

## Requirements Trace

- R1. Admin sync reads Core directly and introduces no Strapi dependency.
- R2-R4. Every Core entity/relationship is inventoried and either mapped,
  added, collapsed, or deliberately excluded with rationale.
- R5-R8. Incremental and full sync freshness semantics remain intact:
  idempotent upsert, watermark-on-zero-errors, soft-delete on successful full
  sync, no unintended admin-owned writes.
- R9-R13. Locale modeling follows the Experience pattern where user-facing or
  retrieval-relevant content needs first-class locale rows.
- R14-R16. Core ownership boundaries remain explicit and Core-derived GraphQL
  remains read-only unless a separate editorial workflow takes ownership.
- R17-R21. Coverage verification proves both row and relationship coverage,
  including localized row behavior.

## Scope Boundaries

- No Strapi runtime dependency, Strapi cutover, or Strapi decommission work.
- No consumer app migration. This work can unblock consumer migration, but
  does not change `apps/web`, `apps/mobile`, or `packages/graphql`.
- No mutations back to Core.
- No media downloading/proxying. Store Core media metadata and URLs only.
- No compatibility schema whose only purpose is to mimic old Strapi names.

### Deferred to Separate Tasks

- Consumer-facing admin GraphQL contract expansion beyond fields needed to
  validate Core coverage.
- Editorial write workflows for Core-derived video/reference data.
- Strapi removal and operational decommissioning.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/services/core-sync/orchestrator.ts` — phase order, DB lock,
  fetch-start watermarks, post-phase `ANALYZE`, zero-error watermark
  advancement.
- `apps/admin/src/services/core-sync/phases/sync-languages.ts` — existing
  paginated language phase, Zod page validation, page transaction, full-sync
  soft-delete guard.
- `apps/admin/src/services/core-sync/phases/sync-countries.ts` — country +
  continent upsert pattern; currently does not represent full
  country-language metadata.
- `apps/admin/src/services/core-sync/phases/sync-videos.ts` — current video +
  `VideoLocale` sync; already uses per-locale rows for title, description,
  snippet, and image alt text.
- `apps/admin/src/services/core-sync/phases/sync-dubs.ts` — current
  Core `videoVariant` → admin `VideoDub` translation; currently missing full
  edition, Mux, and download coverage.
- `apps/admin/src/services/core-sync/schemas/*.ts` — runtime Zod validation
  for Core payloads.
- `apps/admin/prisma/schema.prisma` — existing admin-native models for
  `Video`, `VideoLocale`, `VideoDub`, `VideoDubDownload`, `VideoEdition`,
  `MuxVideo`, `VideoSubtitle`, `VideoImage`, `VideoOrigin`,
  `CountryLanguage`, `VideoKeyword`, `BibleBook`, `BibleCitation`,
  `VideoStudyQuestion`, and `VideoRelation`.
- `apps/admin/src/graphql/types/video.ts` — read-only public-shape GraphQL
  types for current video surface.
- `apps/cms/src/api/core-sync/services/sync-videos.ts` and
  `apps/cms/src/api/core-sync/services/sync-video-variants.ts` — historical
  Core query coverage and per-page relation processing evidence.

### Institutional Learnings

- `docs/solutions/cms/core-sync-incremental-delta-sync.md` — per-phase
  watermark table, advance only on zero errors, soft-delete only on full sync.
- `docs/solutions/cms/core-sync-per-page-upsert-pattern.md` — stream/page
  writes instead of collecting all Core data in memory; avoid full table scans
  inside pagination loops.
- `docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md` — avoid
  per-row update round trips at high volume; keep batch/update strategy in
  mind if Prisma transactions become too slow for large phases.
- `apps/admin/CLAUDE.md` — Experience locale model, Core source ownership,
  GraphQL type classification, and add-new-entity conventions.

### External References

No external research was needed for the plan structure. The work follows local
Core sync and admin data-model patterns. Exact Core GraphQL field support is
intentionally handled in Unit 0 against the existing generated Core query
types and, if necessary, current Core introspection during implementation.

## Key Technical Decisions

- **Inventory first:** Do not start with schema edits. First produce a
  Core-to-admin coverage matrix that classifies every Core concept and names
  the accepted representation or exclusion rationale.
- **Experience locale pattern is the standard for user-facing content:**
  `VideoLocale` remains the home for localized video display text. Localized
  study questions should move away from `Json` text maps toward first-class
  per-locale rows unless Unit 0 proves they are not user-facing in admin.
- **Reference display-name JSON remains acceptable by default:** `Language`,
  `Country`, `Continent`, `BibleBook`, and possibly similar low-cardinality
  reference display names may keep locale-keyed JSON because they do not have
  independent publish lifecycle or embeddings today. Unit 0 must explicitly
  re-validate this for each localized reference concept.
- **Asset objects are metadata, not storage ownership:** Core image, subtitle,
  Mux, and download data should land as normalized metadata/URL rows. Admin
  should not download or re-host assets in this scope.
- **Separate heavy video and dub coverage:** Video-page nested entities
  (images, subtitles, Bible citations, origins, keyword links, child links,
  study questions) expand in the videos phase. Variant-specific entities
  (editions, Mux metadata, downloads) expand in the dubs phase, with shared
  helpers where the same edition appears in both.
- **Coverage audit is a product artifact, not only tests:** The final
  implementation should produce an operator/developer-facing diagnostic report
  that can be run after sync and reviewed before Strapi deletion work begins.
- **Dependent row lifecycle must be explicit:** Some child/join tables do not
  currently carry `coreId`, `source`, or `deletedAt`. Unit 0/1 must decide, per
  table, whether Core-sourced dependent rows need their own provenance and
  stale state, or whether they are always reconstructed from their parent
  during sync.

## Open Questions

### Resolved During Planning

- **Should localized Core content mirror Experience locale modeling?**
  Yes. User-facing or retrieval-relevant localized Core content should use
  canonical parent rows plus first-class per-locale child rows where the
  concept needs more than a display-name map.
- **Should this preserve Strapi compatibility?**
  No. Strapi is only a historical coverage reference.

### Deferred to Implementation

- **Exact Core field availability:** Confirm against current Core query types
  or live introspection during Unit 0. The plan names known historical fields,
  but implementation should verify the current contract before writing sync
  code.
- **Batch performance thresholds:** Start with the current per-page Prisma
  transaction pattern. If large nested phases are too slow, apply the existing
  bulk update lesson with a localized raw-SQL service path.
- **GraphQL exposure breadth:** Keep GraphQL read exposure minimal for
  verification unless a field is already part of the admin video read model.
- **Child/join row staleness strategy:** Relation tables such as
  `VideoKeyword`, `VideoRelation`, `CountryLanguage`, and child rows such as
  `VideoDubDownload` may need explicit provenance or may be safely
  delete-and-rebuilt under a processed parent. Unit 0 must classify each one
  before Unit 1 edits the schema.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```mermaid
flowchart TB
  Core["Core GraphQL"]
  Inventory["Unit 0 coverage inventory"]
  Schema["Admin Prisma model updates"]
  Sync["Core sync phase expansion"]
  Audit["Coverage audit/report"]
  AdminDB["Admin Postgres"]
  GraphQL["Admin GraphQL read surface"]

  Core --> Inventory
  Inventory --> Schema
  Inventory --> Sync
  Schema --> Sync
  Sync --> AdminDB
  Core --> Audit
  AdminDB --> Audit
  AdminDB --> GraphQL
```

Locale modeling decision matrix:

| Data shape             | Default admin representation                                                                 | Rationale                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Video display text     | `VideoLocale` row                                                                            | User-facing, searchable, locale-specific                                                                                      |
| Study question text    | Per-locale row or refactored `VideoStudyQuestion` row with locale                            | User-facing and ordered per video                                                                                             |
| Reference display name | Locale-keyed JSON unless requirements exceed display                                         | Low-cardinality, no publish lifecycle                                                                                         |
| Subtitle asset         | `VideoSubtitle` row keyed by Core subtitle id, linked to video + language + required edition | Editions classify subtitle tracks; admin intentionally omits Core subtitles without an edition instead of loosening the model |
| Dub/audio              | `VideoDub` row keyed by variant + language                                                   | Audio-language-specific media entity                                                                                          |

## Implementation Units

- [x] **Unit 0: Core-to-Admin Coverage Inventory**

**Goal:** Produce the authoritative mapping matrix before changing schema or
sync behavior.

**Requirements:** R1-R4, R9-R13, R17-R18

**Dependencies:** None

**Files:**

- Create: `docs/plans/admin-core-sync-coverage-inventory.md`
- Modify: `docs/plans/2026-04-28-001-feat-admin-core-sync-coverage-plan.md`
- Reference: `apps/cms/src/api/core-sync/services/sync-videos.ts`
- Reference: `apps/cms/src/api/core-sync/services/sync-video-variants.ts`
- Reference: `apps/cms/src/api/core-sync/gql/graphql.ts`
- Reference: `apps/admin/prisma/schema.prisma`
- Reference: `apps/admin/src/services/core-sync/phases/`

**Approach:**

- Inventory historical Core query fields for languages, countries, keywords,
  videos, Bible books, video variants/dubs, and nested relations.
- Compare each concept to the current admin Prisma model.
- Classify every concept as existing model/field, schema addition, derived
  field, or excluded with rationale.
- Add a locale-specific column to the matrix: parent/locale row, JSON display
  map, language-specific media row, or non-localized.
- Update this plan if Unit 0 discovers a major scope correction, such as a Core
  field that no longer exists or a missing admin concept that requires a new
  phase.

**Execution note:** Characterization-first. The inventory is the guardrail for
the rest of the work.

**Patterns to follow:**

- Coverage matrix style from the origin requirements document.
- Query evidence from historical `apps/cms/src/api/core-sync/gql/graphql.ts`.

**Test scenarios:**

- Test expectation: none -- this is a planning/research artifact. Its
  verification is reviewer completeness, not automated behavior.

**Verification:**

- Inventory lists every known Core concept in the origin coverage matrix.
- Inventory explicitly decides locale representation for every localized Core
  field.
- Inventory identifies which later units own every approved addition.

- [x] **Unit 1: Schema and Domain Model Alignment**

**Goal:** Update admin's Prisma/domain model so approved Core concepts have an
admin-native home before sync writes target them.

**Requirements:** R2-R4, R9-R16

**Dependencies:** Unit 0

**Files:**

- Modify: `apps/admin/prisma/schema.prisma`
- Create: `apps/admin/prisma/migrations/<next>_admin_core_sync_coverage/migration.sql`
- Modify: `apps/admin/src/graphql/types/video.ts`
- Modify: `apps/admin/src/graphql/types/reference.ts`
- Modify: `apps/admin/src/graphql/schema.test.ts`
- Modify: `apps/admin/src/graphql/classification.test.ts`
- Modify: `apps/admin/CLAUDE.md`
- Test: `apps/admin/src/graphql/schema.test.ts`
- Test: `apps/admin/src/graphql/classification.test.ts`

**Approach:**

- Add or adjust only the schema pieces approved by Unit 0.
- Likely changes to consider:
  - Add missing country-language metadata (`displaySpeakers`, `primary`,
    `order`) if Core still provides it.
  - Add language audio preview representation if still needed.
  - Refactor `VideoStudyQuestion` from a locale-keyed JSON text map to a
    first-class per-locale row shape if confirmed user-facing.
  - Add Core provenance/lifecycle fields to dependent rows that need
    independent freshness checks, especially child rows with Core IDs such as
    downloads, images, subtitles, study questions, and Bible citations.
  - For pure join rows without independent Core identity, document whether
    they are reconstructed from the processed parent instead of soft-deleted
    independently.
  - Add missing Core fields on existing models where the model already exists
    but coverage is incomplete, such as subtitle `primary`/`value`, image
    rendition fields, video origin `description`, dub `brightcoveId`,
    download `bitrate`/`version`, Mux readiness/downloadability fields, or
    video `publishedAt`/platform restriction representation.
  - Keep reference name JSON maps only where Unit 0 confirms they are simple
    display metadata.
- Keep Core-derived GraphQL fields read-only and type-classified as
  `public-shape` unless a field is operational-only and should stay internal.
- Avoid adding GraphQL fields for internal sync bookkeeping unless needed for
  diagnostics.

**Patterns to follow:**

- `Experience` / `ExperienceLocale` parent-child locale split in
  `apps/admin/prisma/schema.prisma`.
- `Video` / `VideoLocale` existing split in `apps/admin/prisma/schema.prisma`.
- GraphQL public-shape classification in `apps/admin/src/graphql/types/video.ts`.
- Migration comments and append-only migration convention in `apps/admin/CLAUDE.md`.

**Test scenarios:**

- Happy path: Prisma schema exposes the approved new/changed fields and keeps
  existing model names stable where Unit 0 did not approve a rename.
- Happy path: approved Core-owned child rows have enough identity/provenance to
  be updated idempotently or are documented as parent-reconstructed joins.
- Happy path: GraphQL schema exposes approved public read fields and omits
  internal-only sync fields.
- Edge case: schema leak test still rejects vector/embedding/internal sync
  fields where they should not be public.
- Integration: classification test passes for any new Pothos objects and
  relations added for Core-derived public shapes.

**Verification:**

- Admin schema can support every approved Core concept from Unit 0.
- Locale-sensitive approved fields have first-class locale representation where
  required by the inventory.
- No generated outputs are hand-edited.
- Implemented in `apps/admin/prisma/migrations/0007_admin_core_sync_coverage/migration.sql`.
- `apps/admin/CLAUDE.md` required no update because the existing append-only
  migration, GraphQL classification, and Core ownership conventions still
  covered the changes.
- Verified with `pnpm --filter @forge/admin exec prisma format`,
  `pnpm --filter @forge/admin db:generate`,
  `DATABASE_URL='postgresql://user:pass@localhost:5432/forge_admin' pnpm --filter @forge/admin exec prisma validate`,
  `pnpm --filter @forge/admin test -- src/graphql/schema.test.ts src/graphql/classification.test.ts`,
  and `pnpm --filter @forge/admin typecheck`.

- [x] **Unit 2: Core Query Schemas and Transform Helpers**

**Goal:** Expand Core query documents, Zod schemas, and pure transforms so sync
phases can parse and normalize the approved payloads safely.

**Requirements:** R1-R5, R8-R13, R17-R19, R21

**Dependencies:** Units 0-1

**Files:**

- Modify: `apps/admin/src/services/core-sync/phases/sync-languages.ts`
- Modify: `apps/admin/src/services/core-sync/phases/sync-countries.ts`
- Modify: `apps/admin/src/services/core-sync/phases/sync-videos.ts`
- Modify: `apps/admin/src/services/core-sync/phases/sync-dubs.ts`
- Modify: `apps/admin/src/services/core-sync/schemas/language.ts`
- Modify: `apps/admin/src/services/core-sync/schemas/country.ts`
- Modify: `apps/admin/src/services/core-sync/schemas/video.ts`
- Modify: `apps/admin/src/services/core-sync/schemas/dub.ts`
- Create: `apps/admin/src/services/core-sync/transforms.ts`
- Modify: `apps/admin/src/services/core-sync/transforms.test.ts`
- Test: `apps/admin/src/services/core-sync/transforms.test.ts`

**Approach:**

- Extend Core queries only for fields approved by Unit 0.
- Keep parsing strict enough to catch contract drift, but allow nullable fields
  where Core legitimately omits optional data.
- Move reusable pure transforms out of phase files into
  `transforms.ts`, including locale grouping, reference name maps, video label
  mapping, image rendition normalization, study-question locale normalization,
  and platform enum normalization if used.
- Treat duplicate localized values deterministically and document the chosen
  policy in transform tests.
- Ensure BCP-47 comes from synced `Language` data where possible. When Core
  gives only language IDs, resolve to admin `Language.bcp47` before creating
  per-locale rows.

**Patterns to follow:**

- Existing Zod schemas in `apps/admin/src/services/core-sync/schemas/`.
- Existing transform golden tests in
  `apps/admin/src/services/core-sync/transforms.test.ts`.
- Zod error handling guidance from
  `docs/solutions/security-issues/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md`.

**Test scenarios:**

- Happy path: Core localized arrays with `en` and `fr` values transform into
  two locale outputs without merging languages.
- Happy path: Core `videoVariant` payload with edition, Mux, and downloads
  transforms into dub, edition, Mux, and download write payloads.
- Happy path: Core video payload with images, subtitles, Bible citations,
  keywords, study questions, and children transforms into separate normalized
  groups.
- Edge case: duplicate localized values for the same locale follow the
  documented deterministic policy.
- Edge case: optional nested objects missing from Core produce omitted
  relations rather than invalid writes.
- Error path: malformed nested payload increments parse errors without echoing
  raw user-controlled values in thrown errors.

**Verification:**

- Approved Core payloads have Zod coverage.
- Pure transforms cover locale grouping and relation normalization before DB
  writes are expanded.

- [x] **Unit 3: Reference Phase Coverage**

**Goal:** Complete Core-sourced reference coverage for languages, countries,
continents, country-language relationships, keywords, and any approved audio
preview/reference additions.

**Requirements:** R1-R8, R11-R15, R17-R21

**Dependencies:** Units 0-2

**Files:**

- Modify: `apps/admin/src/services/core-sync/phases/sync-languages.ts`
- Modify: `apps/admin/src/services/core-sync/phases/sync-countries.ts`
- Modify: `apps/admin/src/services/core-sync/phases/sync-keywords.ts`
- Modify: `apps/admin/src/services/core-sync/orchestrator.ts`
- Modify: `apps/admin/src/services/core-sync/schemas/language.ts`
- Modify: `apps/admin/src/services/core-sync/schemas/country.ts`
- Modify: `apps/admin/src/services/core-sync/schemas/keyword.ts`
- Test: `apps/admin/src/services/core-sync/phases/sync-languages.test.ts`
- Create: `apps/admin/src/services/core-sync/phases/sync-countries.test.ts`
- Create: `apps/admin/src/services/core-sync/phases/sync-keywords.test.ts`

**Approach:**

- Extend reference phases to write approved missing fields and relationships.
- Country-language sync should replace the existing relation set for each
  processed country inside the page transaction, while preserving historical
  rows outside an incremental page.
- For full sync, soft-delete Core-sourced reference rows and relation rows only
  after the phase succeeds and the first full page/result is non-empty.
- For reference data that lacks Core `updatedAt` filtering, document and keep
  full-sync behavior for that phase; do not fake incremental support.
- Ensure reference row updates do not overwrite `source = MANAGER` rows if any
  manager-owned reference rows are possible.

**Patterns to follow:**

- `syncLanguages` page loop and soft-delete guard.
- `syncCountries` continent upsert pattern.
- `docs/solutions/cms/core-sync-incremental-delta-sync.md` for entities that
  cannot run true delta sync.

**Test scenarios:**

- Happy path: country sync writes country, continent, and country-language
  rows including approved metadata fields.
- Happy path: language sync writes audio preview data if Unit 0 approves it.
- Happy path: keyword sync preserves language relation resolution by Core
  language ID.
- Edge case: country with no continent still syncs without FK failure.
- Edge case: country-language references a missing language; policy from Unit
  0 is applied consistently (skip relation with warning or count error).
- Error path: parse failure increments errors and prevents watermark
  advancement.
- Integration: full sync soft-deletes stale Core reference rows after success
  and skips soft-delete when the first result is empty.

**Verification:**

- Reference phases cover approved entity/relationship inventory items.
- Incremental/full phase semantics match the orchestrator contract.

- [x] **Unit 4: Video Phase Nested Coverage**

**Goal:** Expand video sync to cover approved nested video entities and
relationships beyond the current `Video` + `VideoLocale` baseline.

**Requirements:** R1-R21

**Dependencies:** Units 0-3

**Files:**

- Modify: `apps/admin/src/services/core-sync/phases/sync-videos.ts`
- Modify: `apps/admin/src/services/core-sync/schemas/video.ts`
- Modify: `apps/admin/src/services/core-sync/transforms.ts`
- Modify: `apps/admin/src/services/core-sync/types.ts`
- Create: `apps/admin/src/services/core-sync/phases/sync-videos.test.ts`
- Modify: `apps/admin/src/graphql/types/video.ts`
- Test: `apps/admin/src/services/core-sync/phases/sync-videos.test.ts`
- Test: `apps/admin/src/graphql/schema.test.ts`

**Approach:**

- Keep existing video canonical fields and `VideoLocale` writes, but expand
  writes for approved nested data:
  - `VideoOrigin`
  - `VideoImage`
  - `VideoSubtitle`
  - `VideoEdition` discovered through subtitles and reused by dubs/variants
  - `BibleBook` / `BibleCitation`
  - `VideoKeyword`
  - `VideoStudyQuestion`
  - `VideoRelation` for parent/child links
  - any approved platform restrictions, available-language data, or count data
- Use per-page transactions. Upsert shared low-cardinality rows before
  dependent rows in the same page, then resolve IDs with targeted `whereIn`
  lookups or the Prisma equivalent.
- Replace relation sets for the processed video where Core provides the full
  nested set. For incremental sync, only replace relations for videos returned
  in the delta page.
- Preserve locale behavior:
  - video display text lands in `VideoLocale`;
  - study questions use the approved per-locale representation;
  - reference display names stay JSON only where Unit 0 approved that.
- Parent/child links may require a second pass after all videos in the page are
  upserted. Missing child IDs should be tracked as coverage misses rather than
  causing unrelated video content to fail unless Unit 0 decides otherwise.

**Patterns to follow:**

- Historical page relation processing in
  `apps/cms/src/api/core-sync/services/sync-videos.ts`.
- Existing admin `syncVideos` transaction and `source === "MANAGER"` guard.
- Experience locale modeling in `apps/admin/prisma/schema.prisma`.

**Test scenarios:**

- Happy path: one Core video with two locales writes one `Video` and two
  `VideoLocale` rows.
- Happy path: one Core video with origin, images, subtitles, Bible citations,
  keywords, study questions, and children writes all approved related rows.
- Happy path: a localized study question creates/updates the expected
  per-locale row and preserves order.
- Edge case: incremental sync for a single changed video replaces that video's
  nested relation set without deleting unrelated videos' relations.
- Edge case: missing referenced keyword/language/Bible book follows the Unit 0
  policy and is visible in stats/audit.
- Error path: invalid nested payload fails the affected page or item according
  to the selected policy and does not advance the phase watermark.
- Integration: full sync soft-deletes stale Core videos and approved dependent
  Core rows that disappeared from the full Core result set.

**Verification:**

- Video phase imports every approved video-side Core concept from Unit 0.
- Localized video content remains first-class and BCP-47-addressable.

- [x] **Unit 5: Dub Phase Edition, Mux, and Download Coverage**

**Goal:** Complete `videoVariant`/dub coverage, including edition, Mux metadata,
and download assets.

**Requirements:** R1-R8, R14-R21

**Dependencies:** Units 0-4

**Files:**

- Modify: `apps/admin/src/services/core-sync/phases/sync-dubs.ts`
- Modify: `apps/admin/src/services/core-sync/schemas/dub.ts`
- Modify: `apps/admin/src/services/core-sync/transforms.ts`
- Create: `apps/admin/src/services/core-sync/phases/sync-dubs.test.ts`
- Modify: `apps/admin/src/graphql/types/video.ts`
- Test: `apps/admin/src/services/core-sync/phases/sync-dubs.test.ts`
- Test: `apps/admin/src/graphql/schema.test.ts`

**Approach:**

- Extend the Core variants query to include approved edition, Mux, and download
  fields.
- Upsert `VideoEdition` and `MuxVideo` before `VideoDub`, then upsert
  `VideoDubDownload` rows for each processed dub.
- Replace the download set for a processed dub when Core provides the full set.
  Preserve downloads for dubs not present in an incremental page.
- Keep the domain translation explicit: Core `videoVariant` becomes admin
  `VideoDub`; downloads remain child rows of `VideoDub`.
- Preserve `source = MANAGER` protection on existing manager-owned dubs.

**Patterns to follow:**

- Current `syncDubs` language/video lookup and transaction shape.
- Historical edition/Mux/download flow in
  `apps/cms/src/api/core-sync/services/sync-video-variants.ts`.
- BigInt exposure and `lengthInMilliseconds` handling in
  `apps/admin/src/graphql/types/video.ts`.

**Test scenarios:**

- Happy path: Core variant with edition, Mux, and two downloads writes
  `VideoEdition`, `MuxVideo`, `VideoDub`, and two `VideoDubDownload` rows.
- Happy path: changed Core variant updates the dub and replaces its download
  set on incremental sync.
- Edge case: variant references a video not yet present; phase records a
  recoverable error or skip according to current policy and does not corrupt
  other page rows.
- Edge case: variant has no language, edition, Mux, or downloads; approved
  nullable behavior is applied without FK failure.
- Error path: malformed download payload increments errors and prevents
  watermark advancement.
- Integration: full sync soft-deletes stale Core dubs and approved dependent
  download rows after success.

**Verification:**

- Dub phase covers approved variant-side Core concepts and preserves
  admin-native naming.

- [x] **Unit 6: Coverage Audit and Sync Diagnostics**

**Goal:** Add a diagnostic layer that proves entity and relationship coverage
after a full sync.

**Requirements:** R17-R21

**Dependencies:** Units 0-5

**Files:**

- Create: `apps/admin/src/services/core-sync/coverage-audit.ts`
- Create: `apps/admin/src/services/core-sync/coverage-audit.test.ts`
- Modify: `apps/admin/src/services/core-sync/orchestrator.ts`
- Modify: `apps/admin/src/services/core-sync/watermark.ts`
- Modify: `apps/admin/src/graphql/queries/sync-status.ts`
- Modify: `apps/admin/src/app/dashboard/ops-data.ts`
- Test: `apps/admin/src/services/core-sync/coverage-audit.test.ts`
- Test: `apps/admin/src/services/core-sync/orchestrator.test.ts`
- Test: `apps/admin/src/graphql/schema.test.ts`

**Approach:**

- Represent approved coverage items from Unit 0 as auditable checks.
- Compare Core-observed counts/relationship counts from the current run with
  admin persisted counts where possible. For checks that cannot cheaply query
  Core live, use last-run sync stats plus admin row counts and label the
  confidence level.
- Include both row checks and relationship checks:
  - videos, locales, images, subtitles, Bible citations, study questions,
    keywords, relations;
  - dubs, downloads, editions, Mux;
  - countries, country-language relations, keywords/languages.
- Store or expose enough audit output for operators/developers to see missing
  classes before any Strapi deletion work.
- Keep audit failures separate from phase parse/write errors unless the audit
  itself is made a blocking post-phase gate. Initial recommendation: report
  audit failures without advancing a separate "coverage complete" status, but
  do not retroactively roll back sync data.

**Patterns to follow:**

- `getSyncStatus` / `systemStatus` pattern in
  `apps/admin/src/graphql/queries/sync-status.ts`.
- Existing dashboard operations read model in
  `apps/admin/src/app/dashboard/ops-data.ts`.
- Watermark stats storage in `apps/admin/src/services/core-sync/watermark.ts`.

**Test scenarios:**

- Happy path: audit reports all approved entity classes covered when Core and
  admin counts match.
- Happy path: audit reports relationship coverage for at least video-keyword,
  video-child, country-language, dub-download, subtitle-edition, and
  video-image checks.
- Edge case: an approved entity class has zero Core rows; audit distinguishes
  "valid zero" from "missing query/check".
- Error path: Core count fetch fails; audit surfaces diagnostic failure without
  corrupting sync state.
- Integration: `systemStatus` exposes latest coverage audit status without
  exposing internal-only sync fields on content GraphQL types.

**Verification:**

- Developers can run/review a coverage report that identifies missing approved
  Core entity classes and relationships.
- Coverage status is visible from admin operational surfaces.

- [x] **Unit 7: Documentation and Operational Runbook**

**Goal:** Update the durable docs so future agents and operators understand the
expanded Core sync model, locale decisions, and audit expectations.

**Requirements:** R1-R21

**Dependencies:** Units 0-6

**Files:**

- Modify: `apps/admin/CLAUDE.md`
- Modify: `apps/admin/AGENTS.md`
- Create: `docs/solutions/platform/admin-core-sync-entity-coverage.md`
- Modify: `docs/roadmap/platform/feat-109-admin-core-sync-entity-coverage.md`

**Approach:**

- Document the final Core-to-admin mapping table, especially where names differ
  from Core.
- Document locale modeling rules:
  - first-class locale rows for user-facing/retrieval content;
  - JSON maps only for approved low-cardinality display references.
- Document operational expectations for full sync, incremental sync,
  soft-delete, source ownership, and coverage audit review.
- Mark roadmap ticket complete only after implementation and verification.

**Patterns to follow:**

- Existing admin playbook sections in `apps/admin/CLAUDE.md`.
- Solution note style in `docs/solutions/platform/`.

**Test scenarios:**

- Test expectation: none -- documentation-only unit.

**Verification:**

- A future agent can identify where each Core entity lands in admin and how to
  extend the sync without re-opening the same modeling questions.

## System-Wide Impact

- **Interaction graph:** Core GraphQL feeds admin sync phases; sync writes to
  admin Postgres; operational status and coverage audit surface through admin
  GraphQL/dashboard read models. Consumer apps remain untouched.
- **Error propagation:** Phase parse/write errors increment phase stats and
  block watermark advancement. Coverage audit failures report diagnostic gaps
  separately from write failures unless later implementation deliberately makes
  them blocking.
- **State lifecycle risks:** Incremental pages must replace nested relations
  only for processed parent entities. Full-sync soft-delete must not run when
  the first full result is unexpectedly empty.
- **API surface parity:** Public content GraphQL remains read-only for
  Core-derived entities. Any added fields should follow public-shape
  classification and avoid internal sync metadata.
- **Integration coverage:** Unit tests prove transforms and phase writes;
  coverage-audit tests prove row and relationship checks; at least one
  integration path should exercise status exposure.
- **Unchanged invariants:** No Strapi runtime dependency, no Core mutations,
  no media download/proxying, no overwriting `source = MANAGER` rows.

## Risks & Dependencies

| Risk                                                                | Mitigation                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Core query shape has drifted from historical sync                   | Unit 0 verifies current Core contract before schema/sync edits                                         |
| Blindly copying old schema names reintroduces legacy coupling       | Unit 0 classification requires admin-native target and rationale                                       |
| Locale data collapses into JSON and becomes hard to search later    | Unit 1 uses Experience locale standard for user-facing/retrieval content                               |
| Nested relation replacement deletes data during incremental sync    | Units 4-5 replace nested relation sets only for parents returned in the delta                          |
| Child rows without provenance cannot satisfy freshness requirements | Unit 0/1 classifies each dependent table and adds provenance or parent-rebuild semantics               |
| Large phases become slow with per-row Prisma upserts                | Start with existing pattern; apply documented bulk SQL pattern if implementation profiling requires it |
| Coverage audit becomes noisy or untrusted                           | Unit 6 labels confidence levels and distinguishes valid zero counts from missing checks                |

## Documentation / Operational Notes

- Update admin agent docs with the final Core-to-admin entity mapping.
- Add a solution note after implementation so future Core sync work preserves
  locale modeling and coverage-audit conventions.
- Operators should review coverage audit output after full sync before any
  future Strapi deletion or consumer cutover work.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-28-admin-core-sync-entity-coverage-requirements.md](../brainstorms/2026-04-28-admin-core-sync-entity-coverage-requirements.md)
- **Roadmap ticket:** [docs/roadmap/platform/feat-109-admin-core-sync-entity-coverage.md](../roadmap/platform/feat-109-admin-core-sync-entity-coverage.md)
- Related code: `apps/admin/src/services/core-sync/orchestrator.ts`
- Related code: `apps/admin/src/services/core-sync/phases/sync-videos.ts`
- Related code: `apps/admin/src/services/core-sync/phases/sync-dubs.ts`
- Related code: `apps/admin/prisma/schema.prisma`
- Historical coverage evidence: `apps/cms/src/api/core-sync/services/sync-videos.ts`
- Historical coverage evidence: `apps/cms/src/api/core-sync/services/sync-video-variants.ts`
- Institutional learning: `docs/solutions/cms/core-sync-incremental-delta-sync.md`
- Institutional learning: `docs/solutions/cms/core-sync-per-page-upsert-pattern.md`
- Institutional learning: `docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md`
