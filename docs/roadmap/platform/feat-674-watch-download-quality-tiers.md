---
id: "feat-674"
title: "Watch download quality tiers ignore legacy distro rows"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-09"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "download"
---

## Problem

FGE-71 / FGE-239. The Watch download picker sorts every catalog row by size and
picks head / `floor(n/2)` / tail. On production JESUS-film rows that maps
High to the legacy `distroSd` (480p) and Low to `distroLow` (240p) even though
the catalog carries real `high` (720p) and `low` (270p) rows. The reported
"plays inline instead of downloading" symptom was NOT reproduced (both origins
send `Content-Disposition: attachment`); this ticket fixes the tiering only and
does not claim to fix that symptom.

## Entry Points — Read These First

1. `apps/web/src/components/watch/download-options.ts` — `bucketDownloads`,
   `sortDownloadsByQuality`, `selectDefaultDownloadTier`.
2. `apps/web/src/components/watch/collection-download-options.ts` — consumes
   `bucketDownloads` per episode and intersects tiers.
3. `apps/web/src/components/watch/DownloadModal.tsx` — single-video picker.
4. `apps/web/src/components/watch/WatchPageClient.tsx` — hero Download CTA
   default tier.

## Grep These

- `bucketDownloads`
- `QUALITY_METADATA`
- `distroHigh`

## What To Build

1. Exclude `distro*` qualities from user-facing tiers.
2. Highest keeps the highest available supported fidelity. High = quality
   `high`; Low = quality `low` (never the size middle).
3. When `high` or `low` is missing, degrade to a real lower supported quality
   (sd / other known quality) and keep up to three distinct downloads:
   1 -> Highest; 2 -> Highest + Low.
4. Rows with unknown quality keep working through the existing fallback.
5. Preserve opaque IDs and capabilities; no URL or host filtering in the
   client.

## Constraints

- No literal URL or host filtering in the client.
- No change to the download proxy, auth gate, permissions or TOS flow.
- No schema, generated output, authored data or media-source migration.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch/download-options.test.ts src/components/watch/collection-download-options.test.ts src/components/watch/__tests__/DownloadModal.test.tsx`
- `pnpm --filter @forge/web typecheck`

## Completion Notes

- `bucketDownloads` drops `distro*` rows, ranks by known quality priority
  (size only breaks ties inside one quality; unknown qualities rank last), and
  picks High = `high`, Low = `low`. Missing tiers degrade to a real lower
  quality, preferring another quality (`sd`) over the `fhd`/`highest` alias of
  `fhd`; the alias is a last-resort fallback so up to three distinct downloads
  survive.
- `sortDownloadsByQuality` (size-first) is unchanged and exported; it is no
  longer used for tiering.
- Not verified: the original "plays inline" symptom (not reproduced; both
  origins sent `Content-Disposition: attachment`). This ticket does not claim
  to fix it.
