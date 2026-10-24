# Watch Datadog Availability Incidents

This runbook defines the production-only Watch availability incident path. It is
paired with server-side Watch breadcrumbs in `apps/web/src/lib/watch-observability.ts`.

## Goal

Catch Watch server-rendered 500s and timeouts even when browser RUM never loads.
The incident gate requires both:

- an outside-in Watch canary alert, and
- a production Watch server 5xx or timeout log alert.

Client-side RUM remains useful context, but it is not part of the v1 incident
trigger.

## Canary URLs

The original set was checked from this worktree on 2026-06-12 with `curl -L`.
The canonical/compatibility split below was updated on 2026-07-25 and must be
reconfirmed before enabling or editing monitors:

| Surface                               | URL                                                                                           | Expected |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| Watch home, English                   | `https://watch.jesusfilm.org/watch`                                                           | `200`    |
| Gospel of John, English canonical     | `https://watch.jesusfilm.org/watch/life-of-jesus-gospel-of-john.html`                         | `200`    |
| Jesus, English canonical              | `https://watch.jesusfilm.org/watch/jesus.html`                                                | `200`    |
| Jesus, explicit-English compatibility | `https://watch.jesusfilm.org/watch/jesus.html/english.html`                                   | `200`    |
| LUMO Gospel of John episode, English  | `https://watch.jesusfilm.org/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html` | `200`    |

Romanian, Spanish, and Russian standalone probes remain language-explicit and
belong in the release URL matrix. Contextual episode browser URLs also remain
language-explicit.

Do not add `https://watch.jesusfilm.org/watch/reflections-of-hope.html/7-jesus-our-living-water/english.html`
to the initial canary set without fixing or revalidating it; it returned `500`
during the 2026-06-12 check.

## Tags

Use these tags on every monitor in this flow:

- `service:watch`
- `env:prod`
- `surface:watch`
- `feature:watch-availability`
- `team:platform`

## Synthetic HTTP Tests

Create one Datadog Synthetics HTTP test per canary URL.

Recommended naming:

- `Watch availability canary - home English`
- `Watch availability canary - Gospel of John English`
- `Watch availability canary - Jesus English`
- `Watch availability canary - Jesus explicit-English compatibility`
- `Watch availability canary - LUMO John episode English`

Configuration:

- Method: `GET`
- Follow redirects: enabled
- Assertions:
  - response status code is `200`
  - response time is less than `10000 ms`
- Locations: three public locations, preferably two US locations plus one
  non-US location.
- Alerting rule: alert if any assertion fails for `5 minutes` from at least
  `2 of 3` locations.
- Fast retry: `2` retries, `300 ms` interval.
- Notifications: leave the individual canary tests quiet unless the operations
  team wants non-incident diagnostics. The composite monitor is the incident
  source of truth.

Datadog reference: https://docs.datadoghq.com/synthetics/api_tests/http_tests/

## Production Server Log Monitors

Create six logs monitors:

- `Watch production server 5xx or timeout logs - home English`
- `Watch production server 5xx or timeout logs - Gospel of John English`
- `Watch production server 5xx or timeout logs - Jesus English`
- `Watch production server 5xx or timeout logs - Jesus explicit-English compatibility`
- `Watch production server 5xx or timeout logs - LUMO John episode English`
- `Watch production shared manifest/substrate failures`

Keep a broad production 5xx query for diagnosis, but do not use the broad query
as the incident gate. The incident gate should pair each canary with either a
matching route-specific server log signal or the shared manifest/substrate
signal. That avoids creating an incident from an unrelated canary failure and an
unrelated non-canary 500 in the same window.

Use this production host filter in every server-log monitor, and verify it in
Logs Explorer before enabling:

```text
(
  @url_host:watch.jesusfilm.org OR
  @url_host:"1ee8fdb1-3cb5-40fd-9258-35d589917b4a.jesusfilm.org" OR
  host:"1ee8fdb1-3cb5-40fd-9258-35d589917b4a.jesusfilm.org"
)
```

Route-specific monitor template:

```text
service:watch
(
  @url_host:watch.jesusfilm.org OR
  @url_host:"1ee8fdb1-3cb5-40fd-9258-35d589917b4a.jesusfilm.org" OR
  host:"1ee8fdb1-3cb5-40fd-9258-35d589917b4a.jesusfilm.org"
)
(
  (status:error @statusCode:[500 TO 599]) OR
  "Internal Server Error" OR
  ApolloError OR
  TimeoutError OR
  AbortError OR
  timeout
)
(
  <ROUTE_MATCH>
)
```

Use these route matches:

| Monitor                      | `<ROUTE_MATCH>`                                               |
| ---------------------------- | ------------------------------------------------------------- |
| home English                 | `"page: '/'" OR @http.url_details.path:"/watch"`              |
| Gospel of John English       | `"life-of-jesus-gospel-of-john.html"`                         |
| Jesus English                | `"watch/jesus.html" -\"jesus.html/english.html\"`             |
| Jesus explicit compatibility | `"jesus.html/english.html"`                                   |
| LUMO John episode English    | `"lumo-the-gospel-of-john.html/wedding-in-cana/english.html"` |

Shared manifest/substrate monitor query:

```text
service:watch "[watch]"
(
  @url_host:watch.jesusfilm.org OR
  @url_host:"1ee8fdb1-3cb5-40fd-9258-35d589917b4a.jesusfilm.org" OR
  host:"1ee8fdb1-3cb5-40fd-9258-35d589917b4a.jesusfilm.org"
)
(
  "event=watch_route_manifest.fetch.failed" OR
  "event=watch_route_manifest.fetch.error" OR
  "event=watch_route_manifest.fetch.invalid_payload" OR
  "event=watch_seo_manifest.fetch.failed" OR
  "event=watch_seo_manifest.fetch.error" OR
  "event=watch_seo_manifest.fetch.invalid_payload"
)
```

Threshold:

- Alert each server-log monitor when count is `>= 1` over the last `5 minutes`.
- Recover when count is `0` for `10 minutes`.

Notes:

- Read-only Datadog checks in this work found `service:watch` logs across
  production, preview, and e2e hosts. Keep the production-host allowlist rather
  than relying on broad `service:watch` plus exclusions.
- Current production examples exposed `custom.statusCode`, `custom.path`, and
  `custom.url_host`; Datadog queries those custom attributes as `@statusCode`,
  `@path`, and `@url_host`.
- As of 2026-06-12, the highest-volume production-looking `service:watch` host
  in Datadog was `1ee8fdb1-3cb5-40fd-9258-35d589917b4a.jesusfilm.org`. Recheck
  the `@url_host` distribution before enabling the monitor and update the
  allowlist if production traffic moved.
- The quoted `@url_host:"1ee8fdb1-3cb5-40fd-9258-35d589917b4a.jesusfilm.org"`
  filter returned known production `@statusCode:500` samples in the 2026-06-12
  validation pass.
- The new `[watch] event=...` manifest breadcrumbs are included only in the
  shared substrate monitor. Metadata fallback breadcrumbs remain diagnostic
  context and do not open incidents on their own.

## Composite Incident Gate

Create a composite monitor named `Watch production availability incident gate`.

Use the four synthetic monitors, the four route-specific log monitors, and the
shared manifest/substrate monitor as constituents. With Datadog monitor labels
`a` through `i`, use:

```text
(a && (e || i)) ||
(b && (f || i)) ||
(c && (g || i)) ||
(d && (h || i))
```

Where:

- `a`: home English synthetic alert
- `b`: Gospel of John English synthetic alert
- `c`: Jesus English synthetic alert
- `d`: LUMO John episode English synthetic alert
- `e`: home English production server 5xx or timeout log alert
- `f`: Gospel of John English production server 5xx or timeout log alert
- `g`: Jesus English production server 5xx or timeout log alert
- `h`: LUMO John episode English production server 5xx or timeout log alert
- `i`: shared manifest/substrate failure alert

Set `notify_no_data` to false on the composite. Do not base another composite
monitor on this one.

Datadog reference: https://docs.datadoghq.com/monitors/types/composite/

## Incident And Workflow Notifications

Attach Datadog incident creation to the composite monitor, not to the individual
synthetic or log monitors.

Monitor message template:

```text
{{#is_alert}}
Watch production availability is failing. At least one public canary is failing
and production Watch server logs show matching route-specific 5xx/timeout
evidence or a shared manifest/substrate failure.

Scope: production Watch availability
Canaries: home, Gospel of John English, Jesus English, LUMO John episode English
Logs: service:watch route-paired 5xx/timeout monitors plus shared substrate monitor

@incident-watch-availability
{{/is_alert}}

{{#is_recovery}}
Watch production availability recovered after the canary and server-log signals
cleared.
{{/is_recovery}}
```

Replace `@incident-watch-availability` with the actual `@incident-` option from
Datadog Incident Settings. Datadog supports creating incidents from monitors on
alert, warn, or no-data transitions when an `@incident-` option is added to the
monitor notification.

Datadog reference: https://docs.datadoghq.com/monitors/notify/

## Verification Matrix

Run these checks before treating the flow as active:

| Scenario                                                                  | Expected result                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| One canary location fails briefly                                         | Synthetic test records the failure, composite stays OK                |
| Canary monitor alerts but no production server 5xx/timeout logs exist     | Composite stays OK, no incident                                       |
| Server log monitor alerts while all canaries stay healthy                 | Composite stays OK, no incident                                       |
| Home canary alerts while only the Jesus route log monitor alerts          | Composite stays OK, no incident                                       |
| Canary monitor alerts and its paired route or shared substrate log alerts | Composite alerts and creates or updates a Watch availability incident |
| Canary recovers but server log monitor is still alerting                  | Composite remains alert-worthy or last-known until both signals clear |
| Both canary and server log monitor recover                                | Composite recovers and the incident path receives recovery context    |

## Useful Follow-Up Queries

Use this to inspect the new server breadcrumbs:

```text
service:watch "[watch]" (
  "watch_route_manifest.fetch" OR
  "watch_seo_manifest.fetch" OR
  "watch_metadata.video.fallback" OR
  "watch_metadata.episode.fallback"
)
```

Use this to inspect production Watch 500s by route:

```text
service:watch status:error
(
  @url_host:watch.jesusfilm.org OR
  @url_host:"1ee8fdb1-3cb5-40fd-9258-35d589917b4a.jesusfilm.org"
)
@statusCode:[500 TO 599]
```

## Boundaries

- Do not page from the individual synthetic monitors in v1.
- Do not use browser RUM as the incident trigger for this flow.
- Do not include preview, e2e, staging, or localhost traffic.
- Do not broaden this into route-manifest crawling or server APM without a new
  plan.
