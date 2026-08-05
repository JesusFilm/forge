---
title: "Datadog custom log attributes named after reserved fields are silently shadowed (source, host, service, status, message, trace_id)"
date: "2026-08-05"
category: "conventions"
module: "Datadog logs / cross-app observability (apps/mobile today; apps/tv + apps/web share the same wrapper shape and org)"
problem_type: "convention"
component: "tooling"
severity: "medium"
applies_when:
  - "Naming a key inside a datadogLog.info/warn/error attributes object in apps/mobile, apps/tv, or apps/web"
  - "Choosing an attribute name to distinguish event variants (a paint source, an outcome) that could collide with a Datadog-reserved log field"
  - "Verifying after shipping that a new custom attribute actually surfaces in Datadog rather than trusting the emit code alone"
  - "Debugging a DDSQL group-by or facet on a custom attribute that returns only blank values while sibling custom fields are present"
  - "Adding a datadogLog call site that reuses a field name used elsewhere for a different purpose"
symptoms:
  - "Grouping Datadog logs by a custom attribute returns only blank/empty values across every row"
  - "The event's attribute dump shows other custom fields present but the reserved-named one entirely absent"
  - "The colliding value appears instead as a top-level reserved Datadog tag rather than under the custom namespace"
  - "The event still looks healthy in the log stream and ships with no error, warning, or ingestion failure"
  - "The gap is invisible to code review and found only by explicitly querying the attribute"
root_cause: "wrong_api"
tags:
  - "datadog"
  - "logs"
  - "observability"
  - "reserved-fields"
  - "attribute-shadowing"
  - "cross-app"
  - "mobile"
  - "telemetry-accuracy"
related_components:
  - "apps/mobile/src/hooks/useWatchHome.ts"
  - "apps/mobile/src/lib/datadog.ts"
  - "apps/mobile/src/hooks/useManagedVideoPlayer.ts"
  - "apps/mobile/src/lib/offlineFileSystem.ts"
  - "apps/tv/src/lib/datadog.ts"
  - "apps/web/src/observability/datadog-logs.ts"
---

# Datadog custom log attributes named after reserved fields are silently shadowed

## Context

`apps/mobile` emits a `home_feed_ready` log at three points in the Home feed load, so an
operator can tell an instant snapshot repaint from a real admin round-trip:

- `apps/mobile/src/hooks/useWatchHome.ts:374` — `datadogLog.info("home_feed_ready", { source: "snapshot" })`
- `apps/mobile/src/hooks/useWatchHome.ts:299` — `{ source: "network", outcome: "success" }`
- `apps/mobile/src/hooks/useWatchHome.ts:171` — `{ source: "network", outcome: "failed" }`

The in-code rationale (labelled R21) is explicit that the split exists so snapshot TTFB and
network TTFB never get averaged together.

In Datadog, `@source` is empty on every one of those rows.

A DDSQL query over a controlled regression session
(`service:forge-mobile version:final-regression-20260805`, 10 `home_feed_ready` rows) grouped by
`@source` and `@outcome` and returned exactly two buckets: `("", "")` x6 and `("", "success")` x4.
`@source` was blank in all ten. A full attribute dump of one row showed `custom.outcome: success`
present and **no `custom.source` key at all** — the attribute never arrived. The row's tag list,
meanwhile, contains `source:react-native`: Datadog's own reserved `source`, which the SDK sets.

Nothing warned. No error, no dropped log, no SDK complaint. The events are all present and look
healthy in the log stream; only the one facet is missing. It shipped this way and stayed this way
because nobody queried that specific attribute until a deliberate telemetry audit.

## Guidance

**Never name a custom Datadog log attribute after a Datadog reserved field.**

The reserved log attributes are:

```
source   host   service   status   message   trace_id
```

Datadog claims these names for its own pipeline (log source, originating host, service, severity,
the log body, APM correlation). A custom attribute using one of those names is not merged, not
prefixed, not renamed — it is **dropped on ingest with no diagnostic**.

The wrapper will not save you. `apps/mobile/src/lib/datadog.ts` is a thin pass-through:

```ts
export const datadogLog = {
  info: (message: string, context: object = {}): void =>
    safeDatadogCall(() => DdLogs.info(message, context)),
  // warn / error identical
}
```

`safeDatadogCall` swallows throws so telemetry can never break the app. There is no key
validation and no reserved-name check anywhere between the call site and the SDK.
`apps/tv/src/lib/datadog.ts` exports a byte-identical `datadogLog` wrapper; only the surrounding
init config differs (mobile env-tunes its sample rates, TV hardcodes 100).

**Rule: prefix every custom attribute with its feature namespace.**

The repo already has the correct pattern, and it happens to be collision-proof by construction —
the watch-search telemetry shared across all three apps:

```ts
// apps/tv/src/lib/search.ts
datadogLog.info("watch_search analytics", {
  "watch_search.outcome": outcome,
  "watch_search.result_count": resultCount,
  "watch_search.latency_ms": Date.now() - startedAt,
})
```

`apps/mobile/src/lib/watchSearchLog.ts` and `apps/web/src/lib/watch-search-analytics.ts` use the
same `watch_search.*` namespace (the key sets differ per app; the prefix does not). A namespaced key can never collide with a reserved field, and
as a bonus it groups cleanly in the facet list. This is the same convention
[the tvOS observability guardrails](../best-practices/datadog-tvos-observability-pipeline-qoe-and-guardrails.md)
already prescribe — that doc justifies it by facet-joinability, and reserved-field shadowing is a
second, independent reason to follow it.

For a non-namespaced attribute, pick a name the platform does not own: `feed_source`, not
`source`; `http_status`, not `status`.

**Add a guard so the rule is enforced, not remembered.** The repo has a source-scanning
`.guard.test.js` convention — `apps/mobile/src/lib/__tests__/watchSearchTelemetry.guard.test.js`
walks the app's `apps/mobile/src/` and `apps/mobile/app/` trees, asserts `files.length > 50` so a broken root resolution cannot pass
vacuously, and pairs the tree scan with positive and negative control fixtures so deleting any one
pattern fails a test. A reserved-key guard belongs in exactly that shape:
scan every `datadogLog.*` / `DdLogs.*` call site, fail on any context key in the reserved set.

**Match ES6 shorthand too.** The first audit of this very doc missed two collisions because they
were written `{ surface, content_id, message }` rather than `message: err.message`. A scan keyed on
`\bmessage\s*:` finds neither. Shorthand is the form a human reviewer skims past as well.

## Why This Matters

The failure is **silent and total**, which is the worst combination an observability bug can have:

- **Silent.** No exception, no console warning, no rejected log. Emit-side unit tests pass — they
  assert the wrapper was called with the right object, which it was. The bug lives entirely on the
  other side of the network boundary.
- **Total.** The attribute is not degraded, truncated, or renamed. It simply does not exist.
- **Undetectable by inspection.** The event still appears in the log stream at the right time with
  the right message and the right service. Everything about the row looks correct until you
  specifically group by the one missing facet.

So the discovery mode is: someone builds a dashboard months later, sees an empty facet, and
assumes the events aren't firing. In this case the distinction the three emits were written to
express — snapshot paint vs. real admin TTFB — had never once been answerable in Datadog.

There is an **accidental** partial mitigation today. Because the two network emits carry
`outcome` and the snapshot emit carries nothing, the rows are currently separable by the presence
or absence of `outcome`. That is incidental, not designed. It is undocumented, it depends on an
attribute that exists for an unrelated reason, and it evaporates the moment anyone adds an
`outcome` to the snapshot emit — a change that would look entirely harmless in review.

**This is a cross-app trap, not a mobile bug.** `apps/tv` ships to the same Datadog org through a
byte-identical `datadogLog` wrapper over the same `DdLogs` SDK. Nothing in either app prevents the
next `{ source: ... }` from being written.

Sibling-app status, checked in the current tree rather than assumed:

- **`apps/tv` — no collision today.** Every `datadogLog.*` call site was swept; none passes
  `source`, `host`, `service`, `status`, `message`, or `trace_id`. Its search telemetry is
  `watch_search.*`-namespaced and its QoE summary uses `ttff_ms` / `rebuffer_count` /
  `error_count` / `watched_ms`. Clean by good habit, not by any enforced guard.
- **`apps/web` — no collision today, and a different mechanism.** Web does not use `DdLogs`; it
  forwards over syslog UDP via `apps/web/src/observability/datadog-logs.ts`. Its
  `buildDatadogSyslogMessage` spreads `normalizeAttributes(input.attributes)` **first**, then
  hard-sets `message`, `service`, `status`, `env`, `ddsource`, and `ddtags` after it. A custom
  `status` or `message` is therefore clobbered locally, before the packet is even sent — same
  silent-loss class, caught by a different layer. A custom `source` would survive that builder and
  reach the intake. Web's live attribute keys are all `watch_search.*`, so nothing collides now.

**`apps/mobile` — eight live collisions**, all present at the time of writing:

| Site                                                    | Log                           | Reserved key                           |
| ------------------------------------------------------- | ----------------------------- | -------------------------------------- |
| `apps/mobile/src/hooks/useWatchHome.ts:171`             | `home_feed_ready`             | `source`                               |
| `apps/mobile/src/hooks/useWatchHome.ts:299`             | `home_feed_ready`             | `source`                               |
| `apps/mobile/src/hooks/useWatchHome.ts:374`             | `home_feed_ready`             | `source`                               |
| `apps/mobile/src/hooks/useManagedVideoPlayer.ts:76`     | `video.qoe`                   | `source` (offline vs network playback) |
| `apps/mobile/src/hooks/useManagedVideoPlayer.ts:267`    | `video.playhead_stall`        | `source` (same)                        |
| `apps/mobile/src/lib/offlineFileSystem.ts:101`          | `sidecar.download_bad_status` | `status` (the HTTP status)             |
| `apps/mobile/src/components/home/HomeHeroPager.tsx:203` | `video.playback_error`        | `message` (shorthand)                  |
| `apps/mobile/src/components/home/HomeHeroPager.tsx:215` | `video.playback_error`        | `message` (shorthand)                  |

The two `useManagedVideoPlayer` sites are the same defect with a different blast radius: the
attribute distinguishes offline (`file://`) from network (`https`) playback, so QoE and stall rates
cannot currently be split by playback source. The `offlineFileSystem` site loses the HTTP status
code that is the entire diagnostic value of that warning.

The two `HomeHeroPager` sites are the worst of the eight, and they were missed by this doc's own
first audit — twice over. They are ES6 shorthand (`{ …, message }`), which a naive
`message\s*:` scan does not match. And `message` is not merely reserved in the abstract: the
wrapper's own first positional argument already populates it (`DdLogs.warn("video.playback_error",
ctx)`). So the context key is shadowed by a value the same call is setting from something else, and
every hero playback error reaches Datadog with its error text stripped — the one field that log
exists to carry. Rename to `error_message`.

**None of this is fixed.** PR #1840 ("fix(mobile): correct Datadog telemetry accuracy", open at the
time of writing) split the `home_feed_ready` success and failure latches and added
`outcome: "success"`, but did **not** rename `source`. The rename is recommended, not done.

## When to Apply

Apply this rule whenever you write or review:

- Any `datadogLog.info/warn/error(...)` call in `apps/mobile` or `apps/tv`.
- Any structured-log call in `apps/web`.
- Any `DdRum.addAction` / `DdRum.addError` context (RUM carries its own reserved set — `action`,
  `view`, `error`, `resource`, `usr`, `session`, `application`, `service`, `date` — same class of
  trap).
- Any new telemetry wrapper added to a fourth surface. Copying the `datadogLog` shape copies the
  absent guard along with it.

Reach for the guard test specifically when:

- You are adding a new telemetry surface to an app that has none.
- You are fixing a collision (add the guard in the same PR as the rename; a rename alone leaves
  the next author free to reintroduce it).
- A dashboard shows an empty facet for an event that is otherwise arriving — check the reserved
  list **before** assuming the emit is broken.

Corollary for verification: an emit-side unit test cannot prove an attribute survives ingest. The
only thing that does is querying the attribute in Datadog against a controlled session — a build
tagged with a known `version`, then a DDSQL group-by on the attribute you care about. Do that once
for every new attribute the first time it ships, not months later when a dashboard needs it.

## Examples

**Broken — the `source` collision (`apps/mobile/src/hooks/useWatchHome.ts`):**

```ts
// :374 — snapshot paint
datadogLog.info("home_feed_ready", { source: "snapshot" })

// :299 — real admin TTFB
datadogLog.info("home_feed_ready", { source: "network", outcome: "success" })
```

In Datadog:

```
@source    @outcome    count
""         ""          6
""         "success"   4
```

Attribute dump of one row: `custom.outcome: "success"`. There is no `custom.source`. Tags include
`source:react-native`, set by the SDK.

**Recommended fix — rename to a non-reserved key:**

```ts
datadogLog.info("home_feed_ready", { feed_source: "snapshot" })
datadogLog.info("home_feed_ready", {
  feed_source: "network",
  outcome: "success",
})
datadogLog.info("home_feed_ready", {
  feed_source: "network",
  outcome: "failed",
})
```

Then `@feed_source` groups into `snapshot` / `network` and the R21 distinction becomes answerable
for the first time.

**Already correct — namespaced keys (`apps/mobile/src/lib/watchSearchLog.ts`):**

```ts
{
  "watch_search.event_name": "watch_search",
  "watch_search.outcome": outcome.outcome,
  "watch_search.request_type": input.requestType,
  "watch_search.result_count": outcome.result_count,
  "watch_search.client_latency_ms": nonNegativeInt(input.clientLatencyMs),
}
```

A namespace prefix makes collision structurally impossible. Prefer this for any attribute set
larger than one or two keys.

**The other live collisions and their fixes:**

```ts
// apps/mobile/src/hooks/useManagedVideoPlayer.ts:76 and :267 — offline vs network playback
datadogLog.info("video.qoe", { ...summary, source: sessionSourceRef.current })
//                                          ^^^^^^ dropped -> playback_source

// apps/mobile/src/lib/offlineFileSystem.ts:101 — the HTTP status is the whole point of the log
datadogLog.warn("sidecar.download_bad_status", { status: result.status })
//                                               ^^^^^^ dropped -> http_status

// apps/mobile/src/components/home/HomeHeroPager.tsx:203 and :215 — shorthand, and doubly shadowed
datadogLog.warn("video.playback_error", {
  surface: "hero",
  content_id,
  message,
})
//              ^^^ the wrapper already sets `message` from here   ^^^^^^^ dropped -> error_message
```

**Guard shape to add** — model it on `apps/mobile/src/lib/__tests__/watchSearchTelemetry.guard.test.js`:

```js
const RESERVED_LOG_ATTRIBUTES = [
  "source",
  "host",
  "service",
  "status",
  "message",
  "trace_id",
]
// Scan every .ts/.tsx under apps/mobile/src and apps/mobile/app for a reserved
// key in a datadogLog.* / DdLogs.* context object -- BOTH `message:` and the
// bare `message` shorthand, which is how two live collisions were missed.
// Assert files.length > 50 so a broken root resolution cannot pass vacuously,
// and pair the scan with positive and negative controls so deleting any one
// pattern fails a test.
```

## Related

- [Datadog RUM env tag: unify every app on one canonical value](./datadog-rum-env-tag-cross-app-canonical-value.md) —
  the sibling cross-app Datadog naming pitfall. Different mechanism (a mismatched tag _value_
  rather than a shadowed attribute _name_), same class of silent fleet-wide unqueryability.
- [tvOS observability pipeline: QoE and guardrails](../best-practices/datadog-tvos-observability-pipeline-qoe-and-guardrails.md) —
  its attribute-namespacing guardrail is the general-case prevention rule for this bug, stated
  there for a different reason (facet-joinability).
- [Datadog RN SDK log level as a data-governance boundary](../best-practices/datadog-rn-sdk-log-level-rum-data-governance-boundary.md) —
  another non-obvious RN SDK attribute-forwarding behaviour in the same call-site family.
