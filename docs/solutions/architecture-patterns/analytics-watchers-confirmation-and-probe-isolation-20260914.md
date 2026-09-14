---
title: "Confirm analytics silence without letting probes conceal it"
date: "2026-09-14"
module: "Watch analytics monitoring"
problem_type: "architecture_pattern"
category: "architecture-patterns"
component: "background_job"
severity: "high"
applies_when:
  - "Building a scheduled analytics watcher with Slack notifications"
  - "Combining synthetic browser probes with real provider intake checks"
tags: [analytics, datadog, ga4, slack, confirmation, monitoring]
---

## Context

The Watch analytics regression in PR #2229 showed that a rendered page and
configured measurement ID do not prove delivery. The permanent watcher must
also avoid turning transient query failures into false outage notifications.

## Guidance

`apps/analytics-watcher/` separates healthy, failed, unknown and warming evidence.
Only three failed observations spanning ten minutes open an incident. Two
successful observations over five minutes recover it. Unknowns preserve open
incidents and raise a separately worded monitoring problem if repeated.

Elapsed time matters as well as count: three immediate retries do not prove ten
minutes of failure. Scheduler gaps reset pending confirmation. GA's standard
Realtime API covers only thirty minutes, so two hours of silence requires
retaining activity and query continuity across successful runs. A failed query
invalidates coverage; it cannot be treated as an empty report. The required
stream ID keeps unrelated properties/streams from satisfying the query, but
Realtime cannot distinguish Watch paths inside a shared stream.

Browser probes can otherwise keep a dead intake monitor green. Inspect the
application's original GA events, namespace probe event names on their way to
Google, and query only real `page_view` events. Keep the limitation explicit:
aggregate user/session/total event metrics can still include the probe. Block
its Datadog intake because the RUM no-data check must observe real viewers.
Never install the analytics SDK in the test: that would conceal its removal
from the production application.

Persist the notification outbox before sending and remove messages only after
Slack acknowledges the configured destination. Document at-least-once delivery:
a crash between acceptance and durable acknowledgement may duplicate a message.
Drain existing pending notifications before accumulating new ones so a bounded
backlog can recover. Corrupt state must not silently reset incidents.

Use an external heartbeat to detect a dead watcher. A checker cannot detect its
own stopped scheduler. Bound each run and use a process lock, since Railway
skips cron executions while the previous run remains active. Preserve default
Playwright container flags: changing `/dev/shm` behavior to fix a particular
developer machine is not automatically suitable for a container's small shared
memory mount.

## Verification and boundaries

Tests exercise a local HTTP Slack server, persisted restart/retry/recovery, and
an actual browser against both healthy and missing-tracking fixture pages.
Production browser and container probes returned three HTTP 204 responses for
the original initial page-view, Share and navigation events. A read-only
Datadog query returned production Watch views. These observations do not prove
the Slack bot is installed or that the scheduled service has been activated;
feat-495 remains in progress until operational verification is complete.

Related: `docs/solutions/integration-issues/watch-analytics-unwired-consent-gate.md`,
`apps/analytics-watcher/README.md`, and
`docs/analytics-and-recommendation-policy.md`. Preserve the restored analytics
through future ticket work and rollbacks.
