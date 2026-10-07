# Precomputed recommendation orchestration

Updated: 2026-10-07 (Pacific/Auckland).

Parent: https://github.com/JesusFilm/forge/issues/2565.
Draft integration PR: https://github.com/JesusFilm/forge/pull/2578.
Roadmap: [feat-590](../roadmap/content-discovery/feat-590-precomputed-video-recommendation-experiment.md), in progress.

The [verification and handoff record](2026-10-05-precomputed-video-recommendation-verification.md)
preserves exact source/integration commits, checks, browser artifacts, review
findings, and recovery history. The [CTR operations note](../operations/precomputed-ctr-report.md)
describes the private reporting contract and limits.

## Integration

October 7 continuation: the owner requested completion of the live measurement
verifier, deployment configuration, actual catalog report and capacity checks.
The test must stop after one calendar month and return to the incumbent for
manual reevaluation. A working local demonstration is required before any
production merge. Numeric winner/health thresholds remain pending; fixture
settings are not live authority. Workers A/B continued from `5c9f38c6f`. Deployed-identity GA auth is
`9d2ff9944`; the one-month cutoff and browser-proof verifier are integrated as
`2069e87f6`. Their remaining live verifier/baseline work is still in progress.
The real GA/Astra two-video durable pilot is complete: two saved connections,
eight calls and $0.2494275 known model charges. The full 1,031-video generation
passed the GA timeout after `de5a20bf2`, then two candidate judgments failed
strict local evidence validation. That attempt is now cancelled, preserving
$2.3197855 known model charges and one unresolved call with unknown charge.
A bounded candidate repair is integrated as `aeb55b991` and `e4ecc23ad`:
strict evidence checks remain, each invalid response retains its charge, and
the two-attempt limit plus safe feedback survive checkpoint resume. The next
full build awaits the bounded real-model retrieval comparison: the exhaustive
implementation requires at least 53,612 plan/discovery calls before individual
judgments, versus 4,128 with the reviewed selected-content retrieval policy. The spec
permits catalog-wide retrieval without requiring exhaustive all-pairs reasoning.
The local Admin preview served the saved pilot after correcting PrismaPg's
selected-schema handling. Local Chromium verified the Admin review, Watch card,
successful selection and navigation to the target. Temporary gateways on the
existing Tailscale connection let the owner inspect this isolated pilot from
their host machine. On October 7 the owner confirmed that the preview looks
fine. The preview servers, gateways and temporary Redis are now stopped at the
owner's request to recover memory; their links are offline. Approximately
2.2 GiB of disposable caches and generated preview files were removed, with
source, selected catalog inputs and paid-build evidence preserved. No production
experiment is active; preview acceptance does not authorize its activation.

- Orchestrator: `01a109d7-dc1c-7600-a2c4-07dee79b4aff`.
- Initial base: `d661b99939e24ba41834adce53c6bad9262bcee9`.
- Branch: `codex/precomputed-video-recommendations`.
- Checkout: `/home/nisal/.codex/worktrees/precomputed-video-recommendations/forge`.
- Latest broadly verified integration: `5c9f38c6f`, with real source-build through
  manual controls and rollback under controlled local measurement. GA auth
  `9d2ff9944` passed the full Mastra suite and real read-only GA coverage.
  Follow-on baseline/browser-proof work and real-catalog compatibility fixes
  still require combined validation.
- Previous verified application integration: `6b9c9836a44c90983489534355857858ddab0708` (#2574 Mastra `af835cdd0`, Admin `f18768c39`, current-main merge `ae9bc5363`, root verification `6b9c9836a`). Current-main baseline is `1daa80373`; storage CI passed: [run 37419891818](https://github.com/JesusFilm/forge/actions/runs/37419891818), 37 successful jobs, three skipped, no failures.
  #2568 GA ingestion is `084fe3eae`, Admin validation is `58b2aaa18`,
  and the OpenRouter adapter is `b7926faf5`.
- Catalog integration `285bb46eb` passed [forge-ci run 37411231982](https://github.com/JesusFilm/forge/actions/runs/37411231982): 37 successful jobs, three skipped and no failures.
- The PR records the current published integration SHA and [CI checks](https://github.com/JesusFilm/forge/pull/2578/checks).
  The published navigation integration `ffd1feb21` passed [forge-ci run 37403077030](https://github.com/JesusFilm/forge/actions/runs/37403077030), with 37 successful jobs, three skipped jobs and no failures.
- The original dirty `/home/nisal/forge` checkout is preserved.
- Development chats use exactly `gpt-6-sol`; the application model remains
  `gpt-6-astra`. Matt Pocock implement/TDD/code-review workflow only; no
  Compound Engineering skills or agents. Normal hooks remain required.

## Execution ledger

All issues remain open until merge. Dependencies advance on verified acceptance,
not issue closure. Implemented, integrated, merged, and live are distinct.

| Issue | Immediate blockers | State                                         | Integrated work                                                                                         |
| ----- | ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| #2566 | None               | Integrated-and-verified                       | `9a984c544`; saved Admin comparison                                                                     |
| #2567 | #2566              | Integrated-and-verified                       | `c89db0e4e`, `0636bf861`; exact Astra durable two-video pilot complete                                  |
| #2568 | #2567              | Integrated-and-verified                       | `084fe3eae`, `58b2aaa18`; real GA pair and Astra judgment passed                                        |
| #2569 | #2568              | Code verified; full real build incomplete     | `1298713cc`, `04200cd9f`; 20 connected native cases and 37 Admin cases passed                           |
| #2570 | #2566              | Integrated-and-verified                       | `0a93244a3`; private Watch serving                                                                      |
| #2571 | #2570              | Integrated-and-verified                       | `267a65281`, `b69592b6c`, corrections in `a7f36d778`                                                    |
| #2572 | #2571              | Integrated-and-verified                       | Core `a7f36d778`, UI `af8eba415`                                                                        |
| #2573 | #2572              | Private reporting verified; live incomplete   | Sources `acbb33fe4`, `302dffe31`; migration `0134`                                                      |
| #2574 | #2569, #2573       | Code integrated-and-verified; live incomplete | `af835cdd0`, `f18768c39`; native retention and measured fixture load passed                             |
| #2575 | #2574              | Code integrated-and-verified; live incomplete | `082fc550f`, `84ef7ce38`, `127b61e1f`, `8401049c1`; isolated native rehearsal and browser checks passed |

## Ownership and continuation

Both workers started #2575 from locally verified integration
`6b9c9836a44c90983489534355857858ddab0708`, also their fixed review base.

Worker A, `01a109e1-47c8-7043-bfd4-a85592cfafc5`, titled
`#2575 Wire Watch experiment controls`, owns Web consumption, stable browser
assignment, trusted admission propagation and click flow, plus the thin Admin
public-delivery GraphQL adapter and generated SDL/client operation.
Checkout: `/home/nisal/.codex/worktrees/feat-590-2566/forge`;
branch: `codex/feat-590-2575`.

Worker B, `01a10a28-aa8e-7080-b3d1-c59293f8f4dd`, titled
`#2575 Add Admin launch and rollback controls`, owns Admin authorization,
manual controls, readiness/audit, migrations, public delivery services,
report qualification and operator run procedure.
Checkout: `/home/nisal/.codex/worktrees/feat-590-2570/forge`;
branch: `codex/feat-590-2575-live-admin`.

Current continuation ownership: A completed strict candidate-evidence repair and
the retrieval audit, and delivered deterministic catalog-wide retrieval in
`31dfe6fe6` and `b717ec718`. A bounded real-model reference comparison precedes
the next full build. B's conditional
live prepare/start readiness and fresh append-only launch-capacity evidence are
integrated; B delivered experiment-scoped Web attribution telemetry and its Admin
report reconciliation as `cc4e97fd4`, now integrated and locally verified. B owns the
final calibration receipt and evaluator under reserved migration `0140`.
The trusted independent calibration source/key and owner loss threshold remain
external inputs; unknown browser/network loss stays explicit.
The orchestrator owns local preview/schema selection and actual build resumption.
The CI repair is committed locally as `ba0376723`. Retrieval integration
`16cce70f4` includes the reviewed worker commits and main `89f0f99a6`, which contains the separately
merged Expo maintenance PR. GitHub rejected publication of the CI repair because
the current OAuth login lacks workflow scope. The first device code expired;
fresh owner authorization is still required. The remote feature PR remains
at `a9cbf8362` and is still a draft.
The completion notes below record earlier slices.

Both workers have completed their owned implementation and normal-hook commits.
A source `3112244b7` is integrated as `127b61e1f`; B sources `ac78b3c85` and
`a41a6807a` are integrated as `082fc550f` and `84ef7ce38`. They remain available
for specific review or CI fixes. B’s follow-up `452fd51dc` is integrated as
`8401049c1`, restoring closed private report evaluation and correcting the
bounded-retention fixture. No additional implementation chat was created.
Previous branches and integrated work remain saved.
The orchestrator owns cross-app integration tests, live operator verification,
shared docs/roadmap, integration and the single PR. The October 7 instruction
authorizes necessary deployment preparation; production merge/deployment remains
behind the requested local demonstration. No public activation, promotion or
recurring schedule has occurred. At most two implementation
chats may run. Serialize heavy validation with
`/tmp/forge-feat590-heavy-validation.lock`.

A read-only current catalog count at 2026-10-06T02:11:35Z found 1,031 eligible
Videos, 859 with transcripts and 858 with English transcripts. Across all
languages it found 164,639 transcript records declaring 280,046 chunks; one Video
declares 80,248 chunks. This measures the current workload, not a frozen build
snapshot, completed generation or capacity proof. Artifact:
`/tmp/forge-feat-590-orchestration/catalog-build-dimensions.json`.

## Verified acceptance and qualifications

Private visits use signed browser identity independently of profile learning
controls. Multiple accepted clicks/retries contribute one clicked visit; empty,
failed, and fallback visits remain in the assigned denominator. Individual card
traces require trace-review permission. Raw data retains the ordinary 29-day life.

#2573 transfers expired visits atomically into per-browser counts and arm totals,
retains compact replay markers, and preserves private request provenance after
links expire. Shared transaction fences and the fixed cutoff protect accepted
receipts, snapshots, and delivery summaries. The method uses visit-weighted CTR
with a conservative browser-cluster Student-t approximation. Reports are immutable,
bounded to 32 provisional revisions plus one final result, and cannot activate
or promote anything. Private unverified measurements always remain inconclusive.

Combined checks through migration `0134` passed: 89 precomputed/playback/profile/
Admin-action cases, the exact 20-case profile-scale CI pair, 15 ordinary-delivery
native cases (one intentional skip), 130 default-off Admin regressions, 109 Web
cases, and six retention cases on a fresh migrated database. The first profile
pair run exposed duplicate fixture DDL; the source-chain correction passed all
20 on repeat. Three typechecks and regenerated SDL/client drift checks passed.
The worker full Admin suite passed 8,986 tests (774 skipped, one todo); earlier
verified full Web and Mastra runs are preserved in the detailed record.
Final whole-spec Standards and Spec review against the initial base found zero
confirmed defects in the delivered slices. The known fixture caveat is closed.

Root inspected the #2573 desktop/mobile screenshots and loading data. Eight
alternating warm HTTP samples per mode measured median total response time
178.95ms baseline / 207.8ms with the report, and 61,022 / 78,004 HTML bytes.
Both modes used 19 identical static assets. Tables scrolled within their mobile
containers; no browser console errors were recorded. This is synthetic development
HTTP/layout evidence, not FCP, production auth/database performance, or capacity.

The report API is
`GET /api/recommendations/precomputed/ctr-report?experimentId=...&revision=...`,
using an existing Admin OAuth session cookie and `read:recommendation-aggregates`.
Omit `revision` for the latest saved result. No new AI plugin or bearer credential
was introduced. Evaluation and fixture-policy declaration require operator permission.

The GitHub credential cannot change workflow files. Retention regressions run
through the existing CI entry point; no workflow edit remains. Published history
was preserved when the earlier unpublished workflow revision was rejected.

The #2568 qualification continuation passed independent Standards/Spec review,
with its single source-identifier length/wrapping finding fixed. Combined checks
passed 70 Admin/native, 15 source-build-through-review, 59 default-off and nine
Mastra cases. Both affected package typechecks passed. Full worker suites passed
8,987 Admin and 3,223 Mastra cases before the final bounded cap/wrap fix; focused
checks covered that fix. No migration or GraphQL change was introduced.
Ten alternating synthetic Next samples measured median total response times
130.6ms without qualification and 136.9ms with it, adding 2,189 HTML bytes with
the same 19 static assets. This remains local development evidence.

The GA reader continuation is integrated from `b0892f4e4`: full Mastra tests
passed 3,238 cases (37 configured skips), and final independent review found no
unresolved defects. Real Node impersonation/coverage and aggregate-page reads
succeeded while explicitly retaining source truncation and unknown mappings.
After merging current main `8ebd6500c`, both application typechecks, 15 native
generation-to-Admin cases, 23 Mastra cases, 68 retention unit/workflow cases and
seven fresh PostgreSQL retention cases passed. The additive test conflict kept
both implementations' cases. The completed fixture ticket now uses feat-612;
main's new feat-609 HNSW work is preserved. No history-backed model build or
public experiment activation is implied by these checks.

## External inputs and boundaries

The user signed into GA4 property `320198532` and the Cloud console. Browser
inspection confirmed its existing daily BigQuery link to `cru-ga4-prod-1` and
successful metadata/aggregate reads in `jfp-data-warehouse`. The candidate
`cru-ga4-prod-1.analytics_320198532` remains denied-or-nonexistent, not a verified
source path. Two readable exact-property copies cover only March–July 2023 and
have no viewer/session keys for video starts. They cannot establish transitions.
A combined-event candidate has nonplaceholder keys for mostly 2021–2022 Watch
starts; its lineage, sequence semantics and canonical mapping remain unverified.
See the [GA discovery record](2026-10-06-precomputed-video-recommendation-ga-discovery.md).

The user explicitly restricted historical evidence to verified JesusFilm.org
hosts and exact `/watch` or `/watch/` descendants. Query strings/fragments do not
change scope; unrelated hosts, `/watching`, and other pages are excluded. The
current event source or a verified aggregate transition source and canonical
Video mapping remain unresolved. Remote ADC is now saved with owner-only
permissions and BigQuery API metadata reads succeed. Current GA reports also
contain Watch data: the exact host/path-filtered September 8–October 5 report
shows 283,064 page views and 1,014 `videostarts`. Older warehouse-copy dates do
not describe the live GA reporting range. The direct GA Data API probe failed
with insufficient OAuth scopes because the sign-in command omitted
`analytics.readonly`. Adding it to the default ADC client was subsequently
blocked by Google. The installed SDK lists that scope as being blocked for its
default client; a supported project-owned OAuth client or appropriately
configured service identity was required. The existing Cloud credentials remain
present. No policy bypass was attempted.
Tatai subsequently supplied project `jesusfilm-org-1738781064783` and service
account `watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com`.
Remote impersonation with `analytics.readonly` now succeeds using the existing
Cloud ADC login, and GA Data/Admin API reads return HTTP 200. No downloaded key,
new user login, or agent-created IAM change was needed. The standard API request
works without a quota-project override; explicitly overriding the quota project
returned `USER_PROJECT_DENIED`, so no additional role was requested for that
unnecessary override. API authentication is resolved.

The Watch-filtered report from property creation (June 21, 2022) through October
3, 2026 returned all 200 monthly/event aggregate rows, including 4,006,892
`videostarts` across September 2022–October 2026. This is report coverage, not
verified complete raw-event history. Recent video-ID coverage is incomplete:
720 of 1,017 starts in a separate September 8–October 5 observation have an empty
or unset `mediacomponentid`. Page paths provide a mapping lead. The dedicated
TypeScript reader performs scoped reads with bounded pagination, property-local
cutoff guards and explicit source truncation. Actual live coverage and aggregate
page reads passed; they do not yet constitute a qualified model build.

On 2026-10-06 the user approved validated Watch referrer links plus engagement
for the first build, labeled as navigation evidence. This replaces the original
requirement to prove consecutive playback for this GA input. A bounded probe
confirmed 450,061 destination starts with a Watch referrer, including homepage
and self-referrals, and retrieved 100 of 163,347 pair rows. One pair associated
1,648 starts of the Spanish Birth of Jesus page with the Spanish The Beginning
referrer. These are aggregate associations, not unique navigations or individual
journeys. Current endpoint mapping passed a bounded live pair read, and the connected
reader-to-model-to-Admin path passed native tests with controlled inputs. The
full production catalog build remains pending. Provider-declared historical gaps stay unknown even when
all pages of the separately declared usable interval have been processed.

#2568 navigation ingestion and #2569 resumable builds are integrated and verified. No unavailable transition,
exposure, bot-filter, or exclusion count becomes zero. No new export/link or
warehouse write is authorized.

#2573 live winner certification remains incomplete: the measured human baseline,
agreed numeric stopping settings, trusted bot qualification, and tracking-loss
evidence are absent. Production cookie forwarding, actual catalog cost, and
measured capacity/headroom also remain prerequisites where required. Fixtures
cannot satisfy these criteria. #2574 code and local loaded cleanup are verified; actual production capacity approval remains incomplete. #2575 code is integrated and locally verified through `8401049c1`. Live start remains unavailable until a trusted qualification verifier and its real inputs exist.

Public experimental serving stays default-off and the incumbent remains available.
Do not merge, deploy, start public A/B traffic, promote a winner, or enable refresh
scheduling without the separate required authority. Preserve useful worktrees and
the owned PostgreSQL 18 integration database on loopback port `32810`.

## OpenRouter continuation

The user requested OpenRouter instead of provisioning a direct OpenAI key.
The existing Railway Mastra service has a configured OpenRouter credential, and
the live provider catalog includes the exact `openai/gpt-6-astra` model with
structured-output support. The orchestrator owns the narrow provider adapter
and transport tests; the Sol chats retain their GA/Admin ownership.

The actual adapter passed a live structured-output smoke on 2026-10-06:
41 input tokens, 12 output tokens, and $0.00101 reported cost. The response
identified `openai/gpt-6-astra`. No credential was printed or saved. Evidence:
`/tmp/forge-feat-590-orchestration/openrouter-astra-live-smoke.json`.
This verifies model access and transport, not recommendation quality, catalog
cost, or a completed GA-backed generation. The adapter retains validated
structured output, the same application model stamp, and explicit token usage;
it disables provider fallback and SDK retries. Development chats remain Sol.

## Verified live navigation sample

The read-only GA smoke processed all 4,329 snapshot rows over 44 pages for
The Beginning → Birth of Jesus. Current catalog mapping qualified 3,948
navigation-associated destination starts and left 27 unmapped; destination
engagement was 123,894 starts, with engaged views and exposures unavailable.
The usable interval was August 6, 2022–October 3, 2026, preserving the unavailable
requested prefix. This used a local fixture of real read-only current catalog
rows, not a production Admin build or verified historical URL ownership.

Astra then judged the real pair through OpenRouter using its published metadata
and these GA aggregates. The explanation preserved all evidence limits. This
one-pair call used 865 input/198 output tokens and cost $0.01855. Native controlled
build-through-Admin review and the bounded live checks are distinct evidence;
none is a full catalog cost/coverage report.

Saved GA usage counts are snapshot-scoped. The smoke made 53 report requests:
44 snapshot pages, seven qualification reports, and two smoke-only size previews.
#2569 must account for qualification and retry overhead in complete build reports.

## Final navigation integration verification

The combined committed Mastra/Admin implementation passed all 16 native
build-through-review cases and 23 focused Admin catalog, contract and view cases.
Both application typechecks, focused lint/format and diff checks passed.
The worker full suites passed 3,250 Mastra and 8,999 Admin cases. Separate
Standards and Spec reviews have no unresolved findings in this slice. The new
root integration case uses synthetic GA HTTP and controlled model output; live
qualification and the real Astra pair judgment remain separately labeled above.
#2568 is integrated-and-verified under the approved navigation revision, unlocking
#2569. Full catalog execution and its capacity/cost report remain future work.

## Catalog integration verification

#2569 passed 20 native build-through-Admin cases, including four new catalog
resume/refresh/charged-retry/GA-receipt cases, plus 37 focused Admin native and
view cases. Both package typechecks, root lint/format, and the fresh full
migration chain through `0135` passed. Worker suites passed 3,257 Mastra and
8,999 Admin cases. Standards and Spec reviews found no remaining confirmed
defects in this slice; capacity-race and protocol-isolation findings were fixed.

Desktop and mobile report checks found no horizontal overflow or console errors.
Ten alternating warm synthetic development requests measured median total HTTP
response time 142.34ms baseline / 147.28ms with the report, and 62,426 / 76,420
HTML bytes, with the same 19 assets. This is local rendering evidence, not
production latency or capacity. The temporary preview route was removed.

The current OpenRouter adapter also captured the exact $0.00101 provider charge
on a fresh live Astra smoke. Full catalog execution, deployed GA credentials,
measured build/retention capacity, and public experiment readiness remain pending.

## Storage integration verification

#2574 passed 21 connected build-through-Admin cases, 63 focused Admin native/view
cases, 13 Mastra runtime/workflow cases and seven dedicated ordinary-retention
cases. The official migration chain through `0136`, both package typechecks and
the root seam typecheck passed. Worker full suites passed 3,267 Mastra cases and
8,999 Admin cases; focused native checks cover the subsequent pin-race fix.
Sequential Standards then Spec review found no unresolved defect in this slice.

The isolated loaded fixture reclaimed 6,715 expired request roots and 34,395
served items in 68 successful bounded runs, preserving 6,715 archived visit
receipts. Allocated relation bytes did not shrink. This is measured local
throughput, not a production capacity budget. The actual controlled source
workflow also verified compact native runtime persistence. Full qualifications
and machine receipts are in the storage runbooks and detailed verification record.

Desktop/mobile report layout passed, including a 191-character generation ID
and independent table scrolling. Five alternating warm HTTP samples per mode
measured median 123.090ms for the empty comparison view and 196.456ms for the
storage view, 62,428 versus 82,582 HTML bytes, with the same 19 assets. The added
report has a measurable local development render cost; this is not a before/after
comparison of the same page or production latency proof. Protected route access
without authentication still redirects to login. Temporary preview files and
server were removed. Public serving remains off.

## Manual-control integration verification

The complete connected native suite passed 25 cases, including actual controlled
catalog builds, no implicit activation, explicit fixture preparation/start,
stale-target rejection, signed clicks after rollback, raw expiry with identical
retained arm counts, fixed browser assignment, frozen-cohort exclusions, and an
actual evaluator-produced fixture winner followed by exact promotion/rollback.
A separate case exercises real native incumbent retrieval and signed selection
after saved-signer failure, preserving the original challenger denominator.
Fixture counts and provider receipts are synthetic; no live winner is claimed.

The official migration chain through `0137` and seven ordinary-retention tests
passed on a fresh disposable native database. Watch's full worker suite passed
4,780 tests (10 skipped, one todo); Web and typed-client checks passed. Admin's
final full suite passed 9,019 tests (810 skipped, one todo), and all 42 focused
native cases passed. Admin and seam typechecks, regenerated schema/client drift
checks and Next route types passed. Final published-head CI is tracked on the PR.

Admin desktop/mobile checks passed with 191-character IDs, table scrolling,
report expansion, and no console errors or document overflow. Unauthenticated
prepare/rollback showed an error without changing the pointer. The real page
redirected to login (307); the API returned 401. Four alternating warm samples
per mode measured median 112ms baseline / 106.5ms controls, 52,911 / 62,381 HTML
bytes and 22 script tags in each mode. These small local development samples do
not establish production latency or authenticated query cost. Temporary preview
route/server were removed and viewport reset.

The live start/promotion verifier is deliberately incomplete pending trusted
human/bot and loss-audit inputs. The Admin page reports this as blocked and the
services reject live authority. Thus #2573–#2575 and feat-590 retain incomplete
live acceptance; PR #2578 remains a draft. No public A/B traffic was activated.
