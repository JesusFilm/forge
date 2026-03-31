---
id: "feat-030"
title: "Video Content Discovery Dashboard"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-03-18"
duration: 7
depends_on: []
blocks:
  - "feat-031"
tags:
  - "manager"
---

## Problem

The video library contains thousands of videos, many lacking metadata (descriptions, titles, topics, thumbnails). The team needed a dashboard to identify which videos have gaps and prioritize enrichment work. Without visibility into content quality, enrichment efforts are unfocused.

## Entry Points — Read These First

1. `apps/manager/` — the Manager app (Next.js dashboard)
2. `apps/manager/src/app/` — dashboard pages and routes
3. `apps/manager/src/services/` — backend services for data access
4. `apps/manager/src/types/` — TypeScript types for jobs and workflows

## Grep These

- `dashboard\|Dashboard` in `apps/manager/src/` — dashboard components
- `VideoForge\|videoForge` in `apps/manager/src/` — VideoForge UI references
- `enrichment\|Enrichment` in `apps/manager/src/` — enrichment pipeline references

## What Was Built

1. Built the Manager app (`apps/manager/`) as a Next.js dashboard for internal team use.
2. Wired the dashboard to read exclusively from Strapi CMS data, showing video content with metadata quality indicators.
3. Deployed to Railway with optional S3 storage for artifacts.
4. Created the VideoForge UI for browsing and managing video enrichment.

## Verification

- `cd apps/manager && pnpm build` — Manager app builds
- Dashboard shows video content sourced from Strapi CMS
- https://manager.jesusfilm.org — live production dashboard
