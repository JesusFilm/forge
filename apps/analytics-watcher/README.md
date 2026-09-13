# Forge Analytics Watcher

Checks production Watch GA delivery and real GA/Datadog intake every five minutes.
Posts confirmed problems and recoveries to `#forge-development` as **Forge
Analytics Watcher**, from an independent Railway cron service.

**Activation pending:** the Railway service and dedicated volume are created.
Slack installation, production credentials, external heartbeat and actual Slack
delivery still need verification.
A merged PR does not activate this service by itself. Track completion in feat-495.

## Confirmation rules

| Check            | Failure evidence                                                                                                                           | Confirmation                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `ga-browser`     | Watch renders, but initial `page_view`, `share_opened`, or navigation `page_view` is not accepted for the expected measurement ID and page | Three failed runs spanning at least 10 minutes                                                   |
| `datadog-intake` | A successful query returns zero production Watch RUM views in the preceding **2 hours**                                                    | Three empty queries spanning at least 10 minutes after the silence threshold                     |
| `ga-intake`      | GA Realtime establishes **2 hours** without real `page_view` events in the configured stream                                               | Three failed observations spanning at least 10 minutes after the silence threshold               |
| `*:visibility`   | Authentication, query validation, browser launch, page access or interaction prevents a trustworthy result                                 | Three unknown observations spanning at least 10 minutes; message says monitoring needs attention |

Recovery requires two successful observations spanning at least five minutes.
Unknown results neither confirm nor recover an analytics incident. Valid empty
GA reports warm up the silence window quietly. Gaps over 15 minutes reset pending
confirmation and GA coverage; open incidents survive restarts and gaps.

Intake alerts confirm **missing data**, not a global Google/Datadog outage.
Quiet traffic or provider filtering remain possible causes. Realtime cannot
filter by page path: a shared stream's intake check includes non-Watch traffic.
The browser check independently catches broken Watch events in that case.

## Synthetic traffic

The browser inspects the app's original event name, measurement ID and page
identity, then namespaces **only the probe's outbound event names** as
`forge_monitor_*` before forwarding to Google's real collection endpoint. It
never installs GA or injects `gtag` calls. This keeps probes out of `page_view`
intake queries and normal Share event counts. Total event/user/session metrics
can still include probes; exclude `forge_monitor_*` in event reports. HTTP
acceptance proves transport, not that every event appears in processed reports.

The probe blocks its own Datadog browser-intake requests. Real RUM is sampled at
50%, so requiring each fresh browser to send a RUM batch would create false
alarms. The read-only RUM query observes real traffic independently. Preserve
all configured Watch analytics under `docs/analytics-and-recommendation-policy.md`.

## Install the Slack bot

1. [Create an app](https://api.slack.com/apps) in the JFP Digital workspace from
   `apps/analytics-watcher/slack-app-manifest.json`. Install it to the workspace.
2. Invite **Forge Analytics Watcher** to `#forge-development`. Copy the channel
   ID from channel details into the service's `SLACK_CHANNEL_ID`.
3. Store the Bot User OAuth Token as `SLACK_BOT_TOKEN` in Railway service secrets.
   Never paste tokens into chat, commit them, or put them in command arguments.
4. With those secrets securely injected, run
   `pnpm --filter @forge/analytics-watcher slack:test` (or
   `node apps/analytics-watcher/dist/index.js --test-slack` inside the container).
   This sends one clearly labelled installation test without opening an incident.

The only bot scope is `chat:write`; it cannot read channel history. Installation
requires workspace app-install permission. The manifest defines the app; it
does not prove installation. No Slack installation credential is present here.

## Configure and deploy

Use the `@forge/analytics-watcher` service in Forge production, connected to
`JesusFilm/forge` on `main`, with repository root as build root and a **dedicated
volume at `/data`**. Its settings are recorded in
`apps/analytics-watcher/railway-service-settings.json` and applied through
Railway's service API/dashboard; editing that snapshot does not apply changes.
Railway rejected a new `railwayConfigFile` binding on 2026-09-14 because that
configuration mechanism is deprecated. Use the supported service settings;
do not migrate unrelated Forge services to a new infrastructure framework.
Deploy through the normal PR-to-main flow. The service needs no public domain.
Do not share an app's volume or run multiple replicas.

Production service ID: `db748998-280b-4f3f-97a7-44ec2b94c3b9`.
Volume ID: `2448e16a-90c7-4fbc-8104-5ddcea63d8a8`.

Set variables from `.env.example` in Railway:

| Variable                              | Source                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GA_MEASUREMENT_ID`                   | Production Watch's measurement ID                                                                               |
| `GA4_PROPERTY_ID`, `GA4_STREAM_ID`    | Numeric property and web stream IDs matching that measurement ID                                                |
| `GA4_CREDENTIALS_JSON`                | Dedicated service account with Viewer access; enable Analytics Data API; only `analytics.readonly` is requested |
| `DD_SITE`                             | Organization site, default `datadoghq.com`                                                                      |
| `DD_API_KEY`, `DD_APP_KEY`            | API key and application key scoped to `rum_apps_read`; no monitor-writing permissions                           |
| `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` | Installed bot and the ID of `#forge-development`                                                                |
| `HEARTBEAT_URL`                       | Secret success-ping URL from an external heartbeat service                                                      |

Chat connector access does not automatically provide credentials to this runner.
Configure the external heartbeat with a five-minute period, 15-minute grace and
its own Slack notification to `#forge-development`. Run it outside Railway so a
Railway outage cannot disable both watcher and alarm. The success ping follows
checks, state persistence and required Slack sends. Missing pings catch stopped
runs, hung browsers, missing credentials, storage errors and failed delivery.

Railway cron timing varies and an active execution causes the next to be skipped.
`start.sh` uses a kernel-released process lock and a 240-second deadline, followed
by forced termination after ten seconds, to keep one stuck run from blocking all
future runs. State is saved atomically and flushed to disk on the volume.

## Verify activation

1. Run package `test`, `lint`, `typecheck` and `build`. Slack tests exercise a
   local HTTP server, including rejected delivery, restart, opening and recovery.
   The package test command installs Chromium and its system dependencies when
   `CI=true`; local development needs `pnpm exec playwright install chromium` once.
2. Run `GA_MEASUREMENT_ID=<public-id> pnpm --filter @forge/analytics-watcher probe`.
   This tests production without Slack, state, or provider read credentials.
3. Verify real provider queries and at least three successful scheduled runs.
4. In an isolated test service/state, simulate a missing collector and recovery;
   clearly mark any Slack delivery test **TEST**. Confirm messages actually reach
   `#forge-development`. Never disable production analytics to test an outage.
5. Verify external missed-heartbeat alert/recovery and state persistence across
   a service restart before declaring the watcher active.

## Delivery and recovery operations

State and the notification outbox live at `/data/analytics-watcher/state.json`.
Failed sends remain pending. Acknowledged sends are removed. Unchanged incidents
and healthy runs do not generate repeated messages.

Delivery is **at least once**: a crash after Slack accepts a message but before
the acknowledgement is saved can duplicate it. Stable incident IDs identify
that case. A backlog over 100 messages stops state writes and triggers the
external heartbeat; restore Slack and inspect the backlog.

Changed URLs, GA scope, Datadog site or Slack destination refuse old state.
Archive it and resolve existing alerts before starting the changed scope.
Corrupt state fails visibly instead of discarding incidents. Stored evidence
contains statuses, timestamps and summaries; secrets and raw provider bodies
are never logged.

## References

- [Datadog RUM read API](https://docs.datadoghq.com/api/latest/rum/get-a-list-of-rum-events/)
- [GA Realtime](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runRealtimeReport)
- [Slack chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/)
- [Railway cron](https://docs.railway.com/cron-jobs)
