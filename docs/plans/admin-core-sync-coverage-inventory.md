---
date: 2026-04-28
scope: feat-109-admin-core-sync-entity-coverage
status: complete-for-unit-0
---

# Admin Core Sync Coverage Inventory

This inventory is Unit 0 for
`docs/plans/2026-04-28-001-feat-admin-core-sync-coverage-plan.md`.
It compares the historically complete Core sync query surface with the current
admin data model and classifies each Core concept into an admin-native target.

The guiding rule is: Core facts should land in admin according to admin's data
model, not according to Strapi's old shape. Localized user-facing content
should follow the `Experience` / `ExperienceLocale` mental model whenever it
needs independent retrieval, search, editorial review, or future embeddings.

## Source Evidence

- Historical query coverage:
  `apps/cms/src/api/core-sync/services/sync-languages.ts`,
  `apps/cms/src/api/core-sync/services/sync-countries.ts`,
  `apps/cms/src/api/core-sync/services/sync-keywords.ts`,
  `apps/cms/src/api/core-sync/services/sync-videos.ts`,
  `apps/cms/src/api/core-sync/services/sync-video-variants.ts`.
- Current admin sync:
  `apps/admin/src/services/core-sync/phases/sync-languages.ts`,
  `apps/admin/src/services/core-sync/phases/sync-countries.ts`,
  `apps/admin/src/services/core-sync/phases/sync-keywords.ts`,
  `apps/admin/src/services/core-sync/phases/sync-videos.ts`,
  `apps/admin/src/services/core-sync/phases/sync-dubs.ts`.
- Current admin model: `apps/admin/prisma/schema.prisma`.

## Summary

Admin already syncs the main spine:

- `Language`
- `Country` + `Continent`
- `Keyword`
- `Video` + `VideoLocale`
- `VideoDub`

The meaningful gaps are mostly nested or relation coverage:

- language audio previews
- country-language metadata and lifecycle
- video origins
- Bible books and citations
- video images with rendition fields
- subtitles with text/primary/edition linkage
- study questions as localized rows
- video-keyword links
- video parent/child links
- video editions from subtitles and dubs
- Mux metadata
- dub downloads

## Coverage Matrix

| Core concept                 | Core fields observed                                                                                                                                                                     | Admin target                                                                     | Locale model                                                   | Lifecycle / provenance                                                                                               | Decision                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Language                     | `id`, `bcp47`, `iso3`, `slug`, `name[]`                                                                                                                                                  | `Language`                                                                       | Keep `name` as locale-keyed JSON                               | Independent Core row: `coreId`, `source`, `syncedAt`, `deletedAt` already exist                                      | Extend admin query to include `slug`; keep JSON display-name map                                                                           |
| Language audio preview       | `audioPreview.value`, `duration`, `size`, `bitrate`, `codec`                                                                                                                             | New `LanguageAudioPreview` or fields on `Language`                               | Non-localized media metadata                                   | 1:1 child of `Language`; no independent Core id, so rebuild/update from parent language                              | Add first-class child model if API/UI needs nested preview; otherwise fields on `Language` are acceptable                                  |
| Continent                    | `id`, `name[]`                                                                                                                                                                           | `Continent`                                                                      | Keep `name` as locale-keyed JSON                               | Independent Core row; admin model already has lifecycle                                                              | Current admin model fits; ensure query preserves all localized names Core returns                                                          |
| Country                      | `id`, `name[]`, `population`, `latitude`, `longitude`, `flagPngSrc`, `flagWebpSrc`, `languageCount`, `languageHavingMediaCount`, `continent`                                             | `Country`                                                                        | Keep `name` as locale-keyed JSON                               | Independent Core row; admin model already has lifecycle                                                              | Current admin model mostly fits; current admin sync must include language counts                                                           |
| Country-language             | `id`, `speakers`, `displaySpeakers`, `primary`, `suggested`, `order`, `language.id`                                                                                                      | `CountryLanguage`                                                                | Non-localized relationship metadata                            | Core has an id; add `coreId`, `source`, `syncedAt`, `deletedAt`, `updatedAt` or explicitly parent-rebuild            | Prefer adding provenance fields because Core gives an id and coverage audit needs independent relation coverage                            |
| Keyword                      | `id`, `value`, `language.id`                                                                                                                                                             | `Keyword`                                                                        | Language-specific via `languageId`, not a locale row           | Independent Core row; admin model already has lifecycle                                                              | Current model fits; verify whether Core supports incremental filters because historical sync treated keywords as full-sync only            |
| Video                        | `id`, `slug`, `label`, `publishedAt`, `primaryLanguageId`, `locked`, `noIndex`, `source`, `origin`, localized arrays, nested entities                                                    | `Video`                                                                          | Canonical parent; localized display text in `VideoLocale`      | Independent Core row; admin model already has lifecycle                                                              | Add missing canonical fields only if useful: `publishedAt`, `videoSource`, platform restrictions, count/available-language strategy        |
| Video localized display text | `title[]`, `description[]`, `snippet[]`, `imageAlt[]` with `language.id`                                                                                                                 | `VideoLocale`                                                                    | First-class per-locale row                                     | Rebuilt/updated under parent `Video`; unique `(videoId, locale)` already exists                                      | Current direction is correct; resolve language id to BCP-47 and preserve every Core locale                                                 |
| Video origin                 | `origin.id`, `name`, `description`                                                                                                                                                       | `VideoOrigin`                                                                    | Non-localized unless Core changes shape                        | Independent Core row; admin model has lifecycle but lacks `description`                                              | Add `description` to `VideoOrigin`; keep `name` string unless Core provides localized names                                                |
| Bible book                   | `id`, `osisId`, `alternateName`, `paratextAbbreviation`, `isNewTestament`, `order`, `name[]`                                                                                             | `BibleBook`                                                                      | Keep `name` as locale-keyed JSON                               | Independent Core row; admin model has lifecycle                                                                      | Add missing fields or map existing fields: `osisId`, `alternateName`, `paratextAbbreviation`, `isNewTestament`/`testament`, `order`        |
| Bible citation               | `id`, `osisId`, `chapterStart`, `chapterEnd`, `verseStart`, `verseEnd`, `order`, `bibleBook.id`                                                                                          | `BibleCitation`                                                                  | Non-localized                                                  | Core has an id; admin model has `coreId`, `source`, `syncedAt` but lacks `deletedAt`, `updatedAt`, `osisId`, `order` | Add missing fields and lifecycle if citations need stale detection; otherwise rebuild under processed video                                |
| Video keyword link           | `video.keywords[].id`                                                                                                                                                                    | `VideoKeyword`                                                                   | Non-localized relation                                         | Pure join, no Core id in video query                                                                                 | Rebuild from processed video's keyword set; no independent `coreId` needed                                                                 |
| Video image                  | `id`, `aspectRatio`, `mobileCinematicHigh`, `mobileCinematicLow`, `mobileCinematicVeryLow`, `thumbnail`, `videoStill`, `blurhash`, `url`                                                 | `VideoImage`                                                                     | Non-localized media metadata; image alt stays on `VideoLocale` | Core has id; admin model has `coreId` but lacks `deletedAt`, rendition fields, aspect ratio                          | Add approved rendition fields and `deletedAt`; keep media as URL metadata, not storage ownership                                           |
| Video subtitle               | `id`, `primary`, `vttSrc`, `srtSrc`, `value`, `language.id`, `videoEdition.id/name`                                                                                                      | `VideoSubtitle`                                                                  | Language-specific media/text row keyed by edition + language   | Core has id; admin model has lifecycle                                                                               | Add `primary`, `value`, and ensure `videoId` is available if needed for efficient coverage queries; keep `languageId` and `videoEditionId` |
| Video study question         | `id`, `value`, `primary`, `order`, `language.id`                                                                                                                                         | Refactor `VideoStudyQuestion`                                                    | First-class per-locale row                                     | Core has id; admin model has `coreId` but text is currently JSON                                                     | Prefer `locale`/`languageId` + `text` row over JSON map because questions are user-facing, ordered, and language-specific                  |
| Video child relation         | `children[].id`                                                                                                                                                                          | `VideoRelation`                                                                  | Non-localized relation                                         | Pure parent-child relation, no relation Core id in query                                                             | Rebuild child links for processed parent video; no independent `coreId`; keep `order` nullable unless Core provides ordering               |
| Video edition                | `videoEdition.id`, `name` from subtitles and variants                                                                                                                                    | `VideoEdition`                                                                   | Non-localized unless Core changes shape                        | Independent Core row; admin model has lifecycle                                                                      | Current model fits; upsert from both video subtitles and dubs through shared helper                                                        |
| Video variant / dub          | `id`, `slug`, `duration`, `lengthInMilliseconds`, `hls`, `dash`, `share`, `downloadable`, `published`, `brightcoveId`, `videoId`, `language.id`, `videoEdition`, `muxVideo`, `downloads` | `VideoDub`                                                                       | Language-specific media row                                    | Independent Core row; admin model has lifecycle                                                                      | Current rename is correct; admin sync must add `brightcoveId`, edition, Mux, downloads                                                     |
| Mux video                    | `id`, `assetId`, `playbackId`                                                                                                                                                            | `MuxVideo`                                                                       | Non-localized media metadata                                   | Independent Core row; admin model has lifecycle                                                                      | Current model fits for observed fields; leave `uploadId`, `duration` nullable unless Core provides them                                    |
| Dub download                 | `id`, `quality`, `size`, `height`, `width`, `bitrate`, `url`                                                                                                                             | `VideoDubDownload`                                                               | Non-localized media metadata                                   | Core has id; current admin model lacks `coreId`, `source`, `syncedAt`, `deletedAt`, `bitrate`, `updatedAt`           | Add Core identity/provenance and missing fields; soft-delete or replace under processed dub on full/incremental sync                       |
| Available languages          | `availableLanguages[]` in Core schema, not historical sync query                                                                                                                         | Derived from `VideoDub`/`VideoSubtitle` unless product requires exact Core value | Locale/language set                                            | Derived, no separate lifecycle                                                                                       | Do not persist initially; coverage audit can compare derived admin languages to Core if query added later                                  |
| Platform restrictions        | `restrictDownloadPlatforms[]`, `restrictViewPlatforms[]` in Core schema, not historical sync query                                                                                       | TBD on `Video` if needed for product/API behavior                                | Non-localized policy metadata                                  | Parent `Video` fields if approved                                                                                    | Defer unless consumer parity needs these restrictions before cutover                                                                       |
| Counts                       | `childrenCount`, language counts                                                                                                                                                         | Prefer derived except existing country counts                                    | Non-localized derived metadata                                 | Parent row if Core count is meaningful and expensive to derive                                                       | Keep country counts; derive video children count from `VideoRelation`                                                                      |
| Cloudflare/R2 asset objects  | Historical sync stores URLs/renditions, not full asset rows                                                                                                                              | URL/metadata fields on image/download/subtitle rows                              | Non-localized media metadata                                   | Child row lifecycle                                                                                                  | Do not introduce a generic asset model in this scope                                                                                       |

## Locale Modeling Decisions

- `VideoLocale` is the standard for video display text. Sync should create one
  row per `(video, BCP-47 locale)` for every locale Core returns in title,
  description, snippet, or image alt text.
- `VideoStudyQuestion` should be redesigned as language/locale-specific rows
  unless implementation proves Core groups translations under a stable
  canonical question id. Core currently exposes each study question with its
  own `id`, `value`, `order`, and `language.id`, so one row per localized Core
  question is the safest mapping.
- `VideoSubtitle` and `VideoDub` are language-specific media rows, not
  locale-content rows. They should relate to `Language` and optionally expose
  BCP-47 through the language relation.
- Reference names may remain JSON maps because they are low-cardinality display
  metadata without independent publish lifecycle. This applies to `Language`,
  `Country`, `Continent`, and `BibleBook` for now.

## Lifecycle / Provenance Decisions

- Independent Core rows with Core IDs should have `coreId`, `source`,
  `syncedAt`, and `deletedAt` when stale detection matters.
- Pure joins without independent Core IDs should be rebuilt from the processed
  parent row:
  - `VideoKeyword` from the processed video's keyword set
  - `VideoRelation` from the processed parent video's children set
- Parent-rebuilt child sets should only be replaced for parents included in the
  current page/delta. Incremental sync must not prune children for parents that
  Core did not return.
- `CountryLanguage` should be treated as an independent Core-sourced relation
  because Core provides a relation id and metadata beyond a pure join.
- `VideoDubDownload` should be treated as an independent Core-sourced child row
  because Core provides a download id and metadata beyond a pure join.

## Phase Ownership

| Phase        | Owns                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `languages`  | `Language`, language audio preview                                                                                                                                                            |
| `countries`  | `Continent`, `Country`, `CountryLanguage`                                                                                                                                                     |
| `keywords`   | `Keyword`                                                                                                                                                                                     |
| `videos`     | `BibleBook`, `Video`, `VideoLocale`, `VideoOrigin`, `VideoImage`, `VideoSubtitle`, `VideoStudyQuestion`, `BibleCitation`, `VideoKeyword`, `VideoRelation`, subtitle-discovered `VideoEdition` |
| `video-dubs` | `VideoDub`, `VideoDubDownload`, `MuxVideo`, dub-discovered `VideoEdition`                                                                                                                     |

## Follow-Up Changes For Unit 1

- Add or confirm schema support for:
  - `LanguageAudioPreview` or equivalent fields on `Language`
  - `CountryLanguage.coreId`, `displaySpeakers`, `primary`, `order`, lifecycle
    fields
  - `VideoOrigin.description`
  - `BibleBook.osisId`, `alternateName`, `paratextAbbreviation`, and a clear
    `isNewTestament`/`testament` mapping
  - `BibleCitation.osisId`, `order`, and possibly `deletedAt`/`updatedAt`
  - `VideoImage.aspectRatio`, Core rendition URL fields, `deletedAt`
  - `VideoSubtitle.primary`, `value`
  - `VideoStudyQuestion.locale` or `languageId`, `text`, `primary`, `deletedAt`
  - `VideoDubDownload.coreId`, `source`, `syncedAt`, `deletedAt`, `bitrate`,
    `updatedAt`
- Re-check whether `Video.publishedAt`, `Video.videoSource`, platform
  restrictions, and available-language fields are needed before consumer
  migration. They are not required for entity coverage if derivable or unused.

## Verification Expectations

The later coverage audit should verify at least:

- Core language count -> admin active `Language` count.
- Core country count -> admin active `Country` count.
- Core country-language relation count -> admin active `CountryLanguage` count.
- Core keyword count -> admin active `Keyword` count.
- Core published video count -> admin active `Video` count.
- Core localized video values -> admin `VideoLocale` rows by BCP-47.
- Core image count -> admin active `VideoImage` count.
- Core subtitle count -> admin active `VideoSubtitle` count.
- Core Bible citation count -> admin active `BibleCitation` count.
- Core study question count -> admin active `VideoStudyQuestion` count.
- Core child relation count -> admin `VideoRelation` count.
- Core variant count -> admin active `VideoDub` count.
- Core download count -> admin active `VideoDubDownload` count.
- Core Mux count -> admin active `MuxVideo` count.

## Remaining Implementation-Time Checks

- Confirm current Core still exposes every historical field above.
- Confirm which filters support `updatedAt` today. Historical sync treated
  countries and keywords as full-sync-only; current admin code attempts
  `updatedAt` filters for them.
- Confirm whether Core study-question ids are per localized question or shared
  across translations. If shared, introduce canonical question + locale rows;
  if per localized question, use one localized row per Core id.
