---
id: "feat-713"
title: "Bound Studio descriptor sources by actual HLS duration"
owner: "tataihono"
priority: "P1"
status: "in-progress"
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
