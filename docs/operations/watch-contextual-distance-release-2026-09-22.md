# Watch contextual distance release — September 22, 2026

## Verified change and remaining boundary

[PR #2377](https://github.com/JesusFilm/forge/pull/2377) removes duplicate exact
cosine-distance evaluations in contextual recommendations. The inner
`DISTINCT ON` now returns its already-sorted distance; the outer projection
computes similarity. Eligibility, all seeds, per-seed limits, final ranking and
returned fields are unchanged. No deadline, pool size, durable budget, retry,
admission or authorization changes accompany it.

This is a proven query optimization. It does **not** establish the cause of the
historical selection HTTP 503 or the separate HTTP 200 `delivery_timeout`.
The [previous release record](watch-runtime-release-verification-2026-09-22.md)
retains those failures and the possible diagnostic interference. No additional
roadmap ticket is closed by this release. All times below are September 22 UTC.
The [aggregate artifact](../validation/watch-contextual-distance-release-20260922/results.json)
contains complete populations, exact release identities and measurement limits.

## Validation and exact automatic release

The real PostgreSQL regression failed with 16 cosine-function calls for four
eligible chunks and two seeds, then passed with eight. All four database tests,
15 focused service tests and **7,305 Admin tests** pass. Full-row parity,
eligibility/family exclusions and the 176th seed remain covered. Admin typecheck,
scoped ESLint, formatting, roadmap checks and the complete PR CI gate pass,
including the actual Admin production build and database checks. Compound
Engineering review ran sequentially under the repository's tool mapping and
found no actionable issues. The existing contextual-query learning was updated.

The source head was `3143dae7c485e8585abee2e6a0240d4ede68f4ea`. Freshly fetched
main was unchanged from tested base `f1223455ae9c74524d7bc2d9df69fcc48bed288c`
before normal squash merge at 01:25:33. No local deployment or manual redeploy
was used. GitHub production deployment `6581465715` reports success at 01:36:10.
Independent runtime reads verify:

| Service | Verified at | Revision                                   | Deployment                             |
| ------- | ----------- | ------------------------------------------ | -------------------------------------- |
| Admin   | 01:34:55    | `c98ec86bdd9a308f33b53d035084e8fd10e0e08d` | `dfbb23e1-98e5-4c80-9328-528f1192a80a` |
| Worker  | 01:38:18    | `c98ec86bdd9a308f33b53d035084e8fd10e0e08d` | `524e5c8a-b6e9-4b86-8158-ea0cab1bf409` |
| Web     | 01:38:18    | `1cccac03cec7ad4427d0c6f80443dd4d71b942e0` | `7e475679-fd30-4973-b92c-797a183147f3` |

Admin and worker each contain the new SQL in 11 compiled chunks, no old
duplicated projection, and the preceding logger, Mux and budget-timing changes.
Their workflow-runner roles remain false/true respectively. Health responses
are HTTP 200. Web's anonymous homepage availability remains `enabled:false`.
The owner subsequently instructed this task to preserve the authored English
homepage block behind that flag; see the authenticated continuation below.

## Complete-service and production read comparisons

The [local query artifact](../validation/watch-contextual-distance-20260922/results.json)
retains analyzed plans and concurrent 176-seed query rounds. An additional
complete-service comparison uses the actual `SceneRecommendationsService`,
Prisma adapter and ten-connection pool on the same owned synthetic fixture.
Requesting six cards means the service actually requests **18 candidates per
seed**. Alternating baseline/candidate order returned six identical cards with
three statements in every round:

| Order                   | Baseline | Corrected |
| ----------------------- | -------- | --------- |
| Baseline then corrected | 5,360 ms | 3,559 ms  |
| Corrected then baseline | 5,345 ms | 3,510 ms  |

This improves complete-service time by approximately one third. The synthetic
fixture is not feat-447's required restored vector-bearing snapshot. Concurrent
small writes stayed below 34 ms in both query versions; the workload did not
reproduce the historical 701 ms selection-budget delay.

Three bounded, read-only `sceneRecommendations(slug: "jesus", locale: "en",
limit: 6)` requests used Web's existing configured consumer credential. They
created no selection, impression or playback evidence. The before request at
01:28:44 returned in **2,508 ms** on the previous Admin revision; requests at
01:35:42 and 01:37:00 returned in **1,827 and 1,910 ms** after deployment.
All were HTTP 200 without GraphQL errors, with six distinct playable items and
an identical complete-response hash. These are three legacy contextual-query
samples, not primary-delivery latency percentiles or selection acknowledgments.

## HTTP outcomes and semantic fallbacks

Primary counts use `trace.web.request.hits`, scalar **sum**, grouped by endpoint,
HTTP status and revision. Delivery log groups are independently summed and
compared with those counts. No traffic is excluded. A short window is not a
recovery claim; the post-release selection population is especially small.

The earlier **00:35–01:20** window has one selection 200, no selection 503,
2,693 playback 200s, 246 playback 403s and two playback 400s. Initial evidence has
864 200s, 427 403s and 18 400s. All 20 observed 400 reason logs report terminal
`invalid_request`, `timeoutStage=none`; they remain HTTP failures and are not
relabelled timeouts. These logs alone do not prove the cause of each invalid
request. Playback has zero 5xx / 2,941 requests.

All 537 seeded-delivery outcomes reconcile: 321 HTTP 200s and 216 403s.
Among the 200s, 275 are served and 46 are coverage/cooldown fallbacks:
22 `no_candidates`, 21 `seed_embedding_unavailable`, three `cooldown`.
There are zero observed `delivery_timeout` or `retrieval_timeout` envelopes.

The post-release **01:39–01:54** window begins after both Admin and worker were
independently verified. The final query was repeated after the boundary and
ingestion delay; the initial near-boundary query was incomplete.

| POST endpoint    | 200 | 403 | Other HTTP errors | Total |
| ---------------- | --: | --: | ----------------: | ----: |
| Seeded delivery  |  94 |  76 |                 0 |   170 |
| Selection        |   1 |   0 |                 0 |     1 |
| Playback         | 680 |  79 |                 0 |   759 |
| Initial evidence | 250 | 152 |                 0 |   402 |
| Profile          | 134 | 180 |                 0 |   314 |

All **170** delivery outcomes reconcile. Of 94 HTTP 200s, 81 are served
(52 with six cards) and 13 are coverage fallbacks: 11 `no_candidates`, two
`seed_embedding_unavailable`. There are **zero observed `delivery_timeout` or
`retrieval_timeout` fallbacks**, and playback has zero 5xx / 759 requests, with
no exclusions. The 76 delivery 403s report invalid fetch metadata or origin.
Other endpoints' 403 semantics are not independently reconciled in this record.
One successful selection and fifteen minutes do not establish intermittent
timeout recovery. Neither HTTP 200 nor six visible cards alone proves success.

### Longer observation caught a separate Redis update interruption

The settled **01:39–02:19** population includes the fresh browser canary and
supersedes the shorter window for current release assessment:

| POST endpoint    |  200 | 403 | Other HTTP errors | Total |
| ---------------- | ---: | --: | ----------------: | ----: |
| Seeded delivery  |  264 | 212 |             1×503 |   477 |
| Selection        |    4 |   0 |                 0 |     4 |
| Playback         | 1496 | 222 |     1×401, 19×503 |  1738 |
| Initial evidence |  633 | 470 |                 0 |  1103 |
| Profile          |  394 | 447 |             1×503 |   842 |
| For you delivery |    1 |   0 |                 0 |     1 |

All 477 seeded-delivery outcomes reconcile: 220 served, 43 coverage/cooldown
fallbacks and one empty HTTP 200, 212 rejected 403s, and one
`admission_unavailable` 503. There are zero observed HTTP 200 `delivery_timeout`
or `retrieval_timeout` fallbacks. The separate For you response is served with
six cards. Four successful selections remain a small population.

The **19 playback 503s / 1,738 requests (1.093%)** occur at
02:11:13.019–02:11:20.885. All report `upstream_unavailable`,
`timeoutStage=none`, and retryable disposition; no traffic is excluded. In
trace `6ab1e3c80000000043ee885b4b6c170a`, Web returns 503 in 10.6 ms after
Admin returns HTTP 500 in 7.1 ms. Matching Admin logs identify Redis
`getForIdentity` in the GraphQL rate-limit store failing because its stream is
not writable and offline queueing is disabled. The two identical error log
entries are one request, not two failures.

Railway records **automatic Redis image updates**, independent of PR #2377:

- Web Redis deployment `1bbd4698-b9c5-4694-903a-b4aedc5a0c27` starts 02:09:21
  and succeeds 02:09:34; the delivery admission 503 occurs 02:09:35.693.
- Admin Redis deployment `880e5110-906c-4d96-8500-7ab3c22e8adf` starts 02:11:07
  and succeeds 02:11:16. Both metadata records say `reason=autoupdate`, image
  `redis:8.10.2`. Admin logs `connect ETIMEDOUT` at 02:11:21.622.
- A bounded read-only Redis check at 02:25:27 reports 854 seconds of uptime,
  consistent with restart around 02:11:14. It disconnects afterward. Neither
  Redis deployment was requested by this task.

This proves the sampled fast playback failure path and identifies the
concurrent infrastructure restart. It does not assign all historical delays to
Redis, prove every burst request's mutation disposition, or explain the
independent PostgreSQL budget delay. The profile 503 is counted but not
independently traced. Rate limiting remains fail-closed; no queue, retry,
availability topology or provider setting was changed. Preserve the burst in
the acceptance population and investigate Redis update availability separately.

## Independent commit-path investigation

Natural commit waits remain observable with spare Admin connections. A bounded
250 ms sampler observed an episode-budget statement aged 111 ms waiting on
`WALWrite` at 01:26:08 while another commit waited on `WalSync`; eight catalog,
three workflow and one queue Admin connections were idle. The later sampler
observed a `search_trace` write aged 170 ms in `WalSync` alongside a budget wait,
then at 01:41:39 a 101 ms-old budget statement in `WalSync` and a playback commit
in `WALWrite`. Neither sample had a row/advisory lock blocker.

Statement age is not measured WAL-wait duration, and idle backends do not measure
the native pool queue. These observations do not identify the underlying storage
cause or reproduce the 701 ms incident. A narrow, indexed `search_trace` aggregate
for 01:20–01:40 found only eight rows: metadata averaged 1,426 bytes and peaked at
1,910 bytes. This does not support blaming oversized trace writes. No trace
collection, index, durability or rate-limit policy was weakened.

Slow completed budget events separately report 281 ms at 00:38:24, 203 ms at
01:33:02 and 209 ms at 01:46:16, each with function time rounding to zero. None
has a matching retained server-wait sample from these captures. The last event's
`kind=delivery` means the shared evidence capability, not a recommendation
delivery request. Do not infer an HTTP timeout or assign its remainder to WAL.

Both completed samplers stopped automatically at approximately five cumulative
seconds of observer query time. One relation capture was interrupted by the
automatic Admin rollout and left no completed artifact. In the streaming retry,
PostgreSQL `name[]` arrived as array text; the local filter mistakenly retained
extra ordinary active queries because `"{}"` is nonempty. Analysis selects actual
WAL wait names rather than treating all retained rows as waits. A kernel `wchan`
surface returned zero and was unusable; its empty capture is not evidence of no
kernel waits. At 01:44:19 the observer connection count was **zero**. Settings
were read-only and session-local; no global diagnostic settings need restoration.

## Reconciliation and unfinished acceptance

The indexed, read-only 01:20–01:45 scheduler query finds five completed batches
and five heartbeats, with 46 classifications, eight queued rebuilds and zero
reported classification failures, exhausted attempts or dispatch failures in
those batches. Starts are 306–312 seconds apart. The window spans old and new
worker revisions. The query deliberately reads completed steps only; it does
not prove absence of unfinished or failed runs and does not replace a current
pointer audit or permission-checked Admin report.

| Ticket   | Remaining acceptance                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-496 | Attribute and correct the remaining selection/commit delay; retain separate delivery-persistence evidence and sustained complete observations.  |
| feat-464 | Installed Datadog alerts/dashboard, terminal browser retry proof and complete sustained transport acceptance, including the Redis update burst. |
| feat-459 | Feat-464 dependency; authorized current-pointer and matching repair evidence below now pass for their observed snapshots.                       |
| feat-447 | Independent operational last-known-good fallback proof and feat-459 dependency; matching authorized lifecycle proof below now passes.           |

The earlier restored-snapshot performance evidence and the original 16 natural
publication-fence proofs retain their existing credit. This smaller synthetic
benchmark does not replace them or reopen completed gates. The later expanded
28-fence inventory is not a per-row proof for the additional 12 runs.

## Authenticated continuation and homepage decision

The owner completed normal Admin sign-in at approximately 02:00. The earlier
access gap is resolved. At 02:06:06 the permission-checked Recommendations view
shows a **clean current-pointer audit**, zero affected pointers, zero ineligible
contributions and zero rebuild backlog. Its rolling 24-hour panel records 187
replacement publications, eight source fences and 1,522 clean hybrid requests.
Its degraded label includes 108 terminal runs and is not a nonzero current-pointer
result. Separately, the evidence panel reports 299 committed rejections, zero
write failures, 41 replays and two selections without impressions. Those
different populations must not be equated with HTTP failures or fresh timeouts.

While the older instruction still applied, this task saved a draft removing the
homepage recommendation block. The owner then explicitly changed the instruction
to **leave the block in place behind LaunchDarkly**. The task discarded only its
own unpublished draft through Admin. A bounded read-only check at 02:06:18
confirms 14 published blocks, one `homepageRecommendations` block at
`watch-home-recommendations`, zero active drafts and unchanged canonical
timestamp `2026-09-21T21:02:14.513Z`. No publication, revalidation, flag change
or direct database mutation occurred. The flag default remains off.

The earlier canary's authorized request trace now confirms six served cards,
the selected item's impression and selection, a finalized episode with 22
facts, 75.6 seconds of active playback and a qualified active-classifier outcome
eligible for profile/aggregate use. Its later hybrid decisions remain retained,
but withdrawal has removed their projection references. Do not mistake that
privacy cleanup for a lost outcome or claim a complete retrospective feedback
ancestry trace from a now-null projection. The existing browser/SQL proof keeps
its original scope.

A fresh real Watch canary now completes the missing authorized lifecycle proof.
The source slate has six served cards; the selected Day 2 card has both an
impression and selection. Normal unmuted playback, without seeking or speed
changes, yields **32 facts, 73,780 ms active playback**, and a finalized qualified
`active-watch-proxy-v1` outcome at 02:16:02.554, eligible for profile and aggregate
use. A later request at 02:16:50.033 uses durable generation **3**, two interests
and session intent, with no active experiment assignment. Its Admin trace
names the exact earlier request as qualified feedback ancestry and reports
**hybrid personalized**, six composed playable/localized/deduplicated cards,
complete candidate evidence, 536 ms retrieval, no fallback and no shortfall.
The stored contribution independently references the exact finalized outcome.
No synthetic fact, profile or privileged principal was inserted.

The first top-level navigation suspended the episode in BFCache, correctly
leaving it unfinalized. Returning to the cached paused player and following its
normal home link produced a terminal route exit and finalization. This was
verified through actual facts, not inferred from navigation. Request identities
remain in private task artifacts; the committed artifact contains only aggregate
and version evidence. This clears feat-447's matching Admin lifecycle gate,
not its independent operational fallback or dependency gates.

The feat-459 repair trace is also now reconciled. A bounded query starts from
the latest 200 retained hybrid decisions and finds a later request using a
completed eligibility-reconciliation replacement. Original generation **4**
remains immutable and published. One of its two qualified-outcome contributions
references eligible decision revision **1**, superseded by current revision
**2** at September 21 19:36:08.775. A superseded reference is ineligible lineage
even when the replacement decision remains eligible. The completed repair at
19:36:42.119 expects pointer generation 4, publishes generation **5**, and
atomically advances the current pointer to 5. Both replacement contributions
reference current eligible revision 2; their finalized outcome watermarks match
all 48 and 27 stored facts. No outcome or impression was manufactured.

The later authorized Admin trace at September 22 00:45:44 shows generation 5,
one durable interest, six Spanish hybrid cards, 117 ms retrieval, no fallback
and no shortfall. Both qualified sources are standalone episodes, so Admin
correctly says no prior **recommendation request** contributed; that does not
mean no qualified outcome contributed. These exact-row checks and the fresh
clean authorized aggregate satisfy the matching repair/snapshot evidence gate.
They do not establish continuous zero violations or close feat-464.

Read-only Datadog access supports investigation but cannot install monitors.
No privileged principal, production failure or user evidence was fabricated.
