# Analytics watcher activation — 2026-09-14

Owner: Nisal. Roadmap: feat-495. Code: PR #2277.

## Configuration audit

| Setting                     | Verified value                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Source                      | `JesusFilm/forge`, branch `main`; autodeploy enabled                                      |
| Build root                  | Repository root                                                                           |
| Dockerfile                  | `apps/analytics-watcher/Dockerfile`                                                       |
| Schedule                    | `*/5 * * * *` (UTC)                                                                       |
| Start command               | `sh apps/analytics-watcher/start.sh`                                                      |
| Replicas and limits         | One replica, 2 vCPU, 1 GB RAM                                                             |
| Restart policy              | `NEVER`; retry on the next schedule                                                       |
| Run deadline                | 240 seconds, forced termination after 10 further seconds                                  |
| State                       | Dedicated volume mounted at `/data`; one process lock                                     |
| HTTP healthcheck and domain | None; this process completes and exits                                                    |
| GA access                   | Production property/stream verified with `analytics.readonly`                             |
| Datadog access              | Personal application key scoped to `rum_apps_read`; production Watch query passed         |
| Slack                       | Bot installed; configured channel acknowledged the labelled installation test             |
| Healthchecks                | Operator confirmed Up with recent pings; 5-minute period, 15-minute grace, Slack/email ON |

Watch paths include the watcher directory, root package/lock/workspace files,
`patches/**`, and `.dockerignore`. The settings snapshot records the service
settings; resource limits and GitHub trigger settings use separate API operations.
No secrets or heartbeat URLs belong in this record.

**Wait for CI is enabled.** The project-token attempt to enable `checkSuites`
returned `Bad Access`; the operator enabled it in Railway, and a subsequent API
read confirmed `checkSuites: true` for the `main` trigger. Repository connection
also required the operator's dashboard login. The current deployment continues
running while future deployment candidates wait for GitHub checks.

## Runtime evidence

Initial deployment: `8ab3078a-e6d6-4a00-9c3e-2a37bd1439c3`.
The Docker build passed and runtime logs recorded `good` for `ga-browser`,
`ga-intake` and `datadog-intake`. The volume mount was the same on successive
executions. Railway reported these executions as `EXITED`:

| Execution (UTC, 2026-09-13) | Container duration | Kind               |
| --------------------------- | ------------------ | ------------------ |
| 23:07:08–23:07:28           | 19.3 seconds       | Initial deployment |
| 23:10:20–23:10:35           | 15.0 seconds       | Scheduled          |
| 23:15:09–23:15:23           | 14.5 seconds       | Scheduled          |
| 23:20:33–23:20:53           | 20.5 seconds       | Scheduled          |
| 23:25:28–23:25:44           | 16.7 seconds       | Scheduled          |

Railway parses JSON console entries into log `attributes`; an empty `message`
field does not mean no check result. Read `check`, `status` and `detail` attributes.
Successful provider log entries precede the heartbeat. The operator separately
confirmed Healthchecks is Up with recent pings; receipt was not inferred from
provider logs alone. Its five-minute period plus fifteen-minute grace means a
missing-run alert becomes due about twenty minutes after the last success ping.

Outstanding acceptance:

- Verify external missing-ping alert and recovery reach the configured Slack
  channel. Any drill must be clearly labelled TEST and preserve website analytics.
- Verify incident state survives a production container restart by inspecting
  the persisted state; the mount identity and local restart tests alone do not
  prove production state continuity.
- Reconcile the storage metrics below and recalculate cost after a full day.

## Incremental cost estimate (USD)

Every five minutes means `12 × 24 × 30 = 8,640` executions per 30 days.
Railway runtime metadata above includes container startup and shutdown. Its first
minute-sampled CPU/RAM series reported zero for these short executions, so those
zeros are not evidence of free compute.

A separate run of the same Docker browser probe measured 9.91 seconds wall time,
11.17 CPU-seconds, 0.47 GiB peak RAM, 3.44 GiB-seconds integrated RAM and 141,142
outbound bytes. It passed the real production GA journey. This is a local reference
measurement, not production metering; it excludes provider queries and container
startup/shutdown. Convert GiB to decimal GB for the reference calculation below.

| Component           | Calculation at the reference workload     | Per 30 days |
| ------------------- | ----------------------------------------- | ----------- |
| CPU                 | `11.174339 / 60 × 8,640 × $0.000463`      | $0.75       |
| RAM                 | `3.690803 / 60 × 8,640 × $0.000231`       | $0.12       |
| Egress              | `141,142 / 1,000,000,000 × 8,640 × $0.05` | $0.06       |
| Volume              | `0.64442368 × $0.15`                      | $0.10       |
| **Reference total** |                                           | **$1.03**   |

Budget **$2–5/month** in incremental Railway usage for the healthy workload,
allowing for runtime differences, startup and the read-only provider queries,
provided storage remains small. Recalculate from actual usage after a full day;
this is not a fixed quote or cap.
Longer or repeatedly hung runs can cost more. CPU/RAM ceilings do not reserve or
charge their full capacity continuously, and the cron exits between runs.

Storage is provisional: the volume metrics series rose from 0.0078 GB to
0.6444 GB during the first 24 minutes, while `volumeInstance.currentSizeMB`
still reported 7.7988 MB. The volume capacity is 50,000 MB. These measurements
disagree, so do not extrapolate either as confirmed steady-state file usage.
Railway documents filesystem overhead even for empty volumes; that is a possible
explanation, not a verified diagnosis here. CLI file inspection required an SSH
key registered with Railway, which is unavailable in this session. Inspect
`/data` and `/data/analytics-watcher/state.json` through authenticated Railway
access and compare fresh metrics. At $0.15/GB-month, storage would be $0.38/month
at 2.5 GB or $7.50/month at the entire 50 GB capacity; the latter is a storage-only
scenario, not an expected cost or a total spending limit.

Healthchecks' $0/month Hobbyist tier covers 20 checks; this uses one. The watcher
does not invoke an AI model. Existing Railway plan fees, GA/Datadog/Slack account
subscriptions and website/CDN costs from the synthetic visits are outside this
incremental estimate. Keep normal GA page-view/Share counts isolated from probes.

Sources checked 2026-09-14:

- [Railway resource prices](https://docs.railway.com/pricing/plans)
- [Railway cron lifecycle](https://docs.railway.com/cron-jobs)
- [Railway Wait for CI](https://docs.railway.com/deployments/github-autodeploys)
- [Railway explanation of volume filesystem overhead](https://station.railway.com/questions/how-do-i-create-a-small-volume-the-50gb-b5086b03)
- [Healthchecks pricing](https://healthchecks.io/pricing/)
