# Push campaign Datadog monitors

Monitors-as-code for the localized push campaign send path. Each file is a
Datadog **log alert** payload, created through the Monitor API the same way the
sibling `fleet-ceiling` and `recommendation-evidence` payloads are. They follow
the directory convention that `infra/datadog-monitors/README.md` established.

## What these watch

The admin worker emits plain-string logs shaped
`[push] event=<name> key=value key=value` from
`apps/admin/src/services/push/`. Each monitor is a quoted-substring log query
with a five-minute rollup and `count >= 1`.

| File                                 | Event token                              | Priority | Fires when                                                |
| ------------------------------------ | ---------------------------------------- | -------- | --------------------------------------------------------- |
| `provider-auth-failed.json`          | `event=provider_auth_failed`             | P1       | the provider refused the worker's access token            |
| `zone-missed.json`                   | `event=zone_missed`                      | P2       | a time-zone group was retired unsent, for any reason      |
| `dispatch-start-failed.json`         | `event=dispatch_start_failed`            | P2       | an editor's schedule, send, or test never started a run   |
| `heartbeat-stale-live-campaign.json` | `event=zone_missed reason=run_not_alive` | P1       | the recovery sweep found a live campaign with no live run |

`apps/admin/src/services/push/monitors.test.ts` loads all four files, checks the
payload shape, and checks that every event token in a query is a token the
source actually emits. That test is the only guard the repo has against a
monitor query drifting away from its log line.

## The fourth monitor is a proxy, and here is why

The plan asks for "heartbeat stale while any campaign is scheduled or sending".
Nothing emits that today. The workflow worker heartbeat
(`apps/admin/src/services/workflow-worker-heartbeat.service.ts`) writes a
database row every 15 seconds and logs nothing, so a log monitor cannot see it,
and a sleeping campaign run logs nothing between groups by design.

`heartbeat-stale-live-campaign.json` therefore watches the detected
**consequence** instead: `reason=run_not_alive`, which the recovery sweep emits
when a worker boots and finds a campaign still scheduled or sending whose
durable run the runtime no longer holds. That is the same fault, seen one worker
boot later.

To close the gap, either add a periodic log line from the worker while any
campaign is live, or move this monitor to a metric monitor over the heartbeat
rows. Until then, the workflows dashboard workers section is the live check
during a wave: one row online with a heartbeat under 45 seconds.

## Prerequisites

- **`DD_API_KEY`** — the `Forge-production` Datadog API key.
- **`DD_APP_KEY`** — a Datadog application key. Monitor writes need both.
- Datadog site is US1 (`datadoghq.com`); override with `DD_SITE` if needed.

## Precondition — verify the log pipeline first

In Datadog → Logs, run `service:forge-admin` and confirm recent admin logs are
arriving. If none are, syslog forwarding is not active and **every monitor here
is silently green**. Fix the pipeline first; see `docs/observability/datadog.md`.

## Creating them

`infra/datadog-monitors/create.sh` posts a payload file to the Monitor API. Run
it once per file:

```bash
DD_API_KEY=... DD_APP_KEY=... infra/datadog-monitors/create.sh \
  infra/datadog-monitors/push/provider-auth-failed.json
```

Replace the notification handle in each `message` with the approved destination
for your organization before you create them.

## What never appears in these logs

No push token, no Expo access token, no viewer digest, and never the provider's
own message string. The provider's dead-token message embeds the push token, so
the code records the provider's error **code** plus an admin classification and
nothing else. A monitor message that asked an operator to read the provider text
would defeat that, so none of them do.
