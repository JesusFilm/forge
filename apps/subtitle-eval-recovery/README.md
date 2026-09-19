# Subtitle Lab recovery cron

Calls Manager's scheduled Subtitle Lab recovery endpoint every five minutes from
an independent Railway cron service, following the same pattern as
`@forge/analytics-watcher`.

**Not deployed yet.** These files describe the service; creating it in Railway is
a separate, owner-approved step. See "Creating the service" below.

## Why this exists

Manager runs workflows on the Workflow SDK's local World, so an in-flight run
lives in the process and is lost if Manager restarts. Nothing re-drives it on its
own. Without this sweep, a run stranded by a restart stays `RUNNING` forever and
the spend it reserved is never released.

Each invocation lists runs stale by at least five minutes, claims a 120-second
lease, requeues expired retryable cells while attempts remain, terminalizes
exhausted work, and writes the terminal report once every cell is terminal.
Concurrent schedulers are safe: lease generation and token hashes fence recovery.

## Why it reads the response body

**A 200 does not mean recovery happened.** The endpoint answers 200 with a list
of per-run outcomes, and a run it could not recover appears in that list rather
than in the status code. `run.sh` parses the outcomes so a persistent failure
turns the cron red instead of looking healthy indefinitely.

One caveat is worth knowing, because it limits what this can detect: the recovery
loop catches _every_ exception into `SKIPPED_OR_RACED`
(`apps/manager/src/workflows/subtitleEvalRecovery.ts`). A benign lease race and an
unreachable Admin produce the same status. So a single all-raced sweep is normal
and is not treated as failure. Once you know the normal rate, set
`RECOVERY_ALERT_ALL_RACED=true` to make a fully-raced sweep a hard failure.

Narrowing that status at the source would be the better fix; it is a Manager
change, not a cron change.

## Environment

| Variable                   | Required | Meaning                                                          |
| -------------------------- | -------- | ---------------------------------------------------------------- |
| `MANAGER_URL`              | yes      | Manager origin, e.g. `https://manager.jesusfilm.org`             |
| `MANAGER_API_KEY`          | yes      | Service bearer; must match Manager's `MANAGER_API_KEY`           |
| `RECOVERY_TIMEOUT_SECONDS` | no       | Request deadline, default 240 — keep below the schedule interval |
| `RECOVERY_ALERT_ALL_RACED` | no       | `true` makes a fully-raced sweep exit non-zero. Default `false`  |

## Creating the service

1. New Railway service in the `forge` project, source `JesusFilm/forge`.
2. Apply `railway-service-settings.json`: Dockerfile path, cron `*/5 * * * *`,
   restart policy `NEVER`, 1 replica, and the watch pattern.
3. Set `MANAGER_URL` and `MANAGER_API_KEY`.
4. Verify a wrong bearer exits non-zero and logs `event=http_error status=401`
   before trusting the schedule.

Restart policy is `NEVER` on purpose: a cron run that fails should wait for its
next tick rather than restart immediately against the same broken upstream.

## Alerting

Alert on runs stuck in `QUEUED` or `RUNNING` beyond the schedule interval plus the
maximum cell timeout. The cron going green is not by itself evidence that a
specific stranded run recovered — check the Admin terminal report.
