---
id: "feat-493"
title: "Align Studio lease-check gateway and worker deadlines"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-09-13"
duration: 1
depends_on: []
blocks: []
tags: [manager, ai-pipeline]
---

## Problem

The first normal revision-16 render after the Chromium fix was cancelled before
frames started. Manager returned HTTP 409 for `/api/shorts/render-pool/owns`
after 5005 ms at 2026-09-12T13:43:51.587Z. Its HTTP handler permits only 5000 ms,
although the VM transport explicitly allows 10000 ms. The worker correctly
cancels execution when ownership cannot be confirmed. The resulting failure
conceals a slow valid ownership read behind a generic render diagnostic.

## Implementation

- `apps/manager/src/services/studio-render-pool-http.ts`: allow 9000 ms for owns,
  leaving response transit time inside the existing worker 10000 ms allowance.
- `apps/manager/src/services/studio-render-pool-http.test.ts`: reproduce a valid
  six-second ownership response, verify caller cancellation and timeout remain
  bounded, and never retry or reset the operation allowance.
- Keep native 900-second execution, capability/lease expiry, canonical ownership
  checks, process/memory/file limits and all mutation timeouts unchanged.

## Verification

Run the real HTTP-handler regression and surrounding render-pool tests. Release
through PR-to-main, then complete the normal six-recording Peace in the Storm
revision-16 Studio-to-Mux run. Preserve the failed attempt
`cmtyfqjxt01q4s40sm2ggwmqt` as evidence.

## Production release evidence

PR #2263 merged to `784a6f5eeb030254a77408b7f83ad0ef30f80c45`; automatic
Manager deployment `631647ee-e68b-42de-9b50-36f4b2488514` succeeded. On the
normal revision-16 retry `cmtygwngq0522s40s9lv22qdt`, an ownership check
returned HTTP 200 after 5661 ms at 2026-09-12T14:16:12.761Z, demonstrating
the valid response that the old five-second gateway would have rejected.
Subsequent checks remained 200 and frames started normally. Final hosted
acceptance is recorded in the Peace in the Storm validation document.

The retry completed normally: render SUCCEEDED/COMPLETED, Mux READY, and the
60-second Studio review player loaded and played without errors.
