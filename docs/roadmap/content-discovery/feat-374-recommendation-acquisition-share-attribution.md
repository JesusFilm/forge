---
id: "feat-374"
title: "Recommendation acquisition and share attribution"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: ""
duration: 4
depends_on: []
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "attribution"
  - "sharing"
---

## October 2, 2026 scope decision

Cancelled the proposed cross-session acquisition and Forge-share attribution
programme. No bounded share-token/campaign journey and Admin acquisition funnel
is claimed from the current implementation. Watch still marks shared URLs in
`apps/web/src/lib/playback-discovery.ts`, records Share interactions, and keeps
configured GA/RUM navigation and interaction analytics. A Share action or a
referrer must not be treated as recommendation-caused playback without a proven
join. Additional acquisition attribution is optional for the selected bounded
recommendation product; actual broken Share/navigation analytics remain defects.

## Problem

Forge must distinguish how a viewer arrived from the in-session discovery path that later led to a video.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U7 contract.
2. `apps/web/src/lib/share.ts`
3. `apps/web/src/lib/`
4. `apps/admin/src/services/recommendations/`
5. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `referrer|referer|utm`
- `shareToken|shareId`
- `acquisition|discovery`

## What To Build

- Capture acquisition once per landing/session as an allowlisted class with normalized registrable domain where justified.
- Add bounded opaque Forge share and campaign identifiers that contain no profile or query data.
- Keep acquisition, immediate discovery, and recommendation candidate provenance as separate linked facts.
- Publish attribution coverage and readiness without turning acquisition source directly into durable taste.

## Admin Evidence Gate

- Show direct, Google, Forge share, generic referral, and unknown acquisition funnels through playback and mission outcomes.
- Show unknown rate, stripped or expired identifiers, and unmatched journey joins.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Never store full referrer URLs, paths, query strings, credentials, or evidence tokens.
- Later semantic search or recommendation discovery must not overwrite acquisition.
- Sanitize and encode every Admin-displayed acquisition value.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Test Google-to-search-to-recommendation, cross-session Forge share, referral, direct, expired token, malicious referrer, and privacy-safe token payloads.
- Test linkage, retention, deletion, and display sanitization.
- Reconcile representative journeys in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
