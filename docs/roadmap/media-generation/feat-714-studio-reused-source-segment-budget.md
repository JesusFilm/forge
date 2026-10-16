---
id: "feat-714"
title: "Reuse source downloads within Studio render preparation"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-17"
duration: 1
depends_on: ["feat-713"]
blocks: ["feat-715"]
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
- `apps/manager/src/services/studio-render-input.ts`
- `apps/manager/src/services/studio-render-input.test.ts`
- `docs/plans/2026-10-17-studio-source-duration.md`

## Grep These

`createStudioSourceDownload`, `readBounded`, `transferred`, `prepareStudioRenderSources`

## What To Build

Cache canonical downloads for one preparation. Count unique downloaded bytes
against the existing aggregate limit. Reuse exact cached bytes for subsequent
clips while preserving per-read limits, cancellation, origin checks, and all codec
verification/materialization. Do not retain cache across preparations. Reuse retained reads by exact immutable
asset reference and packaged files by verified digest so repeated export segments
do not exhaust the downstream 128 MiB worker-input limit.

## Constraints

Keep the production budget at 256 MiB and one active preparation per process.
Cache memory and staged segment files must remain bounded by that budget.
Reuse segment filenames by URL identity rather than duplicating files per clip. No lower-resolution fallback,
proof bypass, external service, or paid render is needed for this correction.

## Verification

Small-budget tests prove repeated segment reuse, distinct-byte exhaustion,
per-read limits on cached bytes, cancellation, origin checks and per-preparation
isolation. Packaging regression must prove 17 repeated source clips produce one
retained export segment read/file and valid playlist references. Recompute live source preflight with unique transfer accounting and
verify all corrected source ranges. Run broker tests, typecheck, lint and format.

## Production verification — 2026-10-17

Merged [PR #2766](https://github.com/JesusFilm/forge/pull/2766), commit
`90442e9f07f15efe5c662d6c9077cb04227c8b63`. Manager deployment
`38961474-90d3-44a5-861d-0273b8e82399` and Admin deployment
`d6f699f7-a8bf-4ff7-b21d-5b9880d2eeb9` are healthy.

Corrected production revision 21 passes the live source-range preflight.
The 158 segment uses need 30 unique URLs, totaling 51.43 MiB, plus about
0.23 MiB of other retained inputs. Existing 256 MiB preparation and 128 MiB
worker-input limits remain unchanged.

Regression coverage proves per-preparation transfer reuse, distinct-byte budget
exhaustion, bounded cached reads and cancellation, origin validation, retained
reference reuse, one packaged file per verified digest, and valid references from
17 repeated clips. All targeted tests, typechecks, formatting, and required CI passed.

The first full production verification attempt hit the separate 90-second
preparation deadline before committing a preparation receipt. Follow-up feat-715
tracks that measured execution bottleneck; byte-budget and source-range fixes
remain deployed and verified independently.
