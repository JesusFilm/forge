---
id: "feat-319"
title: "Datadog syslog structured log tags"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-27"
duration: 1
depends_on:
  - "feat-210"
  - "feat-215"
  - "feat-315"
blocks: []
tags:
  - "platform"
  - "web"
  - "admin"
  - "railway"
  - "datadog"
  - "logs"
---

## Problem

Web and Admin syslog log payloads include a JSON `ddtags` field with `env`,
`service`, and `version`, but Datadog stores that value as a parsed log
attribute instead of promoting it into the log tag set. APM service-page log
patterns filtered by release version can therefore show no matching patterns
even when correlated logs exist and the JSON `ddtags` attribute contains the
right version.

The shared Agent syslog listener also hardcodes `service: forge-admin`, which
can mislabel Web logs received on the same UDP endpoint.

## Entry Points

1. `apps/admin/src/observability/datadog-logs.ts` - Admin syslog formatter.
2. `apps/web/src/observability/datadog-logs.ts` - Web syslog formatter.
3. `infra/datadog-agent/syslog.yaml` - shared Agent UDP listener.
4. `docs/observability/datadog.md` - operator runbook.
5. `infra/datadog-agent/README.md` - Agent log transport notes.

## What To Build

- Emit `ddsource` and `ddtags` in the RFC5424 structured-data section so
  Datadog promotes release metadata into log tags.
- Keep the JSON `ddtags`, `env`, `service`, and `version` fields for existing
  search/debug workflows.
- Remove the Agent listener's hardcoded single-service value.

## Verification

- `pnpm --filter @forge/admin test -- src/observability/datadog-logs.test.ts`
- `pnpm --filter @forge/web test -- src/observability/datadog-logs.test.ts`
- `pnpm --filter @forge/admin exec eslint src/observability/datadog-logs.ts src/observability/datadog-logs.test.ts`
- `pnpm --filter @forge/web exec eslint src/observability/datadog-logs.ts src/observability/datadog-logs.test.ts`
- `git diff --check`

## Completion Evidence

- Web and Admin now emit `ddsource` and `ddtags` in RFC5424 structured data
  while preserving the JSON attributes.
- The shared Agent UDP listener no longer hardcodes `service: forge-admin`.
- The Datadog runbook documents why JSON-only `ddtags` appears as an attribute
  instead of an applied log tag.
