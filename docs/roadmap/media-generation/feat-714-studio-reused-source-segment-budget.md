---
id: "feat-714"
title: "Reuse source downloads within Studio render preparation"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-17"
duration: 1
depends_on: ["feat-713"]
blocks: []
tags: [studio, sources, rendering]
---

## Problem

After correcting feat-713's invalid endpoint, the widow project's 17 source clips
would transfer 273.10 MiB across 158 segment uses, exceeding the 256 MiB staging
budget. Only 30 unique segment URLs (51.43 MiB) are needed; repeated backgrounds repeatedly
download identical bytes.

## Entry Points — Read These First

- `apps/manager/src/services/studio-broker.ts`
- `apps/manager/src/services/studio-broker-download.test.ts`
- `docs/plans/2026-10-17-studio-source-duration.md`

## Grep These

`createStudioSourceDownload`, `readBounded`, `transferred`, `prepareStudioRenderSources`

## What To Build

Cache canonical downloads for one preparation. Count unique downloaded bytes
against the existing aggregate limit. Reuse exact cached bytes for subsequent
clips while preserving per-read limits, cancellation, origin checks, and all codec
verification/materialization. Do not retain cache across preparations.

## Constraints

Keep the production budget at 256 MiB and one active preparation per process.
Cache memory and staged segment files must remain bounded by that budget.
Reuse segment filenames by URL identity rather than duplicating files per clip. No lower-resolution fallback,
proof bypass, external service, or paid render is needed for this correction.

## Verification

Small-budget tests prove repeated segment reuse, distinct-byte exhaustion,
per-read limits on cached bytes, cancellation, origin checks and per-preparation
isolation. Recompute live source preflight with unique transfer accounting and
verify all corrected source ranges. Run broker tests, typecheck, lint and format.
