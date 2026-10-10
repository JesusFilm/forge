---
id: "feat-040"
title: "Partner Activation Network"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: "2026-06-16"
duration: 28
depends_on:
  - "feat-039"
blocks:
  - "feat-042"
tags:
  - "manager"
  - "partner"
  - "distribution"
---

## Problem

The manager app can produce content, but it still lacks a distribution layer for ministry partners. Partners need role-aware access, localized recommendations, campaign collaboration, and structured community signals so content can move from central production into local activation.

## Entry Points — Read These First

1. `apps/manager/src/lib/auth.ts`, `apps/manager/src/lib/require-auth.ts`, `apps/manager/src/middleware.ts` — current manager auth and protection model
2. `apps/manager/src/app/login/page.tsx` and `apps/manager/src/app/dashboard/layout.tsx` — current authenticated manager shell
3. `docs/brainstorms/2026-03-28-manager-viewer-role-requirements.md` — existing role-expansion direction inside manager
4. `apps/manager/src/features/nav/dashboard-nav.tsx` — current role-agnostic dashboard navigation
5. `docs/roadmap/topic-experiences/feat-039-topic-discovery-programming-engine.md` — upstream content programming input for recommendations

## Grep These

- `Manager|Viewer|role` in `apps/manager/src/` and `docs/brainstorms/`
- `auth|login|logout` in `apps/manager/src/app/`
- `dashboard-nav|require-auth` in `apps/manager/src/`

## What To Build

1. Add a new Partner role and partner profile model.
   - Profile fields include location, audience, preferred languages, and ministry context.
2. Add partner-facing dashboard routes inside manager.
   - Personalized recommendations for videos, topic pages, and next-step actions.
3. Add campaign kits.
   - Manager users can package a campaign and share/localize it with partners.
4. Add partner collaboration.
   - Lightweight campaign threads or room-style conversations attached to a campaign.
5. Add campaign collaboration and structured partner feedback loops.

## Constraints

- Do NOT build a general-purpose CRM.
- Do NOT create an open public social network.
- Keep the first version scoped to authenticated partner activation inside the manager ecosystem.

## Verification

- A partner user can log in and see a role-appropriate dashboard.
- Recommendations change based on the partner profile.
- Campaign collaboration and partner feedback are limited to the correct partner context.
- Managers can review partner feedback and use it to improve activation and recommendations.
