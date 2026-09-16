---
id: "feat-514"
title: "Accept canonical Watch content slugs in recommendation requests"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-16"
duration: 1
depends_on: []
blocks: []
tags: [web, recommendations, watch, reliability]
---

## Problem

The live post-release recommendation journey reached
`/watch/origins-of-christmas--episode-1.html` and correctly recorded an attributed
muted preview, but its destination recommendation request returned HTTP 400.
`DeliveryInput.seedMediaSlug` uses a stricter single-hyphen regex than the
canonical `ContentSlug` domain, rejecting valid repeated hyphens and underscores.
This predates the viewing-mode release and can interrupt recommendation chains.

## Entry Points

- `apps/web/src/app/api/recommendations/route.ts`: `DeliveryInput.seedMediaSlug`.
- `apps/web/src/lib/routes.ts`: `CONTENT_SLUG_PATTERN`, `tryAsContentSlug`.
- `apps/web/src/app/api/recommendations/route.test.ts`: request and recovery tests.

## Implementation and Constraints

Reuse `tryAsContentSlug` while retaining the 191-character request bound. Keep
slashes, encoded separators, query delimiters and other non-content segments
invalid. Do not change canonical paths, catalog records, audio-locale validation,
admission, profile authority or response attribution.

## Verification

Reproduce the valid catalog slug returning 400, then require a successful delivery
for repeated-hyphen and underscore slugs. Assert malformed and oversized slugs
fail before Admin access. Run Web tests/types/lint/format and normal PR CI; revisit
the exact production destination and verify its recommendation response and row.
