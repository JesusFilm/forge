---
id: "feat-210"
title: "Admin Datadog Log Forwarding"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-06-26"
duration: 1
depends_on:
  - "feat-204"
  - "feat-207"
blocks: []
tags:
  - "platform"
  - "admin"
  - "datadog"
  - "logging"
  - "railway"
---

## Problem

Admin had Datadog APM/RUM configured, but Railway stdout logs were only visible
in Railway. `DD_LOGS_INJECTION=true` decorates supported logger output for
correlation, but it does not ship Railway logs to Datadog. The Datadog Agent
service needs a log intake and Admin needs to forward logs over Railway private
networking.

## What Landed

- Added Datadog Agent `syslog.yaml` and `datadog.yaml`.
- Enabled Agent log collection and syslog UDP exposure in the Agent Dockerfile.
- Added Admin server console forwarding to the Agent over UDP syslog.
- Included Datadog service/env/version tags and active trace/span ids.
- Documented `DD_AGENT_SYSLOG_PORT=514` and Agent log variables.

## Verification

- `pnpm --filter @forge/admin test -- src/observability/datadog.test.ts src/observability/datadog-logs.test.ts`
- `pnpm --filter @forge/admin lint -- src/observability/datadog.ts src/observability/datadog.test.ts src/observability/datadog-logs.ts src/observability/datadog-logs.test.ts src/config/env.ts`
- `git diff --check`
