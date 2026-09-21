---
id: "feat-524"
title: "Private Watch recommendation tester links without login UI"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-21"
duration: 1
depends_on: []
blocks:
  - "feat-525"
tags:
  - "web"
  - "recommendations"
  - "launchdarkly"
---

## Problem

Watch has no exposed login flow for the requested three-person recommendation
pilot. Email-based LaunchDarkly targeting cannot identify anonymous browsers.
Provide private, expiring tester links without changing Watch UI.

## Entry Points — Read These First

1. `docs/plans/2026-09-21-001-feat-watch-recommendation-tester-access-plan.md`
2. `apps/web/src/lib/homepage-recommendations-flag.ts`
3. `apps/web/src/app/api/recommendations/for-you/availability/route.ts`
4. `apps/web/src/lib/recommendation-route-policy.ts`

## Grep These

- `homepageRecommendationsEnabled|WATCH_FOR_YOU_ENABLED`
- `watch-recommendation-tester|WATCH_RECOMMENDATION_TESTER_SECRET`

## What To Build

- Signed, origin-bound activation tokens and distinct signed tester cookies.
- A no-store activation endpoint, invisible fragment-to-POST bridge, and fixed
  redirect to `/watch`; no token in query strings, logs, or analytics.
- A dedicated LaunchDarkly tester context, used only for homepage recommendations.
- Operator CLI for issuing links, revocation instructions, and three-person LD targeting.

## Constraints

- No visible UI changes, Watch login, identity impersonation, or new consent gate.
- Keep the ordinary Watch static/cache and analytics paths unchanged.
- Links expire after 24 hours; cookies expire no later than seven days after issuance.
- Valid cookies never bypass LaunchDarkly or the existing environment kill switch.
- Production rollout follows PR-to-main; production secret provisioning and live
  validation must be recorded separately from code completion.

## Verification

- Token tampering, expiry, wrong audience/origin, missing configuration, body bounds,
  cross-origin activation, cookie properties, and no token reflection.
- Real signing → activation → availability integration and flag revocation checks.
- Existing signed-in/anonymous behavior, delivery gate, and kill-switch tests.
- Browser activation smoke with only local fixture credentials; measure ordinary
  anonymous evaluation overhead and preserve static route files byte-for-byte.
- Web lint/typecheck, focused tests, format, and security-focused review.

## Completion evidence

Implementation and LD targeting are complete. See
`docs/operations/watch-recommendation-tester-access.md` for local HTTP/VM test
evidence and the three target IDs. Real-browser smoke was unavailable because
no browser was connected. Production deployment, secret setup, and browser
activation are explicitly tracked by feat-525 and remain incomplete.
