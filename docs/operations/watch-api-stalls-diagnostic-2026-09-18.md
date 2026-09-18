# Watch API stalls continuation — September 18

This continuation starts from main `a64f651353c06f9d58917983e0a94603e9995fca`
in the dedicated `codex/feat-496-api-stalls-20260918-q7v` worktree. Admin,
recommendation worker and Web deployment records still identify
`c813991ad3645aebdb50d6b1cac92a47b5aad250`. Feat-496 remains in progress.

## Invalid diagnostic capture and recovery

At 02:15:46 UTC a bounded temporary in-process observer attempted to measure
PostgreSQL connection acquisition, lease duration and sanitized query shapes.
Its local compatibility check covered successful and failed queries, callbacks,
queued acquisitions and releases, but omitted exhaustion of its 512-shape cap.

The observer contained a bug: when a query shape was omitted after the cap,
`last?.shape === shape?.id` could compare two undefined values, followed by an
invalid `last.count++`. When invoked inside a driver callback, this exception
prevented the original callback from running. All ten main-pool connections
became checked out despite having no active or queued SQL. Independent database
inspection confirmed those exact backends were idle, not waiting on locks or
executing slow SQL. The capture's acquisition failures and 26-second maximum
wait are diagnostic-induced and must **not** be attributed to the application.

The capture removed its hooks and closed its inspector at completion, but this
did not release connections whose callbacks had already been interrupted. A
local real-PostgreSQL reproduction confirmed both the failure and recovery by
discarding the stranded connection. Subsequent read-only pool inspection in
production confirmed the same state for the ten backend IDs in this task's
capture. At 02:24:01 UTC, cleanup discarded only those ten connections after
checking they were checked out, had no active or queued query and were ready.
The normal pool replaced them. No mutation was retried, database record changed,
service restarted or deployment triggered. Follow-up database inspection found
none of the old backends, and a separate check confirmed the inspector closed.

An inspection attempt exceeded its inspector response timeout; its cleanup
initially failed to close the task-owned inspector. The subsequent cleanup
attached only to that same task-owned inspector and confirmed closure. Heap
object enumeration is unsuitable for a low-overhead latency probe here.

Connection-timeout log entries persisted while the backlog drained. A later
Datadog search from 02:26 UTC returned no matching connection-timeout or observer
exception entries through 02:28:20. This is a bounded observation, not an
application recovery claim or a complete incident impact count.

Datadog Web request counters for 02:15–02:27 recorded 73 playback HTTP 503s
and 171 profile HTTP 503s. Recommendation delivery had 17 HTTP 200 responses;
their fallback bodies are not available from those counters, so they cannot be
classified as successful delivery. The same window included 37 playback,
67 profile and 16 evidence HTTP 200s, plus 10 playback, 20 profile and 22
delivery HTTP 403s. No selection series was returned. These are window counts,
not a claim that every failure was caused by the observer. Admin GraphQL span
error counters still recorded 252 errors in the 02:26 minute while recovering;
the next six minute buckets through 02:33 contained one error in total.

The first browser scripts waited for lazy recommendations before scrolling them
into view. Their empty outcome sets are invalid acceptance tests. After correcting
the journey to scroll normally, six navigations at 02:28:17–02:29:10 observed:

- Ten recorded recommendation responses: HTTP 200, six cards, `served`, no
  semantic fallback in these recorded bodies.
- Four fully validated selection acknowledgments: HTTP 200, 377–661 ms.
- One selection HTTP 200 whose response body could not be read after navigation;
  it is not a validated acknowledgment.
- One selection browser abort at 801 ms; its server HTTP outcome is not yet
  correlated and must not be labeled HTTP 503 from the browser evidence alone.
- No captured JavaScript errors.

These checks demonstrate resumed useful traffic after diagnostic cleanup. They
do not establish resolution of the original intermittent failures. At that
checkpoint no new application fix had been implemented or deployed.

## Investigation guardrails learned

Production observers must isolate every recording failure from application
callbacks, preserve callback invocation even if recording throws, and contain
rejections from side-branch promises. Test capacity exhaustion, absent metadata,
restoration during pending work and observer exceptions before production use.
Restoring prototype hooks alone is insufficient if an observer interrupted an
already-running operation. Avoid further in-process monkey-patching for this
investigation; use existing traces, independent read-only PostgreSQL sampling
and local reproductions. Exclude the diagnostic incident and backlog from
baseline and post-fix performance comparisons.

## Locally reproduced catalog workload

The continuation found a separate application processing cost in the normal
Watch snapshot: four metadata reads per related Mux video create hundreds of
Prisma operations even though Prisma batches the SQL. A single service batch
preserves the same four output fields and missing-image generation behavior.
The actual-helper local reproduction, limitations and regression coverage are
in `docs/solutions/performance-issues/prisma-batched-mux-metadata-call-overhead-20260918.md`.
The scoped change is under validation; no release or overall API recovery is
claimed at this checkpoint. Feat-496 remains in progress.

Local validation passed 7,275 Admin tests, 111 focused tests including 12 real
PostgreSQL cases, full Admin lint, typecheck and a production build with workflow
registration checks. The new PostgreSQL equivalence regression is also included
in the existing CI database job. The first broader database run needed the
`vector` extension enabled in this task's owned PostgreSQL container; rerunning
the attribution and playback/selection cases then passed. No shared database
was changed. Sequential Compound Engineering review found no outstanding code
findings. Freshly fetched main remains `a64f651353c06f9d58917983e0a94603e9995fca`.

## Uninstrumented pre-release baseline

At 02:54:45–02:55:13, three normal Watch journeys recorded six HTTP 200
deliveries, each with six cards and `served`, and no JavaScript errors. Selection
had one validated HTTP 200 acknowledgment at 689 ms and two browser aborts at
801 ms. Datadog counters for 02:54–02:56 recorded two selection HTTP 200s and
one HTTP 503. Trace `6aaca7fb00000000699858e276829a5a` confirms the first browser
abort's server timeout: Web HTTP 503 at 709 ms, upstream abort at 706 ms, Admin
selection mutation 1,078 ms and its transaction 841 ms. The other browser abort
is not an additional confirmed HTTP failure. No temporary Admin observer was
active. Thus the original failure still exists independently of the earlier
diagnostic incident.

Fresh SSH checks at approximately 03:00 confirm Admin, worker and Web still run
`c813991ad3645aebdb50d6b1cac92a47b5aad250`; Admin/worker runner flags are false/true,
and profiling remains enabled on Admin and Web.
