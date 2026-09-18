---
id: "feat-521"
title: "Attribute browser commit waits delaying Watch selection acknowledgments"
owner: "nisal"
priority: "P2"
status: "not-started"
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
Keep the authored English homepage recommendations block removed and
`forge.watch.homepageRecommendations` default off. No Mobile/TV UI, account
linking or curation republishing. Use an owned isolated worktree and browser;
deploy any justified code fix only through normal PR/main automation.
