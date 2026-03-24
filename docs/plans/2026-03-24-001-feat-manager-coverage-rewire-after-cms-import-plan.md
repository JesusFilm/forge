---
title: "feat: Rewire manager coverage to CMS after import"
type: feat
status: active
date: 2026-03-24
---

# Rewire manager coverage to CMS after import

## Overview

Now that the required video data has been imported into Strapi CMS, `apps/manager` should stop treating coverage as a view over local jobs and start treating CMS as the canonical source for coverage collections, coverage statuses, and selectable videos.

The current coverage implementation is still wired to file-backed job state:

- [apps/manager/src/app/dashboard/coverage/page.tsx](/Users/o/GitHub/jesusfilm/forge/apps/manager/src/app/dashboard/coverage/page.tsx) loads `listJobs()`
- [apps/manager/src/features/coverage/coverage-report-client.tsx](/Users/o/GitHub/jesusfilm/forge/apps/manager/src/features/coverage/coverage-report-client.tsx) groups jobs into fake collections by status
- [apps/manager/src/app/api/jobs/route.ts](/Users/o/GitHub/jesusfilm/forge/apps/manager/src/app/api/jobs/route.ts) only supports URL ingest, not queueing work for an already imported video

## Problem Statement / Motivation

The manager dashboard should browse and act on canonical CMS content:

- `/dashboard/coverage` should render collections of videos from Strapi CMS
- `/dashboard/jobs` should remain a workflow queue view
- the language selector should read language and geo data from CMS
- selecting videos from coverage should queue jobs for existing imported media instead of creating new Mux assets from URLs

Until this rewire happens, the data import work does not restore actual manager functionality because coverage still depends on `.data/jobs.json` instead of CMS.

## Proposed Solution

Rebuild the manager coverage feature as a CMS-backed read model, using typed GraphQL queries through `@forge/graphql`, and reconnect the old coverage selection flow to job creation for existing imported assets.

Key decisions:

- Strapi CMS is the canonical source for coverage data
- coverage collections continue to use the existing `Video.label + childGatewayIds` model
- `/dashboard/jobs` stays job-only and should not become a CMS browser
- URL ingest stays supported for the existing jobs flow
- coverage-driven job creation should infer existing-asset payloads from request shape instead of adding a new mode flag

## Implementation Changes

### 1. Replace the coverage page data source

- Stop loading jobs in [apps/manager/src/app/dashboard/coverage/page.tsx](/Users/o/GitHub/jesusfilm/forge/apps/manager/src/app/dashboard/coverage/page.tsx).
- Add CMS-backed server queries that fetch:
  - top-level labeled videos used as collections
  - `childGatewayIds`
  - subtitles
  - variants
  - primary language
  - keywords
  - study questions
  - bible citations
- Use `@forge/graphql` typed queries through [apps/manager/src/cms/client.ts](/Users/o/GitHub/jesusfilm/forge/apps/manager/src/cms/client.ts), following the same pattern already used in `apps/web`.

### 2. Restore a real coverage domain in manager

- Recreate the missing coverage support modules from the old VideoForge app as the starting point:
  - `types`
  - `submission`
  - `estimate-cost`
  - `refresh-token` if still needed by the current UI
- Port behavior, not data access:
  - keep the UI and submission semantics
  - replace old gateway-backed reads with CMS-backed reads
- Map CMS records into the old coverage contract:
  - `CoverageCollection`
  - `CoverageVideo`
  - `CoverageLanguageOption`
  - coverage submit result types

### 3. Define CMS-backed coverage semantics

- Collections are top-level videos whose labels represent coverage groups.
- The videos shown inside a collection are resolved from `childGatewayIds`.
- If a labeled top-level video has no children, it becomes a single-video collection.
- Derive coverage statuses from CMS content:
  - subtitle status from `VideoSubtitle`
  - audio/voiceover status from `VideoVariant`
  - metadata completeness from title, description, keywords, study questions, and bible citations
- Determine whether a video is selectable by whether a usable `muxAssetId` can be derived from imported CMS data or related variants.

### 4. Add the missing language API expected by the coverage UI

- Add `GET /api/languages` in manager because [apps/manager/src/features/coverage/LanguageGeoSelector.tsx](/Users/o/GitHub/jesusfilm/forge/apps/manager/src/features/coverage/LanguageGeoSelector.tsx) already depends on it.
- Return the current picker payload shape:
  - `continents`
  - `countries`
  - `languages`
- Source this data from CMS language and country records.
- Preserve the current `?search=` support for remote lookup.

### 5. Extend job creation for coverage-driven queueing

- Keep the existing URL-ingest path in [apps/manager/src/app/api/jobs/route.ts](/Users/o/GitHub/jesusfilm/forge/apps/manager/src/app/api/jobs/route.ts).
- Extend the same route to also accept the old coverage-style existing-asset payload:
  - `muxAssetId`
  - `languages`
  - optional source collection/media titles
  - optional requested language abbreviations
  - optional job options
- Infer which branch to use from payload shape instead of introducing a new `mode` flag.
- Coverage submission should queue jobs for already imported assets rather than creating new Mux assets from URLs.

### 6. Reconnect the coverage selection flow

- Restore the old coverage selection flow from `videoforge`:
  - select videos
  - estimate translation cost
  - submit selected videos to `/api/jobs`
  - redirect to `/dashboard/jobs` when jobs are created
- Keep the Forge dashboard route structure and auth model.
- Do not restore the old public `/jobs` route layout from VideoForge.

### 7. Leave job durability as a follow-up scope

- Keep the current `.data/jobs.json` implementation for now so this work stays focused on restoring coverage correctness.
- Treat durable queue storage as a separate follow-up after coverage is fully reading from CMS and submitting jobs for existing assets.

## Acceptance Criteria

- [ ] `/dashboard/coverage` renders collections from CMS even when there are no local jobs.
- [ ] Coverage no longer groups jobs into fake collections like "Completed Jobs" or "Running Jobs".
- [ ] Collections resolve from labeled top-level videos and `childGatewayIds`.
- [ ] Subtitle, audio, and meta coverage bars reflect CMS data rather than workflow step state.
- [ ] `LanguageGeoSelector` loads from `GET /api/languages` and search still works.
- [ ] Coverage can queue jobs for existing imported videos using `muxAssetId`.
- [ ] URL-based ingest from the jobs dashboard continues to work unchanged.
- [ ] `/dashboard/jobs` remains a queue/workflow view rather than a content browser.

## Test Plan

- Add unit coverage for CMS-to-coverage mapping:
  - labeled video with children
  - labeled video without children
  - selectable video with derived `muxAssetId`
  - unselectable video without mapping
- Add route tests for `GET /api/languages`:
  - full response
  - search response
  - empty result set
- Add route tests for `POST /api/jobs`:
  - URL ingest payload
  - existing-asset payload
  - invalid mixed payloads
- Add UI coverage for `/dashboard/coverage`:
  - render collections from CMS
  - select videos and submit jobs
  - redirect to `/dashboard/jobs` after successful creation

## Assumptions

- The CMS import already includes enough videos, variants, subtitles, languages, countries, and related metadata for coverage to render correctly.
- Imported CMS data preserves the information needed to derive `muxAssetId` for queueable videos.
- The old `videoforge` coverage modules are reference material for UI and domain behavior only; all data reads should now come from Strapi CMS.
