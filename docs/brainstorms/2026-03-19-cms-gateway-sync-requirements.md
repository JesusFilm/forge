---
date: 2026-03-19
topic: cms-gateway-sync
---

# CMS Gateway Data Sync

## Problem Frame

The Forge CMS (Strapi) needs canonical language, country, and video data from the JesusFilm API gateway (`https://api-gateway.central.jesusfilm.org/graphql`). Currently this data is either missing or manually maintained. An automated sync ensures the CMS always has up-to-date reference data and rich video metadata for apps/web and apps/mobile to consume via the Strapi GraphQL API.

## Requirements

- R1. **Language sync**: Pull all languages from the gateway in a single request and upsert into a Language content type in Strapi. Store gateway ID as the match key for upserts, plus bcp47, iso3, slug. Translated name fields use Strapi i18n (no separate LanguageName sub-type needed).

  **Sub-types required:**
  - `AudioPreview` — languageId, value (URL), duration, size, bitrate, codec. Relation: language

- R2. **Country sync**: Pull all countries from the gateway and upsert into a Country content type. Store gateway ID, translated country names (i18n), population, latitude, longitude, flagPngSrc, flagWebpSrc, languageCount, languageHavingMediaCount.

  **Sub-types required:**
  - `Continent` — id, translated name (i18n). Relation: countries
  - `CountryLanguage` — id, speakers, displaySpeakers, primary, suggested, order. Relations: language, country

- R3. **Video sync (full depth, paginated)**: Pull all published videos from the gateway using paginated queries (`limit`/`offset`), iterating through all pages until exhausted. Upsert into a redesigned Video content type. Sync includes:
  - Core fields: gateway ID, primaryLanguageId, slug, label (enum: collection, episode, featureFilm, segment, series, shortFilm, trailer, behindTheScenes), source (enum: internal, youTube, cloudflare, mux), published, locked, noIndex, publishedAt
  - Translated fields (i18n): title, description, snippet, studyQuestions, imageAlt, keywords
  - Bible citations: osisId, chapter/verse ranges, bible book reference, order
  - Images (CloudflareImage): id, aspectRatio, mobileCinematicHigh, mobileCinematicLow, mobileCinematicVeryLow, thumbnail, videoStill, blurhash, url
  - Variants: full variant data including downloads
  - Subtitles: full subtitle data with vtt/srt assets
  - Relations: children (IDs), parents (IDs), origin, cloudflareAssets
  - Computed/counts: childrenCount, availableLanguages, restrictDownloadPlatforms, restrictViewPlatforms

  **Sub-types required** (each needs its own Strapi content type or component):
  - `VideoVariant` — id, slug, duration, lengthInMilliseconds, hls, dash, share, downloadable, published, version, brightcoveId. Relations: language, videoEdition, muxVideo, asset (CloudflareR2), downloads
  - `VideoVariantDownload` — id, quality (enum: distroLow, distroSd, distroHigh, low, sd, high, fhd, qhd, uhd, highest), size, height, width, bitrate, url, version. Relations: asset (CloudflareR2)
  - `VideoEdition` — id, name. Relations: videoVariants, videoSubtitles
  - `MuxVideo` — id, assetId, playbackId, duration, readyToStream, downloadable, primaryLanguageId
  - `VideoSubtitle` — id, primary, vttSrc, srtSrc, vttVersion, srtVersion, value (translated), edition. Relations: language, videoEdition, vttAsset (CloudflareR2), srtAsset (CloudflareR2)
  - `BibleCitation` — id, osisId, chapterStart, chapterEnd, verseStart, verseEnd, order. Relations: bibleBook, video
  - `BibleBook` — id, osisId, alternateName, paratextAbbreviation, isNewTestament, order. Translated name (i18n)
  - `Keyword` — id, value. Relations: language
  - `VideoOrigin` — id, name, description
  - `CloudflareR2` — id, contentLength, contentType, fileName, originalFilename, publicUrl, createdAt, updatedAt (for variant/subtitle assets)
  - `CloudflareImage` — id, aspectRatio, url, mobileCinematicHigh, mobileCinematicLow, mobileCinematicVeryLow, thumbnail, videoStill, blurhash

- R4. **Upsert strategy**: All syncs match records by gateway ID. Create if not found, update if exists. Strapi document IDs are stable across syncs.
- R5. **Sync order**: Languages first (needed as i18n locales and for relations), then countries, then videos.
- R6. **Scheduled + manual trigger**: Sync runs on a configurable cron schedule (env var, default daily). Admins can also trigger a sync manually from the Strapi admin or via an API endpoint.
- R7. **Pagination for videos**: Only videos require pagination via `limit`/`offset`. Languages and countries are fetched in single requests. Page size should be configurable (default 50, kept low because variants carry large nested payloads).
- R8. **Strapi i18n for all translations**: Translated fields create locale entries for every language present in the gateway's translation arrays. Languages must be synced first so Strapi locales exist before creating localized content.
- R9. **Replace existing Video content type**: The current minimal Video content type (title, slug, image) is redesigned to accommodate the full gateway schema. Existing seed data (e.g. Easter seeder) will need updating to match.
- R10. **Removal handling**: If a previously synced record no longer appears in the gateway response, soft-delete it by setting its Strapi status to draft/unpublished. Do not hard-delete. Records tagged as manager-enriched (created or modified by the manager app) are excluded from sync deletion.
- R12. **Source tagging**: All content types should have a `source` field (e.g., "gateway" or "manager") so the sync can distinguish gateway-sourced records from manager-enriched ones. The manager app will consume synced data and add enrichments to the CMS, but this data is never pushed back to the gateway.
- R11. **Partial sync on failure**: If a sync fails mid-run, records already upserted are kept. The next scheduled or manual run re-syncs from the beginning. No resume-from-failure tracking needed.

## Success Criteria

- Languages, countries, and all published videos are present in the CMS after a sync run
- Re-running sync is idempotent: no duplicates, updated records reflect latest gateway data
- Video pagination completes fully (no data left behind due to pagination bugs)
- Translated content is accessible via Strapi's i18n locale API
- Manual sync can be triggered from admin UI or API
- Cron schedule is configurable via environment variable

## Scope Boundaries

- **Not in scope**: Syncing unpublished videos, mutations back to the gateway, webhook-based real-time sync
- **Not in scope**: Downloading or proxying media files (images, video streams) — only URLs are stored
- **Not in scope**: Syncing journey or user data from other gateway subgraphs
- **Not in scope**: UI for monitoring sync progress in real-time (logs are sufficient)

## Key Decisions

- **Upsert by gateway ID** over wipe-and-reimport: preserves Strapi document IDs and relations
- **Strapi i18n** for translations over JSON blob storage: enables native locale-aware querying
- **Replace existing Video type** over extending or creating a parallel type: avoids schema fragmentation
- **Public API, no auth**: gateway queries used here don't require authentication
- **Full depth sync**: all nested data (variants, subtitles, bible citations, study questions, keywords) synced, with relational fields (children) stored as ID references
- **Soft-delete on removal** over hard-delete or leaving orphans: preserves data while signaling staleness
- **No resume tracking**: partial syncs are acceptable; next full run catches up

## Dependencies / Assumptions

- The gateway API at `https://api-gateway.central.jesusfilm.org/graphql` remains publicly accessible for read queries
- Strapi v5 i18n plugin supports dynamic locale creation (languages must be registered as Strapi locales)
- The gateway's `limit`/`offset` pagination returns consistent, complete data when iterated sequentially

## Outstanding Questions

### Deferred to Planning

- [Affects R8][Needs research] How does Strapi v5 handle dynamic locale registration? Need to verify if locales can be created programmatically or if they must be pre-configured.
- [Affects R3][Technical] What is the total count of published videos in the gateway? This affects sync duration and whether we need concurrency or batching optimizations.
- [Affects R6][Technical] Best mechanism for manual trigger in Strapi v5 — custom admin panel button, custom controller endpoint, or lifecycle hook?
- [Affects R9][Technical] Audit all references to the existing Video content type (seed-easter.ts, experiences, etc.) to identify what needs updating when the schema changes.
- ~~[Affects R2][Technical] Should continents be a separate content type or an inline component on Country?~~ **Resolved**: Continent is its own content type.

## Next Steps

-> `/ce:plan` for structured implementation planning
