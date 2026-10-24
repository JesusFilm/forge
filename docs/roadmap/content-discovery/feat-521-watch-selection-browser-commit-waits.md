---
id: "feat-521"
title: "Attribute browser commit waits delaying Watch selection acknowledgments"
owner: "nisal"
priority: "P2"
status: "in-progress"
start_date: "2026-09-18"
duration: 3
depends_on: []
blocks: []
tags: [web, watch, performance, observability]
---

## Problem

During feat-496's Admin metadata-batching release verification, several fresh
Chrome 153 headless journeys received selection HTTP 200 headers but could not
read the acknowledgment before the browser aborted. One retained Chrome trace
at 03:26:25 UTC on September 18 identifies a 1,002 ms native renderer wait in
`LayerTreeHost::WaitForCommitCompletion`, beginning seven milliseconds after
the selection request. Network timing records response headers at 325 ms;
renderer response handling runs at 1,022 ms and the deadline timer at 1,032 ms.
This sampled failure is distinct from an Admin HTTP 503 deadline or a delivery
HTTP 200 `delivery_timeout` fallback.

The mechanism underneath the native commit wait, its occurrence outside this
headless harness and its relationship to the separately proven ten-second
toolbar surface delay are not established. Do not silently count unread bodies
as validated acknowledgments or label every browser abort an Admin failure.

## Entry Points — Read These First

- `docs/operations/watch-api-stalls-diagnostic-2026-09-18.md`: Admin causal
  experiment, deployment and separately classified release observations.
- `docs/operations/watch-paint-surface-sync-2026-09-18.md`: recovered
  agent-browser 0.37.1 / Chrome for Testing 153.0.8010.36 launch configuration
  and earlier toolbar surface controls. That earlier mechanism is not proof of
  this one-second commit wait.
- `apps/web/src/components/recommendations/WatchSemanticRecommendations.tsx`:
  `onSelect`, acknowledgment validation and navigation on either outcome.
- `apps/web/src/lib/recommendation-browser.ts`: the existing browser deadline
  and response-body validation. Successful navigation alone is not an API test.
- `docs/roadmap/content-discovery/feat-520-watch-field-post-response-paint-attribution.md`:
  separate non-headless paint attribution; coordinate any overlapping field data.

## Grep These

`WaitForCommitCompletion`, `BeginMainFrame`, `onSelect`, `AbortError`,
`delivery_timeout`, `forge.watch.homepageRecommendations`.

## What To Build

Recover the owned browser trace or repeat a normal card click in a fresh named
agent-browser session. Record network header/body times, fetch callback times,
signal abortion, exact acknowledgment validity and the full renderer/compositor
trace. Inspect `ProxyMain::BeginMainFrame::commit` and
`LayerTreeHost::WaitForCommitCompletion`; browser Long Tasks entries alone did
not expose the native wait in the sampled request. Preserve browser version,
effective launch arguments, actual viewport and trace command/artifact status.

Form a specific native wait hypothesis and run a matched control before changing
application code or verification configuration. Establish whether ordinary
non-headless users encounter it. Implement only a correction supported by those
controls; a harness-specific cause belongs in verification tooling.

## Verification

Keep default-browser failures in denominators
and label any feature-override control. Correlate server traces/counters where
available; healthy traces are sampled, so their absence cannot identify an
individual request. Keep HTTP validation rejections separate from timeouts.

## Constraints

No increased deadlines, mutation retries, hidden errors or unproven UI changes.
Preserve preview timing, identity, authorization, attribution and rate limits.
Preserve the current owner-authorized homepage recommendation pilot gating and
published block state; do not remove, republish or widen targeting as part of
this investigation. No Mobile/TV UI, account linking or curation republishing.
Use an owned isolated worktree and browser; deploy any justified code fix only
through normal PR/main automation.

## September 21 native-wait investigation

The recovered historical trace shows three approximately one-second waits on
the main renderer and 182 compositor `ThrottleUndrawnFrames` decisions over the
same three seconds. Begin-frame delivery advances approximately once per second
despite a 16.7 ms nominal interval. Chromium 153's
[`ShouldSendBeginFrame` implementation](https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.36/components/viz/service/frame_sinks/compositor_frame_sink_support.cc)
contains that one-second undrawn-frame throttle. This identifies the observed
native scheduling path, not the application workload or an ordinary-user cause.

The owned agent-browser 0.37.1 executable matches the historical executable's
SHA-256. New native-UA controls alternate its default Chrome 153 launch with
`--disable-features=Translate,InitialWebUISurfaceSync`. A final twelve-journey
capture marks selection fetch and renderer JSON completion with User Timing,
so waits can be assigned to the actual renderer and request interval. Eight
headless requests receive definitive HTTP 403; four headed requests receive
HTTP 200. All twelve renderer JSON reads complete. Headless main-thread waits
reach 1,014 ms elsewhere in the journey, but none of the captured one-second
waits overlaps selection. The longest overlapping native wait is below 1 ms.
Headless viewport is 1280×577; headed launch is 1050×737, so those groups are
not a matched headless-versus-headed performance comparison. Earlier explicit
1280×577 headed controls checked six acknowledgment nonces and target field types;
review found they did not compare both target values with the issued card.

The corrected 01:48:12–01:49:38 UTC control uses six fresh headed Chrome 153
journeys, a 1280×577 viewport and default features. Each production HTTP 200
acknowledgment matches the exact nonce, canonical href and media ID in the
renderer, completing in 450–588 ms. Two approximately 1,013 ms native waits occur
elsewhere; none overlaps selection, whose maximum overlapping wait is 0.598 ms.
The assertion correction is verification work, not an application fix.

Eight separate headless controls supply a local 325 ms acknowledgment fixture
and intercept all sibling evidence, playback and profile writes. All fixture
responses match the nonce. Neither four default trials nor four trials with a
pre-click screenshot reproduce the selection wait; the maximum overlapping wait
is below 1 ms. These locally supplied HTTP 200s are not production API successes,
and the screenshot is not a demonstrated correction.

Some Node-side Playwright `response.json()` calls fail after navigation even
though the page's own fetch clone has already parsed the JSON. Record that as a
test-runner body-access failure, not a renderer timeout. JSON parse success alone
also does not validate the acknowledgment's nonce and target binding.

The feature override is not a demonstrated correction for the selection
failure. Keep this ticket open for a matched affected request and ordinary-field
attribution; do not change application deadlines or verification defaults.
See the [release record](../../operations/watch-closeout-release-2026-09-21.md).

## September 24 bounded continuation

The current selection path still has no browser-stage observation separating
response headers, parsed/validated body and fail-open navigation. RUM resource
timing cannot expose a native `WaitForCommitCompletion` overlap or prove server
commit. An owned headed-browser startup timed out before navigation, so no new
selection was sent and no acknowledgment or trace was captured. The corrected
September 21 controls retain credit; they did not reproduce the affected wait.

The next required artifact is a fresh affected headed request with the actual
launch arguments and viewport, renderer/compositor trace, header/body/callback
times and exact nonce/href/media acknowledgment validation. If a natural field
failure remains uncorrelatable, a single privacy-safe selection RUM action with
bounded phase times and result category could distinguish browser stages, but
would not prove server commit or native cause. The
[September 24 browser record](../../operations/watch-browser-investigations-2026-09-24.md)
defines that narrow proposal. No deadline, retry or UI change is justified.
