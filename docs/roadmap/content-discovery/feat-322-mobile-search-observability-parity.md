---
id: "feat-322"
title: "Mobile search observability parity with web"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-07-27"
duration: 5
depends_on: []
blocks: []
tags:
  - "mobile"
  - "search"
  - "observability"
  - "analytics"
  - "datadog"
  - "watch"
---

## Problem

Mobile's Watch search shares admin's `watchSearch` contract with web but none of web's telemetry methodology (feat-197, web-only, complete). Three costs, descending severity: (1) mobile's per-process counter request ids (`search-1`, …) pass admin's validator and fuse unrelated searches into single rows at admin's dashboard read layer, which groups traces and joins click events by `requestId`; (2) mobile posts no `RESULT_CLICKED`/`RESULTS_VIEWED` events to admin's public search-event store (its client enum already has `MOBILE`), so mobile searches read as zero-click, and its Datadog logs use flat bare keys and private vocabularies invisible to every runbook query; (3) no platform has any search-failure detection, and mobile's failures are 200-body GraphQL codes RUM error tracking cannot see.

## Entry Points — Read These First

1. `docs/plans/2026-07-28-002-feat-mobile-search-observability-parity-plan.md` — the implementation-ready plan for this ticket (R1–R12, U1–U10, Verification Contract); the exploratory branch whose design it absorbed was deleted 2026-07-28, so the plan is the single source.
2. `apps/mobile/src/lib/watchSearchLog.ts` — the counter id and outcome vocabulary being replaced.
3. `apps/mobile/app/(tabs)/watch.tsx` — every emit site (search success/failure, load-more, result tap).
4. `apps/web/src/lib/watch-search-analytics.ts` + `apps/web/src/lib/search-actions.ts` — the target contract: message, `watch_search.*` attributes, vocabularies, event posts, and the failed-path `latency_ms` substitution the runbook must carve out.
5. `apps/tv/src/lib/watchSearchLog.ts` + `apps/tv/src/lib/search.ts` — the sibling RN precedent (UUID id, dotted keys, RUM click action).
6. `docs/operations/watch-search-analytics-datadog.md` — the runbook that must cover `service:forge-mobile` when this ships.

## Grep These

- `generateSearchRequestId|searchRequestCounter` in `apps/mobile/src/lib/`
- `watch_search_failed|search\.result_clicked` in `apps/mobile/` (retired names; guard tests must pin their absence)
- `recordWatchSearchEvent|WatchSearchEventClient|MAX_VISIBLE_RESULT_IDS` in `apps/admin/src/`
- `watch_search\.` in `apps/web/src/lib/watch-search-analytics.ts` (attribute inventory)
- `authHeadersForOperation` in `apps/mobile/src/lib/authHeaders.ts` (no-bearer property for event mutations)
- `watch_search` in `docs/observability/fleet-ceiling-datadog-monitors.md` (calibration recipe keyed to retired names, mislabeled RUM)

## What To Build

The plan's Product Contract carries the full requirements. In brief: UUID request ids preferring admin's echoed `requestId`; one canonical `watch_search.*` log for success and failure with web's vocabularies (`completed|no_result|failed`, `search|load_more`), allowlisted attributes, and split `latency_ms`/`client_latency_ms`; the shared `watch_search.result_clicked` RUM action (1-based positions, no query text); anonymous fire-and-forget `RESULT_CLICKED`/`RESULTS_VIEWED` posts to admin deduped per request; runbook and prose-sweep updates; guard tests pinning the retirement and the no-bearer property; and one Datadog monitor on `watch_search.outcome:failed` for `service:forge-mobile` (threshold calibrated after alignment ships — this last piece exceeds web parity and is not in the absorbed branch docs).

## Constraints

- No `apps/admin`, `apps/web`, or `apps/tv` code changes.
- Never attach the fleet bearer to any operation other than `WatchSearch`.
- Telemetry never throws into the app or blocks navigation.
- Raw query text lives only in the canonical log (`watch_search.query`), never in RUM actions or admin events.
- The house `domain.event_name` log style breaks only for cross-client search events; mobile-only events (e.g. `search.prefetch`) keep it.
- Simulator verification runs against local admin so dev taps never write into prod's event store.

## Verification

- `pnpm --filter @forge/mobile test` and `pnpm --filter @forge/mobile typecheck` green, including the new guard tests.
- Simulator flow against local admin: `psql "$DATABASE_URL" -c "SELECT request_id, event_type, client, position FROM watch_search_event ORDER BY occurred_at DESC LIMIT 5;"` shows `client = mobile`, position 1, UUID request ids; a matching `search_trace` row shares the id.
- Datadog: `service:forge-mobile @watch_search.event_name:watch_search` returns the search; `@action.name:watch_search.result_clicked` carries the same `search_request_id` and no query text.
- Two fresh installs' first searches appear as two distinct rows in admin's dashboard.
- The monitor fires on a synthetic failure spike; its threshold rationale is written down where it lives.
