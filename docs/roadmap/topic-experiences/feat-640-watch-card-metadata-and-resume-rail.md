---
id: "feat-640"
title: "Show Watch card metadata and continue watching"
owner: "vladmitkovsky"
priority: "P2"
status: "in-progress"
start_date: "2026-10-08"
duration: 3
depends_on: []
blocks: []
tags:
  - "watch"
  - "accessibility"
  - "content-discovery"
---

## Problem

Watch listing cards omit runtime, episode count, audio/subtitle availability, and visible resume time despite the data being available through Admin and Watch progress.

## Scope

- Add a batched Admin projection for card runtime, episode count, and child audio/subtitle language counts without per-card queries.
- Render compact runtime/episode metadata and a captions badge on MediaCollection cards when data exists.
- Add a home-level Continue watching rail from the user's existing progress entries with a visible remaining-time label.
- Keep public Watch links and language slugs canonical.

## Verification

- Cover Admin resolver/data batching, media-item enrichment, metadata rendering, and continue-watching states.
- Run Admin and Web focused tests, schema print/gql.tada generation if the Admin schema changes, typechecks, scoped lint, and Web production build.
- Compare Watch home rendering and loading behavior before/after.
