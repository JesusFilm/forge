---
id: "feat-063"
title: "Personalize Discovery Experiences"
owner: "tataihono"
priority: "P2"
status: "cancelled"
start_date: "2026-10-01"
duration: 45
depends_on:
  - "feat-058"
  - "feat-090"
blocks:
  - "feat-064"
tags:
  - "search"
  - "personalization"
  - "discovery"
---

## October 2, 2026 closeout disposition

Cancelled under the owner's final recommendation-roadmap scope decision.
This broad umbrella is superseded by the implemented, individually audited anonymous-profile, candidate and client-delivery work (feat-378, feat-386, feat-447, feat-487 and feat-517). Cancel the redundant umbrella instead of claiming every historical search/homepage adaptation was built. Additional personalized page orchestration is retired under feat-449; measured causal benefit remains unestablished.

Audit anchors: `apps/admin/src/services/recommendations/profiles/projection.ts`, `apps/admin/src/services/recommendations/candidates/profile-candidate.service.ts`, `apps/web/src/components/recommendations/WatchForYouRecommendations.tsx`.
The audit establishes the current scope and code boundaries, not new production
verification. See [the consolidated closeout record](../../reports/2026-10-02-recommendation-roadmap-closeout.md)
for owner, PR, evidence and remaining operational work. The requirements below
are historical and do not authorize new implementation.

## Historical problem

Once semantic search is deployed, the next step is making discovery feel personal instead of generic. Search, recommendations, and landing experiences should adapt to a user's context, history, or intent so the platform highlights the most relevant content instead of the same ranking for everyone.

## Entry Points — Read These First

1. `docs/roadmap/content-discovery/feat-058-deploy-semantic-search-architecture.md` — deployed search foundation
2. `docs/roadmap/content-discovery/feat-046-recommendations-demo-experience.md` — recommendation UI baseline
3. `apps/web/src/app/page.tsx` — default discovery surface
4. `apps/web/src/lib/content.ts` — content query layer
5. `apps/manager/src/services/embeddings.ts` — vector-generation assumptions

## Grep These

- `search` in `docs/roadmap/content-discovery/`
- `recommend` in `docs/roadmap/content-discovery/`
- `content.ts` in `apps/web/src/lib/`
- `embedding` in `apps/manager/src/services/`

## What To Build

1. Define the signals that can shape personalized ranking without making the system opaque.
2. Add personalization hooks to discovery surfaces, recommendation APIs, or both.
3. Keep a clear fallback path for anonymous or low-signal sessions.
4. Make personalization measurable so later optimization work is grounded in outcomes.

## Constraints

- Do NOT assume full logged-in identity is required for every personalization use case.
- Keep ranking logic explainable enough for debugging and editorial review.
- Personalization should improve discovery, not trap users in narrow loops.

## Verification

- Discovery results can vary based on an explicit personalization signal
- Anonymous or low-signal users still receive a strong default experience
- The system records enough data to compare personalized and non-personalized outcomes
