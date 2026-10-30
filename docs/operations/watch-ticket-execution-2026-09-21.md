# Watch ticket execution — September 21, 2026

## Result and scope

This continuation fixes three proven evidence defects and clears the fresh
current-pointer integrity audit. It does **not** establish a cause or correction
for the remaining selection delay. No broader reliability ticket is closed on
the strength of successful navigation, HTTP 200s or a short healthy window.

The [64-hour corpus review](watch-recommendation-corpus-review-2026-09-21.md)
remains the sustained baseline. Work used an owned worktree created from freshly
fetched main `48f4fb3202f5d3c78a758584a6ea3d328d9b8842`, then incorporated each newer
main revision before merging. No other agent's worktree or service was changed.

## Proven corrections

| Correction                                           | Evidence and validation                                                                                                                                                           | Release                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Separate semantic delivery outcomes from HTTP status | Test-first final-response instrumentation; 54 focused tests; 4,438 full Web tests, lint and types                                                                                 | [PR #2352](https://github.com/JesusFilm/forge/pull/2352), merge `4e31f822781f44df06e91c8194142a6c4b51646a` |
| Count actual hybrid execution                        | Impossible `lane='hybrid'` counted zero; production had 3,508 clean hybrid decisions. Real PostgreSQL regression fails before and passes after the valid lane/execution predicate | [PR #2353](https://github.com/JesusFilm/forge/pull/2353), merge `6e02dd855af4053d9c9a7b032fe1ece7317cfc33` |
| Keep terminal capability observations terminal       | Typed token rejection was incorrectly logged as retryable unknown; regression preserves the identical thrown error and infrastructure-error control                               | Same Admin PR; 42 focused tests; final 7,281 Admin tests, six PostgreSQL/overview tests, lint and types    |

Both PRs passed CI and sequential Compound Engineering review. The Admin
PostgreSQL regression runs in the existing CI database entry point. There is no
workflow, migration, deadline, retry, admission, ranking or rollout change.
The independently committed atomic capability budget is untouched.

The complete [canonical profile audit](watch-profile-audit-2026-09-21.md) checked
**167,029 live current pointers, zero ineligible**, in one read-only repeatable-read
snapshot. Eighty-five cursor fetches retained the full canonical lineage
predicate and five-second statement guard; maximum fetch 320 ms, total 5,063 ms.
It cleared the missing invariant snapshot, not the separate alerts or browser
lifecycle gates.

## Separate production populations before deployment

Primary `trace.web.request.hits`, service `forge-web`, environment `prod`, fixed
window **September 20 20:50–22:30 UTC**, grouped by exact resource and HTTP status:

| Endpoint        |   200 | 400 | 401 | 403 | 409 | 5xx |
| --------------- | ----: | --: | --: | --: | --: | --: |
| Seeded delivery |   848 |   0 |   0 | 390 |   0 |   0 |
| Selection       |     8 |   0 |   0 |   6 |   0 |   0 |
| Evidence        | 2,468 |  14 |   0 | 877 |   0 |   0 |
| Playback        | 6,989 |   0 |   3 | 505 |   2 |   0 |
| Profile         |   892 |   0 |   0 | 725 |   0 |   0 |

These are requests, not people. Rejected traffic is explicit. The six automated
card clicks described below coincide with the six selection 403s; no individual
identity join was performed. The semantic `delivery_timeout` population in this
pre-instrumentation window remains **unknown**. The absence of HTTP 5xx cannot
substitute for it or establish recovery from eight selection HTTP 200s whose
browser acknowledgment bodies were not independently validated.

## Database, pool and scheduling remain separate

A bounded independent observer sampled `pg_stat_activity` 100 times, every
200 ms, at **22:17:31.331–22:17:51.731 UTC**. No sampled query had blocking PIDs.
No capability-budget call was captured. The largest sampled catalog query age
was 197.451 ms with `IO/AioIoCompletion`; sampled profile and other `WalSync`
query ages were 1.214 and 0.742 ms. These are **query ages**, not measured wait
durations. None of the observer's queries took over 100 ms.

This 20-second sample does not measure application pool acquisition or scheduling,
does not capture the earlier failing selection, and cannot exclude intermittent
storage stalls. A later read-only catalog check found `pg_stat_statements` absent;
no extension or server setting was installed. The earlier capability-budget
spans and WAL observation remain hypotheses, not a causal reproduction. No
selection runtime correction is justified by these new samples.

## Browser evidence and limits

Six fresh default Chromium contexts exercised `/watch`, `/watch/jesus.html`,
French prayer, Spanish sower, Chosen Witness with `autoplay=1`, and a mobile-size
homepage. Locale/timezone controls included US, France, Mexico and New Zealand.
All document responses were 200 and no page error appeared in the six-second
observation periods. FCP was 488–904 ms; TTFB 205.6–588.7 ms. These are individual
automated samples, not field percentiles or a before/after performance claim.

Four delivery envelopes were observed: three served six cards; the French route
returned six cards with the non-timeout `seed_embedding_unavailable` fallback.
Neither homepage probe issued the authored homepage row request. The authored
English block remains removed and its flag remains default off.

A separate six-click default headless Chromium batch at **22:16:48–22:17:33 UTC**
received six selection **HTTP 403s**. Navigation proceeded, but response bodies
were unread after navigation aborts, so there were **zero validated selection
acknowledgments**. Its 12 delivery envelopes were HTTP 200, served six cards and
had no semantic fallback. Do not classify these 403 rejections as Admin
503s or use the navigations as an API success test. No admission bypass or
user-agent spoof was used.

Field hydration remains active: ordinary-browser-named RUM includes Safari
`/watch` text mismatches at 21:52:58 UTC and Mobile Safari French-route mismatches
at 21:37 UTC. These are browser labels, not proof of human traffic. Retained
stacks terminate in React framework frames without a component/server-client
diff. The Chromium probes did not reproduce them. No UI patch or warning
suppression is justified. Native commit/paint causes still need their own trace.

Six equivalent fresh WebKit 2311 contexts also returned document HTTP 200 with
no page error. FCP was 528–851 ms and TTFB 237–508 ms; the same French
`seed_embedding_unavailable` fallback appeared, with six cards. Libraries were
downloaded and extracted only under the owned worktree, and the owned browser
wrapper preserved that local library path. No host packages were installed.
This Linux Playwright engine is not a physical Safari reproduction, and no
selection acknowledgment or complete personalized lifecycle was exercised.

After Web revision verification, the same six-route Chromium check again had
six document HTTP 200s, no page errors, three six-card served envelopes and the
same six-card French coverage fallback. FCP was 560–1,004 ms and TTFB
257.7–706.3 ms. Network/cache conditions were not a matched performance
experiment; these observations do not prove a speedup or a regression.

## Exact deployment verification

Railway reported success, and independent runtime environment reads confirmed:

| Service      | Running revision                           | Deployment                             | Runner role    |
| ------------ | ------------------------------------------ | -------------------------------------- | -------------- |
| Web          | `4e31f822781f44df06e91c8194142a6c4b51646a` | `b7b5ed70-a43a-4611-ba42-b5bbdd989a07` | Not applicable |
| Admin        | `6e02dd855af4053d9c9a7b032fe1ece7317cfc33` | `3f1539af-b0c6-4aa5-81fb-ba946fecf535` | `false`        |
| Admin worker | `6e02dd855af4053d9c9a7b032fe1ece7317cfc33` | `ce068d16-7e44-45bb-887f-bf9987993248` | `true`         |

The Web release merged at 22:18:42 UTC; the Admin release merged at 22:39:25 UTC.
Automatic build/deployment completion is distinct from those merge times.
No manual redeploy was triggered.

At **22:49:19.903 UTC**, a bounded read-only PostgreSQL check from the exact new
Admin revision still found 3,508 clean, unexpired hybrid-execution decisions in
the fixed review window. This verifies the predicate's underlying population,
not a new full Admin UI lifecycle test. Natural accepted facts were logged on
the new revision at 22:49:02 UTC. Invalid-capability classification is proven by
the failing-then-passing regression and deployed code; do not infer that a short
window necessarily exercised that particular error branch.

## Reconciled release window and a separate playback failure

For **22:42–22:50 UTC**, exact Web revision `4e31f8227...` has **84 indexed
delivery events and 84 primary seeded-delivery requests**, matching separately
at **62 HTTP 200 and 22 HTTP 403**. Environment/revision were verified in the
actual log `@ddtags` field; a bare `env:prod` log filter falsely returned zero.
The [event procedure](watch-delivery-outcome-observation-2026-09-21.md) includes
the tested query and the non-durable forwarding caveat.

- 53 ordinary served responses had six cards; six served responses had one,
  two or five cards.
- Three HTTP 200 responses had six cards with
  `fallback / seed_embedding_unavailable`.
- Zero `delivery_timeout` or `retrieval_timeout` envelopes occurred in these
  62 HTTP 200s. There were no delivery 5xx, empty or unavailable outcomes.
- The 22 HTTP 403s were 21 `invalid_fetch_metadata` and one `invalid_origin`.
- Selection had two HTTP 200s and no 5xx in this window. Their browser bodies
  were not independently validated. No `for-you` traffic exercised its observer.

Playback separately recorded **one HTTP 503 / 800 primary requests (0.125%)**:
766 HTTP 200, one 400, one 401, 30 403, one 409 and one 503. No deliberate
fault-injection traffic was excluded; the denominator includes rejected traffic.
At **22:48:27 UTC**, trace `2812671347123689187` completed Web in 46.6 ms after
an upstream `fetch failed` in 42.7 ms, logged as
`upstream_unavailable / timeoutStage=none`. No Admin span is returned for that
trace. This is a fast transport failure, not a 700 ms selection timeout or a
semantic delivery fallback. It overlaps Admin deployment, but the trace does
not prove the transport's underlying cause or that Admin never received it.
Keep it in the failure numerator; do not add an ambiguous mutation retry.

On exact Admin revision `6e02dd855...`, the **22:48–22:50** indexed evidence
population contains 164 accepted facts, one idempotent replay, one terminal
invalid-request rejection and 13 accepted claims. Four `transaction_busy`
attempt-one observations correlate to three accepted requests and one
idempotent replay, all Web HTTP 200. They are recovered attempts, not exhausted
transactions or the separate transport 503. A natural terminal event at
22:49:38, trace `3657218728632951387`, agrees with GraphQL `BAD_USER_INPUT`
(16.0 ms mutation); the masked response does not reveal the exact typed cause.

This short release window verifies instrumentation and ordinary operation. It
does not satisfy sustained reliability, field rendering, full personalized
lifecycle, installed alerts or the unproven selection-delay cause.

## Reconciliation scan failure discovered during monitoring

The worker's first observed new-revision heartbeat at **22:52:48 UTC** was
`unavailable`. Focused children of trace `4459174987863152105` identify repeated
failures in `stepRunRecommendationProfileReconciliation`: the unchanged
interactive transaction expired at 5,182 and 5,371 ms against its 5,000 ms limit.
These are substantive batch failures, not expected workflow sleep/suspension
spans. The scheduler remained alive and emitted `completed` at **22:58:17 UTC**.
That next success does not erase the failed batch.

The exact affected-pointer SELECT was reconstructed from the checked-in canonical
lineage helper and the scheduler query, including the active-run exclusion,
session-link lookup, deterministic ordering and 100-result limit. Production
diagnostics were sequential, read-only, guarded at five seconds, and rolled back
after each case. No profile identifiers or returned rows were exported.

| Control                                              | Observation                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Original `EXPLAIN ANALYZE`, JIT on/off/on/off        | On cancelled twice at the five-second guard. Off completed once in 4,555 ms and cancelled once            |
| Materialized affected-pointer candidate              | Off took 4,842 ms; on cancelled. Rejected as a reliable correction                                        |
| Reuse already-joined generation metadata             | Instrumented execution 3,756/3,930 ms; avoids two repeated generation lookups but retains the global scan |
| Direct SELECT, original/candidate/original/candidate | 4,187 / 3,492 / 4,258 / 3,835 ms; all returned zero in this later population                              |

`EXPLAIN ANALYZE` adds instrumentation overhead; the separate direct reads are
the request-time control. All listed wall times are bounded samples, not latency
percentiles. Live populations changed between snapshots: an earlier diagnostic
returned two affected candidates before the completed heartbeat. Zero later
candidate rows exclude active rebuilds and are not a replacement for the full
current-pointer invariant audit.

The plan sorts current pointers and performs correlated lineage checks across
roughly 167,000 pointers when few are invalid; `LIMIT 100` bounds returned work,
not scanned work. The diagnostic performed millions of shared-buffer accesses.
The generation-reuse candidate improves these samples but does not prove the
complete transaction survives representative competing workload or preserve
all invalid-lineage cases through a regression fixture. It was **not shipped**.
JIT changes and materialization were also not shipped. No setting persisted.

The next feat-459 work is a production-shaped regression for the sparse-invalid,
large-pointer population, then a query correction with full canonical-predicate,
ordering, concurrency and lifecycle parity. Preserve the five-second budget and
serving fences. This identifies concrete reconciliation work; it does not prove
that this worker scan caused the earlier Admin selection timeouts.

## Ticket disposition

| Ticket                                        | Disposition                | Remaining evidence or action                                                                                                                                   |
| --------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform 513, 516, 517; content-discovery 515 | Keep complete              | Their specific shipped fixes were independently verified; this continuation does not reopen them                                                               |
| 496                                           | Keep in progress           | Causal selection-delay reproduction; sustained reconciled semantic delivery outcomes                                                                           |
| 464                                           | Keep in progress           | Install and verify required alerts; classify remaining transport failures; reconcile full lifecycle evidence                                                   |
| 459                                           | Keep in progress           | The timestamped full audit passed; a later reconciliation batch exceeded its transaction limit, and dependent 464 gates remain                                 |
| Content-discovery 470                         | Keep in progress           | Retrieval repair is in deployed code; complete post-deploy semantic timeout/fill evidence still needed                                                         |
| 447                                           | Keep in progress           | Full eligible browser → finalized outcome → updated profile → later recommendation/Admin lineage journey                                                       |
| 523                                           | In progress                | Remaining text/HTML variants lack causal component and server/client differences                                                                               |
| 520 / 521                                     | Investigation remains open | Representative non-headless paint trace / matched native commit-wait control; 403 probes do not exercise successful selection acknowledgments                  |
| 497                                           | Keep not started           | Expansion requires curation import/promotion, outside this session's explicit no-republishing boundary                                                         |
| 396                                           | Keep not started           | Full privacy, retention, outage, load and capacity drills plus upstream dependencies; normal zero root deletion before first expiry is not a retention failure |

Existing Datadog read access supports inspection and reconciliation. It does not
install monitors. The owner requested continued use of that read access; no new
credentials, alert recipient or notification destination was chosen. No Google
Analytics access was available, so this report claims only Datadog and PostgreSQL
evidence.

## Diagnostic and review record

All production SQL diagnostics were bounded and read-only. Transaction-local
settings ended with explicit rollback and connections closed. No inspector,
runtime monkeypatch, persistent setting, database mutation or manual deployment
was used. Application releases went through PR-to-main automation.

The isolated database fixtures used the owned `codex-watch-q6m-postgres` container,
never another agent's database. Its ownership labels were verified and that
container alone was removed after the database tests completed. Browser contexts
closed in `finally`; extracted libraries remain only in the ignored worktree
scratch directory.

Durable learning: [Recommendation outcome accounting boundaries](../solutions/logic-errors/recommendation-outcome-accounting-boundaries-20260921.md).
The overall [execution plan](../plans/2026-09-21-watch-ticket-completion-plan.md)
remains active while the gates above remain unmet.
