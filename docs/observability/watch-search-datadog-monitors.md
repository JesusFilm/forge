# Watch-search failure — Datadog monitor spec (feat-334)

Implementation spec for the Datadog monitor that pages an operator on an
elevated mobile Watch-search failure rate. **Self-contained** — everything you
need to build the monitor is here; you do not need the originating chat.

- **Owner:** Urim · **Feature:** feat-334 (mobile search observability parity), unit U10
- **Source of the signal:** `apps/mobile/src/lib/watchSearchLog.ts` (attribute
  builder + error-code classifier), emitted from
  `apps/mobile/app/(tabs)/watch.tsx` through the Datadog RN SDK
- **Related runbooks:** `docs/operations/watch-search-analytics-datadog.md`
  (canonical query + full attribute contract),
  `docs/observability/fleet-ceiling-datadog-monitors.md` (the monitor-spec
  template this doc follows), `docs/observability/datadog.md` (log pipeline)

---

## 0. Background (why this monitor exists)

Mobile Watch-search failures arrive as GraphQL error codes in a **200-body**
response. RUM error tracking never sees them — no HTTP error, no crash, no RUM
error event — so a full mobile search outage would today be visible only to
users. The feat-334 alignment gave every failed search one canonical structured
log row (`@watch_search.outcome:failed`); this monitor is the alarm on that
row's rate.

**This monitor deliberately exceeds web parity.** Even web has no search-quality
monitor; this is net-new methodology (session-settled decision in the feat-334
plan), not a parity item. Scope is **one monitor on the `failed` outcome** —
not a dashboard suite.

## 1. Precondition — aligned logs arriving (verify FIRST)

Verified 2026-08-04 (feat-334 U8 simulator verification, against local admin in
`env:development`): mobile emits the shared message `watch_search analytics`
under `service:forge-mobile`; failed rows log at **warn** carrying
`@watch_search.error_code`; every row carries the
`@watch_search.event_name:watch_search` facet.

The monitor watches `env:prod`, which only fills once a build with the aligned
telemetry is live in the stores. Before building the monitor, confirm prod rows
are arriving — in Datadog → Logs, run:

```text
service:forge-mobile env:prod @watch_search.event_name:watch_search
```

If that returns nothing, the aligned build hasn't shipped (or has no traffic
yet) and the monitor would be silently green — fix that first.

Two properties that change interpretation:

- **Counts are a floor.** These logs are client-emitted and SDK-sampled (unlike
  admin's server logs). The threshold below therefore sits on a floor; a real
  spike is at least as large as what the monitor sees.
- **Failures log at `warn`, not `error`.** Benign rate-limit rejections share
  the failure path by design. Filter on `@watch_search.outcome:failed`, never
  on log status.

## 2. The failure row (attributes the monitor and triage use)

One canonical log per settled search; on failure the relevant attributes are:

| Attribute                         | Value on a failed row                      | Notes                                                                                              |
| --------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `@watch_search.event_name`        | `watch_search` (constant)                  | The join facet — the monitor query filters on it                                                   |
| `@watch_search.outcome`           | `failed`                                   | The monitored discriminator                                                                        |
| `@watch_search.failure_category`  | `watch_search_error` (constant)            | Web's category vocabulary                                                                          |
| `@watch_search.error_code`        | e.g. `RATE_LIMITED`, `http_429`, `unknown` | GraphQL extension code when present, else `http_<status>`, else `unknown` (network-level failures) |
| `@watch_search.client_latency_ms` | integer                                    | Client round-trip; always present, failures included                                               |
| `@watch_search.search_request_id` | UUID                                       | Joins to admin's `SearchTrace` — the triage cross-check below                                      |

`@watch_search.latency_ms` (admin's server-side measure) is **absent on failed
rows by contract** — its absence is not a data problem.

The row also carries `@watch_search.query` — raw user search terms. The monitor
never needs it, and its presence is why `enable_logs_sample` is `false` below.

## 3. The monitor — WS1 mobile search-failure rate (P2)

A single Datadog **Log Alert** monitor.

- **Name:** `[forge-mobile] watch_search failures — mobile search-failure rate elevated`
- **Query:**
  `logs("service:forge-mobile env:prod @watch_search.event_name:watch_search @watch_search.outcome:failed").index("*").rollup("count").last("15m") > @REPLACE_AFTER_CALIBRATION`
- **Evaluation window:** count over the **last 15m** (recommended shape — long
  enough to smooth one user's retry burst, short enough to page inside a real
  outage). Finalize together with the threshold in §4.
- **Threshold:** `@REPLACE_AFTER_CALIBRATION` — the number is deliberately
  deferred to calibration. **Rationale:** rate-limit rejections are part of
  NORMAL failed volume — benign `RATE_LIMITED` / `http_429` rows share
  `outcome:failed` by design (the same reason mobile logs failures at `warn`) —
  so the threshold must clear that baseline, and the baseline can only be read
  from a representative week of real prod traffic post-ship (§4). Counts are a
  floor under SDK sampling: don't size the threshold so high that a
  sampled-down outage slips under it.
- **Message:**
  > Mobile Watch-search failures are elevated (`@watch_search.outcome:failed`
  > on `service:forge-mobile` crossed the calibrated threshold).
  > **Triage step 1 — rule out fabrication.** This signal is client-emitted
  > under a bundle-extractable Datadog client token; anyone can post
  > well-formed rows. Confirm the failure volume against admin-side
  > `SearchTrace` rows for the same window — no matching server-side movement
  > means fabrication or a client misconfiguration, not an outage.
  > **Step 2 — classify.** Slice by `@watch_search.error_code`:
  > `RATE_LIMITED` / `http_429` = throttling (check admin's rate-limit posture
  > and the fleet-ceiling monitors); `unknown` = network-level failures (the
  > client never got a GraphQL response); any other code = admin's GraphQL
  > surface. Runbook: `docs/operations/watch-search-analytics-datadog.md`.
  > `@REPLACE_WITH_ALERT_CHANNEL`
- **Priority:** 2. **renotify_interval:** 60. **notify_no_data:** false
  (absence = healthy; a quiet night is not an incident).
- **evaluation_delay:** 300 — client-emitted logs arrive with RN-SDK batching
  and offline-retry lag, meaningfully more than the 60s the fleet-ceiling
  monitors budget for server syslog.
- **Tags:** `service:forge-mobile`, `env:prod`, `team:forge`,
  `feature:feat-334`, `area:watch-search`.
- **`enable_logs_sample: false` — one deliberate departure from the
  fleet-ceiling template** (which attaches a sample log line to every alert).
  The log carries `@watch_search.query`, raw user search terms; an attached
  sample line would deliver raw terms into the alert channel, outside the
  R43-governed stores
  (`docs/solutions/best-practices/mobile-datadog-rich-posture-data-governance-20260714.md`).
  The notification carries only the aggregate failure count.

## 4. Calibration → alert (the post-merge operator tail)

Owned by the feat-334 plan owner (Goal Capsule tail ownership). **Deadline:
monitor live and firing-tested within 14 days of merge.** The feat-334 roadmap
ticket stays `in-progress` until this completes.

1. **Accumulate.** Let the aligned logs gather ~1 representative week of prod
   traffic after the aligned build ships.
2. **Read the week, including the benign baseline.** In Logs Explorer:

   ```text
   service:forge-mobile env:prod @watch_search.event_name:watch_search @watch_search.outcome:failed
   ```

   over the past week, grouped by `@watch_search.error_code` — note the total
   failed volume, the `RATE_LIMITED` / `http_429` share (the benign baseline),
   and the busiest 15-minute bucket. Datadog MCP alternative:
   `analyze_datadog_logs` with the same query, `time_window: "7d"`, and
   `@watch_search.error_code` declared in `extra_columns` (recipe shape in the
   runbook).

3. **Set the threshold + window.** Pick a 15m count that clears the busiest
   observed benign bucket with headroom, remembering counts are a floor under
   SDK sampling. Replace `@REPLACE_AFTER_CALIBRATION`; adjust the window only
   if the week's data argues for it, and write the chosen number's rationale
   into the monitor description.
4. **Point the channel.** Replace `@REPLACE_WITH_ALERT_CHANNEL` with the real
   handle — copy it from the existing `service:forge-tv` monitor
   (id 303307205) or the team's alert channel.
5. **Firing-test.** Drive a synthetic burst of failed mobile searches (e.g.
   sustained rapid searches from one device until rate-limit rejections flow)
   and confirm the monitor fires **and the page lands in the chosen channel** —
   that page is the completion test (feat-334 Goal Capsule). If the calibrated
   threshold is too high to reach synthetically, temporarily lower it, observe
   the page, then restore — the test proves the wiring (query → monitor →
   channel), not the number.

Definition of done:

- [ ] Prod precondition query returns mobile rows (§1).
- [ ] WS1 created with the §3 query, options, and privacy departure
      (`enable_logs_sample: false`).
- [ ] Threshold + window calibrated against a representative week; rationale
      recorded in the monitor description.
- [ ] Notification channel set; no placeholder left.
- [ ] Synthetic-burst firing test paged the chosen channel.
- [ ] `docs/roadmap/content-discovery/feat-334-mobile-search-observability-parity.md`
      flipped to `complete`.

## 5. How to create it — manual, in the Datadog UI

The repo owns no monitor-as-code — no terraform, and this spec deliberately
adds none (the committed fleet-ceiling payloads under `infra/datadog-monitors/`
are one-shot API bodies for that feature, not a managed system). Create WS1 by
hand:

Monitors → New Monitor → **Logs**. Paste the search from §3 (the part inside
`logs("…")`), set "over" = `count`, evaluation window `last 15 minutes`, alert
threshold = the calibrated number, then the message, tags, priority 2, renotify
60, **"Don't notify on no-data"**, evaluation delay 300, and switch **off** the
triggering-log sample (`enable_logs_sample: false` — §3's privacy departure).

Operating context for whoever answers the page:
`docs/operations/watch-search-analytics-datadog.md`.
