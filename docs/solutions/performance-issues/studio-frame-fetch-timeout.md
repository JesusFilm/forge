---
module: Studio render worker
problem_type: performance_issue
tags: [studio, rendering, remotion, timeout, worker]
date: 2026-10-18
---

# Frame fetch allowance is shorter than the configured renderer timeout

An offline 32-process full-project benchmark on the 64-vCPU worker failed at
frame 7620 with `delayRender()` reporting an uncleared retained-video proxy
fetch after 5000ms. Docker reported no OOM kill; peak aggregate memory was
35.4GiB under a 48GiB cap. That establishes a timeout, not a diagnosis of corrupt
media or insufficient VM memory. A prior 16-process run completed the same
source and full timeline.

`apps/studio-render/src/child.mjs` configured `timeoutInMilliseconds: 7000`.
The pinned Remotion 4.0.475 `delayRenderInternal` subtracts 2000ms from the
renderer timeout to leave time to report the error. Consequently, a valid cold
video seek lasting six seconds was cancelled after five seconds. Parallel
load can expose this short allowance; it does not prove which operation made
the original fetch slow.

Use the SDK's normal 30000ms frame timeout, which gives media 28000ms. This is
an allowance for one frame, not a retry loop or a new whole-job deadline. Keep
the native guard, host watchdog, issued immutable execution profile, lease and
cumulative verification deadline unchanged. A stuck fetch still fails within
the frame allowance; job cancellation and the original execution deadline remain
independent bounds.

The regression in `apps/studio-render/test/encoding-policy.test.mjs` executes the
actual child to capture its renderer options, then executes the installed SDK's
real `delayRenderInternal` / `continueRenderInternal` with a deterministic clock.
A six-second completion fails before the fix and succeeds after it; a stuck
30-second fetch still cancels. Run:

```sh
node --import tsx --test apps/studio-render/test/encoding-policy.test.mjs
```

A passing regression does not establish five-minute full-project performance.
Keep the benchmark-only parallel implementation and resource allocation distinct
from the selected production release. Feat-725 remains open until full end-to-end
rendering, independent verification and canonical retention meet 300 seconds.
