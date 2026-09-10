---
id: "feat-477"
title: "Source-free user recommendations and Web For you row"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-10"
duration: 10
depends_on:
  - "feat-476"
blocks: []
tags:
  - "admin"
  - "web"
  - "recommendations"
  - "graphql"
  - "personalization"
---

## Problem

Recommendation delivery currently requires a source video. The Watch homepage
needs one six-card For you row using the returning viewer's server-side profile,
with curated videos filling only the places that profile recommendations cannot
fill. The same API must support independent anonymous mobile and TV installs.

The API and Web implementation are complete in the isolated local preview.
Production activation remains gated on feat-476 coverage and current production
validation; this ticket stays in progress until that rollout is resolved.
The code release is PR #2249, with both new serving flags defaulting off and no
production pool promotion or homepage publication. Before activation, also verify
cold-process delivery latency: one production-mode local startup request exceeded
the deadline, followed by successful six-card deliveries. The detailed merge
validation is in `docs/operations/user-recommendations-validation-2026-09-10.md`.

PR #2249 merged and its primary services deployed on 10 September UTC. Production
monitoring then found sustained Web Redis admission timeouts and image-fetch
connection failures above the pre-release baseline. A Web-only rollback restores
`apps/web` and the shared Watch experience selection to `ab801776`, preserving the
new Admin API, migrations, schema, viewer contracts and curation artifacts.
The full frontend implementation remains in #2249 and the original preview
worktree. Reintroduction requires a healthy production observation window and
investigation of the release-associated runtime delay; its root cause is not yet
established. See `docs/operations/user-recommendations-rollout-2026-09-10.md`.

## Entry Points — Read These First

1. `docs/plans/2026-09-10-001-feat-source-free-user-recommendations-plan.md`
2. `apps/admin/src/services/recommendations/delivery.service.ts`
3. `apps/admin/src/services/recommendations/candidates/profile-candidate.service.ts`
4. `apps/admin/src/services/recommendations/profile.service.ts`
5. `apps/admin/src/services/recommendations/caller.ts`
6. `apps/web/src/components/home/WatchHomeExperiencePage.tsx`
7. `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`

## Grep These

- `seedMediaId|assertWebRecommendationCaller`
- `profileTokenDigest|RecommendationProfile`
- `WatchHomeCategoryRailBlock|legacyCategoryRailCompatibility`
- `RecommendationPlaybackEpisode|RecommendationOutcomeRevision`

## What To Build

- Add source-free ranked delivery with a bounded count parameter, default six.
- Expose a cookie-independent opaque viewer identity and playback-feedback
  contract while retaining the existing Web cookie adapter and server profile.
- Fill from profile results first, then relevant curated interest pools and the
  selected playback language's start pool, after eligibility/history/dedup checks.
- Consume the one-time, versioned curation artifacts from feat-476. Validate
  sufficient unique coverage per language before activation.
- Register a top-level `HomepageRecommendationsBlock` through Admin validation, editor,
  GraphQL/shared fragments and Web dispatch, with a localized “Recommended for You”
  heading. Place it below Browse by category in the homepage starter; preserve
  editor order and removal. Refresh on
  homepage return/reload; keep cards stable during browsing.
- Attribute qualified playback and update the same anonymous profile. Measure
  returning/profile-backed and cold-start outcomes separately.

## Constraints

- No cross-device history, account linking, native UI implementation, full
  homepage orchestration, monthly AI worker, or recurring curation spend.
- Curated candidates never displace sufficient eligible profile candidates.
- Preserve existing seeded delivery and token/receipt/privacy-generation checks.
- Do not add a consent prompt; preserve existing default-on Web behavior and
  profile reset/settings behavior.
- Six-card coverage is a requirement to prove, not an inference from creating
  several overlapping pools. Do not silently relax language, completion, or
  canonical-distinctness rules to manufacture coverage.
- Public Core metadata alone cannot establish Admin recommendation eligibility.
- Regenerate Admin SDL and admin-graphql outputs for GraphQL changes.
- Production activation follows the normal PR-to-main deployment flow.

## Verification

- Contract tests: cookie-free bootstrap/read/feedback, invalid and reset tokens,
  bounded count, and compatibility with seeded delivery.
- Composition tests: six profile plus zero curated; four plus two; zero plus six;
  overlaps, completion filtering, partial-watch penalty, and deadline fallback.
- Real-DB checks: nullable seed migration, profile retrieval without a seed,
  eligibility, bounded history, import/rollback, and per-language coverage.
- Browser checks: exact homepage placement, six cards, stable browsing, refresh
  after playback/navigation, localization, keyboard interaction, and no token
  leakage. Compare homepage load performance and layout shift with baseline.
- Follow plan verification and retain unresolved coverage/activation gates
  explicitly. Run Markdown formatting and roadmap validation for ticket changes.

## Implementation and validation

- Consumer contract: `docs/operations/user-recommendations.md`.
- Local checks and browser evidence: `docs/operations/user-recommendations-validation-2026-09-10.md`.
- Coverage: `docs/recommendations/curation/2026-09-10/all-context-coverage-report.md` audits all 521,325 website locale/audio combinations in the local snapshot. `admin-coverage-report.md` records the three active preview contexts. Missing translations and sparse inventory still prevent broad activation.
- Shared native/Web operations: `packages/admin-graphql/src/operations/user-recommendations.ts` and `recommendations.ts`.
- New delivery/history/identity services: `apps/admin/src/services/recommendations/user-delivery.service.ts`, `user-history.service.ts`, and `viewer-identity.service.ts`.
- No production deployment, native UI, account linking or monthly worker was added.
