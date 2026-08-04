# Watch Search Analytics In Datadog

Watch search analytics are canonical in structured Datadog logs from each
client. Web emits them server-side from `forge-web`; mobile emits them
client-side from `forge-mobile`. Both use the same message
(`watch_search analytics`) and the same `watch_search.*` attribute contract.
Datadog RUM result-click actions are supplemental session context and may be
sampled or blocked.

Per-client status (verified 2026-08-04):

- **`forge-web` — currently dark.** The last
  `service:forge-web @watch_search.event_name:watch_search` emission was
  2026-08-02T23:31Z, with zero rows in the 24 hours after. PR #1808 moved
  web's live search direct-to-client, bypassing `runSearch` — the server
  action that emits web's canonical log. Until web's owners re-wire the
  emission (a web hand-off, not part of the mobile parity work), the
  broadened query below returns mobile rows only. Do not read an empty
  `forge-web` slice as zero web searches.
- **`forge-mobile` — live.** Rows are client-emitted through the Datadog RN
  SDK and subject to SDK sampling, unlike web's unsampled server logs. Treat
  mobile counts as a floor.
- **`forge-tv` — subset.** TV emits the shared message but not the
  `watch_search.event_name` attribute, so the canonical query excludes it.
  When comparing three clients, add TV explicitly, e.g.
  `service:forge-tv "watch_search analytics"`. (Zero TV rows in the 48 hours
  before 2026-08-04 — a tiny fleet with likely no search traffic, not
  necessarily a pipeline fault.)

## Canonical Log Query

Use Datadog Logs Explorer:

```text
service:(forge-web OR forge-mobile) env:prod @watch_search.event_name:watch_search
```

`@watch_search.event_name` is the join facet — constant `watch_search` on
every canonical row, success and failure, from both clients.

Shared structured attributes (both clients):

- `@watch_search.query` — raw query text; the sole raw-text field
- `@watch_search.outcome` — `completed | no_result | failed`
- `@watch_search.request_type` — `search | load_more`
- `@watch_search.search_request_id` — UUID; joins the log to admin's
  `SearchTrace`, the RUM click action, and the first-party click/impression
  events. On success, mobile adopts admin's echoed request id.
- `@watch_search.result_count`
- `@watch_search.added_result_count` — `load_more` rows only
- `@watch_search.visible_result_count`
- `@watch_search.latency_ms` — see the latency carve-out below
- `@watch_search.response_search_mode` — success-only on mobile
- `@watch_search.search_language_slug`
- `@watch_search.failure_category` — failed rows

Web-only depth (server-emitted): `@watch_search.result_source`,
`@watch_search.route_language_slug`,
`@watch_search.search_language_english_name`,
`@watch_search.resolved_language_slug`,
`@watch_search.detected_query_language`, and `@watch_context.page_route` /
`@watch_context.referrer_origin` (the `@watch_context.*` attributes appear
only when a trusted Watch-event provider passes sanitized anonymous context
into the server analytics emitter).

Mobile-only attributes:

- `@watch_search.client_latency_ms` — integer client round-trip, present on
  every mobile row **including failures**
- `@watch_search.exact_query_included` — constant `true` today; the facet
  exists so a future query-text kill switch has somewhere to land
- `@watch_search.degraded` — success-only
- `@watch_search.offset`
- `@watch_search.error_code` — failed rows, alongside `failure_category`

`@watch_search.query` is exact query text (on web, the server-executed text
after `runSearch`'s 200-character cap; on mobile, the raw text as submitted).
Keep it as a log attribute, not a tag, log-based metric dimension, dashboard
group-by default, or monitor notification field.

## Latency Carve-Out

`@watch_search.latency_ms` is the server-side measure on both clients —
**except web's failed rows, which substitute client wall-clock into
`latency_ms`**. Mobile's failed rows instead omit `latency_ms` entirely and
carry `client_latency_ms`; when mobile's `latency_ms` is present it is always
admin's server-side measure (a float). For cross-client server-latency work,
use `latency_ms` on success rows only. For mobile round-trip health
(including failures), use `client_latency_ms`.

## Log Levels

Web logs failures at `error`; mobile logs them at `warn` because benign
rate-limit rejections share mobile's failure path. Never filter on log
status — filter on `@watch_search.outcome:failed`.

## Datadog MCP Path

When Datadog MCP log tools are available, use `analyze_datadog_logs` against
the same base query. Declare custom attributes in `extra_columns`; Datadog MCP's
SQL virtual table only exposes declared custom attributes.

Example extra columns:

```json
{
  "query": "service:(forge-web OR forge-mobile) env:prod @watch_search.event_name:watch_search",
  "time_window": "7d",
  "extra_columns": [
    { "alias": "query", "path": "@watch_search.query", "type": "string" },
    { "alias": "outcome", "path": "@watch_search.outcome", "type": "string" },
    {
      "alias": "request_type",
      "path": "@watch_search.request_type",
      "type": "string"
    },
    {
      "alias": "failure_category",
      "path": "@watch_search.failure_category",
      "type": "string"
    },
    {
      "alias": "latency_ms",
      "path": "@watch_search.latency_ms",
      "type": "number"
    },
    {
      "alias": "client_latency_ms",
      "path": "@watch_search.client_latency_ms",
      "type": "number"
    },
    {
      "alias": "result_count",
      "path": "@watch_search.result_count",
      "type": "number"
    }
  ],
  "sql": "SELECT query, COUNT(*) AS searches, SUM(CASE WHEN outcome = 'no_result' THEN 1 ELSE 0 END) AS no_results, SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failures, AVG(latency_ms) AS avg_latency_ms FROM logs WHERE request_type = 'search' GROUP BY query ORDER BY searches DESC LIMIT 50"
}
```

Use RUM aggregation tools only for supplemental click analysis over
`watch_search.result_clicked`.

## Common Recipes

Top searches:

```text
service:(forge-web OR forge-mobile) env:prod @watch_search.event_name:watch_search
@watch_search.request_type:search @watch_search.outcome:(completed OR no_result)
```

No-result searches:

```text
service:(forge-web OR forge-mobile) env:prod @watch_search.event_name:watch_search
@watch_search.outcome:no_result
```

Failures by category:

```text
service:(forge-web OR forge-mobile) env:prod @watch_search.event_name:watch_search
@watch_search.outcome:failed
```

Load-more health:

```text
service:(forge-web OR forge-mobile) env:prod @watch_search.event_name:watch_search
@watch_search.request_type:load_more
```

Latency by source or mode:

```text
service:(forge-web OR forge-mobile) env:prod @watch_search.event_name:watch_search
@watch_search.outcome:(completed OR no_result)
```

In Logs Explorer, aggregate p95 of `@watch_search.latency_ms` grouped by
`@watch_search.response_search_mode` (both clients), or by
`@watch_search.result_source` (web rows only — mobile does not carry it).
For mobile round-trip latency, aggregate `@watch_search.client_latency_ms`
instead.

Supplemental RUM clicks:

```text
service:(forge-web OR forge-mobile) env:prod @action.name:watch_search.result_clicked
```

RUM click actions include `@watch_search.search_request_id` and result
position/id/slug/type/title plus language context; web adds result source.
Mobile's action carries exactly seven keys: `result_position` (1-based),
`result_id`, `result_slug`, `result_title`, `result_type`,
`search_request_id`, `search_language_slug`. Click actions intentionally
never include exact query text; join an individual click to the canonical
log with `search_request_id` when needed.

## Click Counts: First-Party Events Vs RUM

For click and impression **counts**, prefer admin's first-party search-event
store over RUM. Mobile posts `RESULT_CLICKED` and `RESULTS_VIEWED` events to
admin's public `recordWatchSearchEvent` mutation as client `MOBILE` —
anonymous (no bearer), deduped per request id, visible ids capped at 50, and
with no client `occurredAt` (admin stamps its own clock). Those rows are
unsampled, unlike RUM. Use RUM for session and replay correlation, not for
counting.

Two caveats when reading these numbers:

- **RUM runs slightly ahead of admin's table — accepted, not a bug.** The
  RUM SDK batches locally and essentially always lands; the admin mutation
  can fail silently on a network error with no retry. CTR computed from RUM
  therefore runs slightly ahead of CTR from admin's table for the
  network-failure population. This asymmetry is already true on web.
- **Integrity.** The first-party rows arrive through an unauthenticated
  public mutation: the `client` field is client-declared and the only guard
  is a per-IP rate cap. Before reading an implausible CTR movement as
  product signal, cross-check `SearchTrace` volume for the same request ids.

## Correlation Chain (Mobile)

Mobile's canonical logs carry the RUM `session_id` and `view.id`, so a
search is reconstructible from Datadog alone: canonical log → RUM session →
the session's `WatchSearch` resource → the `watch_search.result_clicked`
action, all sharing one `search_request_id`.

## Production Smoke

Before closing a search-analytics ticket in production:

1. Submit a controlled Watch search with a sentinel query such as
   `analytics-smoke-<date>-<short-id>` on the client under test.
2. Confirm the search response returns normally.
3. In Datadog Logs Explorer, query:

```text
service:(forge-web OR forge-mobile) env:prod @watch_search.event_name:watch_search
@watch_search.query:"analytics-smoke-<date>-<short-id>"
```

4. Confirm the log has structured `watch_search.*` attributes, `service` is
   the emitting client (`forge-web` or `forge-mobile`), and the `message`
   field is `watch_search analytics`. (A web-side smoke will not pass while
   web's emission is dark — see the per-client status above.)
5. Confirm no app-supplied name, email, full user id, auth token, cookie,
   bearer/API key, IP address, or manual session id appears in the event.

## Access And Rollback

Exact query text can contain sensitive words typed by a viewer. Limit raw-query
views, notebooks, exports, dashboards, and saved searches to teammates who need
search analytics. Avoid monitors and alert payloads that include
`@watch_search.query`. The raw-term posture and retention window are governed
by the signed-off R43 assessment
(`docs/solutions/best-practices/mobile-datadog-rich-posture-data-governance-20260714.md`).

If exact query text needs to stop immediately on web, set this on the web
service and redeploy:

```bash
WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT=false
```

The server event will keep non-query fields such as outcome, result count,
latency, source, mode, language, and failure category. Re-enable by removing
the variable or setting it to `true`.

Mobile has no runtime kill switch: a baked `EXPO_PUBLIC_*` flag requires a
store release, so the query-text posture changes only with a shipped build.
`@watch_search.exact_query_included` is emitted as constant `true` so the
facet already exists if a switch ever lands.
