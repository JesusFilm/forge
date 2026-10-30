# Watch production latency investigation — October 20, 2026

## Finding

The product owner's report is reproducible. Watch has substantial origin-side
latency while its single Next.js worker is busy processing and serializing page
responses. An eight-vCPU service allowance does not make the JavaScript request
thread parallel. Current evidence points to that worker as the immediate
bottleneck; it does not establish which application change triggered the rise
in work.

During diagnosis, no deployment, restart, scaling, feature-flag change, or cache
flush was made. After the user authorized remediation, Web was scaled from one
to two replicas; see the mitigation results below.
Two brief CPU profiles used a temporary loopback-only Node inspector. Its
closure was verified after each capture. Only timing and code-location summaries
were retained, without request bodies, credentials, cookies, or cache contents.

## Slack and deployment timeline

All local times below are October 20 in Pacific/Auckland (NZDT, UTC+13).
These are monitor alert states, not proof that every request failed throughout
each interval.

| Checkly failed alert | Recovered alert |
| -------------------- | --------------- |
| 04:29:11             | 04:36:02        |
| 04:49:14             | 04:53:32        |
| 05:19:23             | 05:23:37        |
| 05:39:20             | 05:44:34        |
| 06:39:20             | 06:43:38        |
| 07:19:10             | 08:15:05        |

Sources: [first failed alert](https://jfp-digital.slack.com/archives/C03658SE2/p1792423751694469),
[last failed alert](https://jfp-digital.slack.com/archives/C03658SE2/p1792433950452949),
[last recovery](https://jfp-digital.slack.com/archives/C03658SE2/p1792437305694609).
The first alert attachment reports a 25.91-second check run from N. Virginia,
timestamped 15:22 UTC (04:22 NZDT). The last failed alert reports 32.61 seconds,
timestamped 18:12 UTC (07:12 NZDT). These are check durations; the check's exact
failed assertion was not available from Slack.

The active Web deployment is `772be46d-0d78-4faa-aa5e-43b8d5e010d2`, commit
`3003c52046544d83b59f4acbea287ac04504dcf6`, PR #2778. It was created at
03:51:23 NZDT and its successful status was updated at 04:15:14. Subsequent
deployments for #2779 and #2812 were skipped, so their newer timestamps must
not be mistaken for active releases. The first failed check followed the
successful rollout, but a controlled comparison is required before blaming
that PR or selecting a rollback.

## Reproduction

Bounded, unauthenticated curl probes against the real public documents produced:

| URL                                          | First byte |    Total | Outcome                                   |
| -------------------------------------------- | ---------: | -------: | ----------------------------------------- |
| `https://www.jesusfilm.org/watch`            |   12.827 s | 13.162 s | HTTP 200, 906,634 bytes                   |
| `https://watch.jesusfilm.org/watch`          |   12.833 s | 13.231 s | Redirected to canonical home, HTTP 200    |
| `https://www.jesusfilm.org/watch/jesus.html` |   31.428 s | 35.001 s | HTTP 200 headers, body download timed out |
| `https://www.jesusfilm.org/watch/languages`  |   12.918 s | 13.888 s | HTTP 200, 2,841,909 bytes                 |

DNS, TCP and TLS completed within approximately 0.1 seconds. A later homepage
probe still measured 4.430-second first byte and 5.067-second total with
`x-nextjs-cache: HIT`, `cf-cache-status: DYNAMIC`, and
`cache-control: s-maxage=60, stale-while-revalidate=31535940`.

Repeat this diagnostic loop; the two-second threshold is an investigation
signal, not a newly approved production SLO:

```bash
python3 - <<'PY'
import json
import subprocess
import sys

result = subprocess.run([
    'curl', '--silent', '--show-error', '--max-time', '25',
    '--output', '/dev/null', '--write-out', '%{json}',
    'https://www.jesusfilm.org/watch',
], capture_output=True, text=True)
data = json.loads(result.stdout)
print({key: data[key] for key in (
    'http_code', 'time_starttransfer', 'time_total', 'size_download'
)})
slow = data['time_starttransfer'] > 2
print('FAIL: homepage first byte exceeds 2 seconds' if slow else 'PASS')
sys.exit(1 if slow or result.returncode or data['http_code'] != 200 else 0)
PY
```

The equivalent measured loop exited 1 with the 4.430-second cached-home result.
The read-only public auth/session control returned HTTP 400 in 297 ms; that
demonstrates a quick refusal, not successful session health.

## Railway and runtime evidence

Production project `98952497-a4d9-4714-8fe8-0cdbff3147c9`, environment
`5f41e037-90e4-4674-a3ea-66bbd05fb3b4`, Web service
`23b82451-0da1-4edc-bcde-096a9fd2a687` initially had one replica in `us-west2`, with
eight vCPUs and 16 GB allowed. Twelve-hour Web metrics showed approximately
1.16 CPU average, 1.91 maximum; memory averaged 3.78 GB, maximum 6.47 GB.
Those service-level aggregates do not show exhaustion of the configured limits.

A three-second read-only `/proc` sample showed the Next.js main thread accruing
267 CPU ticks in 3.003 seconds, approximately 89% of one core at Linux's
100-Hz process-accounting rate. Worker/GC threads also accrued CPU. There was
one Next.js server process. This is different from using 89% of eight CPUs.

Two short CPU profiles sampled ordinary live traffic, without adding load:

- First capture: approximately 7.2 seconds of recorded sample deltas for a
  requested five-second window; 30.5% self time in a minified React/Next runtime
  function `J`, 5.6% in `writev`, 4.7% in incremental-cache `set`, 3.8% GC.
  `J` was not uniquely symbolicated and must not be assigned to a particular
  function from its name alone.
- Second capture, requested three-second window: 43.5% self time in React
  Flight model serialization (`eW`, Next 16.3.8
  `app-page-turbo.runtime.prod.js`, line 11, zero-based column 80019).
  The source dispatches typed arrays and serializes models through the Flight
  JSON replacer. Incremental-cache `set` accounted for 5.3%, including
  `JSON.stringify(t).length`; the Redis handler's JSON serializer accounted
  for another 2.2%. Idle samples were approximately 1%.

These captures identify page processing/serialization as current CPU work.
They are observational profiles, not a before/after proof of a repair. CPU
profiling itself adds some overhead; the slowdown was reproduced before it.
The deployed configuration has `generateEtags: false`, so the historical
generated-ETag problem is not an explanation to reuse without evidence.

A bounded Railway sample at 09:45 NZDT contained 168 successful page GETs:
median 7,259 ms, sample p95 13,482 ms, maximum 21,146 ms. The broader sample
included 27 page requests with HTTP 499 (the caller closed the request).
This approximately 25-second sample is not a full-day or human-only percentile;
user agents included browsers, declared crawlers and headless browsers.

## Dependency checks and secondary issues

- Web's Admin hostname is private Railway networking. Three authenticated
  `query WatchDiagnosticHealth { __typename }` probes from a separate process
  in the Web container returned HTTP 200 in 135, 13 and 9 ms. These test the
  transport/basic GraphQL path, not every content resolver.
- A separate Admin public HTTP-log sample had 301 requests, median 11 ms,
  p95 118 ms, maximum 3,952 ms. Private SSR traffic is not represented in that
  public edge sample, so it cannot clear all Admin content queries.
- Five Redis pings from the Web container took 2, 1, 2, 10 and 4 ms. Redis
  reported no evicted keys; inspected slow-log entries were tens of milliseconds,
  not multi-second commands. Historical command statistics are not an incident
  time series. Redis holds roughly 7.8 GB and performs approximately 39-second
  background saves of roughly 2.75 GB. Those saves merit monitoring but are not
  established as the cause of the current multi-second delay.
- Runtime logs during the 07:12 NZDT failed-check window showed outbound
  `ETIMEDOUT` connections to Cloudflare addresses and IPv6 `ENETUNREACH`.
  Image optimization returned HTTP 500, including one 48.4-second request.
  The exact remote image hostname and relationship to the monitor assertion
  remain unverified. These failures are separate from a slow cached HTML hit.
- Missing LaunchDarkly flags repeatedly log `FLAG_NOT_FOUND` for
  `forge.watch.questionPanel`, `forge.watch.hideBibleQuotes`, and
  `forge.watch.downloadAccountGate`. The fallback executes; the logs do not
  establish that flag evaluation causes the page delay. Do not disable Datadog
  or required analytics to suppress this noise.

Railway HTTP metric totals show 748,135 requests and 1,153 HTTP 5xx responses
between midnight and approximately 09:46 NZDT. This includes API, assets,
redirects and automated traffic. CLI percentile summaries were inconsistent
between overlapping windows, so this report uses explicit request-log samples
and direct probes for latency conclusions instead of composing those summaries.
The environment-status tool also returned no matching services for `*web*`;
that empty result was not treated as proof of health.

## Repair direction and limits

`feat-747` tracks a controlled performance repair. First compare the previous
and active production builds under the same route/cache/traffic mix and profile
the Flight payloads, cache serialization and cold regeneration rate. Preserve
content, language and player behavior while reducing repeated serialization or
unnecessary regeneration. Verify cached home/detail latency while cold
multilingual routes are concurrently requested.

More replicas distribute independent requests, whereas merely raising the CPU
allowance does not parallelize one JavaScript thread. The subsequently authorized
replica mitigation and measured results are below. Inspect the image timeout
path independently. No user authorization for emergency code deployment or
bypassing the PR-to-main flow was given.

## Authorized mitigation and observed results

After the user authorized remediation, Railway Web production was scaled from
one to two replicas in the existing `us-west2` region. `describe_service`
confirmed the live configuration with no staged changes, and unfiltered
`environment_status` reported two running replicas, zero crashes, no pending
work and `2/2 Online` at approximately 09:53 NZDT. The active deployment stayed
`772be46d-0d78-4faa-aa5e-43b8d5e010d2`; no new build or code deployment was made.

The first post-change homepage probe returned HTTP 200 with 0.363-second TTFB
and 1.157-second total. Eight further bounded public probes at approximately
09:55 NZDT, at most two concurrent, returned:

| Public path           | First-byte samples | Total samples    | Status   |
| --------------------- | ------------------ | ---------------- | -------- |
| `/watch`              | 0.269 s, 0.328 s   | 0.364 s, 0.372 s | 200, 200 |
| `/watch/jesus.html`   | 0.284 s, 0.301 s   | 0.387 s, 0.627 s | 200, 200 |
| `/watch/languages`    | 0.317 s, 0.527 s   | 0.529 s, 0.593 s | 200, 200 |
| `/watch/spanish.html` | 0.242 s, 0.209 s   | 0.247 s, 0.579 s | 200, 200 |

The JSON curl diagnostic's homepage two-second threshold now passes. The probes
read responses without saving bodies or headers containing authentication data.

For the requested 20:54–20:55 UTC origin log window, the bounded 501-entry result
covered approximately 20:54:44–20:55:00 UTC (09:54:44–09:55 NZDT). Successful page
GETs, excluding `/api/` and `/_next/`, had n=204, median 114 ms, p95 897 ms and
maximum 1,670 ms. The earlier successful-page-GET sample had n=168, median
7,259 ms, p95 13,482 ms and maximum 21,146 ms. These are different live traffic
populations and time windows, not a controlled benchmark or a sustained SLO
verification. Across all 501 post-change requests there were no 5xx and one 499.

The latest Watch Slack entry remained the 08:15 recovery, which predates this
mitigation. Do not attribute that monitor recovery to scaling or claim the
Checkly assertion passed after scaling without its actual run evidence.

`apps/web/railway.toml` now proposes two `us-west2` replicas only for the
`production` environment. This repository change goes through the normal PR
flow. It records the live mitigation without altering rendering, playback,
recommendations, analytics, feature flags or cache invalidation. Scope and
reversal are in `docs/plans/2026-10-20-watch-replica-mitigation.md`.

### Cost effect

Railway's [current public pricing](https://railway.com/pricing) charges actual
resource consumption: $0.00000386 per GB-second memory and $0.00000772 per
vCPU-second CPU, approximately $10/GB-month and $20/vCPU-month over 30 days.
The configured eight-vCPU/16-GB limits are ceilings, not reserved-resource bills.

Using the original 12-hour mean, an additional instance consuming the same
3.78 GB RAM and 1.16 vCPU continuously would add approximately **US$61/month**
(US$2/day): about $38 memory and $23 CPU. This is a planning scenario, not a
measured incremental bill, forecast, or spending cap. Existing requests now
split across two processes, so CPU consumption need not double; duplicated
runtime memory and additional render/cache work still cost money. No extra
service subscription fee or attached disk was introduced. Egress depends on
actual bytes and is excluded from this compute estimate. No account discount,
credit or tax adjustment was assumed.

Keep the deeper serialization comparison in feat-747 open. A short successful
mitigation window does not establish its cause, eliminate cold-route contention,
or demonstrate that returning to one replica would be safe.
