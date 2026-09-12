---
id: "feat-493"
title: "Align Studio lease-check gateway and worker deadlines"
owner: "tataihono"
priority: "P1"
status: "in-progress"
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
