---
id: "feat-713"
title: "Bound Studio descriptor sources by actual HLS duration"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-17"
duration: 1
depends_on: []
blocks: ["feat-714"]
tags: [studio, sources, rendering]
---

## Problem

Attempt `cmvb5xwi2kzqtqa0syykg68c8` failed staging revision 19 of
`widow-vertical-components-20261016`: catalog duration 426197 ms admitted a
426180 ms trim, but preview/export HLS ends at 426166.67 ms.

## Entry Points — Read These First

- `apps/admin/src/services/studio-authoring/sources.ts`
- `apps/manager/src/services/studio-broker.ts`
- `packages/studio-contracts/src/hls.ts`
- `docs/plans/2026-10-17-studio-source-duration.md`

## Grep These

`playlistSegments`, `exactCatalog`, `resolveStudioDocumentSources`, `capture`

## What To Build

Use shared HLS parsing and rendition selection. Descriptor admission measures both
preview/export playlists and pins the smaller of catalog and complete media duration.
Reject unavailable requested ranges before retaining a descriptor. Repair affected
project through a new expected-revision command with newly captured source handles.

## Constraints

Keep catalog digest eligibility, immutable history, byte proofs, origin allowlists,
download bounds, and broker staging limits intact. Retained original MP4 sources
keep their existing admission path. Release through PR/main only.

## Verification

Regression reproduces the 426197/426166.67 mismatch, validates both rendition bounds,
and rejects unsupported/incomplete HLS. Run contract and source DB suites, Manager
broker tests, touched lint/type/format checks. Verify deployed revision and repair receipt.

## Production verification — 2026-10-17

Merged [PR #2766](https://github.com/JesusFilm/forge/pull/2766), commit
`90442e9f07f15efe5c662d6c9077cb04227c8b63`. Admin deployment
`d6f699f7-a8bf-4ff7-b21d-5b9880d2eeb9` is healthy.

The deployed source/authoring services, acting as SYSTEM, accepted the
expected-revision-20 repair as revision 21. Idempotency key:
`feat-713-widow-source-repair-20261017`. New source snapshot:
`65c497ea-b10b-46d5-9651-1840bb8d5397`, measured duration 426166 ms.
All 17 video source handles were replaced; only `film-scene.endMs` changed
from 426180 to 426166. Its 1928 frames and the 8856-frame timeline remain intact.
All 17 sources resolve within bounds. A deep comparison confirmed no other
document changes.

Historical PostgreSQL JSONB hashes match before and after repair:

- Revision 19: `f1999b4644b18d59a450d909a497bf38`.
- Revision 20: `360ca10db7020e9800682b9808da0b0e`.
- Original failed attempt result: `d0ee7889359b129095322f5cd1bc9759`.

Validation passed: contracts (46), source unit tests (8), fresh PostgreSQL
source/catalog/revision integration (4), and Manager broker/download/materialization/
render-input/draft-render tests (28). Admin, Manager and contracts typechecks,
touched lint, repository formatting and required GitHub CI passed.
