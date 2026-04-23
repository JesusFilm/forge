---
id: "feat-042"
title: "Video Contests and Inspiration Feed"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: "2026-06-30"
duration: 28
depends_on:
  - "feat-040"
blocks: []
tags:
  - "manager"
  - "partner"
  - "community"
---

## Problem

Video contests and inspiration browsing are important enough to deserve their own product surface. Contest submissions, judging, featured entries, and an inspiration feed for strong examples should not be buried inside the general partner portal.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-08-manager-video-contests-inspiration-feed-requirements.md` — product scope and rationale
2. `docs/roadmap/platform/feat-040-partner-activation-network.md` — shared identity and partner-context assumptions
3. `apps/manager/src/lib/auth.ts`, `apps/manager/src/middleware.ts` — auth and role-protection model
4. `apps/manager/src/app/dashboard/` — route and dashboard-shell patterns for internal authenticated surfaces

## Grep These

- `Partner|role|dashboard` in `apps/manager/src/`
- `campaign|feedback` in `docs/brainstorms/2026-04-08-manager-partner-activation-network-requirements.md`

## What To Build

1. Add dedicated contest workflows for submissions, review states, judging notes, and featured winners.
2. Add an inspiration feed for standout contest entries and curated example videos.
3. Allow managers to move reviewed entries into the inspiration feed without duplicating content manually.
4. Support filtering by topic, language, audience, region, and campaign.

## Constraints

- Do NOT turn this into a public social network.
- Do NOT bury the feature as a sub-tab of partner activation with no independent workflow identity.
- Keep featured content human-curated even if ranking is assisted.

## Verification

- Contest submissions can be reviewed in structured states.
- Standout videos can appear in an inspiration feed with provenance intact.
- Teams can browse inspiration by useful editorial filters.
