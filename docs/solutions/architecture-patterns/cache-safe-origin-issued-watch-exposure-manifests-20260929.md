---
title: Cache-safe origin-issued Watch exposure manifests
date: "2026-09-29"
category: architecture-patterns
module: Anonymous Watch exposure measurement
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - Cached public pages need a server-established measurement denominator.
  - Client render facts must bind to trusted source cards without viewer identity.
tags: [watch, exposure, cache, manifests, activation, replay, retention]
---

# Cache-safe origin-issued Watch exposure manifests

## Context

Anonymous Watch blocks could report rendering, eligibility and selection, but
those client facts could not establish how many cards the origin issued.
Persisting during ISR generation would count cache builds rather than visits;
accepting a client-authored card list would let clients invent the denominator.
Making cached routes dynamic would also add request work before player startup.

## Guidance

Project public card authority from trusted source data and sign a reusable
descriptor while building the cached response. This step has no writes or
request identity. After activation and document load, exchange the descriptor
and a random retry nonce for an origin-persisted delivery window. Label served
as **persisted issuance**, since a successful write does not prove receipt or
an eligible impression.

The issuer serializes one nonce using a transaction-scoped advisory lock. A
binding-derived digest covers the complete source version, expiry, placement,
positions and paths. Exact retries replay the immutable slate; changed slates
conflict. An empty descriptor creates no rows/window and does not claim a nonce.
Only issued v2 cards admit browser facts, and later facts inherit the original
served expiry so retention cannot erase the denominator before its numerator.

Keep original event IDs and event times in a bounded buffer while issuance is
pending. On timeout, failure or unsupported source, retain explicit legacy v1
coverage with an unknown denominator. Navigation never waits for telemetry.
Selection before eligibility remains observable and cannot synthesize an
impression. Restored navigation and changed descriptors require new windows.

Trusted projection must mirror the actual renderer, including its early returns
and filtered card order. A chapter renderer returning null for fewer than two
children cannot authorize a parent title link. An empty collection cannot
authorize a CTA. Nested boundaries must own only their own anchors, and repeated
paths must retain occurrence positions.

Markdown projection should use the renderer's real compiler and traverse its
compiled host anchors, preserving CommonMark references and inert raw HTML.
Keep that compiler in a server-only source module and prove it is absent from
actual browser search/feed graphs. Cap aggregate authored parse bytes; overflow
withholds authority. Navigation-relative links also withhold authority until the
caller supplies the exact trusted public document base. Root/language home
routes can prove that base from their redirect/proxy contract; generic video and
episode routes cannot. Rootless same-scheme HTTPS forms are also document-relative
under WHATWG parsing despite their scheme prefix. A canonical path or an
internal ISR rewrite path is not automatically the browser's navigation base.
Withhold the whole ambiguous source rather than dropping links and shifting
positions. Follow-up feat-564 owns the remaining cached navigation authority.

Reserve bounded cross-service clock skew inside the lifetime ceiling: both
signers mint 47h55m descriptors, while verifier and issuer reject expiry beyond
48h from their own clocks. Up to five minutes of positive signer skew fits
without widening the ceiling. Signed expiry remains final, with no grace after
expiration.

Migration CHECK replacement and index creation must be atomic and bounded.
Migration 0105 uses a two-second lock timeout and 30-second statement timeout.
Test the actual migration SQL under contention: timeout, rollback, inspect the
original constraint/index state, release the lock, and retry the same migration.
Duplicating the desired schema in a service fixture cannot establish migration
rollback safety.

Report eligibility without a per-selection correlated scan over a materialized
CTE. Rank full admitted history first, then compute the first eligible time in
the exact delivery/config/policy/position/path partition. Apply window-start
qualification inside the window function, preserve receipt/end cutoffs, and
compare only the first selection. A 60,000-fact fixture reproduced the existing
three-second cancellation; this relational form completed in 338 ms. Bound output
is still not a bound on query work. Keep the statement budget and truncation
sentinel, and offer a registry-entry filter before cohort selection and ranking
so later groups remain inspectable without pretending a truncated table is full
coverage. Apply the same identity filter to the signed reader.

## Why This Matters

Cache reuse and measurement windows have different lifetimes. Reusing public
authority preserves caching, while issuing one nonce-bound window after
activation establishes a truthful denominator without viewer linkage. Reporting
served-only deliveries keeps lost receipts visible; separate v1/v2 cohorts
prevent legacy unknown counts from looking complete.

## When to Apply

Use this pattern for anonymous cached card surfaces whose source data is known
at the origin. Unsupported or ambiguous projections remain gaps. Keep
request-owned recommendation deliveries on their existing evidence contract.

## Examples

- `apps/web/src/lib/watch-surface-manifest.server.ts` signs and verifies reusable authority.
- `apps/web/src/lib/watch-surface-manifest.sources.ts` mirrors source renderers and owns bounded Markdown compilation.
- `apps/admin/src/services/recommendations/watch-surface-exposure.service.ts` issues immutable windows and binds ingestion.
- `apps/admin/src/services/recommendations/watch-surface-migration.db.test.ts` exercises actual SQL contention and retry.
- `docs/validation/2026-09-29-feat-373-browser-local.md` records local browser reconciliation and its limits. Native BFCache was not observed; hidden/prerender visibility checks were simulations. Deployed authorized Admin reconciliation remains necessary before completing feat-373.

## Related

- [Exclude crawler recommendation traffic before the first write](../logic-errors/recommendation-traffic-exclusion-before-persistence.md)
- [Per-visit randomness on a statically cached route](../performance-issues/per-visit-randomness-on-a-statically-cached-route-20260827.md)
- [Origin-issued manifest plan](../../plans/2026-09-29-feat-373-origin-served-manifests-plan.md)
