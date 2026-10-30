# Evidence index — Watch production latency, 2026-10-19 (feat-745)

Supports `docs/reports/2026-10-19-watch-production-latency-incident.md`.
Every production read here was read-only. No restart, redeploy, scale change,
cache purge, flag change or load test was performed.

Sanitization: client IP addresses (`srcIp`) and internal upstream addresses
were removed from Railway rows. No credentials, cookies, bearer keys or Redis
URLs appear. The probe user agent `forge-feat745-probe/1.0` is ours. Railway
request ids are kept so rows can be looked up again while logs are retained.

## Identity at capture

| Item                          | Value                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Railway project / env         | `98952497-a4d9-4714-8fe8-0cdbff3147c9` / `5f41e037-90e4-4674-a3ea-66bbd05fb3b4`                                                                                                                  |
| Web service                   | `23b82451-0da1-4edc-bcde-096a9fd2a687` (`@forge/web`)                                                                                                                                            |
| Serving deployment            | `772be46d-0d78-4faa-aa5e-43b8d5e010d2`, commit `3003c52046544d83b59f4acbea287ac04504dcf6`                                                                                                        |
| Serving replica               | `7116eeca-d7e5-4b55-8273-4b134bbc3b16` (`RAILWAY_REPLICA_ID`), region `us-west2`                                                                                                                 |
| Web process                   | `next-server`, pid 20, 19 threads, Datadog runtime `c79e912b-2962-4f80-a9fa-1d34a8c992e9`                                                                                                        |
| Previous deployment           | `a6661a84-2cc9-4ee4-85be-53bcb31474e2` (REMOVED), commit `156666c2`, replica `5140c371-3531-4191-80c7-d87b18eda11e`, runtime `7a623397…`                                                         |
| Not serving                   | `8824a12a…` (`7dae8b62`, SKIPPED 15:22), `e288c696…` (`0527226c`, SKIPPED 17:31)                                                                                                                 |
| Datadog                       | service `forge-web`, env `prod`, operation `web.request`; all spans and metrics carry `host:forge-datadog-agent-prd`                                                                             |
| Datadog runtime-id on metrics | absent: `avg:runtime.node.event_loop.utilization{service:forge-web,env:prod} by {runtime-id}` returns one `runtime-id:N/A` group; `DD_RUNTIME_METRICS_RUNTIME_ID_ENABLED` unset in the container |

## Raw files (`raw/`)

| File                                   | What it is                                                                                                             | Window (UTC)      | Samples        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------- |
| `probe-root-1833-1836.txt`             | `scripts/probe.sh https://www.jesusfilm.org/watch 6 10`: curl timing and cache headers                                 | 18:33:06–18:36:24 | 6 requests     |
| `railway-http-probe-rows.jsonl`        | Railway HTTP log rows for those 6 probes (`--filter '@clientUa:"forge-feat745-probe/1.0 (read-only latency sample)"'`) | same              | 6 rows         |
| `http-summary-1832-1839.json`          | `scripts/http_analyze.py` over the last 5,000 Railway HTTP rows before 18:40 on the serving deployment                 | 18:32:49–18:39:04 | 5,000 requests |
| `http-summary-baseline-1406-1409.json` | Same analysis, previous deployment `a6661a84…`, last 5,000 rows before 14:10                                           | 14:06:44–14:09:59 | 5,000 requests |
| `sched-sample-1841.txt`                | `scripts/sched-sample.sh` via `railway ssh`: two snapshots 10 s apart                                                  | 18:41:00–18:41:10 | 2 snapshots    |
| `redis-info-1633.txt`                  | `scripts/redisinfo.js` via `railway ssh` (see caveats)                                                                 | ~16:33            | 2 INFO reads   |
| `checkly-keyword-results.json`         | Checkly results for check `54844597-f049-43fd-8808-06a2df8dbdfc`, reduced to timing and status fields                  | 15:51–16:32       | 10 runs        |
| `railway-web-cpu-1430-1630.json`       | Railway service metrics `CPU_USAGE` / `CPU_LIMIT`, 1-minute points                                                     | 14:30–16:30       | 121 points     |
| `bench-telemetry.txt`                  | `scripts/bench-telemetry.mts`: telemetry overhead on a development machine                                             | 2026-10-19        | 50,000 calls   |

The full raw Railway JSONL behind the two summaries was not committed: it
contains client IPs. Re-fetch while Railway retains logs:

```sh
railway logs [a6661a84-2cc9-4ee4-85be-53bcb31474e2] --http --json \
  -p 98952497-a4d9-4714-8fe8-0cdbff3147c9 -e 5f41e037-90e4-4674-a3ea-66bbd05fb3b4 \
  -s 23b82451-0da1-4edc-bcde-096a9fd2a687 \
  --since <start> --until <end> -n 5000 > rows.jsonl
python3 -I scripts/http_analyze.py rows.jsonl
```

The CLI rejects `-n` above 5,000 ("Error in beforeLimit - Invalid input") and
returns the latest 5,000 rows inside the window. That is why each summary
covers 3–6 minutes, not the requested 10–20.

## Datadog queries (exact)

Runtime comparison (`get_datadog_metric`, scalar). Windows 2026-10-19
12:00–15:10 and 15:20–18:30:

| Measure                | Query                                                                                               | Aggregator |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ---------- |
| ELU average / maximum  | `avg:runtime.node.event_loop.utilization{service:forge-web,env:prod}` / `max:` same                 | avg / max  |
| Loop delay             | `avg:runtime.node.event_loop.delay.avg{service:forge-web,env:prod}` (ns)                            | avg        |
| Scavenge median        | `avg:runtime.node.gc.pause.by.type.median{service:forge-web,env:prod,gc_type:scavenge}` (ns)        | avg        |
| Mark-sweep-compact avg | `avg:runtime.node.gc.pause.by.type.avg{service:forge-web,env:prod,gc_type:mark_sweep_compact}` (ns) | avg        |
| GC counts              | `sum:runtime.node.gc.pause.by.type.count{service:forge-web,env:prod,gc_type:<type>}.as_count()`     | sum        |
| Heap used              | `avg:runtime.node.mem.heap_used{service:forge-web,env:prod}`                                        | avg        |
| Process CPU            | `avg:runtime.node.cpu.user{…}` + `avg:runtime.node.cpu.system{…}` (percent of one CPU)              | avg        |
| Completed requests     | `sum:trace.web.request.hits{service:forge-web,env:prod}.as_count()`                                 | sum        |

Results:

| Measure                | 12:00–15:10    | 15:20–18:30    |
| ---------------------- | -------------- | -------------- |
| ELU avg / max          | 0.882 / 1.0    | 0.947 / 1.0    |
| Loop delay avg         | 1.14 ms        | 60.5 ms        |
| Scavenge median        | 13.89 ms       | 21.98 ms       |
| Mark-sweep-compact avg | 50.23 ms       | 95.47 ms       |
| Scavenges / MSCs       | 20,670 / 3,752 | 14,362 / 3,121 |
| Heap used              | 601.5 MB       | 605.2 MB       |
| CPU user / system      | 46.47% / 8.75% | 52.53% / 8.83% |
| Completed requests     | 273,197        | 218,930        |

Latency timeline: `p50:` and `p95:trace.web.request{service:forge-web,env:prod}`,
12:00–18:31, 30-minute buckets. p95: 1.41, 1.00, 0.94, 1.26, 1.15, 1.47, 12.91,
17.88, 17.34, 17.34, 15.08, 16.55, 18.16, 16.81 s.

Traces (`get_datadog_trace`): `6ad641ff000000006cea3e3df01e2e3a` (16:14),
`6ad65f3b000000005b2c16d80a6ee879` (18:19), `6ad65355000000001a847091a66b24c9`
(17:28). Span search used `service:forge-web env:prod
@http.route:"/[locale]/[htmlLang]" @span.kind:server` over ~15:32–18:32: 38
kept root spans; the 27 returned in one page ranged 31.8 ms–26.7 s, all on
runtime `c79e912b…`. No span
search matched the probe user agent: those traces were not kept.

Profiler (runtime `c79e912b…`): timeline 18:33:00–18:34:00; `cpu-time` flame
graph `service:forge-web runtime-id:c79e912b-2962-4f80-a9fa-1d34a8c992e9`
18:30–18:40. The 16:40 draft's async table compared ~2.2-minute timelines of
runtimes `7a623397…` and `c79e912b…`. Its exact windows were not recorded.

## Script caveats (`scripts/`)

- `redisinfo.js`: the 10 s numbers are call-count deltas. `usec_per_call` is
  Redis's lifetime average, not the window's. `SLOWLOG GET 10` is the last 10
  entries and measures execution inside Redis only.
- `dnsprobe.js`: ignores each callback's error and addresses, and runs in a
  fresh process. Fast completion is not proof of a successful lookup in the
  production process.
- `cost.mts`: measures the snapshot read only, not emit or logging. Superseded
  by `bench-telemetry.mts` (snapshot, compute and real DogStatsD emit).
- `real-procfs.mts`: a busy loop proving the sensor reads real procfs. It is
  not evidence about production.
- `sched-sample.sh`: the `awk` line reading `/proc/<pid>/stat` misreads fields,
  because the command name contains a space. Use the `/proc/<pid>/sched` line
  (policy 0, prio 120) instead.

## Retained only as summaries

These were read live and only their summary values survive in the report: the
16:31 scheduler sample, the 16:14 trace's span timings, and the profiler async
table. The temporary files below were not committed (size or client data).
Their SHA-256 prefixes identify the copies the report was written from:

| File                                                     | SHA-256 prefix     |
| -------------------------------------------------------- | ------------------ |
| `/tmp/f745/watch.html` (`/watch` body, 906,634 B)        | `2f54a9cff2c5f193` |
| `/tmp/f745/video.html` (content page body, 909,821 B)    | `97570a611d077437` |
| `/tmp/checkly-54844597-f049-43fd-8808-06a2df8dbdfc.json` | `020d10b9b6ae6b26` |
| `/tmp/checkly-380dc7b3-67c7-488d-a28f-e7d78e63b099.json` | `427e113db654aeaf` |
| `/tmp/checkly-949a62aa-29d0-4e7f-8a3d-b8bb46a4d1aa.json` | `ce43fcde0551c4ed` |
| `/tmp/watch-recurrence.json`                             | `0a90b6064636e2db` |
| `/tmp/forge-web-resources.json`                          | `870900d6da13258f` |
| `/tmp/forge-deploy-config.json`                          | `d4f207893e19741a` |
