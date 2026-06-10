---
id: YTM-007
title: "Harden uploads, retention cleanup, and job access"
status: todo
priority: P2
depends_on:
  - YTM-001
  - YTM-005
---

# YTM-007: Harden uploads, retention cleanup, and job access

## Goal

Close the known prototype gaps before the service handles large or shared
production workloads.

## Scope

- Stream request bodies into upload storage instead of buffering the full upload
  before writing.
- Add a cleanup worker or command for expired `MatchJob` rows and leftover
  transient uploads.
- Decide whether job polling needs caller ownership or scoped job tokens beyond
  the service bearer token.
- Add request size, rate, and timeout guardrails appropriate for video uploads.
- Add operational logging around job lifecycle transitions without logging raw
  media, bearer tokens, or internal evidence payloads.

## Acceptance Criteria

- Large uploads do not require holding the full file in memory.
- Expired job results and transient uploads can be cleaned up safely.
- Job access policy is documented and enforced.
- Operational logs are useful for support without leaking sensitive data.

## Verification

```sh
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
pnpm --filter @forge/yt-video-mapper-backend lint
```
