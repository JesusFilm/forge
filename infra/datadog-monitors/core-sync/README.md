# Core Sync Datadog monitors

Monitors-as-code for the daily Core Sync workflow. Each file is a Datadog
**log alert** payload, created through the Monitor API the same way the
sibling `push`, `fleet-ceiling`, and `recommendation-evidence` payloads are.
They follow the directory convention that `infra/datadog-monitors/README.md`
established.

## What these watch

Core Sync logs structured JSON (`console.log` / `console.error` of
`JSON.stringify({ event: "core-sync...." , ... })`), not the plain
`event=name` strings the `push` monitors match. Datadog's JSON log pipeline
promotes the top-level `event` key to a facet, so these queries use the
attribute form `@event:<name>` instead of a quoted `"event=<name>"`
substring.

| File                             | Event                                 | Priority | Fires when                                                             |
| --------------------------------- | -------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `run-failed.json`                 | `core-sync.run.failed`                 | P1       | a Core Sync run finished with at least one phase error                  |
| `scheduled-skip-exhausted.json`   | `core-sync.scheduled.skip-exhausted`   | P2       | the daily scheduled run stayed lock-skipped through all same-day retries |

`run-failed.json` matters beyond Core Sync itself: a run with any phase error
also blocks Watch catalog publication for that run
(`src/services/watch-catalog-publication.ts`).

`scheduled-skip-exhausted.json` watches the terminal outcome of the same-day
retry added for this ticket (`runCoreSyncQueued` in
`src/workflows/coreSyncQueued.ts`): when the 07:00 UTC scheduled run finds the
sync lock held, it retries up to 3 times, 15 minutes apart
(`core-sync.scheduled.retry`), and only logs `skip-exhausted` if every retry
still found the lock held.

`apps/admin/src/services/core-sync/monitors.test.ts` loads both files, checks
the payload shape, and checks that every `@event:<name>` token in a query is
an `event: "<name>"` literal that actually exists in source under
`apps/admin/src/`. That test is the only guard the repo has against a
monitor query drifting away from its log line.

## Prerequisites

- **`DD_API_KEY`** — the `Forge-production` Datadog API key.
- **`DD_APP_KEY`** — a Datadog application key. Monitor writes need both.
- Datadog site is US1 (`datadoghq.com`); override with `DD_SITE` if needed.

## Precondition — verify the log pipeline first

In Datadog → Logs, run `service:forge-admin` and confirm recent admin logs
are arriving. If none are, syslog forwarding is not active and **every
monitor here is silently green**. Fix the pipeline first; see
`docs/observability/datadog.md`.

## Creating them

The root `infra/datadog-monitors/create.sh` is hardcoded to the fleet-ceiling
payload set (`m1-exceeded`, `m2-missing-key-id`, `m3-near`), so it cannot be
reused as-is for these files. POST each payload directly, once per file:

```bash
DD_API_KEY=... DD_APP_KEY=...
curl -sS -X POST "https://api.datadoghq.com/api/v1/monitor" \
  -H "Content-Type: application/json" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  --data-binary @infra/datadog-monitors/core-sync/run-failed.json
```

Repeat for `scheduled-skip-exhausted.json`. Replace the notification handle
in each `message` with the approved destination for your organization before
you create them.

**Re-running creates duplicates** — Datadog has no create-if-absent. To
re-apply, delete the old monitor first (see the root README's "list/delete"
snippet, searching for `core-sync` instead of `fleet_ceiling`).
