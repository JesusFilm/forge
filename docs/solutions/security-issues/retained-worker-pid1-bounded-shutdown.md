---
module: shorts-worker
problem_type: runtime_error
tags: [studio, devotional, shutdown, pid1, cancellation, remotion]
---

# Retained worker PID1 shutdown and cleanup ownership

The retained devotional worker started Node directly as container PID1, but delivered TERM did not terminate its idle process. Exact-image comparisons showed the same worker exiting as a non-PID1 child, and an explicit diagnostic handler exiting as PID1. Node's default signal handler re-raises the signal after resetting its disposition; namespace PID1 behavior made direct Node startup alone insufficient. The diagnostic immediate exit was never adopted as the product fix.

The server now explicitly owns signal handling, queue cancellation, listener closure and outstanding HTTP handlers. TERM/INT immediately stop readiness and admission. All shutdown callers share one promise and one absolute five-second grace. Actual executor and handler settlement is required for `drained`; an expired or failed drain exits unsuccessfully. Disconnected sockets do not imply their handlers stopped. Queued successors cannot start, and cancellation cannot be overwritten by late success. In-memory job records do not become durable receipts.

Normal job cancellation also needs bounded cleanup ownership. A timed-out browser open can resolve late; an encoder or bundle operation can still run after a race rejects. Track those operations through cleanup, propagate Remotion cancellation, and wait for actual settlement. Failure to confirm cleanup within five seconds permanently closes admission before queue pumping and retires the process unsuccessfully without granting another grace. An earlier service-shutdown deadline wins. Cooperative cancellation remains reusable; immutable Workspace artifacts are preserved.

The exact-image active check also found a pre-existing baked-media path defect: the composition's static base is `/public`, while the worker copied per-job media into the copied bundle root. Copying into that job's `bundle/public` fixes the URL contract without modifying the shared baked composition. A focused entrypoint regression covers both media availability and absence of shared-bundle writes.

See [failure-first tests and exact-image evidence](../../validation/studio-460/worker-shutdown/README.md). Idle-only diagnosis, failed fixture attempts, active cancellation and full render acceptance have separate meanings. This lifecycle correction does not establish Studio generated-code containment, production transfer, Mux readiness or Railway operation. The [renderer decision brief](../../validation/studio-460/worker-shutdown/renderer-decision-brief.md) records the separate runtime choice; no support request or infrastructure change has been performed.
