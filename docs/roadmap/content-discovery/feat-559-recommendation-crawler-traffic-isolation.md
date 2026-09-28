---
id: "feat-559"
title: "Isolate crawler and speculative recommendation traffic before persistence"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-09-28"
duration: 2
depends_on: []
blocks: []
tags: [web, admin, recommendations, graphql, integrity]
---

## Problem

Recognized crawler requests can commit recommendation traces despite being
excluded from experiments and engagement evidence. Automatic profile bootstrap
and speculative browsing also need enforcement before their first write.

## Entry Points — Read These First

1. `docs/plans/2026-09-28-002-fix-recommendation-traffic-isolation-plan.md`.
2. `apps/web/src/lib/recommendation-human-admission.ts` and
   `apps/web/src/app/api/recommendations/route.ts`.
3. `apps/admin/src/services/recommendations/delivery.service.ts` and
   `user-delivery.service.ts`.
4. `docs/analytics-and-recommendation-policy.md`.

## Grep These

`eligibleHuman`, `machine_ineligible`, `authorizeProfile`, `prerendering`,
`RecommendationConsentShell`, `observeRecommendationDelivery`.

## What To Build

Implement plan U1/U2/U4: trusted origin traffic classification, read-only public
crawler delivery in seeded and For You surfaces, speculative activation deferral,
profile bootstrap protection, and bounded aggregate exclusion observations.

## Constraints

No human classification inferred from missing UA. Preserve ordinary recommendations,
keyboard navigation, configured analytics, no-consent prerequisite, privacy
withdrawal/deletion, rate limits and strict caller validation. No raw identifiers
in observations. Deploy through normal PR-to-main only.

## Verification

Prove excluded paths perform zero relevant database writes in disposable Postgres;
verify ordinary delivery/attribution, parser compatibility, activation/StrictMode/
BFCache behavior, schema generation, page-load request timing, targeted checks
and production convergence observations. Keep production proof separate from
unit-test success.
