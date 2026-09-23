# Recommendation evidence acceptance — September 23, 2026

Feat-464 remains **in progress**. Required Datadog monitors and the dashboard
cannot be installed through the available organization policy. This continuation
does not waive that gate or enable profile ranking, experiments, or promotion.

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
Admin's actual running process also reported that revision. No manual deployment,
production mutation, production fault injection, or support contact was used.

## Fixed production window

The coordinated acceptance window is **04:30:00 inclusive–06:30:00 exclusive
UTC on September 23**. Collection is pending completion of that interval.

Primary Railway HTTP edge records supply request denominators. Exact paths are
queried explicitly: `@path:/watch/api/recommendations` does **not** include its
child routes. Collection uses five-minute anchor intervals, subdividing if the
oldest returned row does not cover the lower boundary. Rows are clipped to the
half-open interval and checked for deployment, path, method, and duplicate request
IDs. Only aggregate counts and a request-ID set digest are published.

Datadog's `trace.web.request.hits` does not provide a Railway environment
dimension in this access path. It is a corroborating source, not an independently
scoped primary-environment denominator. Structured Web outcomes, Admin outcomes,
durable facts, and replay receipts use different units and are reported separately.
HTTP 200 does not by itself prove durable acceptance or browser acknowledgement.

The interim 04:30–05:00 primary HTTP collection contains **0 / 1,795 playback
5xx**, with 1,621 HTTP 200, one HTTP 401, 171 HTTP 403 and two HTTP 499. Web and
Admin logs each contain 1,439 accepted fact batches, four replay batches and 90
accepted claims; Web also records 90 accepted contexts. These are interim counts,
not the completed two-hour gate.

Separately, [sampled browser telemetry](../validation/evidence-acceptance-20260923/rum-interim-discrepancy.json)
reports one playback HTTP 503 on `www.jesusfilm.org` at **04:54:50.312 UTC**, with
3,160.7 ms duration and browser release `37e10b622`. There is no trusted request
join to the zero Railway 5xx population. Its inspected view has no additional
retained playback resource in 04:53–05:00, which is insufficient to establish
durable disposition or subsequent recovery. Do not discard this observation,
infer a Redis/edge cause, or reclassify it as recognized crawler traffic.

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
rolled back explicitly. A final post-window audit remains pending.

The authenticated production Recommendations page was observed at its
**04:31:17.329 UTC database probe**. It reported a clean current-pointer audit:
zero affected pointers, ineligible contributions, rebuild backlog, and stale
runs, with 204 replacement publications in its rolling window. It also reported
100 terminal runs and a broader **degraded** reconciliation state. The selected
24-hour evidence view showed **loss suspected**, 144 committed rejections, zero
write failures, and zero conflicts. These rolling-window labels are preserved;
they are not the fixed two-hour acceptance population.

The current scheduler's committed batch and heartbeat outputs can be decoded
from PostgreSQL's workflow ledger. Its latest inspected batch at 04:27:24 had
zero classification failures, dispatch failures, stale runs, or exhausted
attempts. An older queued ledger from September 7 remains distinct from the
active scheduler. Final interval accounting remains pending.

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
must remain in progress while this mandatory gate is unmet.

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
