---
id: "feat-871"
title: "Prefer supplied catalog artwork in Studio footage browser"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Problem

Mux time-zero frames often show black. The footage browser should prefer the
supplied catalog thumbnail rather than a sampled frame.

## Entry Points

- `apps/manager/src/backend/admin-client.ts`: existing `video.images` GraphQL contract.
- `apps/manager/src/cms/gateway.ts`: optional artwork enrichment on bounded ID lookup.
- `apps/manager/src/services/studio-library-artwork.ts`: prefer catalog stills.
- `apps/manager/src/app/api/shorts/command/route.ts`: request artwork only for search results.

## Constraints

Use existing Admin fields; no schema or generated output changes. Preserve source
admission and timeline sampled frames. Fetch only admitted search IDs, not the
whole coverage library, and add no request at initial editor startup.

## Verification

Real catalog image status, adapter/artwork tests, library/loading tests, lint,
format and scoped typecheck evidence. Check that artwork uses the same GraphQL
request and is not requested by ordinary enrichment consumers.

## Result

Search opts into catalog artwork after resolving canonical video metadata. A
single `watchHomeVideos(coreIds)` request fetches artwork for the deduplicated
bounded set (max 100), using existing Admin fields. Selection prefers thumbnail,
then videoStill, then original URL. Artwork failure preserves enrichment metadata
so Mux fallback remains available. No Admin schema/deployment required; timeline
sampling remains unchanged. Normal enrichment consumers do not request artwork.

The earlier per-video alias approach failed for multi-video results because it
consumed a query-field rate-limit entry for every `video` alias. Reproduced with
19 hope catalog IDs: GraphQL returned “You are trying to access 'video' too often”
and artwork enrichment silently disappeared. The regression test failed before
replacing aliases with the existing batch query. Do not restore those aliases.

Live read-only verification: all 19 hope catalog matches returned by the batch
lookup have artwork; all 19 supplied image URLs return HTTP 200. Both metadata and
batch artwork lookups completed in 716ms in the probe (not a browser latency
claim). The intentional extra request is one batch per search, not one per card.
No requests added before Media intent. 33 focused adapter/gateway/artwork/loading/
workspace tests pass, including a 19-result case and artwork-failure isolation.
Lint, format and diff checks pass. The preview remains on the same remote URL.

Full typecheck reports the same six pre-existing LanguageGeoSelector
StaticImageData errors, with no errors in this change.
