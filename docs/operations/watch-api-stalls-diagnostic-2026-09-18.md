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

## Automatic release

PR #2342 merged normally at 03:09:15 UTC as
`32caef0f1cc2e9b59570bfb44fd1cd96f2df0c58`. Main was freshly fetched immediately
before merge and still matched the validated base `a64f651353c06f9d58917983e0a94603e9995fca`.
All required checks and CodeQL passed. CI passed 7,277 Admin tests; the database
job passed 66 recommendation integration cases, including all 11 cases in
`playback-episode.db.test.ts` and the new metadata output-equivalence regression.
The separate local counts above remain local results, not CI counts.

Railway automatically deployed Admin `a08413af-2ff9-408b-bae1-83e1346cdd80`
and worker `e2555936-f6a3-4299-829c-6944d5df17b4`; both report SUCCESS. At
03:17:41 UTC, SSH checks independently confirmed both execute the exact merged
revision and contain the compiled batch helper. Admin/worker runner flags remain
false/true. Web correctly skipped this Admin-only release and still executes
`c813991ad3645aebdb50d6b1cac92a47b5aad250`. Admin/Web profiling remains enabled,
and all three inspectors are closed. No manual deployment or redeploy occurred.
An independent SSH recheck at 04:16:37 confirms the same revisions, compiled
batch, runner settings, enabled Admin/Web profiling and closed inspectors.

A retained ordinary catalog trace at 03:20:10 on the new revision,
`6aacadea000000003a7acca02c0158c7`, contains one related-image
`MuxImageDerivative.findMany` at 29 ms and a 561 ms Watch route snapshot. Root
video individual image reads still occur as intended. This verifies the executed
path; the unrelated pre-release 3,353 ms snapshot is not a matched request and
must not be used as a production speedup ratio.

## Separate browser acknowledgment observation

The initial six post-release journeys returned six valid acknowledgments in
241–319 ms and 12 HTTP 200 deliveries with six cards and no fallback. Subsequent
fresh-browser batches include HTTP 200 responses whose cloned bodies cannot be
read after the browser deadline; these remain unverified acknowledgments.
They are not silently counted as successes or inferred to be server HTTP 503s.

One such case was captured with native Chrome tracing at 03:26:25 UTC. Network
resource timing records selection response headers at 325 ms. The renderer
blocks from 7–1,009 ms in `LayerTreeHost::WaitForCommitCompletion` inside
`ProxyMain::BeginMainFrame::commit`, handles the response at 1,022 ms, then runs
the deadline timer at 1,032 ms. Body reading fails with `AbortError`. This proves
a native renderer scheduling contribution for this sampled client failure;
it does not establish the wait's underlying cause or classify all other cases.
The browser Long Tasks observer alone did not reveal that native wait.

The trace stop command returned `No tracing in progress` after writing a complete
206 MB JSON artifact with 1,106,321 events; artifact parsing and request alignment
succeeded. Treat command status and artifact validity separately. The artifact
is retained privately in this task's owned worktree, not committed with raw
browser data. All task-owned browser sessions close after their bounded batches.
Feat-521 records the remaining browser attribution and non-headless verification.

At the 03:29 checkpoint, counters for 03:17–03:29 recorded 27 selection HTTP
200s, one HTTP 400 and no selection HTTP 503 series, alongside 9,756 Admin
GraphQL requests. The separately retained 03:22:15 validation rejection,
`6aacae670000000071b4c5f5239dbdc0`, failed with `BAD_USER_INPUT` in 7 ms; it is
not a runtime timeout and did not match a measured browser selection timestamp.
This checkpoint is not the final sustained acceptance window. Feat-496 remains
in progress while monitoring continues.

## Remaining confirmed server timeout

The extended check disproved complete recovery. At 03:40:10.256 UTC, the second
selection in a normal three-journey batch aborted at 801 ms without a browser
response. Trace `6aacb29a000000003096dac941cd5f16` correlates it with Web HTTP
503 at 703 ms and the original 700 ms upstream deadline. Admin runs the new
`32caef0f1` revision, and its selection mutation continues for 2,433 ms. The
dominant span is the pre-transaction
`SELECT consume_recommendation_capability_submissions(...)` call at 2,341 ms;
the subsequent selection transaction takes 81 ms. Admin's HTTP span ends when
the caller aborts and is not evidence of an acknowledged selection.

The driver SQL span accounts for 2,340 ms of the call. It includes driver/pool
waiting and application scheduling as well as database time; it does not prove
PostgreSQL execution was slow. The retained concurrent spans do not establish
the blocker. Production has no `pg_stat_statements` extension, function tracking
or slow-query/lock logging enabled. These shared settings were not changed.
A separate bounded read-only PostgreSQL session is sampling activity/wait edges
during normal browser journeys to distinguish those hypotheses, without
in-process hooks or inspector access. Preserve the atomic 32-submission limit.

At this stop, the ordinary browser cohort contains 48 selections: 42 validated
HTTP 200 acknowledgments, five HTTP 200 unread bodies, and the one browser abort
correlated with server HTTP 503. All 96 recorded delivery bodies served six
cards, with zero `delivery_timeout` fallbacks. The separately traced three-journey
cohort contains two validated acknowledgments and the native commit-wait case.
These denominators stay separate. Feat-496 remains in progress; PR #2342 fixed
a reproduced component, not the entire remaining API problem.

## Database, driver and scheduling separation after release

A second selection timeout at 03:45:42 UTC is independently confirmed by trace
`6aacb3e6000000004bb08c6b3b2e20c3`: Web returns HTTP 503 at 714 ms, while Admin's
selection resolver takes 618 ms. Its capability-budget call takes 382 ms and
the subsequent selection transaction takes 152 ms. Resolver time excludes the
other network and request-processing costs inside Web's existing 700 ms budget.

An independent read-only PostgreSQL client sampled activity every 250 ms for
90 seconds during that journey. At 03:45:42.837 it observed the capability-budget
statement active for 128 ms in `IO / WalSync`, with no blocking PID. This proves
a durable-write wait contributed to this request. It does **not** establish the
whole 382 ms as fsync time or explain the earlier 2,341 ms budget call. The
355 activity probes took at most 9 ms. Their connection is separate from Admin's
pool, so this cannot rule out waiting for an application connection.

Existing Admin runtime metrics in the 03:39:50–03:40:30 window record ten-second
bucket maxima of 21–77 ms event-loop delay and 9–22 ms GC duration. Those do not
support a single 2.34-second Node scheduling pause for the first timeout.
PostgreSQL checkpoint logs instead complete at 03:39:37 and 03:44:42; neither
checkpoint overlaps the corresponding timeout. The available Datadog PostgreSQL
metric series identify unrelated RDS hosts, so they are not evidence about this
Railway database. No database logging/tracking setting was changed.

A second independent 110-second capture at 200 ms intervals completed 541 probes,
maximum 8 ms. It did not sample another budget call above 100 ms. One worker
transaction waited about 75 ms on a transaction-ID lock, which does not explain
the earlier selection failures. The two accompanying browser cohorts stay
separate from the ordinary cohort: the first has 11 validated acknowledgments
and the server-correlated abort; the second has 12 validated acknowledgments.
Together their 48 delivery bodies all served six cards without fallback. Both
read-only clients closed normally. These windows narrow hypotheses, not prove
recovery or eliminate intermittent waits.

A final 110-second read-only sample at 100 ms intervals recorded 1,066 probes,
maximum 8 ms, with no blocking edges or sampled budget call above 100 ms.
Its first browser launch repeated `.tmp` in the report path and failed to persist
the first journey; the browser closed and that launch is excluded. The corrected
12-journey cohort returned 12 valid acknowledgments and 24 served delivery
bodies, with no fallback or JavaScript error. Its first part overlaps the database
capture; the browser finishes later at 04:15:12. This is another healthy sample,
not evidence that the two confirmed failures are resolved.

Datadog population counters for 03:17–04:15 UTC record **90 selection HTTP 200s,
one HTTP 400 and two HTTP 503s**, alongside 51,221 Admin GraphQL requests.
Delivery has 520 HTTP 200s and 2,952 HTTP 403s; these counters do not expose
fallback bodies. Only the separately recorded browser bodies support semantic
delivery classification. The retained 503 spans include both `web.request` and
`next.request` for each request; deduplicate by trace rather than reporting four
failures. Numeric browser cohorts and the two server correlations are preserved
in `docs/validation/watch-api-batch-release-20260918/browser-outcomes.json`.

## Catalog SQL hypothesis and negative causal control

Activity sampling also found up to three concurrent
`VideoService.getWatchLanguageInventory` queries lasting approximately 1.9
seconds. A bounded production `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` in a
read-only transaction took 2,172 ms. The `usable_subtitle_video` CTE sorts 158,757
fallback rows down to 523 choices even where requested-language audio already
exists. JIT was not used. An experimental anti-join against `playable_audio`
inside that CTE reduced the same English plan to 606 ms.

Read-only repeatable-read comparisons returned byte-identical ordered output
for English in both execution orders, Spanish Latin American, and Hindi. Full
query wall times were 1,719–1,996 ms before and 407–564 ms after. This is evidence
of a catalog optimization opportunity, not of a selection fix.

The causal prediction failed in an owned local PostgreSQL fixture with 160,000
variants, the observed three concurrent inventory workers and a ten-connection
pool. An independent worker's HTTP probe performed six reads and one durable
insert transaction. The same 24 catalogs took 18.27 seconds before and 3.43
seconds after; small-transaction maxima were 81.7 and 83.4 ms respectively,
with zero probes above 700 ms in either run. Probe counts differ (171 versus 31) because the workload ends sooner. This direct-pg experiment does not emulate
the complete Prisma/tracing/selection path or production storage, but it fails
to reproduce the hypothesized contention at the observed concurrency.
**No catalog SQL change was applied to the application or production.**

## Remaining causal gate

Feat-496 remains in progress. The proven metadata processing component is
deployed; the remaining server timeout still needs a representative reproduction
that distinguishes driver acquisition, database execution/lock/durable-write
waits and network scheduling. A slow driver span alone cannot choose among them.
Preserve the capability budget's independently committed, atomic 32-submission
limit, including failed attempts; moving it into a rollbackable selection
transaction or retrying an ambiguous write is not an acceptable shortcut.
Continue from the two trace IDs and these negative controls. Any additional
driver timing must use a locally tested supported integration; do not repeat
production callback monkey-patching or heap enumeration.
