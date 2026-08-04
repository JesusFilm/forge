---
title: "Datadog RN SDK log level is a data-governance boundary: error/critical logs forward full attributes into RUM"
date: "2026-08-04"
category: "best-practices"
module: "apps/mobile"
problem_type: "best_practice"
component: "tooling"
severity: "high"
applies_when:
  - "Choosing or changing a Datadog RN SDK log call's status/level (e.g. warn vs error) for a message whose attributes include raw viewer-entered or otherwise sensitive text"
  - "Auditing whether structured log attributes can leak into Datadog RUM error events, Error Tracking groupings, or alert payloads"
  - "Aligning a mobile client's failure log level to a sibling client's server-side error level ('parity' pass) without first checking iOS SDK forwarding behavior"
  - "Writing or reviewing a content-level regression test for a call whose discriminating arguments span multiple source lines"
tags:
  - "datadog"
  - "rn-sdk"
  - "log-level"
  - "rum"
  - "data-governance"
  - "guard-test"
  - "ios-sdk"
related_components:
  - "apps/mobile/app/(tabs)/watch.tsx"
  - "apps/mobile/src/lib/__tests__/watchSearchTelemetry.guard.test.js"
  - "docs/solutions/best-practices/mobile-datadog-rich-posture-data-governance-20260714.md"
---

# Datadog RN SDK log level is a data-governance boundary: error/critical logs forward full attributes into RUM

When a sensitive attribute rides a leveled log through an SDK that fans
high-severity events into a second store, the level itself is a data-governance
control. Pin it like one.

## Context

feat-335 brought `apps/mobile`'s watch-search telemetry to parity with web's.
Mobile deliberately logs the raw viewer search term — that is a signed-off
posture, not an oversight. The governance assessment at
`docs/solutions/best-practices/mobile-datadog-rich-posture-data-governance-20260714.md`
(the R43 deliverable whose sign-off gated production Datadog credentials) bounds
that free text to one place: the Datadog **Logs** store, on the org's default
15-day index, with a named deletion path.

The security review on PR JesusFilm/forge#1823 asked a question the assessment
never had to answer, because before feat-335 the shapes were different: _what
actually holds the raw query inside the Logs store?_ The answer turned out to be
a single word at two call sites. Both failure emits in
`apps/mobile/app/(tabs)/watch.tsx` call `datadogLog.warn(...)`. Had they called
`datadogLog.error(...)`, the Datadog React Native SDK would have copied the
entire attribute bag — including the raw search term — into RUM error events: a
different store, a different retention window, a different access surface, and
a different set of alert payloads than the one the assessment describes.

Nothing was leaking. The containment was real, but it was **incidental**: it
rested on a level chosen for an unrelated reason, documented as if the reason
were the only one, in a codebase whose sibling app (`apps/web`) logs the same
failures at `error`. The review-fix commit on PR JesusFilm/forge#1823 (open
and unmerged as of this writing, 2026-08-04; this doc merges with it) closed
the gap with three additive controls and no behavior change.

## Guidance

Treat the log level as part of the governance contract whenever a governed
attribute rides a leveled log and the logging pipeline routes by severity. Three
controls, each closing a different hole:

**1. A load-bearing WHY comment at every emit.** The comment must name the
mechanism, not just the local rationale, so the next reader knows the level is
load-bearing before they touch it. `apps/mobile/app/(tabs)/watch.tsx:452-454`:

```ts
// warn, not error — two constraints: benign rate-limits share this
// path (R34), and error-level logs copy every attribute incl.
// watch_search.query into RUM errors, outside the R43 Logs posture.
datadogLog.warn(
  WATCH_SEARCH_LOG_MESSAGE,
  buildWatchSearchLogAttributes({
    /* … */
  }),
)
```

The second emit at `apps/mobile/app/(tabs)/watch.tsx:589-590` cross-references
the first rather than restating the mechanism, keeping both blocks inside the
three-line comment cap.

**2. A content-level guard test.** Comments do not fail builds. The pin lives in
`apps/mobile/src/lib/__tests__/watchSearchTelemetry.guard.test.js`, which scans
every `.ts`/`.tsx` file under `apps/mobile/src/` and `apps/mobile/app/` for
retired telemetry shapes.
The level pin is a separate pattern list from the rest **because it must match
across newlines** (`watchSearchTelemetry.guard.test.js:25-28`):

```js
// LEVEL pin, content-wide because the call spans lines: the failure emits MUST
// stay at warn — the native SDK forwards error/critical logs' FULL attribute
// bag (incl. watch_search.query) into RUM errors, outside the R43 Logs posture.
const RETIRED_CONTENT_EMITS = [/datadogLog\.error\(\s*WATCH_SEARCH_LOG_MESSAGE/]
```

The whole-file match is not a stylistic choice. Prettier splits these calls
across four lines, so the per-line scan the other patterns use
(`watchSearchTelemetry.guard.test.js:36-38`, which also skips comment lines so
prose about the retirement never trips the guard) is structurally blind to the
offending shape. The detector at `:32-43` therefore runs the line-oriented
patterns and the content-oriented patterns as two separate branches over the
same file list.

**3. Doc statements everywhere the level is explained.** Both the operator
runbook (`docs/operations/watch-search-analytics-datadog.md:97-101`) and the
governance note itself (the 2026-08-04 update at
`mobile-datadog-rich-posture-data-governance-20260714.md:18-29`) now say the
level is load-bearing and name the mechanism. The governance note is the
document a future reader consults to answer "what is contained where," so a
containment that depends on the level has to be stated in it.

Two supporting habits make the guard trustworthy rather than decorative. Give it
a **positive control per pattern** — a fixture that only that pattern can match,
so deleting the pattern fails a test — and a **negative control** proving the
current, legal shape does not trip it. And **falsify the guard once by hand**:
flip a real emit to `error`, watch the guard go red, flip it back. A guard that
has never been observed failing is a guard whose regex you are trusting on
inspection alone.

## Why This Matters

**The mechanism is real and it is invisible from JavaScript.** The React Native
wrapper is a thin pass-through: `DdLogsImplementation.warn` calls `logger.warn`
and `DdLogsImplementation.error` calls `logger.error`, both forwarding the same
merged attribute dictionary
(`node_modules/@datadog/mobile-react-native/ios/Sources/DdLogsImplementation.swift`,
an installed dependency, not tracked;
`apps/mobile/package.json:20` pins `3.5.2`). The fan-out happens one layer down,
in the native iOS SDK's `RemoteLogger.internalLog`. After writing the log event,
it checks the status and returns early for anything below `error`
(`DatadogLogs/Sources/RemoteLogger.swift:183`):

```swift
guard log.status == .error || log.status == .critical else {
    return
}
```

Past that guard, it publishes a `RUMErrorMessage` onto the SDK's internal
message bus (`RemoteLogger.swift:196-208`) whose `attributes:` argument is
`busCombinedAttributes` — derived from `combinedAttributes` at `:126-127`, which
is the merge of the SDK's global attributes, the logger's attributes, and the
caller's per-call attributes. **Everything.** Not a curated subset, not the
message alone. Every custom attribute the call site passed, copied verbatim into
an event in the RUM product.

_(The pod is not tracked in the repo — `apps/mobile/ios` is an `expo prebuild`
artifact — so these citations are against DatadogLogs `3.11.0`, the version whose
`Podfile.lock` CocoaPods checksum (`ef987082…`, not a git commit) matches the
locally cached pod source read during the feat-335 review.)_

For mobile's search telemetry that bag contains the raw viewer query. It is the
only raw-text field in it, deliberately so —
`apps/mobile/src/lib/watchSearchLog.ts:97-98`:

```ts
// The raw query is the sole raw-text field in the bag (R43 posture).
"watch_search.query": input.query.slice(0, MAX_QUERY_LENGTH),
```

**A one-word change would have kept the suite green.** No test outside the guard
file asserts the level of these two emits; the surrounding suites assert on the
attribute bag, the outcome discriminator, and the dedup behavior, all of which
are identical between `warn` and `error`. Typecheck, lint, and the full jest run
all pass on the leaking version. This is the repo's recurring "one-line revert
surface" shape — the same failure mode as feat-304's environment-conditional
egress pin, where a one-line change at either config builder restored a
fail-open posture with the entire suite green. When the correct behavior is a
single token and nothing asserts on that token, the correctness is a coincidence
maintained by memory.

**The docs actively invited the change.** Before this commit, the runbook's Log
Levels section said only that web logs failures at `error` while mobile logs
them at `warn` because benign rate-limit rejections share mobile's failure path
— then told operators never to filter on log status, which reads as _the level
carries no meaning here_. The emit comments said the same thing: "warn, not
error: benign rate-limits share this path — they reject as a 200-body GraphQL
code, not a 429 (R34); outcome discriminates." Every written explanation framed
the level as a filtering convenience. A future engineer running a "align mobile
with web" parity pass would find a documented rationale that their change does
not violate (the outcome field still discriminates rate limits, exactly as
documented), no failing test, and a sibling app to match. The docs were not
merely silent about the constraint — they supplied an affirmative argument for
removing it.

## When to Apply

Apply this when all three conditions hold:

- An attribute under a governance, privacy, or retention commitment rides a
  **leveled** log or event (raw user text, identifiers, tokens, anything named in
  a data-handling assessment).
- The pipeline **routes by severity** into a destination with different
  properties — a different store or index, a different retention window, a
  different access-control surface, or alert/notification payloads that embed
  attributes.
- Changing the level is a **small, plausible, locally-motivated edit** —
  cross-client parity, alert tuning, "this really is an error."

Concretely in this repo: any `datadogLog.*` call in `apps/mobile` or `apps/tv`
whose attribute bag carries governed content. Datadog RN is the specific SDK
verified here, but the shape is generic — severity-triggered fan-out also shows
up in error-tracking integrations (Sentry breadcrumb promotion), log-router
rules that copy `error` records to a long-retention archive, and PagerDuty or
Slack integrations that inline the full event payload into a notification.

**Do not** apply it as a blanket rule:

- Not a reason to avoid `error`-level logs. Where the attribute bag is clean —
  ids, counts, enums, durations — the fan-out into RUM errors is exactly the
  behavior you want, and suppressing it costs real diagnostic signal.
- Not a reason to pin levels on logs with no governed attributes. A pin on an
  ordinary log is pure friction: it blocks legitimate severity tuning and dilutes
  the signal that the guarded pins carry weight.

The guard test's own negative control makes that boundary executable
(`watchSearchTelemetry.guard.test.js:155-157`): `datadogLog.error("video.swap_failed",
{ content_id: id })` is ordinary house telemetry and does not flag. The pattern
anchors on the _specific message constant_ whose bag is governed, never on the
`error` level generally.

## Examples

**Before — the comment at the search failure emit** (correct behavior, rationale
that omits the constraint):

```ts
// warn, not error: benign rate-limits share this path — they reject as
// a 200-body GraphQL code, not a 429 (R34); outcome discriminates.
datadogLog.warn(
  WATCH_SEARCH_LOG_MESSAGE,
  buildWatchSearchLogAttributes({
    /* … */
  }),
)
```

**After** (`apps/mobile/app/(tabs)/watch.tsx:452-465`) — same call, rationale now
names the mechanism that makes the level load-bearing:

```ts
// warn, not error — two constraints: benign rate-limits share this
// path (R34), and error-level logs copy every attribute incl.
// watch_search.query into RUM errors, outside the R43 Logs posture.
datadogLog.warn(
  WATCH_SEARCH_LOG_MESSAGE,
  buildWatchSearchLogAttributes({
    /* … */
  }),
)
```

**The guard's positive control for the level pin**
(`watchSearchTelemetry.guard.test.js:100-105`) — a fixture written exactly as
Prettier formats the real call, which is what proves the pattern survives the
line split:

```js
{
  // The level pin: error + the shared message flags even across lines.
  relative: "src/lib/telemetry/ErrorLevel.ts",
  content:
    "datadogLog.error(\n  WATCH_SEARCH_LOG_MESSAGE,\n  buildWatchSearchLogAttributes(input),\n)",
},
```

**The paired negative control** (`watchSearchTelemetry.guard.test.js:147-152`) —
the shape production actually ships, proving the guard is not simply matching
everything in the neighborhood:

```js
{
  // The CURRENT failure emit: warn + the shared message stays legal.
  relative: "app/(tabs)/watch.tsx",
  content:
    "datadogLog.warn(\n  WATCH_SEARCH_LOG_MESSAGE,\n  buildWatchSearchLogAttributes(input),\n)",
},
```

The positive fixture goes in the expected-offenders list at `:107-114` and the
negative in the expect-empty assertion at `:117-160`, so removing the
`RETIRED_CONTENT_EMITS` pattern fails the positive control and broadening it to
catch all `error` logs fails the negative one.

## Related

- `docs/solutions/best-practices/mobile-datadog-rich-posture-data-governance-20260714.md` — the R43 raw-query posture this pin protects (its 2026-08-04 note points here)
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the one-line-revert-surface META family this instance joins
- `docs/solutions/architecture-patterns/canonical-server-search-analytics-supplemental-rum-pattern.md` — the Logs-canonical / RUM-supplemental boundary whose mobile leg this level guards
- `docs/solutions/security-issues/pre-verification-log-field-namespace-pollution-20260518.md` — structural sibling: a log FIELD NAME as a trust contract, vs the log LEVEL here
- `docs/solutions/integration-issues/datadog-rn-resourceeventmapper-programmatic-config-gap.md` — same SDK corpus and feat-335 lineage
- PR JesusFilm/forge#1823 (feat-335) — the shipping PR carrying the fix (open as of 2026-08-04; this doc travels with it)
