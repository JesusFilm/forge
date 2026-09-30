# Recommendation evidence acceptance — September 23, 2026

On **September 24**, the owner approved closing feat-464 and feat-459 for their
verified recovery and integrity scope. Remaining monitoring installation and
production telemetry/browser coverage are explicitly transferred to
[feat-545](../roadmap/content-discovery/feat-545-recommendation-monitoring-and-telemetry-closeout.md).
This is a recorded scope decision, not a claim that those requirements passed.
Downstream operational activation dependencies now point to the follow-up; no
feature flag or production configuration changes.

The observations and gate table below describe the September 23 acceptance run.
The two-hour primary playback threshold, local recovery controls and final
integrity audit passed. Required Datadog installation was blocked; the source and
natural terminal-browser coverage gaps remain as observed.

## Scope and release

Work began from `d49df4aae` and incorporated main through `396622c4f` in the dedicated
`codex/feat-464-production-acceptance-20260923` worktree. The task that shipped
[PR #2404](https://github.com/JesusFilm/forge/pull/2404) owns its immediate release
checks and the
[intermittent-evidence report](watch-intermittent-evidence-investigation-2026-09-23.md).
This record owns the longer acceptance window and additional local proof.

PR #2404 already implemented paced bounded fact/claim recovery, mandatory Redis
admission deadlines, a caller-cancellation fence, and Redis-aware Admin readiness.
Initial context issuance remains single-attempt. The existing authenticated Admin
repair proof is credited; lack of Admin/database access is no longer a blocker.

Railway reported exactly one active successful deployment per service at
**04:29:35 UTC**, all at
`37e10b622bd66e55647cf561c3896b2d4fbb4dce`:

| Service      | Deployment                             |
| ------------ | -------------------------------------- |
| Web          | `9448a080-628d-4964-ae79-81c1f920739e` |
| Admin        | `05d2971e-d42a-4f32-b91a-3c552cb44353` |
| Admin worker | `264a75df-cc73-47a9-aee1-7c336e8f986b` |

The primary environment is `5f41e037-90e4-4674-a3ea-66bbd05fb3b4` in project
`98952497-a4d9-4714-8fe8-0cdbff3147c9`. Service identities were resolved afresh.
All three actual running processes reported that revision at 05:30:31 UTC.
Deployment snapshots at 05:30:31 and 06:30:57 still show one active successful
deployment and one running instance per service. The prior Web deployment's
last retained recommendation request was 04:27:30.079 UTC; a bounded anchor read
covering the lower boundary found **zero overlapping requests** in our window.
At 06:39:32/36, direct read-only Admin/worker `/api/health` probes returned
HTTP 200, `status=ok`, in 37.0/48.5 ms, including the bounded Redis PING.
The [release record](watch-intermittent-evidence-investigation-2026-09-23.md#production-rollout)
retains the earlier promotion/health evidence. No manual deployment, production
mutation, production fault injection, or support contact was used.

## Fixed production window

The completed interval is **04:30:00 inclusive–06:30:00 exclusive UTC on
September 23**. The [sanitized collection](../validation/evidence-acceptance-20260923/README.md)
retains slice coverage, exact deployments, guards and source-specific counts.

Primary Railway HTTP edge records supply request denominators. Exact paths are
queried explicitly: `@path:/watch/api/recommendations` does **not** include child
routes. Five-minute anchor intervals subdivide when retained rows do not cover
the lower boundary. Rows are clipped to the half-open interval and checked for
deployment, path, method and duplicate IDs. Only counts and an ID-set digest are
published. All source slices cover the interval without unresolved result caps.

| Primary route / method |   200 | 400 | 401 |   403 | 409 | 499 | Total |
| ---------------------- | ----: | --: | --: | ----: | --: | --: | ----: |
| Delivery POST          |   490 |   0 |   0 |   603 |   0 |  20 | 1,113 |
| Playback POST          | 4,054 |   1 |   3 |   646 |   2 |  10 | 4,716 |
| Selection POST         |    13 |   1 |   0 |     0 |   0 |   0 |    14 |
| Initial evidence POST  | 1,436 |   6 |   6 |   681 |   0 |  37 | 2,166 |
| Profile POST           |   878 |   0 |   0 | 1,426 |   0 |  22 | 2,326 |
| Availability GET       |   153 |   0 |   0 |     0 |   0 |   0 |   153 |
| Content actions POST   |     1 |   0 |   0 |     0 |   0 |   0 |     1 |

Eight additional playback **GETs returned 405**, bringing all explicit
recommendation-path requests to **10,497**. No route above has a 5xx. The playback
POST gate is **0 / 4,716 = 0%**, below 1%. Deliberate production fault injection
and corresponding exclusions are both **zero**. Crawlers remain in the denominator;
this is not a human-only rate. The eight GETs are outside the POST denominator.
HTTP 499 means the origin recorded a client-closed request; it does not prove that
Admin aborted or that no write committed.

### HTTP, application outcomes and durable units

Web and Admin Railway outcomes agree on **3,521 accepted fact batches, eight
all-replay batches and 256 accepted claims**. Web also records 279 contexts. Their
**4,064** successful playback envelopes equal 4,054 edge HTTP 200 plus ten HTTP
499 in aggregate. This is numerical reconciliation, not a trusted per-request
join or proof that those ten clients received acknowledgements. All other playback
statuses match the normalized outcome counts: one invalid request, three forbidden,
646 admission rejections and two terminal binding failures.

Of the 646 playback 403s, **351** are recognized-crawler rejections and **295**
are other forbidden admission. Initial evidence adds **681** recognized-crawler
403s. There are **1,032 recognized-crawler rejections and zero logged recognized-
crawler successes** across these actions; arbitrary undetected automation is not
covered. The two Admin `invalid_binding` outcomes (one claim, one fact batch)
match two Web terminal HTTP 409 envelopes and two primary HTTP 409s.

Initial evidence has **1,472** Web successes, exactly matching **1,254 render +
218 impression** committed audits. Primary HTTP has 1,436 successes and 37 client
closures: successes plus closures exceed logged successes by **one**. The cause
and disposition of that one-request gap are unproven. All 693 initial-evidence
400/401/403 responses reconcile by reason. Selection has 13 successes, 13 resolved
Admin operations and 13 committed selection audits, plus one terminal invalid
request. There are **zero observed selection HTTP 5xx/timeouts** in this window.
Profile counts are retained without claiming profile-envelope reconciliation.

Delivery has **510** Web HTTP-200 semantic envelopes: **403 served**, **55
no-candidates fallbacks**, **32 seed-embedding-unavailable fallbacks**, and **20
admission fallbacks** (15 session-hour, four cooldown, one in-flight). These equal
490 edge HTTP 200 plus 20 HTTP 499 in aggregate. PostgreSQL retains **490 issued
requests**: 403 served, 55 empty/no-candidates, 20 fallback/seed-unavailable and 12
empty/seed-unavailable. The remaining 20 envelopes are admission fallbacks without issued durable
requests. There are **zero `delivery_timeout` and zero `retrieval_timeout` semantic
fallbacks**; HTTP 200 alone is not the criterion. The 603 delivery 403s split into
391 invalid-fetch-metadata and 212 invalid-origin rejections.

Admin's served runtime cohort has 403 completions, p50 **244.693 ms**, p95
**455.381 ms**, maximum **1,402.637 ms**. All 510 seeded operations have measured
elapsed time and `timeoutFallback=false`. The earlier baseline's p95 was
383.810 ms for 143 completions; unequal workloads do not prove either regression
or unchanged performance. No frontend runtime code changes in this continuation.

### Telemetry gaps and browser disposition

The exact primary hosts' indexed Datadog logs contain **3,513 Web / 3,516 Admin**
accepted fact batches, respectively eight/five fewer than Railway's 3,521. Indexed
Web crawler playback rejections are 350, one fewer than Railway. Claims, replays
and both binding failures match. These are retained index/source gaps, not proof
of dropped durable facts; no transport mechanism is attributed without evidence.
Datadog's trace metric lacks an independent Railway environment dimension in this
access path and is not used as the primary denominator.

The primary-host [retained browser sample](../validation/evidence-acceptance-20260923/rum-final.json)
contains **1,933 resources**: 1,871 HTTP 200, 30 HTTP 403, 28 status-zero transport
observations, two HTTP 204, one HTTP 400 and one HTTP 503. Grouped counts equal the
ungrouped total, with no missing status field. Neither production HTTP 409 appears
in retained RUM, so this interval **cannot verify those two browsers stopped
retrying**. The earlier September 22 bounded production non-retry observation
retains credit; the new local terminal control below adds independent proof.

The [HTTP 503 observation](../validation/evidence-acceptance-20260923/rum-interim-discrepancy.json)
is on `www.jesusfilm.org` at **04:54:50.312 UTC**, duration **3,160.7 ms**, browser
release `37e10b622`. It has no trusted join to the zero Railway 5xx population.
Its inspected view has no additional retained playback resource in 04:53–05:00;
that does not establish durable disposition or subsequent recovery. The two RUM
204s also have no matching primary POST status group. Keep these discrepancies;
do not infer a Redis/edge cause or classify the browser as a recognized crawler.

## Additional local proof

The existing real Redis/PostgreSQL/Yoga fixture now has a regression for a client
that disconnects while Redis admission is pending and recovers **before** the
500 ms store deadline. The test observes the actual queued Redis GET, aborts the
HTTP request, drains Redis after recovery, and asserts no resolver call or fact.
All eight tests passed in 10.31 seconds. Recovery in this case took 107 ms.

The negative control removed only the post-admission abort check in the owned
checkout. The new regression failed because the resolver executed once. The
production implementation was restored immediately. This proves the test detects
the cancellation fence rather than passing because the admission deadline expired.

A joined Chrome → production Next Web → production Next Admin → PostgreSQL
fixture passed all eight scenarios with separate owned Web/Admin Redis instances. The
page shell and player are synthetic; routes, consumer-bearer authentication,
signed capabilities, migrations, and databases are real. It is not a complete
Watch/Mux media lifecycle or an Admin OAuth reproduction.

The [browser observations](../validation/evidence-acceptance-20260923/browser-stack.json)
were captured at 04:49:27.231 UTC before component unmount. Each retry retained
its event IDs and exact original payload; stored digests matched the canonical
originals. Sequences were contiguous, browser receipts matched stored sequences,
and each accepted event had one fact. The player clock advanced in every case.

| Scenario                         | Initial fact attempts | Initial facts accepted | Facts / replays before unmount | Result                                                              |
| -------------------------------- | --------------------: | ---------------------: | -----------------------------: | ------------------------------------------------------------------- |
| Healthy                          |                     1 |                      2 |                          3 / 0 | Accepted                                                            |
| Lost acknowledgement             |                     2 |                      2 |                          4 / 2 | Exact replay, one write per event                                   |
| Redis disconnect for 8 seconds   |                     3 |                      2 |                          4 / 0 | 503, 503, 200                                                       |
| Redis silent stall for 8 seconds |                     3 |                      2 |                          4 / 0 | 503, 503, 200                                                       |
| Terminal binding rejection       |                     1 |                      0 |                          0 / 0 | One 409; no further fact attempts for 22 seconds                    |
| Redis unavailable for 25 seconds |                     3 |                      0 |                          2 / 0 | Original events dropped after exhaustion; later new events accepted |
| Claim disconnect for 8 seconds   |                     1 |                      3 |                          4 / 0 | Claim 503, 503, 200; same nonce and one episode                     |
| Lost claim acknowledgement       |                     1 |                      2 |                          4 / 0 | Claim 200, 200; same nonce and one episode                          |

The lost-acknowledgement controls destroy the actual browser socket after a
successful upstream commit. Chrome transparently retries before JavaScript sees
a network error; this proves durable replay, not a JavaScript retry in that case.
The disconnect/stall cases separately exercise the recorder's paced retry path.
The exhaustion case reports `transport_exhausted`, stops retrying its original
events, and advances the synthetic player by 35 seconds.

The [post-unmount SQL snapshot](../validation/evidence-acceptance-20260923/local-durable.json)
at 04:50:32.955 UTC again passes all eight episodes' fact/sequence counters,
replay ordinals and receipt-to-original capability/digest joins. Its counts include
later departure events and therefore exceed the earlier browser snapshot. The
three owned containers and both Next process groups were removed after capture.

Fixture preparation findings are retained rather than credited as product defects:

- `prisma db push` omitted migration-owned submission-budget functions; a fresh
  disposable database using the full migration history resolved this.
- Next development mode exercised development fallback behavior. Accepted outage
  proof must use production builds and assert actual failure before recovery.
- Chrome can retry a dropped socket after commit before JavaScript sees a network
  error. Server attempts and durable replay receipts are necessary to observe it.
- Fractional numeric JSON can round-trip differently through Prisma/PostgreSQL
  (for example, `20.000000000000014` becomes `20.00000000000001`). This matches the
  [earlier bounded numeric audit](recommendation-evidence-production-integrity-2026-09-10.md).
  It does not authorize changing digests or relaxing exact incoming replay checks.

The accepted exact-payload fixture uses exactly representable binary fractions
and a 128-second player duration. The decimal diagnostic is excluded from that
pass claim. This continuation changes only regression coverage and documentation;
it changes no rendered page, hydration, media, routing or initialization code, so
the local fixture timings are not presented as a Watch page-load benchmark.

## Integrity and authenticated Admin evidence

At **04:13:58.874 UTC**, the complete canonical current-pointer predicate scanned
**178,651 pointers with zero ineligible** in one repeatable-read, read-only
snapshot on the deployed Admin revision. It used 91 cursor fetches, completed in
7.93 seconds, and had a maximum fetch time of 518 ms. The full predicate from
`profile-lineage.ts` was unchanged. Each statement was limited to five seconds,
lock waits to 500 ms, and the overall audit to 120 seconds; the transaction was
rolled back explicitly. The final **06:30:25.234 UTC** canonical snapshot scanned
**179,054 pointers with zero ineligible**, again in 91 complete cursor fetches.
It took 5.975 seconds, with a maximum fetch of 379.715 ms. Neither audit substitutes
a simplified eligibility predicate or a sampled population.

The authenticated production Recommendations page's fresh **06:31:39.762 UTC
database probe** reports a **clean** current-pointer audit: zero affected pointers,
ineligible contributions, rebuild backlog and stale/reclaimed runs. Its rolling
window has 207 replacement publications, 97 terminal runs and a broader
**degraded** reconciliation status. The selected 24-hour evidence view remains
**loss suspected**, with 144 committed rejections, zero write failures/conflicts,
48 replays and four selections without impressions. Preserve these labels; they
are not the fixed two-hour acceptance population.

At the **06:31:18.513 UTC** read-only snapshot, the window's **292 newly created
episodes** comprise 175 claimed, 81 finalized and 36 pending. They have **4,422
facts at the snapshot**, of which **4,372 arrived in the fixed window**; 50 arrived
after its end. Their 93 replay receipts have contiguous ordinals and match original
fact capability/digest bindings. All fact counters/sequences are contiguous and
there are zero recorded conflicts, finalization failures or finalization jobs more
than ten minutes overdue. All **81 finalized latest active-watch-proxy-v1 outcomes**
match the fact watermark and episode generation, with no missing or pending update.
There are 218 retained outcome revisions across the cohort.

The separate receipt-time population has **4,703 facts**, including **331 from
older episodes**, and **101 replay receipts**, including **eight from older
episodes**. It has zero late facts and zero receipt binding/digest mismatches.
These are event/receipt counts, not HTTP requests or accepted batches. No raw
viewer/event/episode IDs, capabilities or playback histories are exported.

The workflow ledger has **23 completed batches and 23 committed heartbeats**,
matching 23 completed worker log heartbeats. Durable heartbeat intervals range
**308.167–313.777 seconds**. Batches attempted 50 classifications and found 14
affected-pointer occurrences, queuing 14 rebuilds; classifications, dispatches,
stale/exhausted attempts, unavailable heartbeats and unexpected step statuses all
have zero failures. Thus the final clean audit is convergence evidence, **not a
continuous-zero claim**. The older September 7 queued ledger is reported separately
from the active scheduler, whose latest window batch completed at 06:26.

Admin logs record transient fact transaction retries at attempt one (46) and two
(six); worker finalization retries occur at attempts one (13), two (one), and three
(one). No exhausted transaction, replay-receipt collision or Redis admission/
offline-queue failure signature is observed in the bounded primary logs. This
supports the observed healthy period and does not constitute a production outage
recovery experiment.

## Monitoring gate

The single policy recheck returned:

> MCP write operations are disabled for org 678835 (Jesus Film Project).

The complete visible monitor inventory contained 41 monitors across two pages;
none matched the required recommendation evidence definitions. The only Forge
monitor was an unrelated TV intake monitor. The recommendation dashboard search
returned no result. No alternate write path was attempted.

The six definitions under `infra/datadog-monitors/recommendation-evidence/`
remain unverified as installed and lack a configured notification destination.
Completion requires the organization's permitted write access, the intended
destination, installation, and read-back verification. Both feat-464 and feat-459
remained in progress at the September 23 audit. The September 24 owner decision
transfers this unmet gate to feat-545; it does not claim installation.

## Causes and limits

The Redis admission and retry-horizon mechanisms demonstrated for PR #2404 are
credited. This continuation adds evidence, not another application fix. Historical
selection HTTP timeouts and the 1.19-second evidence write remain unexplained by
this work; feat-496 stays closed as its bounded investigation.

Playback transport failures, selection HTTP failures, HTTP 200 semantic
`delivery_timeout` fallbacks, and terminal crawler/binding/privacy rejections are
separate populations. Historical crawler contamination cannot be relabeled
without retained trusted linkage. Local fault controls do not manufacture natural
production outage or terminal-rejection coverage.

## Acceptance disposition and validation

| Gate                                                                            | Disposition                                                                                                |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Exact deployed revision and bounded Redis readiness                             | Passed for Web/Admin/worker release; point checks and natural traffic retained                             |
| Minimum two hours, primary playback 5xx below 1%                                | Passed: 0/4,716 POSTs, zero fault exclusions                                                               |
| Local disconnect/stall, exhaustion, early cancellation and lost acknowledgement | Passed with real dependencies; browser shell/player limits stated                                          |
| Durable receipt/sequence/outcome consistency and final canonical audit          | Passed for explicit populations; 179,054 pointers clean                                                    |
| Scheduler cadence and no observed collision/exhaustion/crawler success          | Passed within bounded retained evidence; no continuous-zero or unknown-bot claim                           |
| Every natural terminal response stops browser retry amplification               | Coverage gap: both new 409s lack retained browser resources                                                |
| Complete operational/client/durable reconciliation                              | Partial: aggregate joins above; one initial-evidence gap, RUM/origin discrepancies and indexed gaps remain |
| Actionable installed monitors and dashboard                                     | Blocked by organization MCP-write policy and missing destination/verified installation                     |

Validation passed: eight real Redis/PostgreSQL/Yoga cases, a failing negative
control without the caller-abort fence followed by a restored passing run, eight
joined browser cases with SQL checks, full Admin typecheck, focused ESLint,
production Web/Admin fixture builds, formatting, roadmap lint/generation, and
sequential correctness/testing/standards/privacy review. Roadmap generation's
unrelated catalog churn was discarded. The review found no additional demonstrated
application defect to fix. The durable learning records fixture and evidence
boundaries. Both tickets remained **in progress** when these observations were recorded.
The September 24 owner-approved scope transfer above now closes them and preserves
the remaining work in feat-545.
