---
id: "feat-694"
title: "Allow develop Watch recommendation requests"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-13"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "recommendations"
---

## Problem

`develop.jesusfilm.org/watch` proxies production Web, but recommendation Route
Handlers reject its browser Origin with `403 invalid_origin` before querying
Admin. The UI then hides the recommendation section.

## Entry Points — Read These First

1. `apps/web/src/lib/recommendation-route-policy.ts` — shared header validation.
2. `apps/web/src/lib/recommendation-route-policy.test.ts` — origin and JSON tests.
3. `apps/web/src/app/api/recommendations/route.ts` — delivery admission.

## Grep These

`validateRecommendationHeaders`, `expectedOrigin`, `invalid_origin`.

## What To Build

Accept the exact HTTPS develop origin when the configured canonical origin is
`https://www.jesusfilm.org`. Apply the shared policy to all recommendation routes.
Cover acceptance and rejection of lookalikes, insecure origins, non-default ports,
and cross-origin fetch metadata.

## Constraints

Preserve canonical URLs, host-only cookies, exact configured-origin acceptance,
loopback development behavior, and all other request validation. Do not trust
forwarded headers or wildcard domains. Server Actions' allowedOrigins does not
configure Route Handler admission; keep the explicit recommendation policy here.
No rendering, hydration, or page-load dependencies change.

## Verification

Run focused recommendation policy, API route, and component tests plus touched
file lint and formatting checks. After normal PR-to-main deployment, verify
recommendation cards on an eligible develop Watch video and confirm the delivery
endpoint no longer returns `invalid_origin` for the develop browser origin.

## Implementation Evidence

The exact develop exception is implemented in the shared Route Handler policy.
The new regression suite fails against the original policy with `invalid_origin`
and passes with the fix. On current main, 269 tests across 17 recommendation
policy, route, and UI test files pass; touched-file ESLint and Prettier pass.
Review found no additional origin bypass: same-origin fetch metadata remains
mandatory and unrelated canonical deployments do not inherit the exception.
Live verification remains pending the normal PR-to-main deployment, so this
work stays in progress until the deployed develop surface is checked.
