# Watch Search Analytics In Datadog

Watch search analytics are canonical in server-side `forge-web` Datadog logs.
Datadog RUM result-click actions are supplemental browser context and may be
sampled or blocked.

## Canonical Log Query

Use Datadog Logs Explorer:

```text
service:forge-web env:prod @watch_search.event_name:watch_search
```

Expected structured attributes:

- `@watch_search.query`
- `@watch_search.outcome`
- `@watch_search.request_type`
- `@watch_search.search_request_id`
- `@watch_search.result_source`
- `@watch_search.response_search_mode`
- `@watch_search.result_count`
- `@watch_search.added_result_count`
- `@watch_search.visible_result_count`
- `@watch_search.latency_ms`
- `@watch_search.route_language_slug`
- `@watch_search.search_language_slug`
- `@watch_search.search_language_english_name`
- `@watch_search.resolved_language_slug`
- `@watch_search.detected_query_language`
- `@watch_search.failure_category`
- `@watch_context.page_route`
- `@watch_context.referrer_origin`

`@watch_search.query` is exact server-executed text after the existing
`runSearch` 200-character cap. Keep it as a log attribute, not a tag, log-based
metric dimension, dashboard group-by default, or monitor notification field.
`@watch_context.*` attributes appear only when a trusted Watch-event provider
passes sanitized anonymous context into the server analytics emitter.

## Datadog MCP Path

When Datadog MCP log tools are available, use `analyze_datadog_logs` against
the same base query. Declare custom attributes in `extra_columns`; Datadog MCP's
SQL virtual table only exposes declared custom attributes.

Example extra columns:

```json
{
  "query": "service:forge-web env:prod @watch_search.event_name:watch_search",
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
      "alias": "result_source",
      "path": "@watch_search.result_source",
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
service:forge-web env:prod @watch_search.event_name:watch_search
@watch_search.request_type:search @watch_search.outcome:(completed OR no_result)
```

No-result searches:

```text
service:forge-web env:prod @watch_search.event_name:watch_search
@watch_search.outcome:no_result
```

Failures by category:

```text
service:forge-web env:prod @watch_search.event_name:watch_search
@watch_search.outcome:failed
```

Load-more health:

```text
service:forge-web env:prod @watch_search.event_name:watch_search
@watch_search.request_type:load_more
```

Latency by source or mode:

```text
service:forge-web env:prod @watch_search.event_name:watch_search
@watch_search.outcome:(completed OR no_result)
```

In Logs Explorer, aggregate p95 of `@watch_search.latency_ms` grouped by
`@watch_search.result_source` and `@watch_search.response_search_mode`.

Supplemental RUM clicks:

```text
service:forge-web env:prod @action.name:watch_search.result_clicked
```

RUM click actions include `@watch_search.search_request_id`, result position,
result id/slug/type/title, source, and language context. They intentionally do
not include exact query text; join an individual click to the canonical server
event with `search_request_id` when needed.

## Production Smoke

Before closing the ticket in production:

1. Submit a controlled Watch search with a sentinel query such as
   `analytics-smoke-<date>-<short-id>`.
2. Confirm the search response returns normally.
3. In Datadog Logs Explorer, query:

```text
service:forge-web env:prod @watch_search.event_name:watch_search
@watch_search.query:"analytics-smoke-<date>-<short-id>"
```

4. Confirm the log has structured `watch_search.*` attributes, `service` is
   `forge-web`, and the `message` field is `watch_search analytics`.
5. Confirm no app-supplied name, email, full user id, auth token, cookie,
   bearer/API key, IP address, or manual session id appears in the event.

## Access And Rollback

Exact query text can contain sensitive words typed by a viewer. Limit raw-query
views, notebooks, exports, dashboards, and saved searches to teammates who need
search analytics. Avoid monitors and alert payloads that include
`@watch_search.query`.

If exact query text needs to stop immediately, set this on the web service and
redeploy:

```bash
WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT=false
```

The server event will keep non-query fields such as outcome, result count,
latency, source, mode, language, and failure category. Re-enable by removing
the variable or setting it to `true`.
