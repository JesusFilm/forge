---
title: Admin Core Sync Entity Coverage
status: active
date: 2026-04-28
scope: platform
tags:
  - admin
  - core-sync
  - data-model
---

# Admin Core Sync Entity Coverage

Admin syncs directly from Core. Do not add Strapi runtime dependencies or
Strapi-shaped compatibility tables; the old cms sync is only historical
evidence for Core fields that were already available.

## Mapping

Core reference data lands in `Language`, `Country`, `Continent`,
`CountryLanguage`, and `Keyword`. Translated reference display names land in
first-class locale rows: `LanguageLocale`, `CountryLocale`, and
`ContinentLocale`. `Language` stores Core audio preview metadata as columns.
`CountryLanguage` carries its own Core identity and soft-delete lifecycle
because Core exposes it as a relationship entity.

Core video data lands in `Video` plus first-class child rows:
`VideoLocale`, `VideoOrigin`, `VideoImage`, `VideoSubtitle`,
`VideoStudyQuestion`, `BibleBook`, `BibleCitation`, `VideoKeyword`, and
`VideoRelation`.

`VideoSubtitle` is keyed by Core subtitle id, not by a derived
video/language/edition tuple. `VideoEdition` is required for admin subtitle
rows; if Core ever returns a subtitle without an edition, sync should omit that
subtitle rather than make the edition relationship optional.

Core `videoVariant` lands as admin `VideoDub`. Variant-side nested data lands
in `VideoEdition`, `MuxVideo`, and `VideoDubDownload`.

## Locale Rule

Use first-class per-locale rows for localized content that users see or that
may participate in retrieval, search, editorial review, or future embeddings.
That means video display text belongs in `VideoLocale`, and study questions
belong in per-locale `VideoStudyQuestion` rows. Reference display names belong
in `LanguageLocale`, `CountryLocale`, and `ContinentLocale`.

Locale-keyed JSON maps on reference parents are compatibility mirrors only; UI
work should prefer relation-backed locale rows.

## Freshness Rule

Incremental sync replaces nested relation sets only for parents returned by the
Core delta page. Full sync soft-deletes stale Core-sourced rows after a
successful non-empty result. Countries and keywords are treated as full-sync
phases because the Core query shape used here does not expose the same
updated-at filtering as videos and dubs.

Core-sourced rows must not overwrite `source = 'MANAGER'` rows. For rows with
Core authoritative timestamps, pass `updatedAt` explicitly during sync and use
`syncedAt` as the admin refresh timestamp.

## Coverage Audit

`runCoverageAudit()` checks the approved Core entity and relationship classes
after sync and returns `pass` or `review`. `systemStatus` exposes the audit in
its JSON payload, and `runSync()` returns it after a run.

Operators should review the audit after a full sync before consumer cutover or
any future Strapi deletion work.

Last verified against the real Core/API sync database on 2026-04-28: audit
status `pass`, including 10,480 active `VideoSubtitle` rows, 13,148 active
`VideoDub` rows, 376,400 `VideoDubDownload` rows, and first-class reference
locale rows for languages, countries, and continents.
