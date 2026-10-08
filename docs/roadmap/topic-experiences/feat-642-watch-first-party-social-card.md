---
id: "feat-642"
title: "Use a first-party Watch social card"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags: [watch, seo, social]
---

## Problem

The default Watch Open Graph image points to an Unsplash URL, which makes the ministry's main Watch share card depend on third-party hosted stock photography.

## Entry Points — Read These First

- `apps/web/src/lib/experience-metadata.ts`: default metadata image.
- `apps/web/src/lib/__tests__/experience-metadata-watch-page.test.ts`: root and fallback metadata behavior.
- `apps/web/next.config.mjs`: image host allowlist.

## What To Build

Ship a first-party, 1200×630 Watch social image and use it wherever metadata falls back to the default image.

## Constraints

Keep authored and content-specific social images unchanged. Keep the Unsplash image host configured while other Watch surfaces still load Unsplash images through Next Image.

## Verification

Test root and error-fallback metadata image URLs, dimensions, and alt text. Confirm the image is served from the public Watch path and search for remaining Unsplash usage before changing image host configuration.
