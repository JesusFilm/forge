# Recommendation acceptance batch — September 29, 2026

This record separates implementation, release, production observations and
feature acceptance. The parent continues the
[batch plan](../plans/2026-09-29-002-feat-recommendation-acceptance-batch-plan.md)
from main `1c3a3761d0524b25d67427675228214814b84185`. Three isolated GPT-6 Sol
tasks own exposure, co-watch and telemetry closeout; the parent owns integration,
shared roadmap changes and exact-head merges. The original shared checkout and
other worktrees are preserved.

| Native Sol task                                                                                      | Pull request                                          | Effective access                                                              |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Complete feat-373 Watch exposure measurement](codex://threads/01a0e99d-9745-7ef1-82e0-392688ebeffe) | [#2450](https://github.com/JesusFilm/forge/pull/2450) | Full Access, approval never, network enabled; verified before implementation. |
| [Complete feat-387 production co-watch…](codex://threads/01a0e99d-a158-70e0-b8c9-a0899cefb60f)       | [#2448](https://github.com/JesusFilm/forge/pull/2448) | Task remained restricted; parent performed privileged operations.             |
| [Complete feat-545 bounded telemetry closeout](codex://threads/01a0e99d-ab21-72f0-a681-b31481af5146) | [#2447](https://github.com/JesusFilm/forge/pull/2447) | Full Access, approval never, network enabled; verified before implementation. |

## Acceptance state

| Ticket   | Current result                                                                                                                                                                       | Acceptance                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| feat-373 | PR #2450 is deployed and real V2 evidence is visible. Production inspection found a remaining hero authority gap and a mixed-policy display-bound gap; focused repairs are underway. | In progress; the full Admin coverage and performance gate remains open.             |
| feat-387 | Retry repair merged and deployed. Production preflight reached the 50,001-source sentinel; Admin confirms no generation or evaluation.                                               | In progress; there are no production graph metrics or terminal evaluation decision. |
| feat-545 | Retained historical evidence reviewed; nine precise owner decisions documented and merged.                                                                                           | In progress; D1–D9 remain pending explicit owner acceptance or resolving evidence.  |

No co-watch edge affects live viewer selection. No feature flag, conversion
pilot, experiment, live promotion, manual deployment, production data repair or
manufactured privacy event was authorized by these observations. CTR and shadow
overlap do not establish causal usefulness. Feat-505 retains its existing scoped
attribution contract with no new feat-373 prerequisite.

## Released work

- [PR #2447](https://github.com/JesusFilm/forge/pull/2447), telemetry decision
  record: reviewed head `82382261f27e0c1a300cfe212f4802fdfbb23d81`, normal squash
  merge `4e5ac3ae6ccb45d198fdd31a70cbb742b82d77ed` at
  `2026-09-28T20:29:01Z`. All 25 checks were terminal (14 success, 11 skipped),
  with no review threads. This documentation-only release requires no runtime
  deployment and does not accept a limitation.
- [PR #2448](https://github.com/JesusFilm/forge/pull/2448), exact co-watch retry
  tuple and terminal receipt repair: reviewed head
  `bfbbaea09598cb36869bb7c0fd3345e55057f65e`, normal squash merge
  `e0f864dd5436c0c1c0307de3b4c3dd4bb38906df` at
  `2026-09-28T20:56:28Z`. All 25 checks were terminal (17 success, eight skipped),
  including Admin build/test/lint/schema checks; no review threads.
- [PR #2450](https://github.com/JesusFilm/forge/pull/2450), origin-issued exposure
  evidence and bounded Admin reporting: reviewed head
  `e1ceb8f056f7fc8a43b71181a8d47bf04b8b5821`, normal squash merge
  `811f1ec81f359d1cf66cdda5bad8f5445631c44c` at
  `2026-09-28T22:21:16Z`. All 44 checks were terminal (39 success, five skipped),
  including the external Web check. All three CodeQL review threads were
  resolved and outdated, with no suppressed or dismissed alerts.

The [co-watch deployment receipt](../validation/cowatch-preflight-20260929/deployment.json)
verifies actual Admin HTTP and worker processes at `e0f864dd5` at 21:06:30 UTC,
health 200, expected runner roles and compact traces. Each service had one
successful active deployment; old active instances had drained. Only normal
PR-to-main deployment was used.

The exposure release's [migration receipt](../validation/recommendation-acceptance-20260929/migration-0105-verified.json)
confirms 0105 completed at 22:27:58 UTC with the reviewed source checksum and no
unfinished migrations. A metadata-only read through the deployed Admin process
at 22:41:32 UTC verified the validated CHECK and ready, valid unique btree index
over `(window_id, position, item_path)` only for served rows. The transaction
remained read-only with three-second statement and one-second lock bounds.
Database-service SSH had closed before returning a result; the existing Admin
connection supplied the catalog receipt without any access/configuration change.
The initial checker rejected PostgreSQL's quoted `"position"` spelling; independent
offline review corrected this exact comparison while preserving the original
result. No additional production query was needed for that correction, and the
earlier transport failure's cause remains unconfirmed.

The [postrelease runtime receipt](../validation/recommendation-acceptance-20260929/deployment-after.json)
verifies actual Admin HTTP, worker and Watch processes at `811f1ec81` at
22:45:23 UTC, all health 200 and one successful active deployment per service.
Admin roles remain HTTP `false` / worker `true`, with compact traces. A
[read-only signing comparison](../validation/recommendation-acceptance-20260929/signing-config-after.json)
confirmed matching configured values at that revision without exporting keys or
proofs. The storage owner received these receipts and retains capacity and
loaded-retention responsibility.

## Exposure validation and observed reporting defect

The full local Web suite before the final tooling correction passed 4,699 tests
across 276 files; the corrected parity suite subsequently passed 78 tests. The broad Admin
suite passed 7,455 tests before the last reporting change. The final report scope
has 12 focused tests, including seven real PostgreSQL cases, plus 13 page tests.
Application lint and configured type checks passed. The actual migration SQL
was tested under contention and rollback: the old constraint remains intact on
the two-second lock timeout, and a later unblocked attempt creates the intended
served-only uniqueness without constraining repeat client facts. Migration 0105
is exclusively owned by this exposure release.

The exact two-file local PostgreSQL command passed all eight new reporting and
migration tests. The CLI credential refused the workflow update because it lacks
workflow scope. The already-installed GitHub app accepted the exact two-line
content previously validated by those tests and normal repository hooks, in
commit `556b2164df2104f905463a6cccf8f4fdd7afe0c9`. No credential or permission
was changed. The final workflow includes both fixtures in its existing
PostgreSQL step; the child receipt's earlier local/manual-only note describes
the state before this successful publication.
CodeQL found two issues in verification tooling. The final fixture uses a
static HTML shell and JSON configuration endpoint with `nosniff`; the parity
oracle decodes HTML attributes once before resolving URLs. The `pageshow`
listener is installed before awaiting configuration, and both performance
modes include that same configuration fetch. All 29 browser checks passed
with 316 served and 316 rendered V2 facts, 33 accepted batches and zero fixture
ingestion errors. These changes do not alter production code. The preceding
CI run at `556b2164` directly confirms the seven report tests and one migration
test passed. Final head `e1ceb8f0` passed all four CodeQL analyses and the standalone
scan with zero annotations. Its application CI passed on attempt two: the first
attempt failed one unchanged mobile dismissal test, and one failed-job retry
passed without source changes. Review traced the transient assertion's missing
fake clock to an existing timing race, recorded under feat-367; this does not
implicate exposure runtime code or establish that the race has been repaired.

Parent review found and resolved source-authority gaps in raw and Markdown links:
actual browser document URLs, including aliases and rootless same-scheme URLs,
must establish the destination. Proven home bases are explicit; generic ambiguous
routes retain unknown served coverage. Server-only source compilers are absent
from client import graphs. Local browser fixtures remain distinct from deployed
Next.js behavior and production ingestion.

The [authorized Admin baseline](../validation/recommendation-acceptance-20260929/admin-before.json)
showed exposure aggregation unavailable. Narrow read-only diagnostics confirmed
the schema and indexes existed, isolated the anonymous query's three-second
statement timeout, and showed the signed query succeeded with six groups.
The anonymous query repeatedly scanned a materialized ranked relation for each
selection. A window aggregate removes that rescan while preserving exact
identity, policy, first-impression, cutoff, early-selection and repeat semantics.

One candidate read succeeded in production under the unchanged three-second
statement and one-second lock budgets. It returned the 129-group sentinel, so a
registry-entry/placement filter was added instead of raising the display bound
or inferring complete totals from a truncated table. This candidate SQL read is
not evidence that the repaired Admin UI was deployed. SSH elapsed intervals are
not SQL latency.

## Browser baseline boundaries

The parent retained six public-page samples, two navigations each for `/watch`,
`/watch/jesus.html` and `/watch/nua-fresh-perspective.html`, at 1280×800 with no
network/CPU emulation. A separate
[headed Chromium baseline](../validation/recommendation-acceptance-20260929/watch-browser-headed-before.json)
records the initial ordinary-browser route sequence at 21:16 UTC, without a
contemporaneously verified runtime revision. Mobile PR #2449 had merged at
21:12:05 UTC; its shared lockfile change caused ordinary deployments of all three services.
The [pre-exposure runtime receipt](../validation/recommendation-acceptance-20260929/deployment-before.json)
verified their actual revision `837028bf2` and health 200 at 21:43 UTC. A
[refreshed headed baseline](../validation/recommendation-acceptance-20260929/watch-browser-headed-before-verified.json)
repeats the same six navigations at that verified revision for the release
comparison. First-party encoded scripts total 837,272 bytes on home and 912,376
bytes on the video/series routes. These are
small mixed-cache samples on a shared development host; they cannot establish
population performance or a causal improvement.

The [admission record](../validation/recommendation-acceptance-20260929/browser-admission-before.json)
prevents conflating rendered pages with accepted telemetry. HeadlessChrome
matched the existing crawler classifier: 48 logged exposure submissions were
HTTP 403. The headed browser used its genuine Chrome user agent and no header
overrides; its rapid navigation sample recorded 30 HTTP-200 and 16 HTTP-429
submissions. These are request observations, not durable fact totals. Existing
admission and rate rules were preserved. A paced postrelease observation is
required separately from this rapid comparative loading sequence.

The refreshed baseline's [bounded network capture](../validation/recommendation-acceptance-20260929/watch-browser-headed-before-network.json)
contains 26 HTTP-200 exposure submissions and no delivery requests. Those are
the requests logged at collection time; the earlier cumulative admission sample
and this cleared capture are different populations.

The [native visibility observation](../validation/recommendation-acceptance-20260929/watch-browser-visibility-before.json)
also separates geometric intersection from eligibility. The existing first
series episode card had intersection ratio 1 and native `isVisible: false`.
The page reported visible/focused. A later observation found the episode-grid ancestor had
`backdrop-filter: blur(40px) saturate(1.5)`. Independent review found these
styles and the strict visibility hook unchanged by this release. Conservative
visibility rejection from those paint effects is an inference consistent with
Chromium's implementation; a later observer timeout remains unknown. No
visibility state or paint style was overridden to generate an impression.

Current public route wiring can naturally exercise five of the eight anonymous
registry combinations. Root and language home routes select
`WatchHomeExperiencePage`; the fallback `WatchHomePage` collection carousel/grid
emitters have no production caller. Authored dynamic grids and carousels instead
emit `watch-home / authored / authored-block`. Public video/episode routes do not
pass an authored experience into `mergeWatchExperience`, so the non-synthetic
video editorial emitter is also dormant. The loading sample alone does not
exercise search; that requires the normal search UI and returned results.
These three dormant entries remain coverage gaps, not measured zeros. No public
content or route was manufactured to obtain a complete registry. Generic authored
source ambiguity remains separately tracked by feat-564.

The owner explicitly chose to keep the fallback home carousel, fallback home grid
and video editorial entries as unresolved coverage gaps for this batch. This
decision preserves the registry and product scope; it does not satisfy their
coverage gates, complete feat-373 or accept any of the separate D1–D9 telemetry
limitations.

The deployed Admin [signed and dormant entry inspection](../validation/recommendation-acceptance-20260929/admin-signed-dormant.json)
retains each position in the below-player cohort, including eligible selections,
early selections, CTR and native/unknown visibility. These are rolling 24-hour
cohorts read at separate page-request times, not events attributed to this
browser. For You and all three dormant anonymous entries had no measured rows.
The signed replay audit showed 93 across the full window; its denominator is not
position-attributable, so no signed replay rate is inferred. Registry completeness
remains 2/10. Filtering restored inspectability without raising the 128-group cap.

## First deployed exposure observation and necessary follow-up

The [paced browser receipt](../validation/recommendation-acceptance-20260929/watch-browser-paced-interim.json)
records actual series navigation, episode playback, submitted search and home
scrolling. Its separate network capture has 17 HTTP-200 issuance requests and
18 HTTP-200 exposure submissions, no repeated issuance nonce, and no page errors.
The player reached ready state 4 and advanced playback without a media error;
this is not a click-to-first-frame latency measurement. No identity, visibility,
user-agent or admission override was used.

The [authorized anonymous cohorts](../validation/recommendation-acceptance-20260929/admin-anonymous-interim.json)
retain the displayed V2 values by position, plus legacy unknown-served summaries.
They include concurrent production traffic. Search shows ten served/rendered
positions and an early selection without an eligible impression. Natural chapter
rows include eligible impressions, an eligible selection, native/unknown
visibility and replay rates. These observations establish persisted production
evidence, not complete coverage, attribution to this browser, or usefulness.

The shared [Evidence and retention panel](../validation/recommendation-acceptance-20260929/admin-ingestion-interim.json)
still reports `LOSS SUSPECTED`, 189 committed rejections and zero write failures.
This is a shared rolling-window health display, not an exposure-only audit or a
cause attributed to this browser. Its retention label and purge timestamp do not
prove loaded purge throughput, and newer samples do not resolve D1–D9.

Two demonstrated gaps require another focused exposure release:

- The active home hero still emits V1 facts with no issuance request even in
  the paced sample. Manifest forwarding and signing configuration are intact.
  Source review isolates the union of all playable hero pools as the only
  content-dependent refusal: it returns no descriptor above 100 unique paths.
  The exact production pool size is unverified; the visible DOM has only a
  subset of pool candidates. A bounded per-candidate authority repair must keep
  the existing limit and avoid silently dropping candidates.
- Chapters still reach the 128-row sentinel after narrowing to `chapters-1`:
  62 visible V2 rows plus 66 legacy rows were shown, with the truncation warning.
  A policy-version filter is needed before the unchanged display bound. No
  totals or complete coverage are inferred from these truncated snapshots.

The initial and repeated postrelease six-navigation headed loading samples returned HTTP
200 for every document, but FCP/LCP were absent during collection. Selecting the
native tab did not restore them; a later screenshot was followed by a delayed
paint entry. The cause is unconfirmed. The [diagnostic comparison](../validation/recommendation-acceptance-20260929/loading-comparison.json)
therefore withholds a paint-performance conclusion and notes that resource/script
counts may omit deferred work. Rapid sequences hit the existing rate limit;
their request populations are separate from the paced sample above.
The baseline has usable paint values; an offline review correction preserves
those medians while leaving postrelease paint values and comparison deltas
unknown. No measurement was repeated to make that summary correction.

A [fresh headless baseline](../validation/recommendation-acceptance-20260929/watch-browser-headless-before-followup.json)
at `811f1ec81` has usable paint entries for all six samples and full observed
first-party scripts of 839,151 bytes on home and 915,840 bytes on video/series.
Its genuine HeadlessChrome agent is naturally crawler-excluded: 28 exposure and
30 issuance attempts returned HTTP 403. This is a loading baseline for the
follow-up release, not accepted viewer telemetry. The same mode and viewport
must be used for its comparison; no cross-mode paint comparison is valid.

## Co-watch refusal and telemetry decisions

The [co-watch preflight](recommendation-cowatch-preflight-2026-09-29.md) preserves
the exact bounded source query, runtime/migration observations and local
revision/privacy/rebuild fixtures. It establishes a lower bound above the
50,000-source cap before graph eligibility, not the eligible population or full
corpus size. No generation or evaluation operator ran. The authorized Admin
inspection reconciles the absence of a generation; displayed zero generation
counters are not zero eligible sources. A later attempt needs a separately
reviewed finite workload and fresh storage timing/capacity clearance.

The [D1–D9 decision record](recommendation-evidence-closeout-decisions-2026-09-29.md)
keeps net source-count differences, browser transport/status gaps, and missing
terminal activity/retry joins separate. No additional broad audit or runtime
instrumentation was justified. The owner must identify accepted decision rows
explicitly; investigation or merge authorization is not acceptance. Feat-545's
existing blocks on feat-372, feat-381 and feat-447 remain unchanged.

## Independent review and durable follow-ups

The three Sol tasks delegated source projection, services/contracts, browser and
database verification, and review to scoped workers. Parent reviewers independently
checked integration, schema/migration boundaries, source parity, SQL/filter
semantics, co-watch retry behavior and acceptance claims. Co-watch review covered
the six standard lenses plus security, API contracts, reliability, adversarial
and TypeScript review, with a final focused recheck after fixes. No blocking
findings remain in those reviewed snapshots; later changes require their own
checks and exact-head CI verification.

- [feat-563](../roadmap/content-discovery/feat-563-shadow-evaluation-dispatch-recovery.md)
  records existing same-ID dispatch races and queued-without-runtime recovery
  uncertainty. Exact retry tuples do not provide exactly-once dispatch.
- [feat-564](../roadmap/content-discovery/feat-564-cached-watch-public-navigation-authority.md)
  records the generic cached-alias public-path authority gap. It does not permit
  guessed destinations, cache bypass or invisible coverage claims.
- The existing [evaluation identity learning](../solutions/architecture-patterns/bind-eval-manifest-identity-to-execution-and-evidence.md)
  was extended instead of duplicating the principle in another document.

“Investigate production DB growth” retains storage capacity, conversion and
loaded-retention ownership. This batch did not duplicate its monitoring or
authorize its separate cleanup candidates. Datadog/Slack setup and feat-561
staging Auth maintenance remain outside this batch.
