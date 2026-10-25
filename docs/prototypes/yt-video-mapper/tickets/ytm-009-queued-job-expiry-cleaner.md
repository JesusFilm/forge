---
id: YTM-009
title: "Expire abandoned queued match jobs"
status: complete
priority: P1
depends_on:
  - YTM-001
---

# YTM-009: Expire abandoned queued match jobs

## Goal

Prevent yt-video-mapper uploads from remaining in `queued` forever when the
worker is unavailable, overloaded, or a caller submits and then abandons a job.

## Scope

- Add a distinct terminal `expired` Match Job status.
- Expire only jobs that remain `queued` for 30 minutes.
- Run an independent cleaner every minute.
- Delete raw upload bytes when expiring a job, while keeping the lightweight job
  row pollable.
- Return `{ jobId, status: "expired", errorCode: "job_expired" }` for expired
  jobs.
- Keep running jobs under the existing stale-running reclaim behavior.
- Allow manual processing of an overdue queued job until the cleaner marks it
  expired.

## Acceptance Criteria

- Existing overdue queued jobs expire on the first cleaner pass after deploy.
- The automatic worker skips queued jobs that have crossed the expiry window.
- The cleaner coordinates across service instances with a database lease.
- Upload cleanup failures are retried and logged without exposing secrets.
- Operators can disable the cleaner with `MATCH_JOB_CLEANER_ENABLED=false`
  during rollout or incident response.

## Verification

```sh
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
pnpm --filter @forge/yt-video-mapper-backend lint
pnpm --filter @forge/yt-video-mapper-backend build
```
