---
id: "feat-908"
title: "Bound Watch manifest negative proof to successful retrieval freshness"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-24"
duration: 1
depends_on: []
blocks: []
tags: [web, platform, watch-route, route-manifest, availability]
---

## October 29 current-main update

Renumbered from feat-790 because main assigned that ID to the TV feedback
hostname migration. Preserve the TV ticket unchanged. The route-surface helper
introduced by main moves with its catch-all route into `(content)` and keeps
its relative import in the page. Current audience resolver changes are retained.

## Problem

PR #2848 can answer hard 404 for newly published routes indefinitely during
manifest refresh failures. The last-good cache renews its retry expiry even
when retrieval failed. Index presence alone cannot prove current absence.

## Entry Points — Read These First

1. `apps/web/src/lib/watch-route-manifest.ts`: fetch, cache, completeness.
2. `apps/web/src/proxy.ts`: ordinary and unavailable-language misses.
3. `docs/plans/2026-10-24-pr2848-manifest-negative-proof.md`.
4. `apps/web/CLAUDE.md`: process-local 60 second manifest cache contract.

## Grep These

- `canWatchRouteManifestProveMiss`
- `WATCH_ROUTE_MANIFEST_CACHE_TTL_MS`
- `buildUnavailableLanguageNotFound`

## What To Build

Track successful authenticated retrieval independently from retry expiry. Only a
complete snapshot retrieved or conditionally validated within 60 seconds may
prove a hard miss. Failed refreshes retain positive admission but cannot renew
negative proof. Ordinary and language-gap misses degrade to private/no-store
soft recovery. Preserve admission, bounded sentinels, and fresh confirmed 404s.

## Constraints

Local repair only; no publication, authenticated live API, provider calls,
production mutation, schema/dependency changes, or admission-policy loosening.
Keep this ticket in progress until independent acceptance; exact-head CI and
live-manifest qualification remain separate gates.

## Verification

- Offline real-proxy fake-time/fetch fixtures: 503/throw/invalid refresh,
  new routes/languages, seven-day outage, TTL edges, 304, and recovery.
- Focused routing/admission tests, Web typecheck, lint, format, commitlint.
- Matched original/candidate HTTP response and request-cost evidence.
- Actual production Next document 404 for fresh ordinary/language-gap misses;
  real-TTL soft recovery, retained positives and publication recovery through
  `apps/web/e2e/watch-manifest-document-status.spec.ts`.
- Shared-root browser RSC-to-DOM continuity and matched local document loading
  observations; preserve normal streaming in the `(content)` route group.
