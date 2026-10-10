# Watch GA4 measurement — baseline, operator checklist, and privacy remediation

Owner surface: Watch analytics (`apps/web`). Plan:
[`docs/plans/2026-08-28-2331-fix-watch-ga4-measurement-plan.md`](../plans/2026-08-28-2331-fix-watch-ga4-measurement-plan.md).
Enablement policy:
[`docs/analytics-and-recommendation-policy.md`](../analytics-and-recommendation-policy.md).

This document freezes the **v1** Watch measurement behavior and the **external
GA4 property dependencies** that live outside this repository, so the v2
collector can be enabled and rolled back without silently losing an event name,
a key-event marking, or a downstream report.

Consent is **not** a prerequisite for anything described here. Configured
analytics initialize and emit without a consent state, prompt, or receipt.

---

## 1. Configured production baseline

### GA4

| Item                | Value                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collector           | `apps/web/src/components/GoogleAnalytics.tsx`, mounted in the shared Watch layout with no props                                                                                                                        |
| Measurement ID      | `NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID` (build-time, Railway service variable)                                                                                                                                   |
| Loading             | Two `next/script` tags, both `strategy="afterInteractive"`                                                                                                                                                             |
| Initial page view   | Emitted by the Google tag itself. The bootstrap calls a bare `gtag('config', <id>)` with no options object, so GA4 Enhanced Measurement's automatic page view fires for the **raw browser URL**, query string included |
| SPA page views      | `gtag('config', <id>, { page_path })` on each committed App Router path/query change                                                                                                                                   |
| Reporting authority | `apps/mastra/src/services/google-analytics-client.ts` (read-only Data API; property IDs are allowlisted in Mastra config)                                                                                              |

### Datadog RUM

| Item                | Value                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Collector           | `apps/web/src/components/DatadogRum.tsx`, mounted in the same layout    |
| Service / env / ver | `forge-web` / `NEXT_PUBLIC_DATADOG_ENV` / `NEXT_PUBLIC_DATADOG_VERSION` |
| Sampling            | `sessionSampleRate: 50`, `sessionReplaySampleRate: 10`                  |
| Privacy             | `defaultPrivacyLevel: "mask-user-input"`                                |
| Tracking            | user interactions, resources, long tasks; React plugin                  |

### Provider-receipt evidence on record

Do not treat a mounted component or a queued `dataLayer` entry as delivery.
The standing receipt evidence for this baseline is:

- [PR #2229](https://github.com/JesusFilm/forge/pull/2229) restored the GA and
  Datadog Watch baseline.
- **2026-09-10 production proof:** HTTP `204` for GA `page_view` and
  `share_opened`, HTTP `202` for Datadog intake, and indexed RUM events for
  release `09c74a94840e08dd951082ff3a0c2d94b139d717`.
- **2026-08-28 GA4 snapshot (28 days):** 151,955 `/watch/` views, 112,844 active
  users, 1.35 views/user, 17 s average engagement, 462,278 events, 2,803 key
  events. `/watch/jesus.html` 3,011 views / 19 key events;
  `/watch/jesus.html/english.html` 2,038 views / 87 key events. This split is
  the route-attribution defect the plan exists to resolve — it is a baseline
  observation, not a behavioral finding.

Re-run the same receipt checks (initial page view, navigation page view, one
real Watch interaction, fresh RUM events for the deployed release) after any
collector change and after v2 enablement.

---

## 2. Frozen v1 wire contract

These names and counts are external contracts. GA4 key-event settings and
historical reports reference them, so v2 must reproduce them exactly during the
compatibility window (R25). **Dual-writing an old and a renamed form of the same
event is prohibited** — it inflates event counts.

### Event wire names

The GA helper strips a leading `watch_` from event names and a leading `watch_`
then `search_` from parameter names, so the app-local name is **not** the wire
name:

| App-local name                   | GA4 wire name            | Emitted from                             |
| -------------------------------- | ------------------------ | ---------------------------------------- |
| `watch_download_intent`          | `download_intent`        | `WatchPageClient.tsx`                    |
| `watch_language_picker_opened`   | `language_picker_opened` | `WatchPageClient.tsx`                    |
| `watch_share_opened`             | `share_opened`           | `WatchPageClient.tsx`                    |
| `watch_search.result_clicked`    | `search_result_clicked`  | `SearchOverlay.tsx` via `DatadogRum.tsx` |
| `videostarts`                    | `videostarts`            | `WatchEventRecorder.tsx`                 |
| `videoplay`                      | `videoplay`              | `WatchEventRecorder.tsx`                 |
| `video_pause`                    | `video_pause`            | `WatchEventRecorder.tsx`                 |
| `video_progress`                 | `video_progress`         | `WatchEventRecorder.tsx`                 |
| `videocomplete`                  | `videocomplete`          | `WatchEventRecorder.tsx`                 |
| `a_media_progress10/25/50/75/90` | unchanged                | `WatchEventRecorder.tsx`                 |

### Firing and deduplication (v1, as shipped)

- `videostarts`, `video_progress`, `videocomplete`: once per `(videoId, videoDubId)` identity.
- `a_media_progress{10,25,50,75,90}`: once per milestone per identity, surviving seek and replay.
- `videoplay`, `video_pause`: once per real media transition (not deduplicated).
- Modal intents (`download_intent`, `language_picker_opened`, `share_opened`): once per open.
- `search_result_clicked`: deduplicated in `SearchOverlay.tsx` by
  `searchRequestId:resultId:position`.

### Characterization tests that pin the above

| File                                                                        | Pins                                                                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/__tests__/GoogleAnalytics.test.tsx`                | bootstrap shape, absence of `send_page_view`, SPA `config` call count and dedupe, prefix stripping, primitive filtering, the four legacy wire names |
| `apps/web/src/components/__tests__/DatadogRum.test.tsx`                     | RUM init contract, the GA allowlist projection, unregistered-action GA silence                                                                      |
| `apps/web/src/components/watch/__tests__/WatchEventRecorder.test.tsx`       | player start/progress/milestone/completion counts under repeated events                                                                             |
| `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx` | modal intent wire names, parameters, and counts                                                                                                     |

---

## 3. Operator checklist — export before enabling v2 (R23)

The GA4 property is administered outside this repository, so this evidence must
be exported and attached to the ticket. **None of it can be simulated in tests.**
Do all of this _before_ the v2 collector flag is turned on for any cohort.

- [ ] **Event list.** Admin → Data display → Events. Export the full event list
      with 28-day counts. Confirm every wire name in section 2 appears.
- [ ] **Key-event markings.** Admin → Data display → Key events. Record which
      events are currently marked, when each was marked, and the counting
      method. Note that marking history is not retroactive.
- [ ] **Custom definitions.** Admin → Data display → Custom definitions. Export
      every custom dimension and metric, its scope, and its registered event
      parameter. Flag any that are registered against a parameter the v2
      contract changes, bounds, or drops. Record the current count against the
      property limit before adding any v2 dimension.
- [ ] **Enhanced Measurement page views.** Admin → Data streams → the Web stream
      → Enhanced measurement → Page views → _Advanced settings_. Record whether
      **"Page changes based on browser history events"** is on. This is the
      setting that will double-count SPA page views once v2 emits explicit
      `page_view` events (R8). Decide and record the intended post-v2 state.
- [ ] **Enhanced Measurement — other.** Record the state of site search, outbound
      clicks, file downloads, video engagement, and scrolls, because several of
      them can shadow v2 events (`search_completed`, `watch_cta_clicked`,
      `download_started`).
- [ ] **Dependent reports.** Enumerate every Explore, Looker Studio report,
      Data API consumer, audience, and alert that references a legacy wire name
      or a `/watch/` page path. Include the Mastra GA4 client's configured
      property IDs. Name an owner for each.
- [ ] **BigQuery export.** Record whether the property is linked, the dataset,
      and the earliest available export date. This determines whether the
      section 4 audit can be answered precisely or only estimated.
- [ ] **Data retention and data filters.** Record event-data retention, internal
      traffic filters, and any developer/bot filter state, because these bound
      the reconciliation in the plan's success criteria.
- [ ] **Property timezone and currency.** Record both; the 28-day comparison
      window depends on the property timezone, not the deployer's.

---

## 4. Privacy remediation — search-click parameters sent to GA4

### The defect (fixed in this unit)

`reportDatadogRumAction` forwarded its **entire** Datadog RUM context into
`reportGoogleAnalyticsEvent`. The only caller is the Watch search result click
in `apps/web/src/components/SearchOverlay.tsx`, whose context is built by
`buildWatchSearchResultClickRumContext` in `apps/web/src/lib/watch-search-rum.ts`.

After the GA normalizer stripped app prefixes, GA4 received these parameters on
every `search_result_clicked` event:

| GA4 parameter                  | Content                                    |
| ------------------------------ | ------------------------------------------ |
| `result_title`                 | Up to 160 characters of content title text |
| `result_id`                    | Admin document ID of the clicked result    |
| `result_slug`                  | Content slug of the clicked result         |
| `search_request_id`            | Per-search request identifier              |
| `route_language_slug`          | Exact route audio-language slug            |
| `search_language_slug`         | Exact search language slug                 |
| `search_language_english_name` | Typed/derived English language name        |

R13 bans titles, result IDs, request IDs, and typed language names from GA4.
R18 requires the GA projection to use its own allowlist.

### The fix

`reportDatadogRumAction` now holds an explicit **per-action GA projection**
(`GOOGLE_ANALYTICS_ACTION_PARAM_ALLOWLIST` in
`apps/web/src/components/DatadogRum.tsx`). Datadog still receives the unchanged
action name and the full approved context. GA receives only:

- `watch_search.result_position` → `result_position`
- `watch_search.result_source` → `result_source`
- `watch_search.result_type` → `result_type`

An action with **no** registered projection sends nothing to GA while still
reaching Datadog unchanged. The `search_result_clicked` wire name and event
count are unchanged, including when no allowlisted parameter is present. This
fix is unconditional — it is not behind the v2 migration flag.

**Adding a key to that allowlist is the deliberate act of putting that value in
front of Google.** Review any addition against R13, R19, R20, and R21.

### Operator action — audit already-collected data

Not yet performed. Assign to the analytics owner.

- [ ] Query the GA4 property (and the BigQuery export if linked) for
      `search_result_clicked` events carrying `result_title`, `result_id`,
      `result_slug`, or `search_request_id`.
- [ ] Record the **earliest and latest** dates on which each parameter was
      collected, and the **event volume** per parameter, in the table below.
- [ ] Record whether the parameters were ever registered as custom dimensions
      (from the section 3 export) — registration affects standard-report
      exposure and cardinality, not just raw payload retention.
- [ ] Decide and record whether to file a **GA4 data-deletion request**
      (Admin → Data deletion requests). Note the deletion-request limits:
      requests apply to a bounded time range, take effect on a scheduled cycle,
      and do not alter already-exported BigQuery rows — a separate BigQuery
      deletion is required if the export is linked.
- [ ] Attach the decision, its rationale, and the approver to the ticket.

| Parameter           | First seen | Last seen | Event volume | Registered as custom dimension? | Deletion decision |
| ------------------- | ---------- | --------- | ------------ | ------------------------------- | ----------------- |
| `result_title`      |            |           |              |                                 |                   |
| `result_id`         |            |           |              |                                 |                   |
| `result_slug`       |            |           |              |                                 |                   |
| `search_request_id` |            |           |              |                                 |                   |

"Last seen" should stop advancing one deploy after this fix reaches production.
Confirming that it has is the verification that the fix landed.

---

## 5. After v2 enablement

- Re-run the section 1 provider-receipt checks.
- Confirm GA4 DebugView shows exactly one `page_view` per committed route on a
  deterministic initial load and on an SPA navigation.
- Confirm no `result_title`, `result_id`, `result_slug`, `search_request_id`,
  raw search term, viewer/session ID, filename, or unallowlisted RUM parameter
  appears in DebugView, Realtime, or the validation export.
- Reconcile canonical page totals against the bounded raw route variants before
  drawing any conclusion about the JESUS key-event ratio.
- Rolling the v2 flag back must restore the v1 collector without changing a
  route or the GA measurement ID, and must leave Datadog RUM active.
