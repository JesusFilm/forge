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
| `apps/web/src/components/watch/__tests__/WatchEventRecorder.test.tsx`       | player start/progress/milestone/completion counts under repeated events, and the v1 terminal pause before completion                                |
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

## 5. The v2 contract as implemented

Source of truth: `apps/web/src/lib/watch-analytics-contract.ts`. Everything
below is behind `NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2` (default off). With
the flag off, section 2 is exactly what ships.

### Common parameters on every v2 event

`event_contract_version=2`, `watch_route_type`, `watch_route_variant`,
`watch_language_class`, `watch_entry_intent`, and the standard `page_path`
(canonical, query-free), `page_location` (canonical origin + canonical path +
allowlisted campaign values), and `page_referrer` (origin + canonical path, or
`(suppressed)`). Payload-only detail (R21, never register by default):
`watch_raw_path`, `watch_content_slug`, `watch_series_slug`,
`watch_language_slug`.

`page_referrer` on the first page view is the sanitized browser referrer.
Every later page view in the same document uses the previous canonical Watch
location, because `document.referrer` does not change on an App Router
navigation.

### Events

| Wire event                       | Fires when                                                           | Mode                               | Event parameters                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `page_view`                      | Each committed route key (`GoogleAnalytics.tsx`)                     | Same turn (bypasses the seam)      | common only                                                                                                        |
| `videostarts`                    | First play per (video, dub) identity                                 | Deferred                           | `watch_duration_seconds`, `watch_position_seconds=0`, `watch_content_id`, `watch_dub_id`                           |
| `videoplay`                      | Every real play transition                                           | Deferred                           | `watch_duration_seconds`, `watch_position_seconds`                                                                 |
| `video_pause`                    | Every real pause, **except** the browser's terminal pause at `ended` | Deferred                           | `watch_duration_seconds`, `watch_position_seconds`, `watch_progress_percent`                                       |
| `a_media_progress10/25/50/75/90` | First crossing per milestone per identity; a seek fires each crossed | Deferred                           | `watch_progress_percent`, `watch_duration_seconds`, `watch_position_seconds`                                       |
| `video_progress`                 | First of 30 s or 25% per identity                                    | Deferred                           | `watch_duration_seconds`, `watch_position_seconds`, `watch_progress_percent`                                       |
| `videocomplete`                  | First `ended` per identity                                           | Deferred                           | `watch_progress_percent=100`, `watch_duration_seconds`                                                             |
| `search_completed`               | A current (not superseded) search or load-more settles               | Deferred                           | `watch_search_outcome` (`results`/`no_results`/`failed`), `watch_result_count_bucket`, `watch_search_request_type` |
| `search_result_clicked`          | First click per result window (via the RUM projection)               | Deferred                           | `watch_result_position_bucket`, `watch_result_type`, `watch_result_source`                                         |
| `language_picker_opened`         | Language modal opens                                                 | Deferred                           | `watch_picker_language_class`                                                                                      |
| `language_applied`               | Apply commits a different audio language, before navigation          | Deferred                           | `watch_from_language_class`, `watch_to_language_class`, `watch_destination_route_variant`                          |
| `subtitle_applied`               | Apply turns subtitles on/off, or switches language while on          | Deferred                           | `watch_subtitle_enabled`, `watch_subtitle_language_class`                                                          |
| `download_intent`                | Download entry control activates                                     | Deferred                           | `watch_download_language_class`, `watch_content_id`                                                                |
| `download_started`               | Same-origin handoff accepted and the browser download invoked        | Immediate                          | `watch_quality_tier` (`low`/`high`/`highest`), `watch_access_outcome` (`open`/`granted`)                           |
| `share_opened`                   | Share modal opens                                                    | Deferred                           | common only                                                                                                        |
| `share_completed`                | Copy succeeds, or a Facebook/X target activates                      | Copy deferred; social immediate    | `watch_share_method` (`copy_link`/`copy_embed`/`facebook`/`x`)                                                     |
| `watch_cta_clicked`              | An allowlisted mission CTA activates                                 | Immediate when the CTA is outbound | `watch_cta_id`, `watch_destination_class`                                                                          |

Allowlisted CTAs (`WATCH_ANALYTICS_CTA_DESTINATIONS`): `study_ask_yours`,
`study_chat_with_person`, `study_ask_bible_question`, all outbound. An id
outside that map emits nothing. Adding one is a reviewed contract change.

Opening and closing a modal emits only its open/intent event. A denied or
failed download session, a failed clipboard copy, and an unchanged language
or subtitle selection emit no outcome.

### v1 → v2 parameter names change

Event **names** are unchanged (R25). Parameter **names are not**: v1 sent
`video_id`, `video_dub_id`, `video_slug`, `language_slug`, `duration_seconds`,
`position_seconds`, `progress_percent`, and `result_position`/`result_source`/
`result_type`. v2 sends the `watch_*` names above, and drops `video_slug` and
`language_slug` from the modal intents. Any custom definition registered on a
v1 parameter name reads `(not set)` for v2 traffic. The section 3 custom-
definitions export must list every such registration, and the owner must
decide before enablement whether to register the matching v2 name.

### Dispatch timing (R28)

Deferred events wait for one animation frame. Pending events flush on
`visibilitychange` to hidden and on `pagehide`, so a backgrounded tab does not
lose them. Immediate events go out in the same handler, because the document
or tab may be gone before a frame runs.

---

## 6. Enablement runbook

Owner: the analytics owner on FGE-115. Every step below happens outside this
repository; none of it has been performed.

### Before enabling

1. Complete section 3 (property export) and section 4 (privacy audit) and
   attach both to FGE-115.
2. Count registered event-scoped custom dimensions against the standard
   property limit (50 event-scoped, 25 user-scoped, 30 key events) and record
   the remaining budget.
3. Register only R20 low-cardinality parameters before enablement — at least
   `watch_route_variant` and `event_contract_version`, which the `contract`
   reconciliation grain needs. Registration is not retroactive. Do **not**
   register `watch_raw_path`, `watch_content_slug`, `watch_series_slug`,
   `watch_language_slug`, `watch_content_id`, or `watch_dub_id`; read those
   from the BigQuery export.
4. Prove on a non-production build that the v2 observer emits one initial
   and one SPA `page_view` for representative **non-Watch** routes with their
   current page-path semantics. Enhanced Measurement's history setting is
   property-wide.
5. With v2 off, capture the network and DebugView baseline for direct
   `/watch/jesus.html` and `/watch/jesus.html/english.html` loads plus one
   client navigation.

### Enabling

1. Set `NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2=true` on the Web Railway
   service and ship it through the normal merge-to-`main` deploy. It is a
   build-time value, so it needs a rebuild.
2. In the same window, disable only Enhanced Measurement → Page views →
   _Page changes based on browser history events_. Leave outbound clicks and
   file downloads on.
3. Annotate the release in GA4 with the date and commit.

### Validation journeys (DebugView + network)

Run each and match every request to the section 5 table: canonical English,
explicit-English compatibility, Urdu, a contextual episode; play, pause, seek
across milestones, complete; search with results, no results, and a forced
failure, then a result click; language apply and subtitle apply; download
denied and success; share copy failure and success, Facebook, X; each study
CTA. Read base-ui modal state from `data-open` / `data-closed`, not element
presence.

Search every captured payload for: an email sentinel, a credential sentinel,
query text, a result title or id, a search request id, a viewer/session id,
an auth-state id, GraphQL data, a recommendation delivery or episode
capability, the tab correlation/claim nonce, a filename, a raw media URL, an
arbitrary query value, and a full referrer. Any match blocks enablement.

Confirm in DebugView that `page_view` and `video_progress` (both on Google's
reserved list) are collected rather than dropped.

### Reconciliation readout

`queryWatchMeasurementReconciliation` in
`apps/mastra/src/services/google-analytics-client.ts` is the read-only Data API
query for this readout. It accepts only an allowlisted property, the section 5
event names, and up to 20 exact `/watch/` page paths, and returns per
(page path, event) totals with a route-variant breakdown. Use `grain:
"standard"` for the v1 baseline and `grain: "contract"` once the two custom
dimensions are registered. It is a service function only: no agent tool or
workflow calls it yet. A result with `complete: false` carries caveats
(thresholding, other-row loss, row cap, request budget, unattributed rows)
and must not support a definitive behavioral conclusion.

### Checkpoints and stop conditions

- **Seven days after enablement:** duplicate page views ≤ 1%, unknown route
  context ≤ 5%, canonical totals reconcile with raw variants within 1%, no
  privacy sentinel in GA. Missing any one is a stop.
- **28 days after enablement:** segment canonical JESUS by route variant,
  channel, device, and event name, then classify the JESUS ratio as
  instrumentation, acquisition mix, behavior, or inconclusive (plan, Measurement
  Decision Matrix).

### Key-event candidates (R27) — do not mark yet

Candidates: `video_progress`, `videocomplete`, `download_started`,
`share_completed`, `language_applied`, and `watch_cta_clicked` per CTA id.
Opens and intents (`language_picker_opened`, `share_opened`,
`download_intent`) and `search_result_clicked` are not promoted by default.
Marking happens only after the section 3 export and verified v2 outcomes.

### Rollback

- **Normal:** set `NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2=false` and ship
  through the normal deploy. This restores section 2 exactly, keeps the GA
  measurement ID and every route unchanged, and leaves Datadog RUM active.
  Re-enable Enhanced Measurement's history page changes at the same time, or
  v1 SPA page views stop counting.
- **Privacy emergency:** the instant operator stop is pausing or unlinking the
  GA4 web data stream in the property admin; a flag flip still costs a
  rebuild.

---

## 7. After v2 enablement

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
