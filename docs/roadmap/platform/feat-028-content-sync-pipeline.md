---
id: "feat-028"
title: "Content Sync Pipeline (Core Sync)"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-03-20"
duration: 11
depends_on:
  - "feat-022"
blocks:
  - "feat-029"
tags:
  - "cms"
  - "infrastructure"
---

## Problem

The CMS needed to be populated with video content from JesusFilm's existing Core/Gateway API. Manual content entry doesn't scale — an automated sync pipeline was needed to import and keep content up to date, handling thousands of videos with their metadata, languages, and relations.

## Entry Points — Read These First

1. `apps/cms/src/api/core-sync/` — the core-sync API routes and controllers
2. `apps/cms/src/services/core-sync/` — sync service logic (if separated)
3. `apps/cms/src/api/data-snapshot/` — database snapshot endpoints for dev/staging seeding
4. `apps/cms/src/admin/` — System Status settings page in Strapi admin

## Grep These

- `core-sync\|coreSync\|gateway-sync` in `apps/cms/src/` — sync pipeline code
- `bulk.*upsert\|bulkUpsert` in `apps/cms/src/` — bulk SQL upsert patterns
- `core_id` in `apps/cms/src/` — index on external IDs for sync lookups
- `data-snapshot\|snapshot` in `apps/cms/src/` — snapshot/restore logic
- `updatedAt.*filter\|delta.*sync` in `apps/cms/src/` — incremental sync logic

## What Was Built

1. Built core-sync pipeline (originally "gateway-sync", renamed) to import content from JesusFilm Core API into Strapi.
2. Incremental delta sync using `updatedAt` filter — only processes changed content.
3. Bulk SQL upsert patterns with per-page processing and 5x page sizes for performance.
4. Language bulk upserts bypassing Strapi i18n middleware for speed.
5. `core_id` indexes via bootstrap for fast sync lookups.
6. Data snapshot system: auto-restore latest snapshot on dev start and staging deploy.
7. System Status admin page showing sync state and triggers.
8. Extensive performance optimization: bulk SQL, batch UPDATE, per-page upsert patterns.

## Verification

- `ls apps/cms/src/api/core-sync/` — core-sync routes exist
- `ls apps/cms/src/api/data-snapshot/` — snapshot endpoints exist
- Strapi admin has a System Status page showing sync state
- Dev environment auto-restores from latest snapshot on start
