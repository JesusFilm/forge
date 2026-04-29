---
date: 2026-04-28
topic: admin-core-sync-entity-coverage
---

# Admin Core Sync Entity Coverage

## Problem Frame

`apps/admin` is replacing Strapi as the system that owns Core-sourced content
inside Forge. The admin app already has a Core sync spine for languages,
countries, keywords, videos, and video dubs, but the migration is not complete
until admin can independently bring across the same Core entity coverage and
keep it fresh as Core changes.

The goal is not to preserve Strapi or copy Strapi's database shape. Strapi is a
historical reference for which Core facts were important. Admin should ingest
Core directly and map those facts into admin's changed data model in a way that
makes semantic sense for the new system.

## Requirements

**Coverage**

- R1. Admin Core sync MUST ingest Core directly and MUST NOT depend on Strapi
  APIs, Strapi database tables, or Strapi-specific content model shapes.
- R2. Admin Core sync MUST cover every Core-sourced entity class that belongs
  in the admin data model, including reference data, videos, localized video
  text, dubs/variants, downloadable assets, images, subtitles, editions, Mux
  metadata, origins, Bible data, keyword relations, country-language relations,
  and parent/child video relations.
- R3. Every Core entity or relationship considered during planning MUST be
  classified as one of:
  - mapped to an existing admin model or field,
  - added as a new admin-native model or field,
  - collapsed into a derived/admin-native representation,
  - deliberately excluded with written rationale.
- R4. Admin SHOULD avoid adding models that only mirror legacy naming when the
  domain concept is clearer in admin's language. Example: Core
  `videoVariant` maps to admin `VideoDub` because the varying axis is audio
  language.

**Freshness**

- R5. When Core changes a synced entity, the next incremental admin sync MUST
  update the corresponding admin row or relationship without requiring a full
  sync.
- R6. When Core removes or unpublishes an entity from the full result set, a
  successful full admin sync MUST mark the corresponding Core-sourced admin row
  stale/soft-deleted rather than hard-deleting it.
- R7. Sync watermarks MUST advance only after a phase completes with zero
  errors, preserving the current admin fetch-start watermark semantics.
- R8. Sync writes MUST remain idempotent: rerunning the same sync against the
  same Core data produces no duplicates and no unintended admin-owned changes.

**Locale Modeling**

- R9. Core-derived localized content SHOULD follow the same conceptual pattern
  as `Experience` / `ExperienceLocale`: a canonical parent row for stable
  non-localized identity and per-locale child rows for localized, user-facing
  content.
- R10. Video localization MUST remain first-class. Core video titles,
  descriptions, snippets, image alt text, and other locale-specific display
  fields should land on `VideoLocale` or an equivalent per-locale child model,
  not on an opaque JSON blob when the content affects public rendering,
  search, editorial review, or publish/state decisions.
- R11. Reference-data localization MUST be reviewed against the Experience
  locale standard. Low-cardinality display names may stay as locale-keyed JSON
  only when they do not need independent publish lifecycle, editorial workflow,
  embeddings, or locale-specific querying. Otherwise they should move to a
  first-class locale row.
- R12. Locale identifiers MUST use the same BCP-47 semantics used by
  `ExperienceLocale.locale`, and sync MUST preserve all locales Core returns
  rather than defaulting to English or a hardcoded locale allowlist.
- R13. Any localized Core entity that participates in semantic search or
  retrieval MUST make the locale-specific text addressable independently so
  future embeddings/search can target the user's language the way
  `ExperienceLocale` does.

**Ownership Boundaries**

- R14. Core-sourced fields remain Core-authoritative. Admin/editor/manager-owned
  rows or fields MUST NOT be overwritten by Core sync unless a separate
  ownership transfer is explicitly designed.
- R15. Existing `source = CORE` / `source = MANAGER` boundaries MUST be
  preserved or replaced only by a clearer ownership model with equivalent
  protection.
- R16. Core-derived models exposed through admin GraphQL should remain read-only
  unless a separate editor workflow intentionally claims ownership.

**Verification**

- R17. The implementation MUST include a coverage audit that can show, after a
  full sync, which approved Core entity classes and relationships are fully
  represented in admin and which are missing.
- R18. The implementation MUST verify relationship coverage, not only row
  counts. Examples include video-to-keyword, video-to-parent/child,
  country-to-language, dub-to-download, dub-to-edition, subtitle-to-edition,
  and video-to-image relationships.
- R19. The implementation MUST test incremental change propagation for at least
  one representative reference entity, one video entity, and one nested
  relationship.
- R20. The implementation MUST test full-sync soft-delete behavior for approved
  Core-sourced entity classes that can disappear from Core's full result set.
- R21. The implementation MUST test that localized Core data creates or updates
  the expected per-locale admin rows without collapsing locales together.

## Coverage Matrix

| Core concept                                                  | Admin-native target          | Current confidence                                        |
| ------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------- |
| Languages                                                     | `Language`                   | Existing phase; needs coverage audit                      |
| Countries                                                     | `Country`, `Continent`       | Existing phase; country-language coverage needs audit     |
| Country languages                                             | `CountryLanguage`            | Likely missing or incomplete                              |
| Keywords                                                      | `Keyword`                    | Existing phase; video-keyword links need audit            |
| Videos                                                        | `Video`, `VideoLocale`       | Existing phase; nested coverage incomplete                |
| Video variants                                                | `VideoDub`                   | Existing phase; edition/download/Mux coverage needs audit |
| Variant downloads                                             | `VideoDubDownload`           | Needs audit/likely expansion                              |
| Video editions                                                | `VideoEdition`               | Admin model exists; sync coverage needs audit             |
| Mux metadata                                                  | `MuxVideo`                   | Admin model exists; sync coverage needs audit             |
| Video images                                                  | `VideoImage`                 | Admin model exists; sync coverage needs audit             |
| Video subtitles                                               | `VideoSubtitle`              | Admin model exists; sync coverage needs audit             |
| Video origins                                                 | `VideoOrigin`                | Admin model exists; sync coverage needs audit             |
| Bible books/citations                                         | `BibleBook`, `BibleCitation` | Admin models exist; sync coverage needs audit             |
| Study questions                                               | `VideoStudyQuestion`         | Admin model exists; sync coverage needs audit             |
| Parent/child videos                                           | `VideoRelation`              | Admin model exists; sync coverage needs audit             |
| Audio previews                                                | TBD                          | Needs model decision                                      |
| Restrict download/view platforms, available languages, counts | TBD derived vs persisted     | Needs model decision                                      |
| Cloudflare/R2 asset objects                                   | TBD URL-only vs asset model  | Needs model decision                                      |

## Success Criteria

- A full admin Core sync can run against Core without Strapi and produce rows
  for every approved Core-sourced entity class.
- The coverage audit reports zero missing approved entity classes after a
  successful full sync.
- Localized Core content is represented in admin using the same parent/locale
  mental model as Experiences wherever the data is user-facing or retrieval-
  relevant.
- Core updates are visible in admin after the next incremental sync for
  representative top-level and nested entities.
- Core removals/unpublishes are reflected as soft-deleted/stale admin rows
  after a successful full sync.
- Admin-owned or manager-owned data is not overwritten by Core sync.
- Planning and implementation artifacts document every dropped Core field or
  collapsed concept with rationale.

## Scope Boundaries

- No Strapi dependency, Strapi cutover work, or Strapi decommission work in
  this scope.
- No consumer app migration in this scope. Consumer migration can use this work
  as a prerequisite, but does not define it.
- No mutations back to Core.
- No downloading or proxying media files unless a future admin media workflow
  explicitly requires it. Core media URLs/assets are represented as metadata.
- No compatibility schema whose only purpose is to mimic Strapi naming.

## Key Decisions

- **Entity coverage is the primary goal:** The project optimizes for bringing
  Core facts into admin completely, not merely satisfying current UI queries.
- **Admin-native model over legacy copy:** Core concepts should map into the
  admin model that best represents their domain meaning, even when names differ
  from the old sync.
- **Experience locale pattern is the standard:** For localized, user-facing
  Core content, admin should prefer canonical parent rows with first-class
  per-locale child rows, matching how `Experience` / `ExperienceLocale` works.
- **Core remains authoritative for Core-sourced facts:** Freshness flows from
  Core into admin. Admin protects non-Core ownership boundaries from sync
  overwrites.
- **Historical sync is evidence, not dependency:** Prior sync requirements and
  code help identify coverage, but new work should not preserve old system
  constraints.

## Dependencies / Assumptions

- Core's GraphQL API remains the authoritative source for the entities in this
  scope.
- Admin's existing Core sync phases, watermarks, lock, and soft-delete semantics
  are the starting point.
- Some Core concepts may need admin schema changes after the mapping inventory.

## Outstanding Questions

### Resolve Before Planning

_(none)_

### Deferred to Planning

- [Affects R2-R4][Technical] For each Core payload currently absent from admin
  sync, determine whether admin already has the correct model/field or needs a
  new admin-native representation.
- [Affects R9-R13][Technical] Audit every localized Core field and decide
  whether it belongs in a first-class locale child table, can remain
  locale-keyed JSON, or should be represented another way.
- [Affects R2][Needs research] Confirm Core query shapes for images,
  subtitles, editions, downloads, Mux data, origins, Bible data, parent/child
  relations, study questions, country-language relationships, and audio
  previews.
- [Affects R5-R7][Technical] Confirm which Core entities support `updatedAt`
  filtering and which must always run as full-sync reference phases.
- [Affects R12-R13][Technical] Decide whether the coverage audit compares
  direct Core counts during sync, persists last-seen Core counts in sync stats,
  or exposes a separate admin diagnostic report.
- [Affects R2][Technical] Decide whether platform restrictions, available
  language lists, and count fields should be stored directly, derived from
  related rows, or omitted with rationale.
- [Affects R2][Technical] Decide whether Core/R2/Cloudflare asset objects need
  first-class admin models or whether admin should store normalized URL and
  metadata fields only.

## Next Steps

-> `/ce:plan` for structured implementation planning. Planning should begin
with the Core-to-admin coverage inventory, then split schema changes, sync
phase expansion, and coverage verification into PR-sized units.
