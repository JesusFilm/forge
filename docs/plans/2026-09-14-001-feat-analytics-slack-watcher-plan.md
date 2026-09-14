---
title: Confirm Watch analytics outages before notifying Slack
type: feat
status: active
date: 2026-09-14
---

# Confirm Watch analytics outages before notifying Slack

## Summary

Implement feat-495 as an independent Railway cron service with a Slack bot in
`#forge-development`. The user approved monitoring GA and Datadog, requested a
two-hour Datadog silence threshold, and requires confirmation before an incident.

## Requirements and decisions

- Run every five minutes. Confirm three bad observations over at least ten
  minutes; do not count immediate retries as independent confirmation.
- GA browser check exercises initial page view, Share, and real link navigation
  to another Watch page. Verify measurement ID, original event name, page path,
  and accepted HTTP response. Page/runner failures are unknown, not GA outages.
- GA Realtime queries use read-only credentials and a required stream ID. Track
  last real page-view activity across the thirty-minute API window, with two
  hours of silence and continuity checks before entering confirmation.
- The probe namespaces outbound GA event names before forwarding them, retaining
  original payload evidence in memory. GA real-traffic queries select page_view,
  so probe events cannot conceal zero user traffic. Block the probe's Datadog
  intake; production RUM is sampled and cannot be required on each probe.
- Query production Watch RUM over the preceding two hours using rum_apps_read.
  No-data means successful, validated empty results, never authentication errors.
- Persist confirmation, open incidents, and a notification outbox on a dedicated
  Railway volume. Single process lock, atomic saves, bounded run duration.
- Send one opening notification and one recovery after two good observations
  over five minutes. Retry unacknowledged Slack messages; document the unavoidable
  delivery/ack crash window. Never claim exactly-once Slack delivery.
- Repeated unknown results create a separately worded monitoring problem.
  An external heartbeat detects skipped, stuck, or absent runs independently.
- Credentials and Slack app installation are operational prerequisites. They
  are now configured, and the production cron is deployed. Keep the roadmap in
  progress until the activation record verifies all acceptance checks.

## Implementation units

### U1: Persistent confirmation and Slack delivery

Files: `apps/analytics-watcher/src/state.ts`, `store.ts`, `slack.ts`, and colocated
tests. Define health/unknown observations, elapsed-time confirmation, gap reset,
stable incidents and an outbox acknowledged only after Slack accepts delivery.
Test transient failures, irregular schedules, unknowns, recovery flapping,
restart persistence, corrupt state, and failed Slack delivery with local HTTP.

### U2: Browser and provider evidence

Files: `apps/analytics-watcher/src/browser.ts`, `checks.ts`, `config.ts`, and
colocated tests. Follow existing Google auth library usage in
`apps/mastra/src/services/google-auth-client.ts` without cross-app imports.
Test GET/POST/batched GA events, wrong measurement IDs, blocked collection,
malformed API replies, GA window continuity, zero RUM and recent events.
Verify a real production journey without sending Slack messages.

### U3: Scheduled runtime and operator handoff

Files: `apps/analytics-watcher/src/index.ts`, `run.ts`, package/build configuration,
`railway-service-settings.json`, `slack-app-manifest.json`, `README.md`, `.env.example`, and
`docs/observability/datadog.md`. Use normal package CI plus a browser fixture test.
Provide an installable app manifest with chat:write only. Require the operator to
invite it to the target channel. Configure an external heartbeat URL and test
missing-run behavior before activation is complete.

## Sources

- `docs/solutions/integration-issues/watch-analytics-unwired-consent-gate.md`
- `docs/solutions/conventions/datadog-rum-env-tag-cross-app-canonical-value.md`
- [Slack chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/)
- [GA Realtime dimensions](https://developers.google.com/analytics/devguides/reporting/data/v1/realtime-api-schema)
- [Datadog RUM read API](https://docs.datadoghq.com/api/latest/rum/get-a-list-of-rum-events/)
- [Railway cron jobs](https://docs.railway.com/cron-jobs)
