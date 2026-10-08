---
id: "feat-644"
title: "Log unclassified Watch profile failures safely"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "recommendations"
  - "observability"
---

## Problem

Linear FGE-179: intermittent `POST /watch/api/recommendations/profile` 503s
fall through to the generic response without a useful Railway plain-string log.

## Entry Points — Read These First

1. `apps/web/src/app/api/recommendations/profile/route.ts` — profile route catch.
2. `apps/web/src/lib/recommendation-route-response.ts` — shared public error mapping.
3. `apps/web/src/app/api/recommendations/profile/route.test.ts` — route response tests.

## Grep These

- `recommendationError`
- `recommendations_unavailable`
- `RecommendationRouteError`
- `RecommendationRuntimeError`
- `recommendation.profile.unclassified`

## What To Build

- Log one plain string beginning `event=recommendation.profile.unclassified`
  before an otherwise-unclassified profile exception returns the existing 503.
- Include only a bounded reason classification; never log raw exception text,
  request bodies, cookies, URLs, profile tokens, or serialized objects.
- Keep known route/runtime mappings and response bodies unchanged.
- Test the unknown-error path and the known-classification paths.

## Constraints

- Do not change recommendation policy, consent behavior, or response status mapping.
- Do not run production requests or access user data.

## Verification

- `pnpm exec vitest run src/app/api/recommendations/profile/route.test.ts` from `apps/web`.
- Run web typecheck and focused lint/format checks.
