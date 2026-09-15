---
id: "feat-449"
title: "Personalized Watch row and page orchestration"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 8
depends_on:
  - "feat-373"
  - "feat-388"
  - "feat-390"
  - "feat-391"
  - "feat-393"
blocks:
  - "feat-396"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "personalization"
  - "rows"
  - "composition"
---

## Problem

A high-quality recommendation slate does not define a complete video homepage. Watch needs a separate, explainable orchestration layer that chooses useful row types, ranks titles inside each row, orders rows for the current viewer and device, and removes repetition across the page without making one model own every decision.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U32 contract.
2. `docs/roadmap/content-discovery/feat-393-recommendation-slate-composer.md` — one-list composition authority; do not broaden it into page orchestration.
3. `docs/roadmap/content-discovery/feat-388-editorial-recommendation-candidates.md`
4. `docs/roadmap/content-discovery/feat-390-continuation-recommendation-candidates.md`
5. `docs/roadmap/content-discovery/feat-391-qualified-popular-trending-candidates.md`
6. `apps/admin/src/services/scene-recommendations-retriever.ts` — current recommendation retrieval authority.
7. `apps/web/src/app/[locale]/[htmlLang]/page.tsx` and `apps/web/src/lib/watch-home.ts`
8. `apps/admin/src/app/dashboard/search/[requestId]/page.tsx` — current request-decision inspection pattern.

## Grep These

- `row|section|carousel|homepage`
- `continue watching|because you watched|popular|trending`
- `slate|compose|dedupe|diversity`
- `viewport|device|presentation|impression`

## What To Build

- Define versioned typed row contracts for `continue_watching`, `because_you_watched`, `interest`, `popular`, `trending`, `editorial`, and `new_for_you`, including row reason, title policy, eligibility, minimum/maximum fill, locale, device presentation, provenance, and fallback.
- Generate eligible row proposals from the existing continuation, profile/semantic, popular/trending, editorial, and discovery authorities without moving their business rules into the page orchestrator.
- Apply the explicit pipeline `candidate rows → row eligibility → rank titles within each row → rank/select rows → page-level deduplication and diversity → device-aware Watch page`.
- Keep `feat-393` responsible for composing one ranked list/slate. Page orchestration may invoke the published slate contract per row, but it owns cross-row ordering, repetition, coverage, and page budget separately.
- Begin with a deterministic, inspectable row-selection and ordering policy. Learned row ranking requires page-level exposure/outcome evidence and a later governed ticket.
- Preserve fixed editorial rows and pins, continuation priority where applicable, semantic fallback, accessible loading/empty states, and bounded page payload/latency.
- Record served, rendered, visible, and selected row/item exposure so later row-level learning can distinguish row choice, row position, item position, and device presentation.

## Admin Evidence Gate

- Show candidate rows, eligibility/rejection, per-row title order, selected rows, row movement, page-level removals/refills, duplicate reasons, diversity/coverage, device policy, payload/latency, fallback, and exact policy/manifest versions.
- Reconcile row and item impressions/selections separately, including rows served but never rendered or visible.
- Explain why each final row and title position differs from its source order without exposing raw viewer histories or profile contents.

The ticket is not complete until the deterministic page can be verified in Watch and its full row/item decision is reconcilable in the authorized Admin Recommendations area.

## Constraints

- Row orchestration is not a second candidate generator, item ranker, or replacement for the one-slate composer.
- Fixed editorial order and pins cannot be silently displaced; conflicts use an explicit deterministic policy and visible fallback.
- Cross-row deduplication must not empty critical continuation/editorial rows without a declared refill or suppression reason.
- The first implementation is deterministic. No learned row-order promotion occurs without trustworthy page-level exposure and a separate experiment ticket.
- Recommendations and page orchestration cannot gate video playback and must retain bounded device-aware payload and latency budgets.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test each row type, unavailable/empty source, minimum fill, deterministic ordering, duplicate title across rows, fixed editorial row, continuation priority, sparse locale, all-filtered rows, and deterministic fallback.
- Test desktop/mobile row budgets, responsive presentation, keyboard and screen-reader navigation, constrained network, bounded payload, and page-level latency.
- Test row/item served-versus-rendered-versus-visible exposure, selection attribution, duplicate replay, instrumentation degradation, and source provenance through the final page.
- Run composition property tests proving uniqueness, policy constraints, stable tie-breaking, and no loss of fixed/pinned authority.
- Verify a real Watch homepage journey and reconcile candidate rows through final item selections in Admin.
- Run affected Admin/Web tests, lint, and typechecks.
- Run `pnpm --filter roadmap generate:readme` and `pnpm --filter roadmap lint` after updating roadmap metadata.
