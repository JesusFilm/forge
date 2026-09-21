# Watch closeout release — September 21, 2026

The reproduced reconciliation scan correction is deployed; all 24 batches in
the two-hour observation complete without recorded failures. The deployed ANN retrieval repair now has complete delivery
outcome coverage and closes content-discovery feat-470. The historical selection
stall, remaining browser causes and explicit operational/Admin gates stay open.

## Reconciliation correction

PR [#2356](https://github.com/JesusFilm/forge/pull/2356) merged at
00:04:34 UTC as `de752d60980b25ee11806f2c424770fc78027188`. Main was freshly
fetched before merging; it still matched the validated base `7b39077634b72866f281842cb05f2018d535429e`.
Required PR checks, Admin tests/build/lint, schema drift including PostgreSQL
integration, formatting and CodeQL passed. The change received sequential
Compound Engineering review under the repository's Codex tool mapping.

The original sparse-invalid discovery scan repeated canonical lineage checks
across approximately 167,000 current pointers. `LIMIT 100` bounded its output,
not its work. The real PostgreSQL service regression expired at 5,033 ms before
the change and completed in 1,664 ms afterward. The fix materializes invalid
generations and their affected current pointers before ordering/limiting, shares
the canonical eligibility rules, and disables JIT only within the transaction.
It preserves the five-second transaction budget, source cap, advisory lock,
active-run fence, classification and dispatch behavior. The
[causal experiment and regression evidence](../solutions/performance-issues/profile-reconciliation-sparse-invalid-scan-20260921.md)
include rejected plans and competing reads/writes.

At 00:14 UTC, Railway reported successful automatic deployments and independent
SSH reads confirmed the exact running revision:

| Service               | Deployment                             | Revision / runner                                        |
| --------------------- | -------------------------------------- | -------------------------------------------------------- |
| Admin                 | `6c93246f-8587-46e6-9209-46c8e8c6ddf2` | `de752d60980b25ee11806f2c424770fc78027188`, runner false |
| Recommendation worker | `d8b284e6-c8e9-46ad-8285-ad851347590a` | same revision, runner true                               |

Web correctly skipped the Admin-only release and retains the previously verified
`4e31f822781f44df06e91c8194142a6c4b51646a`. No direct deployment or manual
redeploy occurred. The shared Railway CLI login was left untouched; the owner's
Forge-scoped token supplied read-only deployment access.

## Current-pointer convergence

All audits use the complete canonical `profileLineageEligibleSql` expression in
one repeatable-read, read-only snapshot. The current source SHA-256 is
`bc328aa49b76ff2f4bd9af60388ef6e1324b92b772018513c3593f25bb7092b3`.
The cursor returns only eligibility booleans, uses 2,000-row fetches and must
reach its empty final fetch. Guards remain five seconds per statement, 500 ms
for lock waits, ten seconds idle in transaction and 120 seconds overall.

| UTC snapshot                   | Current pointers | Ineligible | Total / maximum fetch |
| ------------------------------ | ---------------: | ---------: | --------------------: |
| 00:12:53, before release       |          167,500 |          0 |        5,036 / 286 ms |
| 00:15:04, new revision         |          167,511 |          1 |        4,954 / 314 ms |
| 00:17:54, after reconciliation |          167,523 |          0 |        4,790 / 285 ms |
| 01:17:54, one-hour checkpoint  |          167,773 |          0 |        5,395 / 287 ms |
| 02:17:54, final timed audit    |          167,979 |          1 |        4,939 / 285 ms |
| 02:20:44, convergence recheck  |          167,984 |          0 |        5,235 / 318 ms |

The 00:16:12 durable heartbeat reports two affected pointers rebuilt, sixteen
classification attempts and zero classification/dispatch failures or exhausted
attempts. The next heartbeat at 00:21:19 reports zero affected pointers and no
failures. Preserve the initial nonzero audit; do not replace it with only the
later zero. Each diagnostic transaction rolled back and closed its connection;
`jit` read `on` afterward. These snapshots are not continuous convergence proof.

The fixed **00:15–02:15 UTC** window contains 24 completed reconciliation batches
and 24 committed heartbeat steps, all at attempt one without an error. Batch
completion intervals are 307.554–316.922 seconds, including work before the next
five-minute sleep. Totals are 238 classification attempts, 14 affected pointers
and 14 queued rebuilds, with zero classification failures, dispatch failures,
exhausted attempts or stale runs. Twenty-five read-only health snapshots from
00:17:51 through 02:17:51 remain on the exact deployed worker revision.

The final timed audit again found one ineligible pointer. The 02:19:59 batch
completed with zero affected pointers, and the subsequent full audit found zero
ineligible pointers. This establishes later convergence, not that this particular
batch rebuilt that pointer; ordinary publication can also replace it. Retain both
nonzero snapshots and do not claim continuously zero ineligible pointers.

## Complete two-hour HTTP and delivery accounting

For the fixed **September 21 00:15–02:15 UTC** window, Datadog primary Web metrics
and independently collected Railway edge records agree exactly:

| Endpoint        | HTTP 200 | HTTP 400 | HTTP 401 | HTTP 403 | HTTP 409 | HTTP 5xx | Total |
| --------------- | -------: | -------: | -------: | -------: | -------: | -------: | ----: |
| Seeded delivery |    1,088 |        0 |        0 |      448 |        0 |        0 | 1,536 |
| Selection       |       33 |        1 |        0 |       31 |        0 |        0 |    65 |
| Playback        |    9,202 |        5 |        5 |      571 |        4 |        0 | 9,787 |

Playback 5xx is **0 / 9,787 (0%)**, below feat-464's stated 1% gate. No production
fault injection or denominator exclusions were used. Normal canaries and
admission-rejected traffic remain included; this is not a human-only rate.
The separate earlier 22:48 playback 503 remains in its earlier window.

All Railway edge windows cover their lower boundaries. Deduplication removes
one identical delivery row and six identical playback rows, with no conflicting
duplicates. Sorted-request-ID digests are, respectively:

- Delivery: `2995d9eac4b298d5bdba6ef5346e619434bfdfca3328ef6947dddc5db38c43fd`.
- Selection: `c4f50f32801e6e7508d26b101518e0cdb47af71c3afeb51d3d71a07ee1bfde50`.
- Playback: `5e32e3d3927ae6a140029da2ce0d123a1dace25ff63e8503441b0b4451f25ffd`.

Datadog and Railway each contain **1,536 delivery outcomes with identical grouped
messages**, including the 448 HTTP 403 rejections. The 1,088 HTTP 200 responses
comprise 946 served envelopes (728 six-card and 218 partial) and 142 fallbacks:

- 71 `no_candidates` and 57 `seed_embedding_unavailable` coverage fallbacks;
  two of these have three cards, while the other 126 have six.
- Nine `session_hour` and four `cooldown` rate-limit fallbacks, each six cards.
- One six-card `profile_lineage_ineligible` fallback.
- **Zero `delivery_timeout` and zero `retrieval_timeout` envelopes.**

Overall, 868 HTTP 200 responses contain six cards and 220 contain fewer. These
are final envelopes, not proof of helpfulness or browser receipt. Matching
aggregate outcome populations is not an individual request join. The 33 selection
HTTP successes likewise do not all carry browser-side validation; the six exact
acknowledgment canaries below do.

## Evidence transport and durable integrity

Datadog records 14,517 Web evidence outcomes, matching the combined primary
selection, playback and evidence request totals. Admin and Web agree on 8,003
accepted facts batches and 23 all-replay batches. Admin's 596 accepted claims plus
one claim replay agree with 597 Web claim successes. A trace-key aggregate joins
all **126 retryable transaction-busy attempts across 109 requests** to final Web
facts HTTP 200; the maximum is four failed attempts in one request, with no
exhausted-transaction signal. Failed attempts are not failed HTTP requests.

Two claim and two facts binding rejections are terminal HTTP 409 in both
boundaries. All 1,520 logged recognized-crawler evidence actions are rejected;
none is logged as successful. This does not identify every unrecognized bot or
prove cross-request browser retry behavior from a terminal log label alone.

Collector differences remain explicit: Railway has six additional initial-
evidence success records and 135 fewer Admin accepted-facts records than Datadog
in the same collector-time window, despite uncapped pagination. It also contains
124 rather than 126 transaction-busy observations. Do not substitute one
collector's event total for the primary-request denominator or assume timestamps
and retention are interchangeable. Delivery's exact group reconciliation is
independent of these evidence-stream differences.

At the **02:19:24 UTC** repeatable-read snapshot, the cohort of episodes created
in the fixed two-hour window contains 612 episodes, 10,600 facts and 207 replay
receipts. Fact/event sequence counts, replay ordinals/counters, original-fact
existence and capability/payload bindings all have zero violations. There are
230 finalized, 365 claimed and 17 pending episodes, with no finalized episode
missing its active-classifier outcome and no pending/claimed work overdue by
more than ten minutes. Still-active episodes are not incorrectly called finalized.

All 32 claimed recommendation episodes have valid exact selection bindings;
two lack attribution-eligible impressions, which is a separate allowed state.
Retained active-classifier revisions have 99 eligible and 156 excluded current
eligibility decisions. Their `human_anonymous` actor label is a classifier value,
not independent proof that all originating traffic was human. Facts and receipts
can arrive after the cohort's creation window, so these are snapshot invariants,
not a one-to-one HTTP-to-row reconciliation. The transaction rolls back, restores
JIT and closes its connection.

The paginated read-only Datadog inventory contains 41 distinct monitors. It has
legacy `service:watch` RUM load/error monitors and a Forge TV intake monitor;
none supplies the required Forge recommendation transport, crawler, exhausted-
retry and reconciliation alert coverage. Installation remains an unmet gate.

## Retrieval closeout and traffic mix

The ANN correction from PR [#2214](https://github.com/JesusFilm/forge/pull/2214),
commit `c2af7e75c`, is an ancestor of the running Admin revision. Its current nine
deterministic PostgreSQL regressions pass, including indexed incompatible-neighbor
retrieval and complete-service semantic/hybrid delivery. Current fixture cold/warm
times are 108/62 ms semantic and 144/100 ms hybrid, each with six cards. These are
not a rerun of the historical 280,107-vector snapshot; the earlier representative
308/185 ms semantic and 279/252 ms hybrid results retain their own boundaries in
the [original verification](../reports/2026-09-09-recommendation-retrieval-verification.md).

The two-hour persisted population is 1,075 requests, distinct from 1,088 final
HTTP 200 envelopes because persistence and final recovery are different stages.
There are 230 hybrid executions, 791 contextual executions, 51 curated fallbacks
and three semantic fallbacks. Compare these successful-issuance cohorts with
the earlier September 18 04:15–September 20 20:50 corpus:

| UI locale | Earlier requests / six cards | Release requests / six cards | Release retrieval p95 / max |
| --------- | ---------------------------: | ---------------------------: | --------------------------: |
| English   |              19,739 / 10,530 |                    755 / 494 |              278.3 / 457 ms |
| Spanish   |                2,307 / 2,307 |                    213 / 213 |              308.4 / 454 ms |
| French    |                1,026 / 1,021 |                        9 / 9 |              166.4 / 178 ms |
| Other     |                5,606 / 2,983 |                      98 / 64 |              243.4 / 382 ms |

UI locale does not identify audio. The first persisted item's audio groups in the
release are English 375/375 six-card requests, Latin-American Spanish 209/209,
French 9/9 and other audio 405/187; 77 requests have no persisted item from which
to read audio. Corresponding earlier counts are 7,145/7,145, 2,187/2,187,
1,022/1,020, 15,042/6,489 and 3,282 without an item. The release has 227 seed
groups versus 790 earlier; its top three account for 273/1,075 requests versus
5,534/28,678. Spanish UI's share rises from 8.0% to 19.8%, and canaries are included.
Do not describe the raw six-card increase as a causal improvement in coverage.

The deployed, reproduced query repair, current regression tests, representative
historical validation and complete final-envelope observation close **feat-470's
retrieval-repair scope**. General selection reliability, coverage expansion,
personalization helpfulness and the other explicit production gates remain
separately owned.

## Real browser lifecycle

Standard headed Chromium, using its native user agent and existing admission
policy, can exercise eligible selection. Earlier headless HTTP 403 probes were
not successful acknowledgment tests. No user-agent override, privileged
credential or admission exception was used.

The 00:15:03–00:17:06 UTC synthetic canary used the public Watch UI and actual
sound-on, visible playback at normal speed. No playback facts were fabricated.
Its episode and later request identifiers stayed in process memory for read-only
SQL correlation; retained artifacts contain only counts, public states and
booleans, not capabilities, cookies, private profile identities or vectors.

- Selection acknowledged with HTTP 200. The browser then played for 75 seconds.
- The episode finalized with recommendation attribution and 22 stored facts.
  Its `active-watch-proxy-v1` outcome had 75,588 active playback milliseconds,
  `qualified_view=true`, and current `profile`/`aggregate` eligibility.
- The current projection contained that outcome. A later request served six
  cards as `hybrid_personalized`, using a durable generation with two interests
  containing the same outcome. Assignment was absent; composition evidence was
  complete and had no shortfall or fallback.
- The canary switched personalization off through Cookie settings. Withdrawal
  returned HTTP 200 and `session_only`; the subsequent six-card request was
  `semantic_contextual` with no projection, interests or contribution from the
  played outcome.

This proves the correlated browser/SQL path and withdrawal behavior. It does not
substitute for the permission-checked Admin trace, complete erasure/reset fencing
checks, an ordinary-human success rate, or sustained reliability.

One earlier diagnostic queried `ORDER BY revision DESC` across both outcome
classifiers. Revisions are scoped by `(episode_id, classifier_version)`, so it
could select the legacy comparator with null active-playback fields. Its apparent
profile gap is invalid evidence. Filtering the active classifier corrects the
probe; no application change was required.

A second complete canary at **00:41:32–00:43:47 UTC** separately verifies reset and
deletion. Before reset, its later six-card hybrid request contains the actual
qualified playback outcome; the probe additionally matches the exact episode
item and claimed, attribution-eligible selection, rather than any row sharing
the original request ID.

Reset returned HTTP 200 and privacy generation 2. Read-only SQL confirmed the old
generation-1 root was tombstoned for reset, its token cleared and erasure
completed; session links, linked transitions, projection generations, pointers,
runs and consent receipts were all zero. The replacement request was ordinary
six-card contextual delivery with `profile_cold_start`, without the old outcome.
Deletion then returned HTTP 200 and `session_only`. The replacement root was
tombstoned for deletion with completed erasure and the same zero-reference
invariants. Later delivery remained six-card contextual with no old contribution.
This is independent erasure and future-influence evidence; it does not force a
stale publisher in production or exercise an operational last-known-good failure.

An earlier canary successfully reset but its diagnostic then called the browser
Fetch response's `status` property as a method. That harness exception is retained
as an incomplete run, not an API failure or a passing privacy proof. The corrected
canary above completes the sequence. No production database mutation was used
for setup or cleanup; all profile changes used the canaries' own normal API
credentials and public control plane.

## Delivery accounting and remaining selection uncertainty

For Web `4e31f822781f44df06e91c8194142a6c4b51646a`, the fixed
September 20 22:42–September 21 00:08 UTC window has **927 primary HTTP requests**: 632 HTTP 200 and 295 HTTP 403.
The first indexed grouping totals **924 events**: 629 HTTP 200 and 295 HTTP 403.
The 629 observed HTTP 200 envelopes comprise 436 six-card served envelopes, 143
partial served envelopes and 50 six-card coverage fallbacks (29
`seed_embedding_unavailable`, 21 `no_candidates`). No indexed envelope had
`delivery_timeout` or `retrieval_timeout`. The three unobserved HTTP 200 outcomes
were initially unknown, so the Datadog grouping alone could not establish zero
semantic timeouts.
An earlier live update incorrectly called these totals an exact reconciliation;
the explicit arithmetic here corrects that claim.

A subsequent independent Railway edge collection confirms **927 unique requests**
and the same 632/295 status split. Eighteen clipped five-minute windows cover
both boundaries; eleven repeated identical edge rows were deduplicated by
request ID, with no conflicting duplicates. The SHA-256 of sorted request IDs
joined with newline is
`f6e57f05367733187031f35f83d04acfc0317c696492c6761e2400d62a81d1d1`.

Railway's application stream returns 933 delivery log records, or **927 unique
nanosecond-timestamp/message pairs** after removing six exact repeated records.
Those outcomes have the same status split: 438 six-card served responses,
144 partial served responses, the same 50 coverage fallbacks, and 295 rejections.
No Railway outcome records a semantic timeout. The three-event difference from
Datadog consists of two additional six-card served outcomes and one one-card
served outcome. Two six-card events at 23:17:52 are present in Railway and absent
from the indexed Datadog minute. This resolves the earlier aggregate outcome gap;
it does not prove durable Datadog ingestion or individual browser delivery.

Application timestamps differ between collectors, including a delayed Railway
cluster near 00:07; use the full fixed window and retain this timing limitation.
Outcome events intentionally have no request identifier, so matching these
aggregate populations is not a per-request join. The complete post-release
window is reported above.

The same primary window contains fourteen selection HTTP 200 and one HTTP 400,
with no selection 5xx. Playback separately has one HTTP 503. That is the earlier
46.6 ms upstream fetch failure, not a selection deadline or semantic fallback.
Synthetic canary traffic remains included and is not described as ordinary-human
traffic. Those earlier observations alone do not establish sustained recovery.

The last retained selection HTTP 503 remains September 18 06:26:02, trace
`6aacd97a0000000044ebee408cdb1989`. Its capability call took 406.9 ms, including
a 275.9 ms query span, but other reads and application gaps also contributed.
A concurrent `GetWatchVideoDubDetail` took 1.5 seconds with slow small reads;
concurrency does not establish causation. Historical reconciliation heartbeats
place the 03:40, 03:45 and 06:26 selection samples between scheduled batches,
so the scan correction is not evidence that those stalls are fixed.

Current Admin/worker cgroups reported zero throttling and no memory pressure at
00:16 UTC. PostgreSQL's 00:22 snapshot had 22 other connections, all idle, and no
deadlocks. I/O timing is disabled: zero accumulated I/O time is not evidence of
zero I/O latency. These current snapshots do not diagnose the earlier failures.

A separate 60-second, 250 ms PostgreSQL sampler at 00:42:55 observed no blocked
PID. It saw catalog query ages up to 1,909 ms, other query ages up to 949 ms
around data-file I/O, and WAL-sync observations on queries aged at most 9 ms.
Query age is not wait duration. Four overlapping headed canaries acknowledged
selection in 246–269 ms and eight deliveries served six cards, so this catalog
activity alone does not reproduce the historical stall.

A following bounded sample identified language-inventory and workflow-event
replay queries among the longer active shapes. Read-only `EXPLAIN ANALYZE` of
the latter uses the run-ID index and top-N sort: it reads 29,858 events and
returns the first 1,000 in 67 ms. This does not include wire/result-decoding cost,
and neither that plan nor table-size estimates justify an index or runtime fix.
No shared database or service setting was changed.

PostgreSQL's retained checkpoint timestamps also place the last selection
failure between checkpoints: the previous one completed at 06:24:45.857 UTC,
76.9 seconds before the 06:26:02.748 failure; the next started at 06:29:37.647.
These are source timestamps parsed from the database records, not Railway's
occasionally batched collector timestamps. They provide no direct checkpoint
overlap and do not rule out other storage or application delays.

## Browser timing controls

Six headed, fresh-context checks at 00:24:01–00:25:14 UTC used the same
1280×577 viewport: three Chrome 153.0.8010.36 and three Chromium 149.0.7827.55.
All six checked acknowledgment nonces and target field types, with request-to-body times 300–533 ms;
twelve delivery responses served six cards without fallback. No captured React
error or selection abort occurred. Maximum captured native commit waits were
57.308 ms on Chrome 153 and 7.296 ms on Chromium 149. Event names and timing
fields were retained without trace arguments or request payloads.

Review found that those initial assertions did not compare both target values
with the selected card. A stronger six-journey headed Chrome 153 control at
01:48:12–01:49:38 UTC uses the same 1280×577 viewport and default features.
The renderer validates the exact nonce, canonical href and target media ID
against the issued card in memory. All six production selections return HTTP
200 and pass all three comparisons in 450–588 ms. Two journeys contain native
waits of approximately 1,013 ms elsewhere, but none overlaps selection; the
largest overlapping wait is 0.598 ms. One Node-side body access fails after
navigation even though the renderer completes and validates its response.
These stronger assertions supersede the earlier claim of full validation.

Eight additional headless browser controls supply a local 325 ms acknowledgment
fixture and intercept sibling evidence, playback and profile writes. They test
browser scheduling only: their HTTP 200s are not production API successes.
Alternating default behavior with a pre-click screenshot does not reproduce a
one-second wait during selection in either group, so neither the screenshot nor
a browser feature override is justified as a fix.

These controls did not reproduce the historical one-second commit wait or the
field 10–12 second delay after first byte. They do not close feat-520/521.
Node, Chromium and WebKit formatting controls agreed on hero runtime labels
for eleven locales; native-language casing differences normalize through the
existing helper. This does not identify the source of feat-523's field errors.

Further agent-browser controls recover the historical undrawn-frame throttle
but do not reproduce an affected selection interval. Native-UA headless requests
are HTTP 403 admission rejections; headed controls receive HTTP 200. Marks in
the actual renderer distinguish its body-read timing from a Playwright response
object that becomes unreadable after navigation. The
[feat-521 update](../roadmap/content-discovery/feat-521-watch-selection-browser-commit-waits.md)
records dimensions, feature controls and the limits of this experiment.

The original mobile paint cases have foreground long animation frames including
substantial framework work, but no source-mapped leaf cause. A matched-route
CPU-slowdown control did not recreate their 10–12 second delay after first byte;
an additional slow homepage sample identifies an Android emulator and belongs
to a separate cohort. See [feat-520](../roadmap/content-discovery/feat-520-watch-field-post-response-paint-attribution.md).
React #418 also persists on the current Web revision: eighteen errors across
eighteen ordinary-browser-named views in the fixed 22:42–00:50 window, separately
from six Googlebot errors in two views. This is not an incidence rate or a
confirmed human cohort. [Feat-523](../roadmap/platform/feat-523-watch-field-hydration-mismatch-attribution.md)
still needs the actual component and server/client difference.

## Closure checkpoint

The originally requested platform feat-513/516/517 and content-discovery feat-515
remain complete for their independently proven runtime/browser causes. Duplicate
Mobile ticket IDs in other lanes are outside this work.

| Ticket                     | Proven or newly completed work                                                                                  | Remaining closure requirement                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| content-discovery feat-470 | Complete: deployed ANN repair, nine current PostgreSQL regressions and reconciled two-hour delivery observation | None for the scoped retrieval repair; other causes remain separately owned                              |
| content-discovery feat-459 | Reproduced and deployed reconciliation scan correction; 24 healthy batches and full canonical audits converge   | Feat-464 dependency and authorized Admin gate                                                           |
| content-discovery feat-464 | Production evidence, terminal rejection and retry accounting; fresh database audits                             | Installed operational alerts, permission-checked Admin reconciliation and remaining acceptance evidence |
| content-discovery feat-447 | Real qualified-playback → hybrid influence, withdrawal, reset and completed erasure                             | Matching Admin trace; independent operational last-known-good and stale-publication proof               |
| platform feat-496          | Separate HTTP/envelope observability and rejected causal hypotheses                                             | Reproduce and fix the residual selection delay; a healthy window does not establish its cause           |
| content-discovery feat-520 | Field timing and resource phases; negative CPU-slowdown control                                                 | Source-mapped field or physical-device reproduction of pre-paint work                                   |
| content-discovery feat-521 | Historical native throttle identified; current exact acknowledgment controls pass                               | Matched affected selection interval and ordinary-field attribution before a correction                  |
| platform feat-523          | Current-revision field hydration errors confirmed separately from bots                                          | Actual component and server/client mismatch, then a demonstrated correction                             |

Content-discovery feat-497's curation expansion remains outside the explicit
no-republishing constraint. Feat-396's aged-retention/capacity evidence is not
supplied by this short observation; the reviewed first expiry is September 30.
No deadline, retry, permission, attribution, rate limit, homepage flag or authored
homepage block changed.
