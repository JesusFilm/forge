---
id: "feat-335"
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
4. `apps/web/src/lib/watch-search-analytics.ts` + `apps/web/src/lib/search-actions.ts` — the target contract: message, `watch_search.*` attributes, vocabularies, event posts, and the failed-path `latency_ms` substitution the runbook must carve out. (2026-08-04: web's search call moved client-side in #1808 and currently bypasses the server action that emits the canonical log; the event posts remain server actions. The contract shapes here are still the target.)
5. `apps/tv/src/lib/watchSearchLog.ts` + `apps/tv/src/lib/search.ts` — the sibling RN precedent (UUID id, dotted keys, RUM click action).
6. `docs/operations/watch-search-analytics-datadog.md` — the runbook that must cover `service:forge-mobile` when this ships.
7. `docs/observability/watch-search-datadog-monitors.md` — the failure-monitor spec (plan U10): monitor query, threshold rationale, calibration procedure, and the post-merge operator tail this ticket tracks.

## Grep These

- `generateSearchRequestId|searchRequestCounter` in `apps/mobile/src/lib/`
- `watch_search_failed|search\.result_clicked` in `apps/mobile/` (retired names; guard tests must pin their absence)
- `recordWatchSearchEvent|WatchSearchEventClient|MAX_VISIBLE_RESULT_IDS` in `apps/admin/src/`
- `watch_search\.` in `apps/web/src/lib/watch-search-analytics.ts` (attribute inventory)
- `authHeadersForOperation` in `apps/mobile/src/lib/authHeaders.ts` (no-bearer property for event mutations)
- `watch_search` in `docs/observability/fleet-ceiling-datadog-monitors.md` (calibration recipe keyed to retired names, mislabeled RUM)

## What To Build

The plan's Product Contract carries the full requirements. In brief: UUID request ids preferring admin's echoed `requestId`; one canonical `watch_search.*` log for success and failure with web's vocabularies (`completed|no_result|failed`, `search|load_more`), allowlisted attributes, and split `latency_ms`/`client_latency_ms`; the shared `watch_search.result_clicked` RUM action (1-based positions, no query text); anonymous fire-and-forget `RESULT_CLICKED`/`RESULTS_VIEWED` posts to admin deduped per request; runbook and prose-sweep updates; guard tests pinning the retirement and the no-bearer property; and one Datadog monitor on `watch_search.outcome:failed` for `service:forge-mobile`, specified in `docs/observability/watch-search-datadog-monitors.md` (threshold calibrated after alignment ships — this last piece exceeds web parity and is not in the absorbed branch docs).

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

## Remaining Work — Post-Merge Operator Tail

The code and docs merge as one increment, but the failure monitor itself cannot ship from the repo (no monitor-as-code) — it remains operator work, owned by this ticket's owner and specified in `docs/observability/watch-search-datadog-monitors.md` (§3–§5):

1. Create the WS1 log monitor in the Datadog UI per the spec.
2. Let aligned logs accumulate ~1 representative week of prod traffic post-ship.
3. Read the week's failure counts — including the benign `RATE_LIMITED`/`http_429` baseline — and set the threshold + evaluation window to clear that baseline (counts are a floor under SDK sampling).
4. Replace `@REPLACE_WITH_ALERT_CHANNEL` with the real notification handle.
5. Firing-test with a synthetic burst of failed mobile searches — the completion test is that burst paging the chosen channel (plan AE6).

Deadline: monitor live and firing-tested within 14 days of merge. This ticket stays `status: "in-progress"` until the firing test passes, even after the PR merges; flip to `complete` only then.
