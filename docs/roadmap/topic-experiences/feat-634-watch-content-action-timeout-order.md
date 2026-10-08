---
id: "feat-634"
title: "Keep Watch content-action timeouts in deadline order"
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
  - "reliability"
---

## Goal

Keep the Admin content-action request timeout below the browser deadline so the server gets a chance to acknowledge a committed action before the client retries.

## Entry points

- `apps/web/src/lib/recommendation-timeouts.ts`
- `apps/web/src/lib/recommendation-content-actions.ts`
- `apps/web/src/lib/recommendations.ts`
- `apps/web/src/lib/recommendation-content-actions.test.ts`

## Constraints

- Keep the 700 ms browser deadline and use a 500 ms upstream timeout.
- Both values must be named shared constants, with a regression assertion that the upstream bound is smaller.
- Preserve best-effort share telemetry behavior.

## Verification

- Focused content-action timeout tests.
- Web typecheck and lint.

## Tracking

- Linear: FGE-188
