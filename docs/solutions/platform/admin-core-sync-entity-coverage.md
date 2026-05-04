---
title: Admin Core Sync Entity Coverage
date: 2026-04-29
last_updated: 2026-04-29
category: best-practices
module: apps/admin
problem_type: best_practice
component: service_object
severity: high
scope: platform
applies_when:
  - Syncing canonical Core API data directly into apps/admin without Strapi.
  - Adding new Core entity coverage or relation-backed child rows.
  - Exposing soft-deletable Core-synced children through GraphQL relations.
  - Handling Core GraphQL responses that return HTTP 200 with errors.
tags:
  - admin
  - core-sync
  - core-api
  - data-model
  - entity-coverage
  - localization
  - soft-delete
  - graphql-errors
related:
  - docs/solutions/cms/admin-app-data-model-decisions.md
  - docs/solutions/cms/core-sync-incremental-delta-sync.md
  - docs/solutions/cms/codegen-strips-optional-graphql-variables.md
  - docs/solutions/cms/core-sync-per-page-upsert-pattern.md
  - docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md
  - docs/solutions/graphql/pothos-relation-abac-filter-required-for-nested-types.md
  - docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md
  - docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md
---

# Admin Core Sync Entity Coverage

## Context

`apps/admin` now syncs the approved Core-derived entity graph directly from
Core. Do not add Strapi runtime dependencies, Strapi database reads, or
Strapi-shaped compatibility tables for this surface. The old cms sync is
historical evidence for which Core fields mattered; Core's current API shape is
the source of truth.

This work expanded the admin schema, migrations, sync phases, GraphQL exposure,
tests, and operator coverage audit for reference data, video media children,
dubs, downloads, editions, Mux metadata, Bible citations, and relationship
rows. The final PR also fixed two review findings: nested GraphQL relations now
filter soft-deleted child rows, and Core GraphQL `errors` in `200 OK` responses
fail the sync instead of looking like empty successful pages.

## Guidance

Treat admin as a direct Core consumer for this data surface. Preserve Core
identity with `coreId`, but use admin-native names and grains where the domain
has settled.

Core reference data lands in `Language`, `Country`, `Continent`,
`CountryLanguage`, and `Keyword`. Translated reference display names land in
first-class locale rows: `LanguageLocale`, `CountryLocale`, and
`ContinentLocale`. Parent JSON `name` maps remain compatibility mirrors only;
UI, search, audit, and future editorial work should prefer relation-backed
locale rows.

Core video data lands in `Video` plus first-class child rows:
`VideoLocale`, `VideoOrigin`, `VideoImage`, `VideoSubtitle`,
`VideoStudyQuestion`, `BibleBook`, `BibleCitation`, `VideoKeyword`, and
`VideoRelation`.

Core `videoVariant` maps to admin `VideoDub`. In admin vocabulary, the varying
axis is the audio language; downloadable encodes belong under
`VideoDubDownload`. Variant-side nested data also lands in `VideoEdition` and
`MuxVideo`.

`VideoSubtitle` is keyed by Core subtitle id, not by a derived
video/language/edition tuple. `VideoEdition` is required for admin subtitle
rows because subtitle timing belongs to a cut/edition. If Core ever returns a
subtitle without an edition, omit that subtitle rather than making the
relationship optional.

```ts
if (!subtitle.videoEdition) continue

await tx.videoSubtitle.upsert({
  where: { coreId: subtitle.id },
  create: {
    coreId: subtitle.id,
    videoId: videoRow.id,
    videoEditionId,
    languageId,
    value: subtitle.value,
    primary: subtitle.primary ?? false,
    vttSrc: subtitle.vttSrc,
    srtSrc: subtitle.srtSrc,
    syncedAt: new Date(),
  },
  update: {
    videoId: videoRow.id,
    videoEditionId,
    languageId,
    value: subtitle.value,
    primary: subtitle.primary ?? false,
    vttSrc: subtitle.vttSrc,
    srtSrc: subtitle.srtSrc,
    syncedAt: new Date(),
    deletedAt: null,
  },
})
```

GraphQL relation fields must filter soft-deleted Core child rows. Filtering
only the parent object is insufficient; active parents can otherwise expose
stale nested rows after a later sync soft-deletes them.

```ts
dubs: t.relation("dubs", {
  query: { where: { deletedAt: null } },
})
```

Core transport handling must distinguish successful HTTP from successful
GraphQL. A `200 OK` response with `errors` is not a valid sync page and must
not advance watermarks.

```ts
const json = (await res.json()) as CoreQueryResult<T>
if (json.errors && json.errors.length > 0) {
  throw new CoreGraphQLError(json.errors)
}
```

Expose coverage operationally, not only in tests. `runCoverageAudit()` checks
the approved Core entity and relationship classes after sync and returns
`pass` or `review`. `systemStatus` exposes the audit in its JSON payload, and
`runSync()` returns it after a run.

## Why This Matters

This avoids the architecture trap of inheriting Strapi's public/editorial
shape for data that belongs to Core. Direct Core sync keeps admin aligned with
Core identity, timestamps, and relationships while allowing admin to use its
own locale, media, and workflow model.

First-class locale rows matter because language, country, and continent labels
are not incidental display strings. They participate in coverage audits,
filtering, search, and future editorial or AI-assisted workflows.

`VideoSubtitle -> VideoEdition` protects timing correctness. If subtitles
attach only to `Video`, the model can silently display timed text for the wrong
cut.

Failing on Core GraphQL `errors` protects sync integrity. Without this guard,
an invalid Core response can look like an empty page, letting the orchestrator
advance a phase watermark while skipping real data.

Filtering nested GraphQL relations protects consumers from seeing deleted
child rows after a later sync correctly marks stale Core data as soft-deleted.

## When to Apply

Apply this pattern when adding or expanding Core-sourced entities in
`apps/admin`.

Use it when:

- The entity comes from Core, not Strapi.
- Core identity must be preserved with `coreId`.
- Sync correctness depends on `updatedAt`, `syncedAt`, or watermarks.
- Localized reference data needs querying, auditing, or future editing.
- Media entities have nested downloadable or rendered variants.
- GraphQL exposes nested relations for soft-deletable rows.
- Sync status needs to be visible through admin operations surfaces.

Do not apply it to admin-authored-only data, Strapi-authored editorial content,
or generated consumer GraphQL contracts in `packages/graphql`.

## What Did Not Work

Scanning the entire Core `videoVariants` universe for dubs was too slow and
unstable. It also imported dubs for videos admin had not synced, then required
stale cleanup. The working approach fetches variants nested under the
admin-synced videos (session history).

The first real sync exposed Core payload mismatches: numeric
`displaySpeakers`, empty language IDs, language slug collisions, duplicate
country-language relationships by Core ids, and too-short transaction
timeouts. The importer was hardened around admin-native identity rules instead
of weakening the target model (session history).

Missing parent videos initially made dub pages fail. The phase now skips and
summarizes unmatched variants, and only successfully matched variants count as
seen for stale cleanup (session history).

Core transient failures caused incomplete `video-dubs` runs. Bounded request
retries help, but the more important fix was reducing the query shape to the
targeted variants admin actually needs (session history).

## Prevention

- Add `runCoverageAudit()` coverage for every approved Core entity class before
  consumer cutover or future Strapi deletion work.
- Advance watermarks only when a phase has zero errors. Capture the watermark
  before issuing the Core query, not after processing completes.
- Soft-delete stale Core rows only during full sync or deliberate full-sync
  phases, not from partial delta pages.
- Never let Core overwrite `source = 'MANAGER'` rows.
- Keep reference display names in first-class locale rows when they need UI,
  search, audit, editorial, or embedding addressability.
- Keep `VideoSubtitle` keyed by Core subtitle id and attached to required
  `VideoEdition`.
- Filter `deletedAt: null` on GraphQL relations for soft-deletable children.
- Treat Core GraphQL `errors` as sync failures even when HTTP status is 200.
- Verify real coverage with an independent read path after sync. Do not trust
  "sync completed" alone.

## Examples

A good coverage audit reports concrete counts by entity class:

```ts
const checks = [
  [
    "languages",
    prisma.language.count({ where: { source: "CORE", deletedAt: null } }),
  ],
  [
    "languageLocales",
    prisma.languageLocale.count({ where: { source: "CORE", deletedAt: null } }),
  ],
  [
    "countries",
    prisma.country.count({ where: { source: "CORE", deletedAt: null } }),
  ],
  [
    "videoSubtitles",
    prisma.videoSubtitle.count({ where: { source: "CORE", deletedAt: null } }),
  ],
  [
    "videoDubs",
    prisma.videoDub.count({ where: { source: "CORE", deletedAt: null } }),
  ],
  [
    "videoDubDownloads",
    prisma.videoDubDownload.count({
      where: { source: "CORE", deletedAt: null },
    }),
  ],
]
```

Last verified against the real Core/API sync database on 2026-04-28:

| Entity                     | Active rows |
| -------------------------- | ----------: |
| Languages                  |       2,301 |
| Language locales           |       2,647 |
| Countries                  |         240 |
| Country locales            |       4,016 |
| Country-language relations |       6,039 |
| Keywords                   |       6,066 |
| Videos                     |       1,088 |
| Video subtitles            |      10,480 |
| Video dubs                 |      13,148 |
| Video dub downloads        |     376,400 |
| Video editions             |       1,048 |
| Mux videos                 |      48,028 |

Validation that passed for PR #851:

```bash
pnpm --filter @forge/admin test
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin lint
set -a; source /workspace/apps/admin/.env; set +a; pnpm --filter @forge/admin exec prisma validate
```

## Related

- [Admin App Data Model Decisions](../cms/admin-app-data-model-decisions.md)
- [Core sync incremental delta sync](../cms/core-sync-incremental-delta-sync.md)
- [Codegen strips optional GraphQL variables](../cms/codegen-strips-optional-graphql-variables.md)
- [Core sync per-page upsert pattern](../cms/core-sync-per-page-upsert-pattern.md)
- [Core sync bulk UPDATE temp table pattern](../cms/core-sync-bulk-update-temp-table-pattern.md)
- [Pothos relation ABAC filter required for nested types](../graphql/pothos-relation-abac-filter-required-for-nested-types.md)
- [Admin scene-embeddings indexer pattern](./admin-scene-embeddings-indexer-pattern.md)
- GitHub issue #464 is useful historical context for the old CMS
  `video-subtitle` framing, but it should not drive admin modeling: admin
  subtitles are keyed by Core subtitle id and attach to `VideoEdition`.
