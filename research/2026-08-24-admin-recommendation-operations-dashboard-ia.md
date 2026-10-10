# Admin Recommendation Operations Dashboard — Information Architecture Research

**Date:** 2026-08-24
**Scope:** Make the feat-368 Admin Recommendations area understandable to an operator without changing the canonical U1 semantics, evidence boundaries, permissions, or 1.5-second retrieval contract.
**Ticket:** `docs/roadmap/content-discovery/feat-368-production-semantic-recommendation-tracer.md`
**Method:** Inspection of the canonical recommendation plan, focused feat-368 plan, current overview/detail implementation, and first-party observability and design-system guidance. External claims below cite primary sources.

---

## Recommendation

Reframe the area around three operator questions:

1. **Is recommendation delivery healthy?**
2. **Where does the viewer journey drop off?**
3. **Why did this request return these videos?**

The current page is hard to read because it gives aggregate health, mixed-unit counters, internal diagnostics, and raw traces nearly equal weight. Grafana's dashboard guidance says a dashboard should answer a question, progress from general to specific, reduce cognitive load, and provide hierarchical drill-downs. Google Cloud likewise recommends charts for historical behavior, tables for finding specific series, and collapsible groups for related secondary content. ([Grafana dashboard best practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/), [Google Cloud dashboards](https://docs.cloud.google.com/monitoring/dashboards), [Google Cloud grouping](https://docs.cloud.google.com/monitoring/dashboards/text-and-grouping))

This structure remains inside U1. It does not add personalization, non-semantic generators, promotion controls, or new viewer facts. It is a clearer presentation of the canonical request, item, evidence, episode, outcome, health, latency, retention, and manifest data already owned by Recommendations.

## What is confusing today

- The section called **Recommendation funnel counts** mixes request-level values (`Issued`, `Issuance failed`, `Fallback requests`) with item-level values (`Served items`, `Rendered`, `Impressions`, `Selections`) and episode-level values (`Playback starts`, `Finalized`). The numbers therefore cannot be read as one conversion sequence.
- A healthy operator has to scan sixteen diagnostic cells before reaching recent requests. Important values such as p95 latency compete with watermarks and purge timestamps.
- Labels such as **Selected-window truth**, **Committed rejections**, **Effective manifest**, and **active roots** reflect storage or implementation language rather than the operator's task.
- The trace list leads with an opaque UUID and compresses seven journey counts into a sentence. It does not make the exceptional request or the next investigation target visually obvious.
- The detail page contains the right U1 evidence, but its tables require the reader to reconstruct the journey instead of first summarizing what happened and where it stopped.

## Proposed page hierarchy

```text
Recommendations                                      [24h | 7d | 29d]

HEALTH
Healthy — recommendations are serving normally
16 requests  ·  0 unavailable  ·  p95 929 ms / 1.5 s  ·  Data current
[Review 0 data-quality issues]

REQUEST OUTCOMES
Delivered | Empty | Used cached fallback | Unavailable

VIEWER JOURNEY
Cards served → Cards loaded → Cards seen → Cards chosen → Videos started
count          step conversion and drop-off shown between stages

OUTCOME PROCESSING
Episodes completed | Outcomes recorded | Outcome processing delayed

RETRIEVAL LATENCY
p50 and p95 over time, with a fixed 1.5 s contract line

RECENT REQUESTS
[Search/request ID] [Outcome] [Viewer progress] [Issue] [Latency] [Created]

▸ Instrumentation and retention details
  watermarks, replay/conflict/rejection facts, classifier lag, purge, manifest versions
```

### 1. Lead with a plain-language health answer and next action

Use one summary such as **“Healthy — recommendations are serving normally”** followed by three scoped indicators: request volume/unavailable count, p95 against the 1.5-second contract, and evidence freshness. If unhealthy, name the impact and provide a direct action such as **“Review 3 requests with missing evidence.”** USWDS recommends using a summary to select, split, and sequence the few details readers should not miss and to surface an actionable next step; Grafana recommends showing only the data needed to answer the dashboard's question. ([USWDS summary box](https://designsystem.digital.gov/components/summary-box/), [Grafana dashboard best practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/))

Keep U1's distinction between genuine zero activity and unknown/unavailable data. Do not turn unavailable counts into zero or label healthy instrumentation as healthy recommendations when the data plane is unknown.

### 2. Separate request outcomes from the viewer funnel

Show request-level outcomes in their own compact group:

- **Delivered** (`served`)
- **No recommendations** (`empty`)
- **Used cached recommendations** (`fallback`)
- **Unavailable** (`unavailable`)
- Delivery/issuance failure as an alert, not as a normal funnel step

Then show one item journey with a consistent progression:

**Cards served → Cards loaded → Cards seen → Cards chosen → Videos started**

Count **distinct served-item identities** that reached each stage, so every denominator represents the same entity even if evidence is replayed or an episode contains multiple facts. Show the absolute count, conversion from the preceding stage, and drop-off. Put episode completion, outcome revisions, and outcome-processing delay in a small adjacent group rather than silently changing the funnel's unit. Datadog's first-party journey view uses a funnel to show volume, conversion, and completion time at each critical step; Google Analytics' funnel model similarly treats steps as a defined sequence and exposes abandonment between them. ([Datadog Journey Monitoring](https://docs.datadoghq.com/journey_monitoring/), [Google Analytics funnel exploration](https://support.google.com/analytics/answer/9327974))

For the screenshot's sample, if recalculated on distinct item identities, this would read as `96 served → 72 loaded (75%) → 21 seen (29% of loaded) → 3 chosen (14% of seen) → 1 started (33% of chosen)`, with `1 episode completed · 1 outcome recorded · 0 delayed` beside it. Those ratios explain the data while preserving the U1 distinction between served, rendered, eligible impression, selection, successful start, episode finalization, and outcome derivation.

### 3. Make the immutable latency contract visible, not buried

Show p50 and p95 together, preferably over time, with a fixed **1.5 s retrieval contract** reference line and explicit status such as **“p95 within contract.”** Do not replace p95 with an average and do not increase the threshold. Google SRE explains that averages hide tail behavior while p50 describes the typical case and high percentiles reveal plausible worst-case experience; Google Cloud recommends charts for spotting historical anomalies. ([Google SRE on SLO indicators](https://sre.google/sre-book/service-level-objectives/), [Google Cloud dashboards](https://docs.cloud.google.com/monitoring/dashboards))

An immediate UI-only pass can render the existing p50/p95 as a budget bar. A later query-only enhancement can add time buckets or previous-window comparison from the same recommendation-owned request records; it does not require new telemetry semantics.

### 4. Move technical diagnostics behind progressive disclosure

Collapse **Instrumentation and retention details** by default when healthy and automatically expand or promote the relevant diagnostic when degraded. Keep delivery/evidence/database watermarks, oldest pending time, purge timestamp, retention reason, replay/conflict/rejection counts, classifier lag, and exact manifest/contract versions there. Google Cloud explicitly supports collapsible dashboard groups to improve usability when a dashboard contains many widgets; Carbon's data-table guidance recommends revealing supplementary information only when needed and moving cramped detail into a side panel or dedicated page. ([Google Cloud custom dashboards](https://docs.cloud.google.com/monitoring/charts/dashboards), [Carbon data table](https://carbondesignsystem.com/components/data-table/usage/))

These facts must remain available because U1 requires loss, lag, replay, conflict, retention, purge, classifier, and pinned-manifest reconciliation. They simply should not dominate a healthy overview.

### 5. Turn the trace table into an investigation queue

Use compact, consistently structured columns:

| Column          | Operator-facing content                                                  |
| --------------- | ------------------------------------------------------------------------ |
| Created         | Relative time with exact UTC available                                   |
| Outcome         | Delivered, No recommendations, Cached fallback, or Unavailable           |
| Viewer progress | A compact six-stage progress indicator, ending at the last observed fact |
| Issue           | Missing impression, classifier pending, conflict, late evidence, or None |
| Latency         | Retrieval milliseconds, visually marked only when near/over 1.5 s        |
| Context         | Locale plus seed/source content when safely resolvable                   |
| Trace           | Short request suffix and an explicit **View trace** link                 |

Keep filters close to the table, add direct request-ID search, retain cursor pagination, and default to newest first. USWDS advises short plain-language headers, consistent column formatting, minimal columns, and sorting where useful; Carbon locates search and filters in the data-table toolbar. Datadog separates searchable trace lists from individual trace details instead of showing all metadata in the list. ([USWDS table](https://designsystem.digital.gov/components/table/), [Carbon data table](https://carbondesignsystem.com/components/data-table/usage/), [Datadog Trace Explorer](https://docs.datadoghq.com/tracing/trace_explorer/))

Preserve the existing permission split: aggregate readers do not receive request identifiers, cursors, or trace links, while privacy-safe trace inspection remains Admin-only and audited.

### 6. Make request detail a narrative before showing raw facts

Lead with one sentence: **“Six recommendations were delivered; three were seen; one was chosen; playback started and an outcome was recorded.”** Under it, show a horizontal/vertical lifecycle with the first missing or unhealthy step highlighted. The narrative must state **“episode completed; outcome pending”** when those states differ. Then retain the current deeper sections:

1. ordered served candidates and semantic provenance;
2. browser lifecycle evidence;
3. playback episode and immutable outcome revisions;
4. data-quality/audit facts;
5. exact contracts, manifest IDs, timestamps, bytes, and raw identifiers.

Datadog's trace detail starts with critical identity, duration, and start-time context, then offers deeper lifecycle visualizations and selected-span metadata. That summary-to-detail order maps cleanly onto U1 without pretending the recommendation chain is a distributed service trace. ([Datadog Trace View](https://docs.datadoghq.com/tracing/trace_explorer/trace_view/))

### 7. Rename for comprehension while preserving canonical terms underneath

Suggested display copy:

| Current               | Display label               | Canonical meaning retained                                           |
| --------------------- | --------------------------- | -------------------------------------------------------------------- |
| Selected-window truth | Recommendation health       | Scoped health classification                                         |
| Served items          | Cards served                | Committed ordered served items                                       |
| Rendered              | Cards loaded                | Browser render facts                                                 |
| Impressions           | Cards seen                  | Eligible impressions under the pinned visibility policy              |
| Selections            | Cards chosen                | Recommendation selections                                            |
| Finalized             | Episodes completed          | Finalized/timed-out episode state; outcome presence remains separate |
| Fallback requests     | Used cached recommendations | Reason-coded compatible semantic cache fallback                      |
| Effective manifest    | Serving configuration       | Immutable pinned strategy/surface/contract versions                  |
| Classifier lag        | Outcome processing delayed  | Episode past deadline without an outcome                             |

Plain labels should be sentence case and short; the exact canonical token can remain in help text and trace diagnostics. USWDS says table labels should use plain language and short labels, and accessibility requires the meaning of presented information and interface behavior to be understandable. ([USWDS table](https://designsystem.digital.gov/components/table/), [USWDS accessibility](https://designsystem.digital.gov/documentation/accessibility/))

## What should stay out of the main screen

- Raw request UUIDs as the dominant label; keep them searchable and copyable in trace tools.
- Exact manifest, contract, surface, classifier, signing, or generator identifiers when everything is healthy.
- Delivery/evidence/database watermark timestamps and purge timestamps unless stale or explicitly expanded.
- Response byte size, server sequence numbers, event IDs, received/occurred timestamp pairs, safe metric payloads, raw similarity values, and audit digests.
- Future acquisition, search, profile, co-watch, candidate-overlap, experiment, promotion, integrity, or learned-ranking panels. The canonical plan adds those only as later vertical slices land; showing empty placeholders now would falsely imply U1 measures them.
- One opaque “engagement score.” U1 intentionally preserves distinct served, visible, selected, playback, and provisional `legacy-position-v0` outcomes.

## Practical rollout

**Pass 1 — clarity using existing overview and trace data:** rewrite labels; split delivery from viewer journey; compute clearly labelled stage ratios; emphasize p95/1.5 s; collapse healthy diagnostics; simplify trace columns; add a narrative request summary.

**Pass 2 — query-only improvements:** make every funnel stage a distinct served-item count, add request-result counts (`served`, `empty`, `fallback`, `unavailable`), separate completed episodes from recorded outcomes, add latency buckets/previous-window comparison, request-ID search, and safe source-content display. These should read existing recommendation-owned records and must preserve the aggregate/trace permission boundary.

**Validation:** test the hierarchy with at least one non-specialist operator using three prompts: identify whether delivery is healthy, identify the largest viewer drop-off, and open the request that needs investigation. USWDS recommends starting with real user needs and testing assumptions with real users throughout implementation. ([USWDS design principles](https://designsystem.digital.gov/design-principles/))

## Internal grounding

- Canonical product contract: `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — R41-R44 and KTD12 require decision-first, permission-separated Admin evidence that distinguishes zero activity from missingness, loss, lag, replay, conflict, and retention state.
- Focused implementation contract: `docs/plans/2026-08-19-0251-feat-production-semantic-recommendation-tracer-plan.md` — U1 is semantic-only and the retrieval budget remains 1.5 seconds.
- Current overview: `apps/admin/src/app/dashboard/recommendations/page.tsx`.
- Current detail: `apps/admin/src/app/dashboard/recommendations/request-detail-panel.tsx`.
- Current aggregates and trace shape: `apps/admin/src/services/recommendations/admin-ops/overview.service.ts` and `trace.service.ts`.
