---
id: "feat-442"
title: "Diagnose and recover Watch organic traffic"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-08-28"
duration: 7
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "seo"
  - "analytics"
---

## Problem

Watch clicks fell 30.3%, impressions 13.5%, and CTR from 0.8% to 0.6% in the
latest three-month comparison while average position stayed nearly flat. The
main JESUS film canonical consolidation explains only part of the loss.
Linear: FGE-116.

## Entry Points — Read These First

1. `apps/web/src/proxy.ts` — public Watch canonicalization and rewrites.
2. `apps/web/src/lib/routes.ts` — canonical public route builders.
3. `apps/web/src/lib/watch-seo-manifest.ts` — sitemap/hreflang source data.
4. `docs/solutions/workflow-issues/launchdarkly-watch-route-migration-conflict-resolution-20260528.md` — migration context.

## Grep These

- `canonical`
- `alternates`
- `hreflang`
- `watch-seo-manifest`
- `english.html`

## What To Build

Decompose the decline by URL/query/device/country, correlate it with known
deployments without overstating causality, audit the highest-loss canonical
groups, and produce ranked fixes or experiments with measurable recovery bars.

## Constraints

- Distinguish intentional consolidation from broken indexing.
- Account for seasonal demand before attributing the decline to code.
- Preserve compatibility URLs while their migration contract requires them.

## Verification

- High-loss groups have canonical, redirect, sitemap, hreflang, and internal-link evidence.
- The plan names exact files and tests for every proposed code change.
- Search Console post-release monitoring covers clicks, impressions, CTR, position, and indexed canonicals.
