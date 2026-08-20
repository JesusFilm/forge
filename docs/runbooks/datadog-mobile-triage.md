# Datadog mobile triage runbook

## Purpose and safety boundary

The Mastra `datadog-mobile-triage` workflow sweeps mobile Datadog telemetry
every hour, judges which signals are worth a human investigating, and files
deduplicated Linear issues into the FGE mobile-triage project.

It is **read-only toward Datadog**. It never resolves, ignores, assigns, or
comments on a Datadog issue, never creates or edits a monitor, and never writes
product code. Toward Linear it creates issues only: the create payload carries
no `priority` and no `assigneeId` field at all, so it cannot set them.

The capability is default-off behind `DATADOG_TRIAGE_ENABLED`. Merging its PR
changes nothing in production. Rollback is the flag; never tear down the
schema.

**Ticket silence is not evidence of health.** The pipeline has no heartbeat in
this version — the daily summary that would have been one was dropped. The
liveness check below is the only thing that distinguishes a quiet week from a
dead sweep, and it has a named owner and cadence for that reason.

## Provisioning

Do all of this before the flag is ever set to `true`.

### 1. Datadog credentials

1. Create a **dedicated least-privilege Datadog identity** for this pipeline.
   Never mint the application key under a personal admin account: an
   application key inherits its creator's permissions.
2. Check that the org's **"Restrict Access by Scope"** setting is enabled. If it
   is not, the application key carries its creator's full permissions
   regardless of what you intended. **Do not enable
   `DATADOG_TRIAGE_ENABLED` until the key's effective permissions are limited
   to the read scopes below.**
3. Grant read scopes: `logs_read_data`, `rum_apps_read`, `monitors_read`, plus
   whatever Error Tracking issue search requires. **That last scope name is not
   documented — verify it empirically during the smoke in step 5.**
4. Record the Datadog site (`DATADOG_TRIAGE_SITE`, default `datadoghq.com`).
   Only the sites in `DATADOG_TRIAGE_ALLOWED_SITES` are accepted; anything else
   fails readiness with `datadog_site_not_allowed` before a key is ever sent.

### 2. Linear project

1. Create a **new, dedicated mobile-triage project** in the FGE team. Do not
   reuse an existing project or the bare team backlog — a dedicated project is
   what keeps agent-filed tickets easy to review or mute.
2. Create or identify the Bug-class label the tickets should carry.
3. Create a distinct Linear service identity for this pipeline. Its key must be
   separate from the support-research and SEO integrations' keys.
4. Record the team id, project id, and label id.

### 3. Secrets into Railway

Set these on the `@forge/mastra` service. Secrets must be Railway references,
never committed values.

| Variable                             | Value                                |
| ------------------------------------ | ------------------------------------ |
| `DATADOG_TRIAGE_API_KEY`             | Datadog API key                      |
| `DATADOG_TRIAGE_APP_KEY`             | Datadog application key (scoped)     |
| `DATADOG_TRIAGE_SITE`                | Datadog site, if not `datadoghq.com` |
| `LINEAR_DATADOG_TRIAGE_API_KEY`      | Dedicated Linear service key         |
| `LINEAR_DATADOG_TRIAGE_TEAM_ID`      | FGE team id                          |
| `LINEAR_DATADOG_TRIAGE_PROJECT_ID`   | Mobile-triage project id             |
| `LINEAR_DATADOG_TRIAGE_BUG_LABEL_ID` | Bug-class label id                   |
| `OPENAI_API_KEY`                     | Judgment model credential            |

`OPENAI_API_KEY` is the shared runtime key, not a triage-specific one — it is
listed because the default `DATADOG_TRIAGE_MODEL` is an `openai/` route and the
sweep cannot judge anything without it. Readiness refuses with
`model_api_key_missing` rather than running, so a missing key is a loud
`disabled` report and not a silent hour of spent Datadog quota. Point
`DATADOG_TRIAGE_MODEL` at an `openrouter/...` model to use the OpenRouter keys
instead.

Leave `DATADOG_TRIAGE_ENABLED` unset or `false` throughout provisioning. Every
other `DATADOG_TRIAGE_*` variable has a default; see the env table in
`apps/mastra/CLAUDE.md`.

### 4. Migration rollout

**Deploy migration `003` before enabling the flag.** The workflow's first run
writes to the `datadog_triage` schema; without it the run fails and files
nothing.

1. Deploy the PR through the normal PR-to-main Railway flow with
   `DATADOG_TRIAGE_ENABLED` off.
2. Apply migrations: `pnpm --filter @forge/mastra migrate:database`. The
   migrator applies every pending Mastra SQL migration, so confirm the ledger
   before running it in a shared environment.
3. Read back independently — a green deploy is not database evidence:

   ```sql
   select table_name from information_schema.tables
    where table_schema = 'datadog_triage' order by table_name;
   ```

   Expect exactly: `actions`, `cursors`, `monitor_states`, `runs`,
   `seen_issues`, `service_baselines`, `spike_baselines`.

Migration `003` is additive and idempotent (`create ... if not exists`), so a
repeat apply is a no-op **on a database that has never applied it**.

That idempotence has a sharp edge worth knowing before you run it locally:
`create table if not exists` does NOT add a column to a table that already
exists. `003` is still unmerged and has never reached production, so a
production apply creates every table complete and this cannot bite there. A
DEV database that ran an EARLIER revision of `003` is a different story — it
would silently lack `spike_baselines.epoch`, and the sweep would fail at write
time. The checksum runner protects you: it refuses with `Mastra migration 3
differs from the applied checksum` rather than running against a stale schema.
Reconcile that database rather than forcing past it:

```sql
delete from schema_migrations where version = 3;
```

then re-run `pnpm --filter @forge/mastra migrate:database`. Safe because `003`
is all `create ... if not exists` — but drop the `datadog_triage` schema first
if the earlier revision created any table you now need reshaped.

### 5. Live scoped-key smoke (pre-enable, not CI)

Confirms the scopes actually work and settles the one contract the test suite
could not. Run each read once with the provisioned keys and record the result:

1. `POST /api/v2/error-tracking/issues/search` for `service:forge-mobile`.
   - Confirm it returns 200 with the scopes granted, and **record which scope
     name Error Tracking search actually needed** — fill it into step 1.3 above.
   - **Confirm the response envelope.** The client models the documented
     JSON:API `data[].attributes` + `included[]` wrapping, which was never
     observed on the wire; the module header in `datadog-client.ts` says so in
     place. If production sends a different shape, the run report shows
     `datadog:issue:<service>:unparsed_rows` and the fix is that one parser.
   - **Record the pagination cursor field.** Ask for more rows than one page
     holds and note where the next-page cursor appears. The client accepts
     `meta.page.after` and `meta.pagination.next_cursor`; anything else means
     paging stops after one page, which shows up as `page_truncated` and
     blocks that service from ever seeding until the client learns the name.
2. `GET /api/v1/monitor?monitor_tags=service:forge-mobile`.
3. `POST /api/v2/rum/analytics/aggregate` for the same service.
4. Record the actual `X-RateLimit-*` headers each endpoint returned, so the
   hourly cadence can be checked against the real budget.

## Dry-run window

The dry run is **the flag on with the daily budget at zero**. Actions enqueue
and nothing dispatches.

1. Set `DATADOG_TRIAGE_MAX_TICKETS_PER_DAY=0`, then
   `DATADOG_TRIAGE_ENABLED=true`.
2. Let the first run complete. It is a **baseline seed**: it records the
   standing issue set for `forge-mobile` and files nothing (this is expected,
   not a failure).
3. Let several more hours run. Review what the pipeline wanted to file:

   ```sql
   select idempotency_key, service, signal_kind, epoch,
          payload->>'title' as title, created_at
     from datadog_triage.actions
    where state = 'pending'
    order by created_at;
   ```

4. Read the bodies of a few. Check the evidence is accurate, the Datadog deep
   link resolves in one click, and nothing in the body should not be in Linear.
5. Decide, and **do exactly one**:
   - **Go live:** raise `DATADOG_TRIAGE_MAX_TICKETS_PER_DAY` to a small number
     (start at `3`). The queued rows dispatch under that budget over the coming
     days.
   - **Discard the backlog first:** delete the rows you do not want, then raise
     the budget.

     ```sql
     delete from datadog_triage.actions
      where state = 'pending' and created_at < '<cutoff>';
     ```

   Skipping this decision does NOT file the backlog at once. The claim orders
   strictly FIFO by `next_attempt_at, created_at` and the queue has no expiry
   (R10), so an N-row backlog drains at the daily budget -- and every genuinely
   new signal detected afterwards is enqueued BEHIND all of it. At a budget of
   3 a few hundred queued rows is months of latency on new signals.

## Live rollout

1. Start at a small daily budget and **review every ticket for the first two
   weeks**. The budget is the blast-radius bound; the review is how the
   thresholds get calibrated.
2. Tune through configuration, not deploys:
   `DATADOG_TRIAGE_CONFIDENCE_THRESHOLD`,
   `DATADOG_TRIAGE_ACTIONABILITY_THRESHOLD`,
   `DATADOG_TRIAGE_MIN_OCCURRENCES`,
   `DATADOG_TRIAGE_REGRESSION_MULTIPLIER`.
3. Raise the budget only after a week of tickets you would have wanted anyway.
   Re-read a sample of ticket bodies whenever you raise it: what the app logs
   changes over time, and the body carries log-derived text.

## Unverified external: restart backfill

**Not verified as of 2026-08-19.** Whether the Mastra scheduler backfills
missed windows after a process restart was never observed — doing so needs a
running instance and a deliberate restart, which is a deploy-time check, not a
CI one. Adjacent evidence only: Studio's **Resume** on a paused schedule
calculates the next regular slot and does not backfill.

Two controls bound the damage either way, so this is worth confirming rather
than worth blocking on:

- The run key is the UTC hour (`datadog-triage:<YYYY-MM-DDTHH>`), so a second
  fire inside the same hour is refused by the run lease and returns
  `already_running`.
- The per-UTC-day ticket budget lives inside the SQL claim under an advisory
  lock, so even repeated fires cannot exceed the day's ticket count.

**Confirm it during the dry-run window**: restart the mastra service, then
check whether more than one `runs` row appears for any single hour.

```sql
select run_key, status, created_at, completed_at
  from datadog_triage.runs
 order by created_at desc limit 20;
```

## Operator levers

**Mute a noisy issue.** Set it to **Ignored** or **Excluded** in Datadog's
Error Tracking UI. Detection skips those states, so this is the mute lever —
and it keeps the pipeline read-only. Un-muting later makes the issue look new
again, so it can be ticketed once more.

**A ticket was closed but the error continues.** No new ticket is filed. Dedup
is epoch-scoped per issue fingerprint, and a continuing issue stays in the same
epoch. A new ticket appears only if activity regresses past
`DATADOG_TRIAGE_REGRESSION_MULTIPLIER` times its recorded baseline, which mints
a new epoch.

**Change the release-session filter.** Editing
`DATADOG_TRIAGE_RELEASE_VERSION_PATTERN` or
`DATADOG_TRIAGE_DEV_SESSION_MARKERS` **requires a paired baseline re-seed.** A
loosened filter makes previously excluded noise look new, and every bit of it
will be ticketed. To re-seed one service:

```sql
delete from datadog_triage.service_baselines where service = '<service>';
delete from datadog_triage.seen_issues where service = '<service>';
delete from datadog_triage.cursors where source like '%:<service>';
```

The next run re-records the baseline and files nothing.

**Recalibrate at an audience jump.** Thresholds tuned at beta scale are wrong at
wide release. Re-run the review period at each release milestone; this is a
scheduled task, not something to discover from a flood of tickets.

**Activate the admin path.** Two steps, no code:

1. Record a one-line confirmation from the web owner that no existing
   automation covers admin's Datadog errors. Until that exists, do not do
   step 2.
2. Append the admin service to `DATADOG_TRIAGE_SERVICES` and add its profile to
   `DATADOG_TRIAGE_SERVICE_PROFILES_JSON`, for example:

   ```json
   {
     "forge-mobile": {
       "surfacePrefix": "[Mobile]",
       "releaseSessionFilter": true,
       "spikeSource": "rum"
     },
     "forge-admin": {
       "surfacePrefix": "[Admin]",
       "releaseSessionFilter": false,
       "spikeSource": "logs"
     }
   }
   ```

   The new service's first covered run seeds its own baseline and files
   nothing.

## Liveness check

**Owner: the mobile owner. Cadence: weekly.**

Silent pipeline death is the worst failure mode here: an expired key, a Datadog
API change, or a Mastra platform upgrade can stop the sweep while everyone
believes coverage exists.

```sql
select source,
       cursor_at,
       last_success_at,
       now() - last_success_at as lag
  from datadog_triage.cursors
 order by last_success_at nulls first;
```

`last_success_at` is the time of the last successful FETCH, deliberately not
the cursor position — a cursor held back for an unresolved signal is normal
bounded work, and reading that as staleness would fire this alarm on the
pipeline's healthy path. A stale `cursor_at` with a fresh `last_success_at`
means "reading fine, working through a backlog"; a stale `last_success_at`
means the source is actually failing.

"Successful" means rows came back USABLE, not that the request returned 200. A
read that parsed nothing — the shape Datadog renaming a field produces — does
not stamp this column, and an incomplete read on a service that has not seeded
yet writes no cursor row at all. Both therefore age this lag rather than
showing green, which is the point: an HTTP-200-shaped outage is exactly the
silent death this check exists to catch.

Every source should show a lag under about two hours. **Act when any source
exceeds a few hours**, in this order:

1. Read the most recent run rows for the failure:

   ```sql
   select run_key, status, partial_reason, completed_at,
          report->'sources' as sources, report->'errors' as errors
     from datadog_triage.runs
    order by created_at desc limit 5;
   ```

2. **No recent rows at all can also mean readiness refused.** A disabled run
   returns before it claims anything, so it writes NO row -- the `disabled`
   status the schema reserves is never persisted. Before concluding the
   scheduler is dead, check `DATADOG_TRIAGE_ENABLED` and the service logs for
   `[datadog-triage] event=run_disabled reasons=...`, which names the missing
   credential or setting. A cleared `OPENAI_API_KEY` lands here.
3. `auth_failed` against a source means the key expired or lost a scope.
4. `parse_error` or `unparsed_rows` means the Datadog response SHAPE changed;
   see the provisioning smoke's envelope note. `response_too_large` is
   different and is not a parser problem: the body exceeded
   `DATADOG_TRIAGE_MAX_RESPONSE_BYTES`. It is retryable, so check whether the
   payload is legitimately large before raising the cap.
5. `dispatch_failed` as `partial_reason` means tickets are not reaching Linear.
   Go straight to the stuck-outbox check below — fetch health stays green
   through this, so nothing else here will surface it.
6. `baseline_read_incomplete` means the service cannot seed from one page. See
   "Issue-search pagination" under Deferred work.
7. No recent `runs` rows at all means the scheduler is not firing. Check the
   Mastra service is up and the workflow is registered.

Also check for stuck outbox rows:

```sql
select state, count(*) from datadog_triage.actions group by state;
```

`terminal` rows need a human. Do NOT assume they exhausted five attempts: a
non-retryable failure — a rotated Linear key (`auth_failed`), a rejected
payload, a GraphQL error — terminalizes on attempt ONE. Read `last_error_code`
to tell the two apart.

A terminal row means the ticket was never filed, and the signal's detection
state was still committed — so the sweep will not re-detect it. The outbox row
is the recovery path: it holds the full drafted ticket, so reclaiming it
re-sends that draft rather than needing the signal back.

```sql
-- After fixing the cause (rotate the key, correct the project id, …):
update datadog_triage.actions
   set state = 'pending', attempts = 0, next_attempt_at = now()
 where state = 'terminal';
```

Check this every time a run reports `partial_reason = 'dispatch_failed'` — that
is the signal that a dispatch terminalized. Do not wait for the liveness query
above to fire: it reads FETCH health, which stays green while every ticket
silently fails to file.

## Rollback

Set `DATADOG_TRIAGE_ENABLED=false`. The next scheduled run returns a typed
disabled report without touching Datadog, Linear, or the outbox. Nothing else
is required — **do not drop the schema**, or the baselines are lost and
re-enabling would file a ticket for every standing error.

## Deferred work

- **A real heartbeat.** A Datadog monitor on the workflow's own logs would
  replace the manual liveness check above. Until it ships, that check is the
  only liveness signal.
- **Issue-search page cap.** The client now follows the search cursor, up to
  `DATADOG_ISSUE_MAX_PAGES` (10 pages = 1000 issues) per service per run, and
  deduplicates by issue id across pages. Beyond that cap — or if a full page
  exposes no cursor at either spelling the client accepts — the read is
  reported `page_truncated`. Unusable rows are reported `unparsed_rows`.

  Either one refuses to seed that service's baseline. **While the service is
  still unseeded** it also holds the issue cursor, so the next run retries the
  same wide baseline window instead of collapsing to the overlap window and
  seeding off one hour. Once a service HAS seeded the cursor advances anyway:
  the standing set is already recorded, so an incomplete page costs one hour of
  coverage rather than a false baseline, and holding would stall a service that
  always fills its page. The cost is real -- issues past the page cap in that
  window are not seen, and are not seen again if they stop recurring. A service that
  stays over the cap therefore never seeds and files nothing from Error
  Tracking — fail-safe (silence, not a storm), and loud: every run reports
  `partial` with `datadog:issue:<service>:baseline_read_incomplete`. Because
  the seeding flag is per SERVICE, that service's monitor and spike detection
  stay dormant with it.

  The lever is `DATADOG_TRIAGE_BASELINE_LOOKBACK_MS`: shorten it until the
  baseline window fits. Raising the page cap needs a deploy and is the wrong
  answer past 1000 standing issues.

  **The cursor field name is unverified.** The client reads `meta.page.after`
  and `meta.pagination.next_cursor`; if production sends a third spelling,
  paging silently stops after one page and the read reports `page_truncated`
  rather than paging wrongly. Confirm the real cursor field during the
  pre-enable smoke (step 5.1) and add it to the client if it differs.

- **Grouped spike detection.** This version runs one ungrouped error-count
  spike check per service. Grouping by facet is a refinement.
- **Retention.** No purge job exists for `datadog_triage`. Growth is bounded by
  distinct issue fingerprints plus the daily ticket budget, so it is slow, but
  it is unbounded over years.
- **Cross-run root-cause merging.** Datadog re-clustering can mint a new
  fingerprint for an old problem, producing an occasional duplicate ticket.
  Close it as a duplicate by hand; merging is stage-2 work.
- **Stage 2.** Agents that pick up filed tickets and validate feasibility
  against the repo.
