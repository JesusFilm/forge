---
id: "feat-495"
title: "Confirm Watch analytics outages and notify Slack"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-14"
duration: 2
depends_on: []
blocks: []
tags: [web, analytics, datadog, infrastructure]
---

## Problem

The Watch consent regression stopped configured GA and Datadog RUM without an
analytics alert. Notify `#forge-development` only after confirming sustained
failure, then notify recovery. Datadog silence must last at least two hours.

## Entry Points — Read These First

1. `apps/analytics-watcher/README.md` — activation and operational contract.
2. `apps/analytics-watcher/src/state.ts` — confirmation and notification state.
3. `apps/analytics-watcher/src/checks.ts` — read-only provider queries.
4. `apps/analytics-watcher/src/browser.ts` — real Watch GA journey.
5. `docs/analytics-and-recommendation-policy.md` — preserve existing analytics.

## Grep These

`analytics-watcher`, `pending`, `rum_apps_read`, `GA4_STREAM_ID`.

## What To Build

A Railway cron service, Slack app manifest, persistent incident state, and
outage/recovery messages. Three failed scheduled observations spanning at least
ten minutes confirm failure. Two successful observations spanning five minutes
confirm recovery. Unknown results do not confirm analytics failure or recovery.

## Constraints

Read-only GA/Datadog access. Slack posting only to the configured channel ID for
`#forge-development`. No app tracking changes or consent gates. Synthetic traffic
must not keep the real-traffic checks green. Deploy through PR-to-main.

## Verification

Run `pnpm --filter @forge/analytics-watcher test`, `typecheck`, `lint`, and `build`.
Run the browser journey against production in probe-only mode. Exercise the
incident lifecycle and retry paths against a local Slack HTTP fixture. Before
marking complete, install the Slack app, configure production service secrets and
volume, verify delivery in `#forge-development`, and verify an external heartbeat
alerts when scheduled runs stop. Code delivery alone is not activation.
