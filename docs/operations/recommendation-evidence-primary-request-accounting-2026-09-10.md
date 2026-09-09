# Recommendation production request accounting — 2026-09-10 NZ

The primary-only playback request gate is now verified using Railway HTTP edge
logs. Datadog's mixed-environment metric is no longer the only count source.
Required recommendation alerts are not installed in the visible Datadog inventory.

## Verified production scope

Railway's authenticated deployment query identifies:

- Project: `98952497-a4d9-4714-8fe8-0cdbff3147c9`.
- Environment: `5f41e037-90e4-4674-a3ea-66bbd05fb3b4`, `production`.
- Service: `23b82451-0da1-4edc-bcde-096a9fd2a687`, `@forge/web`.
- Successful deployment: `7b858e53-281a-4bc1-877c-e522a35b09a8`.
- Web revision: `76ae13f1a92e12527cb095a673409edc43e22c0e`.

The fixed window is **2026-09-09 18:30:00 inclusive to 20:30:00 exclusive UTC**,
the same window as the latest operational and durable reconciliation audit.
There were no task-induced production fault injections or exclusions.

## Complete edge request counts

| HTTP status | Requests |
| ----------- | -------: |
| 200         |    5,523 |
| 401         |        3 |
| 403         |    1,013 |
| 409         |        2 |
| 503         |        2 |
| Total       |    6,543 |

**Production playback 5xx: 2 / 6,543 = 0.03057%, below the 1% gate.**
These counts independently match the existing Datadog metric for this window.
The metric still lacks a Railway environment dimension; equality does not fix
that limitation for arbitrary future windows. Use the scoped Railway source when
a complete production-only denominator is required.

Railway documents HTTP logs as the requests served through its edge:
[HTTP log documentation](https://docs.railway.com/cli/logs#http-logs).
The queried external path is `/watch/api/recommendations/playback`; APM's
normalized resource omits the `/watch` base path.

## Reproducible collection and completeness checks

Read-only GraphQL query against `https://backboard.railway.com/graphql/v2`:

```graphql
query ProductionPlaybackRequests($id: String!, $anchor: String!) {
  httpLogs(
    deploymentId: $id
    anchorDate: $anchor
    beforeLimit: 500
    afterLimit: 0
    filter: "@method:POST AND @path:/watch/api/recommendations/playback"
  ) {
    timestamp
    method
    path
    httpStatus
    deploymentId
    requestId
  }
}
```

Collect 24 five-minute windows, anchoring each query at that window's end.
The API returned 501 rows per call; do not assume the numeric limit alone proves
completeness. For every call, the oldest returned pre-anchor row was earlier than
the window start. Clip locally to `[start, end)` and verify deployment, method,
and exact path on every included row. Subdivide any interval whose lower boundary
is not covered before counting it. No subdivision was needed in this observation.

Included counts by consecutive five-minute window:

```text
148 177 302 378 253 300 400 421 426 246 202 281
283 232 268 247 280 265 254 288 288 217 165 222
```

All 6,543 request IDs were unique across the intervals. The SHA-256 of sorted
request IDs joined with newline is
`20103118f2bbd57badc776d16504af95d33e7c00c2a54bb061b033ae53c8a500`.
Raw request IDs, client addresses, user agents, and credentials are not published
in this record. The query did not request client addresses or user agents.

Retained Datadog spans were checked as an alternative and did not enumerate the
complete metric population; they were not used as the denominator. Early Railway
probes with `afterDate`/`beforeDate` did not return the intended interval. The
accepted collection uses the demonstrated anchor query and explicit local bounds.

## Alert installation result

The complete visible Datadog inventory contained 41 monitors across two pages.
Inspection of names and queries found no recommendation evidence monitor; the
only Forge monitor was the unrelated Forge TV intake monitor `303307205`.

All six checked-in JSON definitions under
`infra/datadog-monitors/recommendation-evidence/` parse successfully. None has a
configured notification destination. Missing installation cannot be verified as
successful through more read queries. It requires an approved monitor-write
access path, an approved destination, installation, and read-back verification of
the resulting monitor IDs and configuration. The owner's prior Datadog read-only
restriction remains in effect while that access/authorization is pending.

The [production integrity audit](recommendation-evidence-production-integrity-2026-09-10.md)
and this request-accounting proof resolve the two previously missing read-side
evidence sources. Keep feat-464/459 in progress pending alert installation and
remaining acceptance requirements. Feat-447's separate browser lifecycle and
production-vector latency gates are not replaced by these operational audits.
