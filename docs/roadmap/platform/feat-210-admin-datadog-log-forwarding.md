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
- Normalized Datadog env aliases so logs, APM, and RUM use the org-standard `prod`.
- Documented `DD_AGENT_SYSLOG_PORT=514` and Agent log variables.

## Verification

- `pnpm --filter @forge/admin test -- src/observability/datadog.test.ts src/observability/datadog-logs.test.ts`
- `pnpm --filter @forge/admin test -- src/config/datadog-env.test.ts src/observability/datadog-logs.test.ts src/components/__tests__/DatadogRum.test.tsx`
- `pnpm --filter @forge/admin lint -- src/observability/datadog.ts src/observability/datadog.test.ts src/observability/datadog-logs.ts src/observability/datadog-logs.test.ts src/config/env.ts`
- `pnpm --filter @forge/admin lint -- src/config/datadog-env.ts src/config/datadog-env.test.ts src/config/env.ts src/config/datadog-rum-env.ts src/observability/datadog-logs.ts src/observability/datadog-logs.test.ts src/components/DatadogRum.tsx src/components/__tests__/DatadogRum.test.tsx`
- `git diff --check`
