---
id: "feat-564"
title: "Public navigation authority for cached Watch relative links"
owner: "nisal"
priority: "P2"
status: "cancelled"
start_date: ""
duration: 3
depends_on: []
blocks: []
tags:
  - "web"
  - "recommendations"
  - "watch"
  - "caching"
---

## Problem

Some public Watch aliases rewrite to the same internal cached route without
redirecting the browser. A navigation-relative authored anchor therefore has
different destinations on those public pages even though the server source
adapter receives identical internal route parameters. Origin-only resolution
can invent a served target or omit a real card and shift later positions.
Feat-373 must withhold the affected source's served denominator when its exact
public navigation base is unavailable. This follow-up was proposed to address
that explicit coverage gap; it did not establish a deployed defect in a
particular authored production block. Its original Admin evidence gate is
superseded by the October 2 disposition below.

## October 2, 2026 disposition

**Cancelled as optional source-coverage expansion.** Existing renderer parity
fixtures demonstrate that relative raw and Markdown anchors can resolve to
different destinations on admitted public aliases sharing an internal ISR key.
The source compiler already withholds the entire ambiguous manifest and its
served denominator, while the browser follows its actual anchor. No deployed
authored block with incorrect measured attribution or failed navigation is
established by those fixtures. Unknown denominator is the accepted limit;
there is no fabricated served count or claim of complete coverage.

The owner retired feat-373's exhaustive source-coverage gate while preserving
the deployed supported-surface evidence and normal Watch analytics. The
[October 2 feat-373 disposition](feat-373-watch-surface-impressions-ctr.md#october-2-2026-disposition)
records the distinction. A future product choice to measure these aliases
would need an origin-owned public path before signing, with ISR, exact DOM
position/path matching, and privacy preserved. A reproduced incorrect
attribution, failed issuance or broken navigation would instead be a defect
requiring investigation. This cancellation implements no routing or player
change and asserts no new deployment.

## Entry Points — Read These First

1. `apps/web/src/proxy.ts` and `apps/web/src/proxy.test.ts` — public path rewrites, compatibility aliases and `WATCH_INTERNAL_REWRITE_HEADER`.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — normalized internal parameters, `dynamic = "force-static"` and one-hour ISR.
3. `apps/web/src/lib/watch-surface-manifest.sources.ts` — raw and Markdown anchor projections and any explicitly proven home-only base.
4. `apps/web/src/lib/watch-surface-manifest.ts` — measured-path admission; unresolved relative strings cannot use a guessed origin base.
5. `apps/web/src/components/recommendations/WatchExposureBoundary.tsx` — actual browser `anchor.href` resolution and exact position/path matching.
6. `apps/web/src/lib/watch-surface-manifest.parity.test.tsx` — actual renderer anchors and public-document-base fixtures.

## Grep These

- `discipleship.html|english.html|episode-bare|WATCH_INTERNAL_REWRITE_HEADER`
- `force-static|revalidate|publicPathname|relativeHref`
- `authoredWatchSurfaceSource|watchSurfaceItemPath|anchor.href`

## What To Build

- Establish an origin-owned contract for the exact public navigation base at
  the source/renderer seam, accounting for admitted language, compatibility and
  episode aliases. First assess the final feat-373 implementation and any
  verified home-only contract.
- Preserve full-route caching and existing link destinations. Do not replace
  public browser authority with canonical metadata or normalized internal params.
- Resolve raw authored CTAs and compiled Markdown anchors by the same rule,
  retaining actual DOM order, ignored non-Watch links and later card positions.
- Keep unresolved sources explicitly unknown. Establish source authority before
  signing or issuing any served fact; client observations cannot supply an
  independent served denominator.

## Constraints

- Do not add request-specific `headers()`/cookies to the force-static path or
  disable caching merely to obtain a pathname.
- Do not change viewer destinations to make telemetry simpler, trust an
  arbitrary browser-provided base, or sign extra possible destinations as though
  they were the delivered card slate.
- Preserve crawler/speculative exclusion, bounded manifest size/expiry, replay
  semantics, anonymous identity boundaries and nonblocking navigation/player
  startup. No live ranking, flag, experiment or feat-505 dependency change.
- Coordinate the final approach and any contract changes with the exposure owner
  before implementation. Unknown coverage remains visible until verified.

## Verification

- Render the same authored block under `/watch/discipleship.html` and
  `/watch/discipleship.html/english.html`, plus supported episode aliases.
  Resolve expected anchors with the browser's actual document URL, not the
  source projection helper being tested.
- Cover `birth.html`, `watch/birth.html`, `#fragment`, `?query`, root-relative
  and absolute links, non-Watch links between measured cards, repeated blocks
  and raw/Markdown CTA families. Prove exact path and later-position agreement.
- Verify cached and fresh navigations, source-signature validity and distinct
  delivery windows in a real browser. Compare page-loading performance and
  confirm no server-only source compiler enters client bundles.
- Reconcile a bounded deployed Admin sample, preserving policy/placement/CTR
  and capability distinctions. Do not mark coverage complete from fixtures.
- Run affected Web tests, lint/typecheck, formatting and roadmap lint.
